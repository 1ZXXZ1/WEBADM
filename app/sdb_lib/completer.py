"""
SDB Комплитер - TAB-автодополнение для интерактивного режима SDB.

Поддерживает 3-уровневое контекстное автодополнение:
  - Уровень 1: SDB команды (USE, SELECT, TOOL, FORMAT, SHOW, ENABLE, DISABLE, ...)
  - Уровень 2: Типы объектов (USER, GROUP, COMPUTER, OU, GPO, DATABASES, ...)
  - Уровень 3: Имена из БД (имена пользователей, групп, компьютеров - через ldbsearch)

Имена из БД подгружаются автоматически через ldbsearch и кэшируются.
После CREATE/DELETE/ENABLE/DISABLE кэш обновляется.

Поддерживает контекстное автодополнение на ..> продолжении:
  - Показывает БД-источники, а не команды верхнего уровня
"""

import os
import glob
from typing import List, Optional

from sdb.config import (
    LDB_DATABASES, OUTPUT_FORMATS, SAMBA_TOOL_HELP,
    SAMBA_TOOL_SUBCOMMANDS, SQL_TABLES,
)

# ─── LDAP-атрибуты для автодополнения WHERE/FILTER ─────────────────────────

LDAP_ATTRIBUTES = [
    "objectClass", "cn", "sAMAccountName", "sAMAccountType",
    "userAccountControl", "distinguishedName", "dn", "displayName",
    "givenName", "sn", "initials", "description", "mail",
    "department", "company", "title", "telephoneNumber",
    "physicalDeliveryOfficeName", "mobile", "streetAddress",
    "l", "st", "postalCode", "co", "countryCode",
    "member", "memberOf", "primaryGroupID",
    "objectSid", "objectGUID", "whenCreated", "whenChanged",
    "uSNCreated", "uSNChanged", "pwdLastSet", "lastLogon",
    "lastLogonTimestamp", "accountExpires", "lockoutTime",
    "badPwdCount", "badPasswordTime", "logonCount",
    "codePage", "countryCode", "unicodePwd", "userPrincipalName",
    "servicePrincipalName", "homeDirectory", "homeDrive",
    "scriptPath", "profilePath", "userWorkstations",
    "dnsRecord", "dc", "objectCategory",
    "objectSid", "privilege", "comment",
    "xidNumber", "type",
    "path", "comment", "volume",
]

# ─── objectClass значения ──────────────────────────────────────────────────

OBJECT_CLASSES = [
    "user", "group", "computer", "organizationalUnit", "container",
    "dnsNode", "groupPolicyContainer", "person", "organizationalPerson",
    "contact", "sidMap", "privilege",
]

# ─── Типы DNS записей ─────────────────────────────────────────────────────

DNS_RECORD_TYPES = ["A", "AAAA", "PTR", "CNAME", "MX", "NS", "SOA", "SRV", "TXT", "ALL"]

# ─── Типы объектов для SHOW/DELETE/LIST/ENABLE/DISABLE ─────────────────────

SHOW_TYPES = ["DATABASES", "USER", "GROUP", "COMPUTER", "OU", "DNS", "GPO", "CONTACT", "HELP"]
LIST_TYPES = ["USERS", "GROUPS", "COMPUTERS", "OUS", "CONTACTS", "GPOS"]
DELETE_TYPES = ["USER", "GROUP", "COMPUTER", "OU"]
ENABLE_DISABLE_TYPES = ["USER"]
CREATE_TYPES = ["USER", "USERS", "GROUP", "COMPUTER", "OU"]

# ─── Подтипы SYNTHESIS ──────────────────────────────────────────────────────

SYNTHESIS_TYPES = ["SCHEMA", "ENTITY", "RELATION", "ASSOCIATION", "NORMALIZE"]

# ─── SQL-like таблицы ──────────────────────────────────────────────────────

SQL_TABLE_NAMES = sorted(SQL_TABLES.keys())

# ─── Опции samba-tool ────────────────────────────────────────────────────

