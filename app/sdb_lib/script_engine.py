"""
ScriptEngine - движок выполнения скриптов SDB.

Разбирает текст скрипта через ScriptParser и последовательно
выполняет команды, используя SdbClient.

Поддерживает сокращённые команды (без TOOL):
  SHOW USER admin      = ldbsearch по sAMAccountName из БД
  SHOW GROUP name      = ldbsearch по sAMAccountName из БД (многословное имя)
  SHOW GPO             = ldbsearch groupPolicyContainer из БД
  SHOW DNS             = ldbsearch dnsNode из БД
  LIST USERS           = TOOL user list
  ENABLE admin         = TOOL user enable admin
  DISABLE admin        = TOOL user disable admin
  DELETE USER admin    = TOOL user delete admin

Все команды регистронезависимые.

SHOW команды используют ldbsearch (напрямую из БД), а не samba-tool,
чтобы работать даже когда samba-tool не может подключиться к DC.

SYNTHESIS - анализ схемы БД как в СУБД:
  SYNTHESIS             = полный анализ
  SYNTHESIS SCHEMA      = то же самое
  SYNTHESIS ENTITY      = сущности -> таблицы
  SYNTHESIS RELATION    = связи 1:M -> внешние ключи
  SYNTHESIS ASSOCIATION = связи M:M -> ассоциативные таблицы
  SYNTHESIS NORMALIZE   = промежуточный итог схемы (до нормализации)

SQL-like SELECT:
  SELECT sAMAccountName, cn, mail FROM USERS;
  SELECT * FROM GROUPS WHERE cn=*Admin*;
  SELECT sAMAccountName FROM COMPUTERS;
"""

import os
import sys
import json
import csv
import logging
import struct
from typing import List, Optional, Any, Dict

from sdb.parser.script import ScriptParser, ScriptCommand, CommandType
from sdb.parser.ldif import LdifRecord
from sdb.formatters import get_formatter
from sdb.config import SAMBA_TOOL_HELP, SQL_TABLES

logger = logging.getLogger(__name__)


# ─── Декодирование dnsRecord ──────────────────────────────────────────────

# Типы DNS записей (RFC 1035 + расширения)
_DNS_RECORD_TYPES = {
    0: "ZERO",
    1: "A",
    2: "NS",
    5: "CNAME",
    6: "SOA",
    12: "PTR",
    15: "MX",
    16: "TXT",
    28: "AAAA",
    33: "SRV",
    65: "EID",
    99: "SPF",
    252: "AXFR",
    253: "MAILB",
    255: "ALL",
}