SAMBA_TOOL_OPTIONS = {
    "user": {
        "create": [
            "--given-name=", "--surname=", "--initials=",
            "--display-name=", "--job-title=", "--department=",
            "--company=", "--description=", "--mail-address=",
            "--telephone-number=", "--userou=",
            "--must-change-at-next-login",
            "--use-username-as-cn",
        ],
        "setpassword": [
            "--newpassword=", "--must-change-at-next-login",
            "--no-expiry",
        ],
        "list": ["--verbose"],
        "show": ["--attributes="],
        "getgroups": ["--recursive"],
    },
    "group": {
        "create": [
            "--group-scope=", "--group-type=", "--description=",
            "--mail-address=",
        ],
        "list": ["--verbose", "--hide-builtin"],
        "listmembers": ["--recursive"],
    },
    "computer": {
        "create": [
            "--computerou=", "--description=",
            "--ip-address=", "--service-principal-name=",
            "--prepare-oldjoin",
        ],
    },
    "ou": {
        "create": ["--description="],
    },
    "dns": {
        "query": [],
        "add": [],
        "delete": [],
    },
    "domain": {
        "passwordsettings": [
            "--complexity=", "--history-length=",
            "--min-pwd-age=", "--max-pwd-age=",
            "--min-pwd-length=", "--store-plaintext=",
        ],
    },
    "fsmo": {
        "transfer": ["--role="],
        "seize": ["--role="],
    },
    "gpo": {
        "create": [],
        "list": [],
        "listall": [],
    },
}


class SdbCompleter:
    """
    Контекстный TAB-комплитер для SDB с 3-уровневым автодополнением.

    Уровень 1: Команды (USE, SELECT, TOOL, SHOW, ENABLE, DISABLE, ...)
    Уровень 2: Типы объектов (USER, GROUP, COMPUTER, OU, GPO, DATABASES)
    Уровень 3: Имена из БД (подгружаются через ldbsearch)

    Имена из БД кэшируются и обновляются при CREATE/DELETE/ENABLE/DISABLE.

    Контекстное автодополнение на ..> промпте:
      - Определяет контекст начатой команды
      - Показывает релевантные дополнения (имена из БД, а не команды)
    """

    def __init__(self, engine=None, client=None):
        self.engine = engine
        self.client = client

        # SDB команды верхнего уровня
        self.sdb_commands = sorted([
            "USE", "SELECT", "WHERE", "FORMAT", "OUTPUT",
            "TOOL", "SHOW", "SET", "FIELDS", "LIMIT",
            "SEARCH", "DATAFRAME", "HELP", "IMPORT", "CREATE",
            "ENABLE", "DISABLE", "DELETE", "LIST", "SYNTHESIS",
            "quit", "exit",
        ])

        # Имена баз данных
        self.db_names = sorted(LDB_DATABASES.keys())

        # Форматы вывода
        self.output_formats = sorted(OUTPUT_FORMATS)

        # Буфер для ..> промпта
        self._buffer_context = ""

    def set_buffer_context(self, buffer: str):
        """Установить контекст буфера для ..> промпта."""
        self._buffer_context = buffer

    def complete(self, text: str, state: int) -> Optional[str]:
        """Функция автодополнения для readline."""
        try:
            matches = self._get_completions(text)
            if state < len(matches):
                return matches[state]
        except Exception:
            pass
        return None

    def _get_completions(self, text: str) -> List[str]:
        """Получить список вариантов автодополнения для текущего ввода."""
        try:
            import readline
            line = readline.get_line_buffer()
        except ImportError:
            line = text

        # Если есть контекст буфера (..> промпт), добавляем его
        if self._buffer_context:
            full_line = self._buffer_context + " " + line.lstrip()
        else:
            full_line = line.lstrip()

        line_stripped = line.lstrip()
        line_upper = line_stripped.upper()
        full_upper = full_line.upper()

        # Пустая строка - показать все команды
        if not line_stripped:
            return [c + " " for c in self.sdb_commands if c.startswith(text)]

        # USE <database>
        if full_upper.startswith("USE "):
            after_use = full_line[4:].lstrip()
            return self._complete_from_list(line_stripped[4:].lstrip() if line_upper.startswith("USE ") else text, self.db_names)

        # FORMAT <format>
        if full_upper.startswith("FORMAT "):
            return self._complete_from_list(line_stripped[7:].lstrip() if line_upper.startswith("FORMAT ") else text, self.output_formats)

        # FIELDS <fields>
        if full_upper.startswith("FIELDS "):
            after_fields = line_stripped[7:].lstrip() if line_upper.startswith("FIELDS ") else text
            return self._complete_from_list(after_fields, LDAP_ATTRIBUTES)

        # WHERE <filter>
        if full_upper.startswith("WHERE "):
            after_where = line_stripped[6:].lstrip() if line_upper.startswith("WHERE ") else text
            if "=" not in after_where:
                return self._complete_from_list(after_where, LDAP_ATTRIBUTES)
            if "objectClass=" in after_where:
                prefix = after_where.split("objectClass=", 1)[1]
                return self._complete_from_list(prefix, OBJECT_CLASSES)
            return []

        # SELECT ... WHERE ...
        if "WHERE " in full_upper:
            where_idx = full_upper.rfind("WHERE ")
            where_part = full_line[where_idx + 6:].lstrip()
            if "=" not in where_part:
                return self._complete_from_list(where_part, LDAP_ATTRIBUTES)
            if "objectClass=" in where_part:
                prefix = where_part.split("objectClass=", 1)[1]
                return self._complete_from_list(prefix, OBJECT_CLASSES)
            return []

        # SELECT ... FROM <таблица> - SQL-like автодополнение
        if full_upper.startswith("SELECT "):
            from_idx = full_upper.find(" FROM ")
            if from_idx != -1:
                after_from = full_line[from_idx + 6:].lstrip()
                # Если после FROM нет WHERE
                if " WHERE " not in after_from.upper():
                    # Показываем SQL таблицы + обычные варианты
                    candidates = SQL_TABLE_NAMES + ["*"] + ['"' + n + '"' for n in SQL_TABLE_NAMES]
                    prefix = after_from.strip().strip('"')
                    return self._complete_from_list(prefix, candidates)
            return []

        # OUTPUT <path>
        if full_upper.startswith("OUTPUT "):
            after_output = line_stripped[7:].lstrip() if line_upper.startswith("OUTPUT ") else text
            return self._complete_path(after_output)

        # IMPORT <path>
        if full_upper.startswith("IMPORT "):
            after_import = line_stripped[7:].lstrip() if line_upper.startswith("IMPORT ") else text
            return self._complete_path(after_import)

        # SHOW <what> [name] - 3-уровневое автодополнение
        if full_upper.startswith("SHOW "):
            return self._complete_show(full_line, line_stripped, text)

        # ENABLE/DISABLE <name> - имена из БД
        if full_upper.startswith("ENABLE ") or full_upper.startswith("DISABLE "):
            return self._complete_enable_disable(full_line, line_stripped, text)

        # DELETE <type> [name]
        if full_upper.startswith("DELETE "):
            return self._complete_delete(full_line, line_stripped, text)

        # LIST <type>
        if full_upper.startswith("LIST "):
            after_list = line_stripped[5:].lstrip() if line_upper.startswith("LIST ") else text
            return self._complete_from_list(after_list, LIST_TYPES)

        # TOOL <args...>
        if full_upper.startswith("TOOL "):
            return self._complete_tool(full_line[5:], text)

        # CREATE <type> [name]
        if full_upper.startswith("CREATE "):
            return self._complete_create(full_line, line_stripped, text)

        # SYNTHESIS [SCHEMA|ENTITY|...]
        if full_upper.startswith("SYNTHESIS"):
            after_syn = full_line[9:].lstrip() if len(full_line) > 9 else ""
            return self._complete_from_list(after_syn, SYNTHESIS_TYPES)

        # Начало команды
        return [c + " " for c in self.sdb_commands
                if c.upper().startswith(text.upper()) or c.startswith(text)]

    def _complete_show(self, full_line: str, line_stripped: str, text: str) -> List[str]:
        """Автодополнение для SHOW с контекстом."""
        after_show = line_stripped[5:].lstrip() if line_stripped.upper().startswith("SHOW ") else text
        parts = after_show.split()

        if not parts:
            return self._complete_from_list(after_show, SHOW_TYPES)

        obj_type_upper = parts[0].upper()

        # Уровень 2: После типа объекта - имена из БД
        if obj_type_upper in ("USER", "GROUP", "COMPUTER", "OU", "GPO", "CONTACT"):
            if len(parts) >= 2 or after_show.endswith(" "):
                # Уровень 3: Подгрузить имена из БД
                obj_type = obj_type_upper.lower()
                names = self._get_names_from_db(obj_type)
                current = parts[-1] if len(parts) >= 2 and not after_show.endswith(" ") else ""
                if names:
                    return self._complete_from_list(current, names)
                return []
            return self._complete_from_list(after_show, SHOW_TYPES)

        # SHOW DNS - особые дополнения
        if obj_type_upper == "DNS":
            if len(parts) >= 2 or after_show.endswith(" "):
                # Автодополнение DNS зон из БД
                dns_names = self._get_names_from_db("dns")
                if dns_names:
                    current = parts[-1] if len(parts) >= 2 and not after_show.endswith(" ") else ""
                    return self._complete_from_list(current, dns_names)
            return self._complete_from_list(after_show, SHOW_TYPES)

        return self._complete_from_list(after_show, SHOW_TYPES)

    def _complete_enable_disable(self, full_line: str, line_stripped: str, text: str) -> List[str]:
        """Автодополнение для ENABLE/DISABLE."""
        is_enable = line_stripped.upper().startswith("ENABLE ")
        cmd_len = 7 if is_enable else 8
        after_cmd = line_stripped[cmd_len:].lstrip()
        parts = after_cmd.split()
        if parts and parts[0].upper() == "USER":
            if len(parts) >= 2 or after_cmd.endswith(" "):
                names = self._get_names_from_db("user")
                current = parts[-1] if len(parts) >= 2 and not after_cmd.endswith(" ") else ""
                if names:
                    return self._complete_from_list(current, names)
            return self._complete_from_list(after_cmd, ENABLE_DISABLE_TYPES)
        # Без USER - имена пользователей
        names = self._get_names_from_db("user")
        if names:
            return self._complete_from_list(after_cmd, names)
        return self._complete_from_list(after_cmd, ENABLE_DISABLE_TYPES)

    def _complete_delete(self, full_line: str, line_stripped: str, text: str) -> List[str]:
        """Автодополнение для DELETE с многословными именами."""
        after_delete = line_stripped[7:].lstrip()
        parts = after_delete.split()
        if parts and parts[0].upper() in ("USER", "GROUP", "COMPUTER", "OU"):
            obj_type = parts[0].lower()
            if len(parts) >= 2 or after_delete.endswith(" "):
                names = self._get_names_from_db(obj_type)
                # Многословные имена - показываем все доступные
                current = parts[-1] if len(parts) >= 2 and not after_delete.endswith(" ") else ""
                if names:
                    return self._complete_from_list(current, names)
                return []
        return self._complete_from_list(after_delete, DELETE_TYPES)

    def _complete_create(self, full_line: str, line_stripped: str, text: str) -> List[str]:
        """Автодополнение для CREATE с контекстом БД."""
        after_create = line_stripped[7:].lstrip()
        parts = after_create.split()
        if not parts:
            return self._complete_from_list(after_create, CREATE_TYPES)

        obj_type_upper = parts[0].upper()

        if obj_type_upper in ("USER",):
            # CREATE USER <name> - автодополнение из БД
            if len(parts) >= 2 or after_create.endswith(" "):
                names = self._get_names_from_db("user")
                current = parts[-1] if len(parts) >= 2 and not after_create.endswith(" ") else ""
                if names:
                    return self._complete_from_list(current, names)
            return self._complete_from_list(after_create, CREATE_TYPES)

        if obj_type_upper in ("GROUP",):
            if len(parts) >= 2 or after_create.endswith(" "):
                names = self._get_names_from_db("group")
                current = parts[-1] if len(parts) >= 2 and not after_create.endswith(" ") else ""
                if names:
                    return self._complete_from_list(current, names)
            return self._complete_from_list(after_create, CREATE_TYPES)

        if obj_type_upper == "USERS" and len(parts) >= 2:
            if parts[1].upper() == "FROM":
                return self._complete_path(parts[-1] if len(parts) > 2 else "")

        return self._complete_from_list(after_create, CREATE_TYPES)

    def _get_names_from_db(self, obj_type: str) -> List[str]:
        """
        Получить имена объектов из БД для автодополнения.

        Сначала проверяет кэш в client, затем - last_records в engine,
        затем подгружает из БД через ldbsearch.
        """
        if self.client:
            names = self.client.get_names_from_db(obj_type)
            if names:
                return names

        if self.engine and self.engine.last_records:
            names = self.get_dynamic_names()
            if names:
                return names

        return []

    def _complete_tool(self, tool_text: str, original_text: str) -> List[str]:
        """Автодополнение для TOOL команд."""
        parts = tool_text.split()
        if not parts:
            specials = ["HELP", "LIST"]
            all_cmds = specials + SAMBA_TOOL_SUBCOMMANDS
            return [c + " " for c in sorted(all_cmds)]

        subcmd = parts[0].lower()

        if parts[0].upper() == "HELP":
            if len(parts) <= 1 or (len(parts) == 1 and original_text):
                return [c + " " for c in sorted(SAMBA_TOOL_SUBCOMMANDS)]
            return []

        if parts[0].upper() == "LIST":
            return []

        if subcmd not in SAMBA_TOOL_HELP:
            all_cmds = ["HELP", "LIST"] + SAMBA_TOOL_SUBCOMMANDS
            return [c + " " for c in sorted(all_cmds)
                    if c.lower().startswith(original_text.lower())]

        subcmds_info = SAMBA_TOOL_HELP[subcmd].get("subcmds", {})
        subcmd_list = sorted(subcmds_info.keys())

        if len(parts) == 1:
            if original_text:
                return [c + " " for c in subcmd_list
                        if c.lower().startswith(original_text.lower())]
            return [c + " " for c in subcmd_list]

        action = parts[1].lower()

        if len(parts) >= 2:
            options = SAMBA_TOOL_OPTIONS.get(subcmd, {}).get(action, [])

            if subcmd == "dns" and action in ("query", "add", "delete"):
                if action == "query" and len(parts) >= 5:
                    last_part = parts[-1] if not original_text else original_text
                    return self._complete_from_list(last_part, DNS_RECORD_TYPES)

            if subcmd == "fsmo" and action in ("transfer", "seize"):
                if original_text.startswith("--role="):
                    roles = ["rid", "pdc", "infrastructure", "naming", "schema"]
                    prefix = original_text[7:]
                    return [f"--role={r}" for r in roles if r.startswith(prefix)]
                if not original_text:
                    return ["--role="]

            if subcmd == "group" and action == "create":
                if original_text.startswith("--group-scope="):
                    scopes = ["DomainLocal", "Global", "Universal"]
                    prefix = original_text[14:]
                    return [f"--group-scope={s}" for s in scopes if s.startswith(prefix)]
                if original_text.startswith("--group-type="):
                    types = ["Security", "Distribution"]
                    prefix = original_text[13:]
                    return [f"--group-type={t}" for t in types if t.startswith(prefix)]

            # Для user show/getgroups/delete/enable/disable - имена из БД
            if subcmd == "user" and action in ("show", "getgroups", "delete", "enable", "disable", "rename", "move"):
                if len(parts) == 2 and not original_text:
                    names = self._get_names_from_db("user")
                    if names:
                        return self._complete_from_list("", names)

            # Для group show/listmembers/delete - имена из БД
            if subcmd == "group" and action in ("show", "listmembers", "delete"):
                if len(parts) == 2 and not original_text:
                    names = self._get_names_from_db("group")
                    if names:
                        return self._complete_from_list("", names)

            if original_text.startswith("-"):
                return [o + " " for o in options
                        if o.lower().startswith(original_text.lower())]

            if not original_text and options:
                return [o + " " for o in options]

        return []

    def _complete_from_list(self, prefix: str, candidates: List[str]) -> List[str]:
        """Отфильтровать список кандидатов по префиксу (регистронезависимо)."""
        if not prefix:
            return [c + " " for c in candidates]
        prefix_lower = prefix.lower()
        return [c + " " for c in candidates
                if c.lower().startswith(prefix_lower)]

    def _complete_path(self, partial_path: str) -> List[str]:
        """Автодополнение пути к файлу."""
        if not partial_path:
            partial_path = "./"

        partial_path = os.path.expanduser(partial_path)

        try:
            matches = glob.glob(partial_path + "*")
        except Exception:
            matches = []

        if not matches and os.path.isdir(partial_path):
            matches = glob.glob(os.path.join(partial_path, "*"))

        result = []
        for m in matches:
            if os.path.isdir(m):
                result.append(m + "/")
            else:
                result.append(m)

        result = [r.replace(" ", "\\ ") for r in result]
        return result

    def get_dynamic_names(self) -> List[str]:
        """Получить имена из last_records движка."""
        if not self.engine or not self.engine.last_records:
            return []

        names = []
        for rec in self.engine.last_records:
            sam = rec.get("sAMAccountName")
            if sam:
                names.append(sam)
        return sorted(names)


def setup_readline(completer: SdbCompleter, history_file: Optional[str] = None):
    """Настроить readline для интерактивного режима SDB."""
    try:
        import readline
    except ImportError:
        return

    readline.set_completer(completer.complete)
    readline.set_completer_delims(" \t\n;|&(){}<>")
    readline.parse_and_bind("tab: complete")
    readline.parse_and_bind("set disable-completion off")

    if history_file is None:
        history_file = os.path.expanduser("~/.sdb_history")

    try:
        readline.read_history_file(history_file)
    except FileNotFoundError:
        pass
    except Exception:
        pass

    import atexit
    try:
        readline.set_history_length(1000)
        atexit.register(readline.write_history_file, history_file)
    except Exception:
        pass