def _decode_dns_record(data_str: str) -> str:
    """
    Декодировать dnsRecord атрибут из LDB в человекочитаемый формат.

    Формат dnsRecord (Samba):
      - version (2 байта, LE)
      - rank (2 байта, LE)
      - serial (4 байта, LE)
      - ttl (4 байта, LE)
      - reserved (4 байта, LE)
      - rdLength (2 байта, LE)
      - wType (2 байта, LE)
      - data (rdLength байт)

    Если строка не может быть декодирована, возвращает сокращённое hex-представление.
    """
    if not data_str:
        return ""

    try:
        raw = data_str.encode("utf-8", errors="replace")
    except Exception:
        raw = bytes(data_str, "utf-8", errors="replace")

    # Проверяем, является ли строка уже hex или base64
    try:
        import base64
        if all(c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=' for c in data_str.strip()):
            raw = base64.b64decode(data_str.strip())
    except Exception:
        pass

    # Пытаемся декодировать как Samba dnsRecord структуру
    try:
        if len(raw) >= 20:
            version, rank, serial, ttl, reserved = struct.unpack_from("<HHIII", raw, 0)
            offset = 16
            rd_length, w_type = struct.unpack_from("<HH", raw, offset)
            offset += 4
            record_type = _DNS_RECORD_TYPES.get(w_type, f"TYPE{w_type}")

            # Декодируем данные записи
            rd_data = raw[offset:offset + rd_length]

            if w_type == 1 and len(rd_data) == 4:
                # A record: 4 байта = IP адрес
                ip = ".".join(str(b) for b in rd_data)
                return f"{record_type} ttl={ttl} {ip}"
            elif w_type == 28 and len(rd_data) == 16:
                # AAAA record: 16 байт = IPv6
                import socket
                ip = socket.inet_ntop(socket.AF_INET6, rd_data)
                return f"{record_type} ttl={ttl} {ip}"
            elif w_type == 6 and len(rd_data) >= 22:
                # SOA record
                return f"{record_type} ttl={ttl} (serial={serial})"
            elif w_type == 12:
                # PTR record
                return f"{record_type} ttl={ttl}"
            elif w_type == 15:
                # MX record
                return f"{record_type} ttl={ttl}"
            elif w_type == 16:
                # TXT record
                try:
                    txt = rd_data.decode("utf-8", errors="replace")
                    return f"{record_type} ttl={ttl} {txt}"
                except Exception:
                    return f"{record_type} ttl={ttl}"
            elif w_type == 33:
                # SRV record
                return f"{record_type} ttl={ttl}"
            elif w_type == 5:
                # CNAME record
                try:
                    cname = rd_data.decode("utf-8", errors="replace")
                    return f"{record_type} ttl={ttl} {cname}"
                except Exception:
                    return f"{record_type} ttl={ttl}"
            elif w_type == 2:
                # NS record
                try:
                    ns = rd_data.decode("utf-8", errors="replace")
                    return f"{record_type} ttl={ttl} {ns}"
                except Exception:
                    return f"{record_type} ttl={ttl}"
            else:
                return f"{record_type} ttl={ttl} ({rd_length}байт)"
    except Exception:
        pass

    # Fallback: сокращённое hex-представление
    if len(raw) > 40:
        return raw[:20].hex() + "..." + raw[-10:].hex()
    elif raw:
        return raw.hex()
    return ""


class ScriptEngine:
    """
    Движок выполнения скриптов SDB.

    Состояние выполнения:
      - current_database: Текущая база данных
      - current_format: Текущий формат вывода
      - current_output: Текущий файл вывода
      - current_fields: Текущий список полей
      - current_limit: Лимит записей
      - variables: Переменные скрипта
      - last_records: Последний результат запроса
      - last_dataframe: Последний pandas DataFrame
    """

    def __init__(self, client):
        self.client = client
        self.parser = ScriptParser()

        # Состояние
        self.current_database = "sam"
        self.current_format = "table"
        self.current_output: Optional[str] = None
        self.current_fields: Optional[List[str]] = None
        self.current_limit: int = 0
        self.variables: Dict[str, str] = {}
        self.last_records: List[LdifRecord] = []
        self.last_result: Any = None
        self.last_dataframe = None

    def execute(self, script_text: str) -> Any:
        commands = self.parser.parse(script_text)
        for cmd in commands:
            self._execute_command(cmd)
        return self.last_result

    def execute_file(self, filepath: str, encoding: str = "utf-8") -> Any:
        with open(filepath, "r", encoding=encoding) as f:
            script_text = f.read()
        return self.execute(script_text)

    def _execute_command(self, cmd: ScriptCommand) -> Any:
        if cmd.cmd_type == CommandType.COMMENT:
            return None
        if cmd.cmd_type == CommandType.EMPTY:
            return None
        if cmd.cmd_type == CommandType.USE:
            return self._cmd_use(cmd)
        if cmd.cmd_type == CommandType.SELECT:
            return self._cmd_select(cmd)
        if cmd.cmd_type == CommandType.WHERE:
            return self._cmd_where(cmd)
        if cmd.cmd_type == CommandType.FORMAT:
            return self._cmd_format(cmd)
        if cmd.cmd_type == CommandType.OUTPUT:
            return self._cmd_output(cmd)
        if cmd.cmd_type == CommandType.TOOL:
            return self._cmd_tool(cmd)
        if cmd.cmd_type == CommandType.SHOW:
            return self._cmd_show(cmd)
        if cmd.cmd_type == CommandType.SET:
            return self._cmd_set(cmd)
        if cmd.cmd_type == CommandType.FIELDS:
            return self._cmd_fields(cmd)
        if cmd.cmd_type == CommandType.LIMIT:
            return self._cmd_limit(cmd)
        if cmd.cmd_type == CommandType.SEARCH:
            return self._cmd_search(cmd)
        if cmd.cmd_type == CommandType.DATAFRAME:
            return self._cmd_dataframe(cmd)
        if cmd.cmd_type == CommandType.IMPORT:
            return self._cmd_import(cmd)
        if cmd.cmd_type == CommandType.CREATE:
            return self._cmd_create(cmd)
        if cmd.cmd_type == CommandType.ENABLE:
            return self._cmd_enable(cmd)
        if cmd.cmd_type == CommandType.DISABLE:
            return self._cmd_disable(cmd)
        if cmd.cmd_type == CommandType.DELETE:
            return self._cmd_delete(cmd)
        if cmd.cmd_type == CommandType.LIST:
            return self._cmd_list(cmd)
        if cmd.cmd_type == CommandType.SYNTHESIS:
            return self._cmd_synthesis(cmd)
        return None

    # ─── Реализации команд ─────────────────────────────────────────────────

    def _cmd_use(self, cmd: ScriptCommand) -> str:
        """USE <database> - переключить базу данных."""
        db_name = self._substitute_vars(cmd.args[0])
        db_name_lower = db_name.lower()
        from sdb.config import LDB_DATABASES
        for key in LDB_DATABASES:
            if key.lower() == db_name_lower:
                db_name = key
                break
        self.current_database = db_name
        result = self.client.use_database(db_name)
        self.client.clear_names_cache()
        print(f"База данных: {db_name} ({result})")
        self.last_result = result
        return result

    def _cmd_select(self, cmd: ScriptCommand) -> List[LdifRecord]:
        """SELECT <fields> FROM <scope> [WHERE <filter>]"""
        fields = cmd.args
        scope = cmd.kwargs.get("scope", "*")
        filter_expr = cmd.kwargs.get("filter", "")

        scope = self._substitute_vars(scope)
        filter_expr = self._substitute_vars(filter_expr)

        # ─── SQL-like SELECT ──────────────────────────────────────────
        # SELECT ... FROM USERS / GROUPS / COMPUTERS / ...
        scope_upper = scope.upper()
        if scope_upper in SQL_TABLES:
            table_info = SQL_TABLES[scope_upper]
            ldap_filter = table_info["filter"]

            # Добавляем WHERE для SQL-like таблиц
            if filter_expr:
                if filter_expr.startswith("("):
                    ldap_filter = f"(&{ldap_filter}{filter_expr})"
                elif "=" in filter_expr:
                    # Простой фильтр: cn=*Admin* → (cn=*Admin*)
                    if not filter_expr.startswith("("):
                        ldap_filter = f"(&{ldap_filter}({filter_expr}))"
                else:
                    ldap_filter = f"(&{ldap_filter}(cn=*{filter_expr}*))"
                filter_expr = ldap_filter
            else:
                filter_expr = ldap_filter

            # Используем атрибуты из описания таблицы
            table_attrs = table_info["attrs"]
            if fields and fields != ["*"]:
                # Пользователь указал конкретные поля - используем их
                attrs = fields
            else:
                attrs = table_attrs

            records = self.client.ldb.query(
                filter_expr=filter_expr,
                attrs=attrs,
            )

            if fields and fields != ["*"]:
                self.current_fields = fields

            if self.current_fields and self.current_fields != ["*"]:
                records = self.client.queries.select_fields(records, self.current_fields)

            if self.current_limit > 0:
                records = records[:self.current_limit]

            # Обновляем кэш имён
            name_attr = table_info["name_attr"]
            self.client._names_cache[scope_upper.lower().rstrip("s")] = sorted([
                r.get(name_attr, r.get("cn", "")) for r in records if r.get(name_attr) or r.get("cn")
            ])

            self.last_records = records
            self._output_records(records)
            self.last_result = records
            return records

        # ─── Обычный SELECT ──────────────────────────────────────────
        if filter_expr:
            ldap_filter = self._simple_to_ldap_filter(filter_expr)
        else:
            ldap_filter = ""

        if "=" in scope and scope != "*":
            records = self.client.query(
                database=self.current_database,
                filter_expr=ldap_filter or "",
                base_dn=scope,
            )
        else:
            records = self.client.query(
                database=self.current_database,
                filter_expr=ldap_filter,
            )

        if fields and fields != ["*"]:
            self.current_fields = fields

        if self.current_fields and self.current_fields != ["*"]:
            records = self.client.queries.select_fields(records, self.current_fields)

        if self.current_limit > 0:
            records = records[:self.current_limit]

        self.last_records = records
        self._output_records(records)
        self.last_result = records
        return records

    def _cmd_where(self, cmd: ScriptCommand) -> List[LdifRecord]:
        """WHERE <filter> - фильтр для последних записей."""
        filter_expr = self._substitute_vars(cmd.args[0])

        if not self.last_records:
            print("(нет предыдущих записей для фильтрации)")
            return []

        if "=" in filter_expr:
            field, value = filter_expr.split("=", 1)
            filtered = self.client.queries.filter_records(
                self.last_records, field.strip(), value.strip()
            )
        else:
            filtered = self.last_records

        self.last_records = filtered
        self._output_records(filtered)
        self.last_result = filtered
        return filtered

    def _cmd_format(self, cmd: ScriptCommand) -> str:
        """FORMAT <format> - установить формат вывода."""
        fmt = cmd.args[0].lower()
        self.current_format = fmt
        print(f"Формат вывода: {fmt}")
        self.last_result = fmt
        return fmt

    def _cmd_output(self, cmd: ScriptCommand) -> str:
        """OUTPUT <filepath> - записать текущие записи в файл."""
        filepath = self._substitute_vars(cmd.args[0])

        # Авто-определение формата по расширению файла
        fmt = self.current_format
        ext = os.path.splitext(filepath)[1].lower()
        if ext == ".xlsx":
            fmt = "xlsx"
        elif ext == ".json":
            fmt = "json"
        elif ext == ".csv":
            fmt = "csv"
        elif ext == ".tsv":
            fmt = "tsv"
        elif ext == ".ldif":
            fmt = "ldif"

        if self.last_records:
            self.client.write_output(
                self.last_records,
                filepath,
                fmt=fmt,
                fields=self.current_fields,
            )
            print(f"Записано {len(self.last_records)} записей в: {filepath}")
        else:
            print(f"Нет записей для записи в: {filepath}")

        self.current_output = None
        self.last_result = filepath
        return filepath

    def _cmd_tool(self, cmd: ScriptCommand) -> Any:
        """TOOL <subcommand> <args...> - выполнить samba-tool команду."""
        args = [self._substitute_vars(a) for a in cmd.args]

        if not args:
            print("Использование: TOOL <подкоманда> [аргументы...]")
            print("Примеры: TOOL user list; TOOL HELP user; TOOL LIST")
            return None

        if args[0].upper() == "LIST":
            return self._tool_list()

        if args[0].upper() == "HELP":
            if len(args) > 1:
                return self._tool_help(args[1])
            else:
                return self._tool_list()

        result = self.client.samba_tool.run(args)

        if result.success:
            output_text = result.stdout.strip()
            if output_text:
                print(output_text)
        else:
            error_parts = []
            if result.stdout.strip():
                error_parts.append(result.stdout.strip())
            if result.stderr.strip():
                error_parts.append(result.stderr.strip())
            error_msg = "\n".join(error_parts) if error_parts else f"Ошибка: команда завершилась с кодом {result.returncode}"
            print(f"Ошибка: {error_msg}", file=sys.stderr)

        self.last_result = result.to_dict()
        return self.last_result

    def _tool_list(self) -> None:
        """Показать список всех подкоманд samba-tool."""
        print("\nДоступные подкоманды samba-tool:")
        print("=" * 60)
        for subcmd, info in SAMBA_TOOL_HELP.items():
            print(f"  {subcmd:14s} - {info['desc']}")
            for sub, desc in info.get("subcmds", {}).items():
                print(f"    {sub:14s}   {desc}")
        print()
        print("Для справки по подкоманде: TOOL HELP <подкоманда>")
        print()

    def _tool_help(self, subcmd: str) -> None:
        """Показать справку по подкоманде samba-tool."""
        subcmd_lower = subcmd.lower()

        if subcmd_lower in SAMBA_TOOL_HELP:
            info = SAMBA_TOOL_HELP[subcmd_lower]
            print(f"\nsamba-tool {subcmd_lower} - {info['desc']}")
            print("-" * 50)
            for sub, desc in info.get("subcmds", {}).items():
                print(f"  {sub:20s} {desc}")
            print()
            print(f"Запустите для полной справки:")
            print(f"  samba-tool {subcmd_lower} --help")
            print()

        result = self.client.samba_tool.run([subcmd_lower, "--help"])
        if result.stdout.strip():
            print(result.stdout.strip())
        if result.stderr.strip():
            print(result.stderr.strip())

    # ─── SHOW - через ldbsearch (из БД) ──────────────────────────────────

    def _cmd_show(self, cmd: ScriptCommand) -> Any:
        """SHOW <what> - показать информацию.

        Все SHOW команды работают через ldbsearch (напрямую из БД),
        а не через samba-tool, чтобы работать даже когда
        samba-tool не может подключиться к DC.

        Поддерживает многословные имена:
          SHOW GROUP Domain Admins        → ищет sAMAccountName="Domain Admins"
          SHOW GPO "Default Domain"       → ищет displayName содержащее "Default Domain"
          SHOW OU "Domain Controllers"    → ищет ou="Domain Controllers"
        """
        if not cmd.args:
            print("Использование: SHOW DATABASES | SHOW USER <name> | SHOW GROUP <name> | ...")
            return None

        what = cmd.args[0].upper() if cmd.args else ""

        # SHOW DATABASES
        if what in ("DATABASES", "DBS"):
            dbs = self.client.show_databases()
            print("\nДоступные базы данных Samba LDB:")
            print("-" * 60)
            for name, info in dbs.items():
                exists = "+" if info["exists"] else "-"
                print(f"  [{exists}] {name:12s} - {info['description']}")
                print(f"      {info['path']}")
            print()
            self.last_result = dbs
            return dbs

        # SHOW HELP
        if what == "HELP":
            self._show_help()
            return None

        # SHOW USER [name] - многословное имя
        if what == "USER":
            obj_name = " ".join(cmd.args[1:]) if len(cmd.args) > 1 else ""
            if obj_name:
                obj_name = self._substitute_vars(obj_name)
                return self._show_from_db("user", obj_name)
            else:
                return self._show_list_from_db("user")

        # SHOW GROUP [name] - многословное имя (Domain Admins)
        if what == "GROUP":
            obj_name = " ".join(cmd.args[1:]) if len(cmd.args) > 1 else ""
            if obj_name:
                obj_name = self._substitute_vars(obj_name)
                return self._show_from_db("group", obj_name)
            else:
                return self._show_list_from_db("group")

        # SHOW COMPUTER [name]
        if what == "COMPUTER":
            obj_name = " ".join(cmd.args[1:]) if len(cmd.args) > 1 else ""
            if obj_name:
                obj_name = self._substitute_vars(obj_name)
                return self._show_from_db("computer", obj_name)
            else:
                return self._show_list_from_db("computer")

        # SHOW OU [dn/name] - многословное имя (Domain Controllers)
        if what == "OU":
            obj_name = " ".join(cmd.args[1:]) if len(cmd.args) > 1 else ""
            if obj_name:
                obj_name = self._substitute_vars(obj_name)
                return self._show_from_db("ou", obj_name)
            else:
                return self._show_list_from_db("ou")

        # SHOW GPO [name] - многословное имя (Default Domain Policy)
        if what == "GPO":
            obj_name = " ".join(cmd.args[1:]) if len(cmd.args) > 1 else ""
            if obj_name:
                obj_name = self._substitute_vars(obj_name)
                return self._show_from_db("gpo", obj_name)
            else:
                return self._show_list_from_db("gpo")

        # SHOW DNS - через ldbsearch (не samba-tool!)
        if what == "DNS":
            return self._show_dns_from_db()

        # SHOW CONTACT [name]
        if what == "CONTACT":
            obj_name = " ".join(cmd.args[1:]) if len(cmd.args) > 1 else ""
            if obj_name:
                obj_name = self._substitute_vars(obj_name)
                return self._show_from_db("contact", obj_name)
            else:
                return self._show_list_from_db("contact")

        # Неизвестный SHOW
        print(f"Неизвестный SHOW: {' '.join(cmd.args)}")
        print("Поддерживается: SHOW DATABASES, SHOW USER <name>, SHOW GROUP <name>,")
        print("                SHOW COMPUTER <name>, SHOW OU <dn>, SHOW GPO,")
        print("                SHOW DNS, SHOW CONTACT, SHOW HELP")
        return None

    def _show_help(self):
        """Показать справку по командам SHOW."""
        print("\nКоманды SHOW (все через ldbsearch - напрямую из БД):")
        print("  SHOW DATABASES            Показать базы данных")
        print("  SHOW USER [<name>]        Пользователь(и) из БД (ldbsearch)")
        print("  SHOW GROUP [<name>]       Группа(ы) из БД (многословное имя)")
        print("  SHOW COMPUTER [<name>]    Компьютер(ы) из БД (ldbsearch)")
        print("  SHOW OU [<name>]          OU из БД (многословное имя)")
        print("  SHOW GPO [<name>]         GPO из БД (многословное имя)")
        print("  SHOW DNS                  DNS записи из БД (ldbsearch)")
        print("  SHOW CONTACT [<name>]     Контакты из БД (ldbsearch)")
        print("  SHOW HELP                 Эта справка")
        print()
        print("  Многословные имена:")
        print('    SHOW GROUP "Domain Admins"     (с кавычками)')
        print("    SHOW GROUP Domain Admins        (без кавычек - склеивается)")
        print('    SHOW GPO "Default Domain Policy"')
        print('    SHOW OU "Domain Controllers"')
        print()

    def _show_from_db(self, obj_type: str, obj_name: str) -> Any:
        """Показать объект из БД через ldbsearch (не через samba-tool).

        Поддерживает многословные имена:
          _show_from_db("group", "Domain Admins")
          _show_from_db("gpo", "Default Domain Policy")
        """
        try:
            if obj_type == "user":
                # Ищем по sAMAccountName (точное совпадение)
                records = self.client.ldb.query(
                    filter_expr=f"(&(objectClass=user)(sAMAccountType=805306368)(sAMAccountName={self._escape_ldap_value(obj_name)}))",
                )
                # Если не нашли - пробуем по cn
                if not records:
                    records = self.client.ldb.query(
                        filter_expr=f"(&(objectClass=user)(sAMAccountType=805306368)(cn={self._escape_ldap_value(obj_name)}))",
                    )

            elif obj_type == "group":
                # Ищем по sAMAccountName (точное совпадение, поддерж. пробелы)
                records = self.client.ldb.query(
                    filter_expr=f"(&(objectClass=group)(sAMAccountName={self._escape_ldap_value(obj_name)}))",
                )
                # Если не нашли - пробуем по cn
                if not records:
                    records = self.client.ldb.query(
                        filter_expr=f"(&(objectClass=group)(cn={self._escape_ldap_value(obj_name)}))",
                    )

            elif obj_type == "computer":
                # Компьютеры имеют "$" в конце sAMAccountName
                if not obj_name.endswith("$"):
                    search_name = obj_name + "$"
                else:
                    search_name = obj_name
                records = self.client.ldb.query(
                    filter_expr=f"(&(objectClass=computer)(sAMAccountName={self._escape_ldap_value(search_name)}))",
                )
                if not records:
                    records = self.client.ldb.query(
                        filter_expr=f"(&(objectClass=computer)(cn={self._escape_ldap_value(obj_name)}))",
                    )

            elif obj_type == "ou":
                # OU можно искать по имени или по DN
                if "=" in obj_name:
                    records = self.client.ldb.query(
                        base_dn=obj_name,
                        scope="base",
                    )
                else:
                    records = self.client.ldb.query(
                        filter_expr=f"(&(objectClass=organizationalUnit)(ou={self._escape_ldap_value(obj_name)}))",
                    )

            elif obj_type == "gpo":
                # GPO ищем по GUID (cn) или по displayName
                obj_name_escaped = self._escape_ldap_value(obj_name)
                # Если это GUID (в фигурных скобках)
                if obj_name.startswith("{") and obj_name.endswith("}"):
                    records = self.client.ldb.query(
                        filter_expr=f"(&(objectClass=groupPolicyContainer)(cn={obj_name_escaped}))",
                    )
                else:
                    # Сначала ищем точное совпадение по displayName
                    records = self.client.ldb.query(
                        filter_expr=f"(&(objectClass=groupPolicyContainer)(displayName={obj_name_escaped}))",
                    )
                    # Если не нашли - пробуем подстроку
                    if not records:
                        records = self.client.ldb.query(
                            filter_expr=f"(&(objectClass=groupPolicyContainer)(displayName=*{self._escape_ldap_value(obj_name)}*))",
                        )
                    # Если не нашли - пробуем по cn
                    if not records:
                        records = self.client.ldb.query(
                            filter_expr=f"(&(objectClass=groupPolicyContainer)(cn={obj_name_escaped}))",
                        )

            elif obj_type == "contact":
                records = self.client.ldb.query(
                    filter_expr=f"(&(objectClass=contact)(cn={self._escape_ldap_value(obj_name)}))",
                )

            else:
                print(f"Неизвестный тип объекта: {obj_type}")
                return None

            if not records:
                print(f"{obj_type.upper()} '{obj_name}' не найден(а) в БД")
                return None

            self.last_records = records
            self._output_records(records)
            self.last_result = records
            return records

        except Exception as e:
            print(f"Ошибка запроса к БД: {e}", file=sys.stderr)
            return None

    @staticmethod
    def _escape_ldap_value(value: str) -> str:
        """Экранировать значение для LDAP фильтра.

        Правильное экранирование специальных символов LDAP:
          \\  →  \\5c
          *   →  \\2a
          (   →  \\28
          )   →  \\29
          \\x00  →  \\00

        Для ldbsearch: пробелы в значениях фильтров обрабатываются корректно,
        когда значение находится внутри (attr=value), поэтому пробелы
        экранировать не нужно.
        """
        if not value:
            return value

        result = []
        for ch in value:
            if ch == '\\':
                result.append('\\5c')
            elif ch == '*':
                result.append('\\2a')
            elif ch == '(':
                result.append('\\28')
            elif ch == ')':
                result.append('\\29')
            elif ch == '\x00':
                result.append('\\00')
            else:
                result.append(ch)
        return ''.join(result)

    def _show_list_from_db(self, obj_type: str) -> Any:
        """Показать список объектов из БД через ldbsearch."""
        try:
            if obj_type == "user":
                records = self.client.ldb.query(
                    filter_expr="(&(objectClass=user)(sAMAccountType=805306368))",
                    attrs=["sAMAccountName", "cn", "dn"],
                )
            elif obj_type == "group":
                records = self.client.ldb.query(
                    filter_expr="(objectClass=group)",
                    attrs=["sAMAccountName", "cn", "dn"],
                )
            elif obj_type == "computer":
                records = self.client.ldb.query(
                    filter_expr="(objectClass=computer)",
                    attrs=["sAMAccountName", "cn", "dn"],
                )
            elif obj_type == "ou":
                records = self.client.ldb.query(
                    filter_expr="(objectClass=organizationalUnit)",
                    attrs=["ou", "dn", "description"],
                )
            elif obj_type == "gpo":
                records = self.client.ldb.query(
                    filter_expr="(objectClass=groupPolicyContainer)",
                    attrs=["cn", "displayName", "dn", "gPCFileSysPath"],
                )
            elif obj_type == "contact":
                records = self.client.ldb.query(
                    filter_expr="(objectClass=contact)",
                    attrs=["cn", "dn", "mail"],
                )
            else:
                print(f"Неизвестный тип объекта: {obj_type}")
                return None

            if not records:
                print(f"Нет записей типа {obj_type.upper()} в БД")
                return None

            # Сохраняем имена в кэш для автодополнения
            self.client._names_cache[obj_type] = sorted([
                r.get("sAMAccountName", r.get("displayName", r.get("ou", r.get("cn", ""))))
                for r in records
            ])

            self.last_records = records
            self._output_records(records)
            self.last_result = records
            return records

        except Exception as e:
            print(f"Ошибка запроса к БД: {e}", file=sys.stderr)
            return None

    def _show_dns_from_db(self) -> Any:
        """Показать DNS записи из БД через ldbsearch (не samba-tool!)."""
        try:
            # Запрос DNS записей из sam.ldb
            records = self.client.ldb.query(
                filter_expr="(objectClass=dnsNode)",
                attrs=["dc", "dnsRecord", "dn"],
            )

            if not records:
                print("DNS записи не найдены в БД")
                # Пробуем через отдельную DNS базу
                try:
                    dns_ldb = self.client.ldb
                    old_path = dns_ldb.url
                    from sdb.config import get_ldb_path
                    dns_ldb.url = get_ldb_path("dns")
                    records = dns_ldb.query(
                        filter_expr="(objectClass=dnsNode)",
                        attrs=["dc", "dnsRecord", "dn"],
                    )
                    dns_ldb.url = old_path
                except Exception:
                    pass

                if not records:
                    return None

            # Декодируем dnsRecord бинарные данные
            for rec in records:
                dns_raw = rec.get("dnsRecord", "")
                if dns_raw and len(dns_raw) > 10:
                    # Пытаемся декодировать бинарные dnsRecord
                    decoded = _decode_dns_record(dns_raw)
                    if decoded:
                        # Заменяем бинарные данные на читаемый формат
                        if "dnsRecord" in rec.attrs:
                            values = rec.get_all("dnsRecord")
                            decoded_values = []
                            for v in values:
                                d = _decode_dns_record(v)
                                decoded_values.append(d if d else v)
                            rec.attrs["dnsRecord"] = decoded_values

            # Сохраняем имена DNS зон для автодополнения
            dns_names = sorted(set([
                r.get("dc", "") for r in records if r.get("dc")
            ]))
            self.client._names_cache["dns"] = dns_names

            self.last_records = records
            self._output_records(records)
            self.last_result = records
            return records

        except Exception as e:
            print(f"Ошибка запроса DNS из БД: {e}", file=sys.stderr)
            return None

    # ─── SYNTHESIS - анализ схемы БД как в СУБД ───────────────────────────

    def _cmd_synthesis(self, cmd: ScriptCommand) -> Any:
        """SYNTHESIS [SCHEMA|ENTITY|RELATION|ASSOCIATION|NORMALIZE] - анализ схемы БД."""
        subcmd = cmd.args[0].upper() if cmd.args else "SCHEMA"

        try:
            # Собираем информацию о схеме
            schema = self._collect_schema()

            if subcmd in ("SCHEMA", "SQL"):
                # "SQL" is treated as alias for SCHEMA — AI models sometimes
                # confuse synthesis with SQL-like queries
                self._print_full_schema(schema)
            elif subcmd == "ENTITY":
                self._print_entity_mapping(schema)
            elif subcmd == "RELATION":
                self._print_relations(schema)
            elif subcmd == "ASSOCIATION":
                self._print_associations(schema)
            elif subcmd == "NORMALIZE":
                self._print_normalization(schema)
            else:
                # v1.9-3-6: Return error dict instead of None + print
                logger.warning("[SDB] Unknown SYNTHESIS subcmd: %s, valid: SCHEMA, ENTITY, RELATION, ASSOCIATION, NORMALIZE", subcmd)
                self.last_result = {
                    "error": f"Unknown SYNTHESIS subcmd: {subcmd}",
                    "valid_subcmds": ["SCHEMA", "ENTITY", "RELATION", "ASSOCIATION", "NORMALIZE"],
                    "hint": "Use action='select' for SQL-like queries. SYNTHESIS is for schema analysis only.",
                }
                return self.last_result

            self.last_result = schema
            return schema

        except Exception as e:
            print(f"Ошибка анализа схемы: {e}", file=sys.stderr)
            return None

    def _collect_schema(self) -> Dict:
        """Собрать информацию о схеме БД для анализа СУБД."""
        schema = {
            "entities": {},     # Сущность → Таблица
            "relations": [],    # Связи 1:M (внешние ключи)
            "associations": [], # Связи M:M (ассоциативные таблицы)
            "attributes": {},   # Атрибуты каждого типа
        }

        # 1. Собираем сущности (objectClass → таблица)
        try:
            self.client.ldb.query(
                filter_expr="(objectClass=*)",
                attrs=["objectClass"],
                scope="base",
            )
        except Exception:
            pass

        # Определяем сущности и их атрибуты
        entity_types = {
            "user": {
                "filter": "(&(objectClass=user)(sAMAccountType=805306368))",
                "table_name": "USERS",
                "key_attr": "sAMAccountName",
                "name_attr": "cn",
                "desc": "Пользователи AD",
            },
            "group": {
                "filter": "(objectClass=group)",
                "table_name": "GROUPS",
                "key_attr": "sAMAccountName",
                "name_attr": "cn",
                "desc": "Группы AD",
            },
            "computer": {
                "filter": "(objectClass=computer)",
                "table_name": "COMPUTERS",
                "key_attr": "sAMAccountName",
                "name_attr": "cn",
                "desc": "Компьютеры AD",
            },
            "ou": {
                "filter": "(objectClass=organizationalUnit)",
                "table_name": "OUS",
                "key_attr": "ou",
                "name_attr": "ou",
                "desc": "Организационные подразделения",
            },
            "gpo": {
                "filter": "(objectClass=groupPolicyContainer)",
                "table_name": "GPOS",
                "key_attr": "cn",
                "name_attr": "displayName",
                "desc": "Групповые политики",
            },
            "contact": {
                "filter": "(objectClass=contact)",
                "table_name": "CONTACTS",
                "key_attr": "cn",
                "name_attr": "cn",
                "desc": "Контакты",
            },
            "dnsNode": {
                "filter": "(objectClass=dnsNode)",
                "table_name": "DNS_RECORDS",
                "key_attr": "dc",
                "name_attr": "dc",
                "desc": "DNS записи",
            },
        }

        for entity_name, entity_info in entity_types.items():
            try:
                sample = self.client.ldb.query(
                    filter_expr=entity_info["filter"],
                    attrs=None,  # Все атрибуты
                )
                count = len(sample)

                # Собираем все уникальные атрибуты
                all_attrs = set()
                for rec in sample[:20]:
                    all_attrs.update(rec.attrs.keys())

                schema["entities"][entity_name] = {
                    "table_name": entity_info["table_name"],
                    "key_attr": entity_info["key_attr"],
                    "name_attr": entity_info["name_attr"],
                    "desc": entity_info["desc"],
                    "count": count,
                    "attributes": sorted(all_attrs),
                }

                schema["attributes"][entity_info["table_name"]] = sorted(all_attrs)

            except Exception:
                schema["entities"][entity_name] = {
                    "table_name": entity_info["table_name"],
                    "key_attr": entity_info["key_attr"],
                    "name_attr": entity_info["name_attr"],
                    "desc": entity_info["desc"],
                    "count": 0,
                    "attributes": [],
                }

        # 2. Определяем связи
        schema["relations"] = [
            {"from": "USERS", "to": "OUS", "fk_attr": "dn → OU", "type": "1:M", "desc": "Пользователь принадлежит OU"},
            {"from": "COMPUTERS", "to": "OUS", "fk_attr": "dn → OU", "type": "1:M", "desc": "Компьютер принадлежит OU"},
            {"from": "GROUPS", "to": "OUS", "fk_attr": "dn → OU", "type": "1:M", "desc": "Группа принадлежит OU"},
            {"from": "GPOS", "to": "OUS", "fk_attr": "gPLink → OU", "type": "1:M", "desc": "GPO привязан к OU"},
        ]

        schema["associations"] = [
            {
                "name": "USER_GROUP",
                "from": "USERS",
                "to": "GROUPS",
                "assoc_attr": "member",
                "reverse_attr": "memberOf",
                "desc": "Пользователь ↔ Группа (M:M через member/memberOf)",
            },
            {
                "name": "COMPUTER_GROUP",
                "from": "COMPUTERS",
                "to": "GROUPS",
                "assoc_attr": "member",
                "reverse_attr": "memberOf",
                "desc": "Компьютер ↔ Группа (M:M через member/memberOf)",
            },
            {
                "name": "GROUP_GROUP",
                "from": "GROUPS",
                "to": "GROUPS",
                "assoc_attr": "member",
                "reverse_attr": "memberOf",
                "desc": "Группа ↔ Группа (вложенные группы, M:M)",
            },
        ]

        return schema

    def _print_full_schema(self, schema: Dict):
        """Полный вывод схемы СУБД."""
        print("\n" + "=" * 70)
        print("  СИНТЕЗ СХЕМЫ БД (СУБД-аналог)")
        print("=" * 70)

        self._print_entity_mapping(schema)
        self._print_relations(schema)
        self._print_associations(schema)
        self._print_normalization(schema)

    def _print_entity_mapping(self, schema: Dict):
        """Сущность → Отношение (Таблица)."""
        print("\n┌─────────────────────────────────────────────────────────────────┐")
        print("│  СУЩНОСТЬ → ОТНОШЕНИЕ (ТАБЛИЦА)                                │")
        print("├─────────────────────────────────────────────────────────────────┤")

        for entity_name, info in schema["entities"].items():
            print(f"│  {entity_name:16s} → {info['table_name']:16s}  PK: {info['key_attr']:20s}  │")
            print(f"│  {'':16s}   {info['desc']:40s}   │")
            print(f"│  {'':16s}   Записей: {info['count']:5d}  Атрибутов: {len(info['attributes']):3d}       │")

        print("└─────────────────────────────────────────────────────────────────┘")

    def _print_relations(self, schema: Dict):
        """Связь 1:M → Внешний ключ."""
        print("\n┌─────────────────────────────────────────────────────────────────┐")
        print("│  СВЯЗЬ 1:M → ВНЕШНИЙ КЛЮЧ (FOREIGN KEY)                       │")
        print("├─────────────────────────────────────────────────────────────────┤")

        for rel in schema["relations"]:
            print(f"│  {rel['from']:14s} ───→ {rel['to']:14s}  FK: {rel['fk_attr']:20s}  │")
            print(f"│  {'':14s}     {rel['desc']:42s}  │")

        print("└─────────────────────────────────────────────────────────────────┘")

    def _print_associations(self, schema: Dict):
        """Связь M:M → Ассоциативная таблица (Раскрытие связи)."""
        print("\n┌─────────────────────────────────────────────────────────────────┐")
        print("│  СВЯЗЬ M:M → АССОЦИАТИВНАЯ ТАБЛИЦА (РАСКРЫТИЕ СВЯЗИ)          │")
        print("├─────────────────────────────────────────────────────────────────┤")

        for assoc in schema["associations"]:
            print(f"│  {assoc['name']:18s}                                  │")
            print(f"│    {assoc['from']:14s} ←→ {assoc['to']:14s}                   │")
            print(f"│    Атр: {assoc['assoc_attr']:12s} / {assoc['reverse_attr']:12s}             │")
            print(f"│    {assoc['desc']:48s}  │")
            print(f"│                                                              │")

        print("└─────────────────────────────────────────────────────────────────┘")

    def _print_normalization(self, schema: Dict):
        """Промежуточный итог схемы (до нормализации)."""
        print("\n┌─────────────────────────────────────────────────────────────────┐")
        print("│  ПРОМЕЖУТОЧНЫЙ ИТОГ СХЕМЫ (ДО НОРМАЛИЗАЦИИ)                   │")
        print("├─────────────────────────────────────────────────────────────────┤")

        total_entities = len(schema["entities"])
        total_relations = len(schema["relations"])
        total_associations = len(schema["associations"])
        total_attrs = sum(len(e["attributes"]) for e in schema["entities"].values())
        total_records = sum(e["count"] for e in schema["entities"].values())

        print(f"│  Сущностей (таблиц):        {total_entities:5d}                            │")
        print(f"│  Связей 1:M (FK):           {total_relations:5d}                            │")
        print(f"│  Связей M:M (assoc):        {total_associations:5d}                            │")
        print(f"│  Всего атрибутов:           {total_attrs:5d}                            │")
        print(f"│  Всего записей:             {total_records:5d}                            │")
        print("├─────────────────────────────────────────────────────────────────┤")

        # Выводим таблицу атрибутов
        print("│  ТАБЛИЦА         │ АТРИБУТЫ (выборочно)                         │")
        print("├──────────────────┼──────────────────────────────────────────────┤")

        for entity_name, info in schema["entities"].items():
            attrs_preview = ", ".join(info["attributes"][:6])
            if len(info["attributes"]) > 6:
                attrs_preview += f", ... (+{len(info['attributes']) - 6})"
            print(f"│  {info['table_name']:16s} │ {attrs_preview:44s} │")

        print("└──────────────────┴──────────────────────────────────────────────┘")

        # SQL аналог
        print("\n  SQL-АНАЛОГ (для справки):")
        print("  ─────────────────────────────")

        for entity_name, info in schema["entities"].items():
            pk = info["key_attr"]
            sample_attrs = info["attributes"][:5]
            fields_str = ", ".join([pk] + [a for a in sample_attrs if a != pk])
            print(f"  SELECT {fields_str}")
            print(f"      -- остальные поля скрыты")
            print(f"  FROM {info['table_name']};")
            print()

    # ─── Остальные команды ─────────────────────────────────────────────────

    def _cmd_enable(self, cmd: ScriptCommand) -> Any:
        """ENABLE <name> - включить учётную запись."""
        if not cmd.args or not cmd.args[1] if len(cmd.args) > 1 else True:
            print("Использование: ENABLE <username>  или  ENABLE USER <username>")
            return None

        obj_type = cmd.args[0] if cmd.args else "user"
        obj_name = self._substitute_vars(cmd.args[1])
        extra = [self._substitute_vars(a) for a in cmd.args[2:]]

        if obj_type == "user":
            return self._run_tool_cmd(["user", "enable", obj_name] + extra)
        else:
            print(f"ENABLE поддерживается только для пользователей (получено: {obj_type})")
            return None

    def _cmd_disable(self, cmd: ScriptCommand) -> Any:
        """DISABLE <name> - отключить учётную запись."""
        if not cmd.args or not cmd.args[1] if len(cmd.args) > 1 else True:
            print("Использование: DISABLE <username>  или  DISABLE USER <username>")
            return None

        obj_type = cmd.args[0] if cmd.args else "user"
        obj_name = self._substitute_vars(cmd.args[1])
        extra = [self._substitute_vars(a) for a in cmd.args[2:]]

        if obj_type == "user":
            return self._run_tool_cmd(["user", "disable", obj_name] + extra)
        else:
            print(f"DISABLE поддерживается только для пользователей (получено: {obj_type})")
            return None

    def _cmd_delete(self, cmd: ScriptCommand) -> Any:
        """DELETE <type> <name> - удалить объект. Поддерживает многословные имена."""
        if not cmd.args or not cmd.args[0]:
            print("Использование: DELETE USER <name> | DELETE GROUP <name> | DELETE COMPUTER <name>")
            return None

        obj_type = cmd.args[0]
        # Склеиваем все оставшиеся аргументы как имя
        obj_name = self._substitute_vars(" ".join(cmd.args[1:])) if len(cmd.args) > 1 else ""

        if not obj_name:
            print("Использование: DELETE <type> <name>")
            return None

        if obj_type in ("user", "group", "computer", "ou", "contact", "gpo"):
            result = self._run_tool_cmd([obj_type, "delete", obj_name])
            self.client.clear_names_cache(obj_type)
            return result
        else:
            print(f"DELETE не поддерживается для типа '{obj_type}'")
            return None

    def _cmd_list(self, cmd: ScriptCommand) -> Any:
        """LIST <type> - показать список объектов."""
        if not cmd.args or not cmd.args[0]:
            print("Использование: LIST USERS | LIST GROUPS | LIST COMPUTERS | LIST OUS")
            return None

        obj_type = cmd.args[0]
        extra = [self._substitute_vars(a) for a in cmd.args[1:]]

        if obj_type in ("user", "group", "computer", "ou", "contact", "gpo",
                        "dns", "sites", "domain"):
            return self._run_tool_cmd([obj_type, "list"] + extra)
        else:
            print(f"LIST не поддерживается для типа '{obj_type}'")
            return None

    def _run_tool_cmd(self, args: List[str]) -> Any:
        """Выполнить samba-tool команду и вывести результат."""
        result = self.client.samba_tool.run(args)

        if result.success:
            output_text = result.stdout.strip()
            if output_text:
                print(output_text)
        else:
            error_parts = []
            if result.stdout.strip():
                error_parts.append(result.stdout.strip())
            if result.stderr.strip():
                error_parts.append(result.stderr.strip())
            error_msg = "\n".join(error_parts) if error_parts else f"Ошибка: команда завершилась с кодом {result.returncode}"
            print(f"Ошибка: {error_msg}", file=sys.stderr)

        self.last_result = result.to_dict()
        return self.last_result

    def _cmd_set(self, cmd: ScriptCommand) -> str:
        """SET <name> = <value> - установить переменную."""
        name, value = cmd.args[0], cmd.args[1]
        value = self._substitute_vars(value)
        self.variables[name] = value
        self.last_result = value
        return value

    def _cmd_fields(self, cmd: ScriptCommand) -> List[str]:
        """FIELDS <field_list> - установить список полей."""
        self.current_fields = cmd.args
        print(f"Поля: {', '.join(self.current_fields)}")
        self.last_result = self.current_fields
        return self.current_fields

    def _cmd_limit(self, cmd: ScriptCommand) -> int:
        """LIMIT <number> - установить лимит записей."""
        self.current_limit = int(cmd.args[0])
        print(f"Лимит: {self.current_limit}")
        self.last_result = self.current_limit
        return self.current_limit

    def _cmd_search(self, cmd: ScriptCommand) -> List[LdifRecord]:
        """SEARCH <term> - поиск подстроки."""
        term = self._substitute_vars(cmd.args[0])
        records = self.client.search(term, database=self.current_database)

        if self.current_fields and self.current_fields != ["*"]:
            records = self.client.queries.select_fields(records, self.current_fields)

        if self.current_limit > 0:
            records = records[:self.current_limit]

        self.last_records = records
        self._output_records(records)
        self.last_result = records
        return records

    def _cmd_dataframe(self, cmd: ScriptCommand) -> Any:
        """DATAFRAME - показать последний результат как pandas DataFrame."""
        if not self.last_records:
            print("(нет записей для DataFrame)")
            return None

        try:
            from sdb.formatters.dataframe_fmt import DataframeFormatter
            df_formatter = DataframeFormatter()
            df = df_formatter.to_dataframe(
                self.last_records,
                fields=self.current_fields,
            )
            self.last_dataframe = df
            print(df.to_string())
            print(f"\n[{len(df)} строк x {len(df.columns)} колонок]")
            self.last_result = df
            return df
        except ImportError as e:
            print(f"Ошибка: {e}")
            return None

    # ─── Импорт данных ────────────────────────────────────────────────────

    def _cmd_import(self, cmd: ScriptCommand) -> Any:
        """IMPORT <file> [TYPE <type>] - импорт данных из CSV/JSON файла."""
        filepath = self._substitute_vars(cmd.args[0])
        import_type = cmd.kwargs.get("type", "").lower()

        if not os.path.isfile(filepath):
            print(f"Ошибка: файл не найден: {filepath}", file=sys.stderr)
            return None

        ext = os.path.splitext(filepath)[1].lower()

        if ext == ".csv":
            data = self._read_csv(filepath)
        elif ext == ".json":
            data = self._read_json(filepath)
        else:
            print(f"Ошибка: неподдерживаемый формат файла: {ext}", file=sys.stderr)
            return None

        if not data:
            print("Файл пуст или не содержит данных")
            return None

        if not import_type:
            import_type = self._detect_import_type(data)
            if not import_type:
                print("Не удалось определить тип импорта. Укажите TYPE: IMPORT file.csv TYPE user")
                return None

        print(f"Импорт {len(data)} записей типа '{import_type}' из {filepath}")

        results = self._do_import(data, import_type)

        success = sum(1 for r in results if r.get("success"))
        failed = sum(1 for r in results if not r.get("success"))

        print(f"Результат: {success} успешно, {failed} ошибок")

        self.client.clear_names_cache()
        self.last_result = results
        return results

    def _cmd_create(self, cmd: ScriptCommand) -> Any:
        """CREATE USER/GROUP/COMPUTER/OU ... - создание объектов."""
        args = [self._substitute_vars(a) for a in cmd.args]

        if not args:
            print("Использование: CREATE USER <username> <password> [опции]")
            print("               CREATE USERS FROM <file>")
            print("               CREATE GROUP <name> [опции]")
            print("               CREATE COMPUTER <name> [опции]")
            print("               CREATE OU <name> [--base-dn=DN] [опции]")
            return None

        obj_type = args[0].upper()

        # CREATE USERS FROM <file>
        if obj_type == "USERS" and len(args) >= 3 and args[1].upper() == "FROM":
            filepath = args[2]
            if filepath:
                return self._cmd_import(ScriptCommand(
                    cmd_type=CommandType.IMPORT,
                    args=[filepath],
                    kwargs={"type": "user"},
                ))
            else:
                print("Ошибка: укажите файл: CREATE USERS FROM <file>")
                return None

        # CREATE USER <username> <password> [опции]
        if obj_type == "USER":
            if len(args) >= 3 and args[1].upper() == "USERS" and args[2].upper() == "FROM":
                filepath = args[3] if len(args) > 3 else ""
                if filepath:
                    return self._cmd_import(ScriptCommand(
                        cmd_type=CommandType.IMPORT,
                        args=[filepath],
                        kwargs={"type": "user"},
                    ))

            if len(args) >= 3:
                username = args[1]
                password = args[2]
                extra = args[3:]
                result = self.client.samba_tool.run(
                    ["user", "create", username, password] + extra
                )
                if result.success:
                    print(result.stdout.strip())
                    self.client.clear_names_cache("user")
                else:
                    error_parts = []
                    if result.stdout.strip():
                        error_parts.append(result.stdout.strip())
                    if result.stderr.strip():
                        error_parts.append(result.stderr.strip())
                    print(f"Ошибка: {'; '.join(error_parts)}", file=sys.stderr)
                return result.to_dict()
            else:
                print("Использование: CREATE USER <username> <password> [опции]")
                return None

        elif obj_type == "GROUP" and len(args) >= 2:
            groupname = args[1]
            extra = args[2:]
            result = self.client.samba_tool.run(
                ["group", "create", groupname] + extra
            )
            if result.success:
                print(result.stdout.strip())
                self.client.clear_names_cache("group")
            else:
                error_parts = []
                if result.stdout.strip():
                    error_parts.append(result.stdout.strip())
                if result.stderr.strip():
                    error_parts.append(result.stderr.strip())
                print(f"Ошибка: {'; '.join(error_parts)}", file=sys.stderr)
            return result.to_dict()

        elif obj_type == "COMPUTER" and len(args) >= 2:
            computername = args[1]
            extra = args[2:]
            result = self.client.samba_tool.run(
                ["computer", "create", computername] + extra
            )
            if result.success:
                print(result.stdout.strip())
                self.client.clear_names_cache("computer")
            else:
                error_parts = []
                if result.stdout.strip():
                    error_parts.append(result.stdout.strip())
                if result.stderr.strip():
                    error_parts.append(result.stderr.strip())
                print(f"Ошибка: {'; '.join(error_parts)}", file=sys.stderr)
            return result.to_dict()

        elif obj_type == "OU" and len(args) >= 2:
            ou_name = args[1]
            extra = args[2:]

            # Обрабатываем --base-dn опцию
            base_dn = None
            new_extra = []
            i = 0
            while i < len(extra):
                arg = extra[i]
                if arg.lower().startswith("--base-dn="):
                    base_dn = arg.split("=", 1)[1]
                elif arg.lower() == "--base-dn" and i + 1 < len(extra):
                    base_dn = extra[i + 1]
                    i += 1  # пропускаем следующий аргумент
                else:
                    new_extra.append(arg)
                i += 1

            # Конструируем полный DN для samba-tool ou create
            if "=" not in ou_name:
                if base_dn:
                    ou_dn = f"OU={ou_name},{base_dn}"
                else:
                    # Без base-dn просто используем OU=name
                    # (samba-tool может потребовать полный DN)
                    ou_dn = f"OU={ou_name}"
            else:
                ou_dn = ou_name

            result = self.client.samba_tool.run(
                ["ou", "create", ou_dn] + new_extra
            )
            if result.success:
                print(result.stdout.strip())
                self.client.clear_names_cache("ou")
            else:
                error_parts = []
                if result.stdout.strip():
                    error_parts.append(result.stdout.strip())
                if result.stderr.strip():
                    error_parts.append(result.stderr.strip())
                print(f"Ошибка: {'; '.join(error_parts)}", file=sys.stderr)
            return result.to_dict()

        else:
            print(f"Неизвестный CREATE: {' '.join(args)}")
            return None

    # ─── Вспомогательные методы ────────────────────────────────────────────

    def _output_records(self, records: List[LdifRecord]):
        """Вывести записи в текущем формате."""
        if not records:
            return

        # Для XLSX формата не выводим в консоль - только в файл
        if self.current_format == "xlsx":
            if self.current_output:
                formatter = get_formatter("xlsx")
                formatter.write_to_file(
                    records,
                    self.current_output,
                    fields=self.current_fields,
                )
                print(f"Записано {len(records)} записей в: {self.current_output}")
                self.current_output = None
            return

        formatter = get_formatter(self.current_format)

        if self.current_output:
            formatter.write_to_file(
                records,
                self.current_output,
                fields=self.current_fields,
            )
            print(f"Записано {len(records)} записей в: {self.current_output}")
            self.current_output = None
        else:
            output = formatter.format_records(
                records,
                fields=self.current_fields,
            )
            if output and output.strip() and output.strip() != "(нет записей)":
                print(output)

    def _simple_to_ldap_filter(self, filter_expr: str) -> str:
        """Преобразовать простой фильтр в LDAP формат."""
        filter_expr = filter_expr.strip()

        if filter_expr.startswith("(") or filter_expr.startswith("&"):
            return filter_expr

        if "=" in filter_expr:
            return f"({filter_expr})"

        return f"(objectClass={filter_expr})"

    def _substitute_vars(self, value: str) -> str:
        """Подставить переменные в строку ($name → value)."""
        if not value or "$" not in value:
            return value

        result = value
        for name, val in self.variables.items():
            result = result.replace(f"${name}", val)
        return result

    # ─── Вспомогательные методы для IMPORT ──────────────────────────────────

    def _read_csv(self, filepath: str) -> List[Dict[str, str]]:
        """Прочитать CSV файл и вернуть список словарей."""
        import csv as csv_mod
        data = []
        try:
            with open(filepath, "r", encoding="utf-8-sig") as f:
                reader = csv_mod.DictReader(f)
                for row in reader:
                    data.append(dict(row))
        except Exception as e:
            print(f"Ошибка чтения CSV: {e}", file=sys.stderr)
        return data

    def _read_json(self, filepath: str) -> List[Dict[str, str]]:
        """Прочитать JSON файл и вернуть список словарей."""
        data = []
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                content = json.load(f)
                if isinstance(content, list):
                    data = content
                elif isinstance(content, dict):
                    for key in ("users", "groups", "computers", "data", "records"):
                        if key in content:
                            data = content[key]
                            break
                    if not data:
                        data = [content]
        except Exception as e:
            print(f"Ошибка чтения JSON: {e}", file=sys.stderr)
        return data

    def _detect_import_type(self, data: List[Dict[str, str]]) -> str:
        """Автоопределение типа импорта по ключам данных."""
        if not data:
            return ""
        first = data[0]
        keys = set(k.lower() for k in first.keys())

        if "username" in keys and "password" in keys:
            return "user"
        if "samaccountname" in keys:
            return "user"
        if "groupname" in keys or "group" in keys:
            return "group"
        if "computername" in keys or "computer" in keys:
            return "computer"
        return ""

    def _do_import(self, data: List[Dict[str, str]], import_type: str) -> List[Dict]:
        """Выполнить импорт данных."""
        results = []

        if import_type == "user":
            for row in data:
                username = row.get("username", row.get("sAMAccountName", ""))
                password = row.get("password", row.get("pwd", "P@ssw0rd"))
                if not username:
                    results.append({"success": False, "error": "Нет имени пользователя"})
                    continue
                extra = []
                for key, value in row.items():
                    if key.lower() in ("username", "password", "samaccountname", "pwd"):
                        continue
                    extra.append(f"--{key}={value}")
                result = self.client.samba_tool.run(
                    ["user", "create", username, password] + extra
                )
                results.append({
                    "success": result.success,
                    "username": username,
                    "output": result.stdout.strip(),
                    "error": result.stderr.strip() if result.stderr else "",
                })
        elif import_type == "group":
            for row in data:
                groupname = row.get("groupname", row.get("group", row.get("name", "")))
                if not groupname:
                    results.append({"success": False, "error": "Нет имени группы"})
                    continue
                result = self.client.samba_tool.run(["group", "create", groupname])
                results.append({
                    "success": result.success,
                    "groupname": groupname,
                    "output": result.stdout.strip(),
                    "error": result.stderr.strip() if result.stderr else "",
                })
        elif import_type == "computer":
            for row in data:
                computername = row.get("computername", row.get("computer", row.get("name", "")))
                if not computername:
                    results.append({"success": False, "error": "Нет имени компьютера"})
                    continue
                result = self.client.samba_tool.run(["computer", "create", computername])
                results.append({
                    "success": result.success,
                    "computername": computername,
                    "output": result.stdout.strip(),
                    "error": result.stderr.strip() if result.stderr else "",
                })
        else:
            print(f"Неизвестный тип импорта: {import_type}")

        return results
