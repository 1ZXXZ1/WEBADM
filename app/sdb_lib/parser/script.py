"""
Парсер скриптового языка SDB.

Скриптовый язык SDB (Samba Database Script) - простой DSL для
удобной работы с базами Samba. Не нужно писать длинные команды
ldbsearch - достаточно простых инструкций.

Синтаксис:
─────────────────────────────────────────────
    # Комментарий

    # Выбор базы данных
    USE sam;
    USE privilege;
    USE /path/to/custom.ldb;

    # Запрос записей
    SELECT dn, sAMAccountName, cn
    FROM *
    WHERE objectClass=user;

    # Запись конкретной записи по DN
    SELECT * FROM "CN=Admin,CN=Users,DC=kcrb,DC=local";

    # SQL-like запросы (новое в 1.2.3-4)
    SELECT sAMAccountName, cn, mail FROM USERS;
    SELECT sAMAccountName, cn FROM GROUPS WHERE cn=*Admin*;
    SELECT * FROM COMPUTERS;

    # Фильтр по атрибуту
    WHERE sAMAccountName=admin;

    # Вывод в разных форматах
    FORMAT json;
    FORMAT csv;
    FORMAT tsv;
    FORMAT table;
    FORMAT dataframe;
    FORMAT xlsx;

    # Сохранение в файл
    OUTPUT /tmp/result.json;
    OUTPUT /tmp/result.xlsx;

    # Команды samba-tool (полный формат)
    TOOL user list;
    TOOL group list;
    TOOL user create username P@ssw0rd;
    TOOL computer list;

    # Сокращённые команды (без TOOL, регистронезависимые)
    SHOW USER admin;              # ldbsearch по sAMAccountName
    SHOW GROUP "Domain Admins";   # ldbsearch по sAMAccountName (с кавычками)
    SHOW GROUP Domain Admins;     # то же самое (без кавычек - склеивается)
    SHOW COMPUTER PC01;           # ldbsearch по sAMAccountName
    SHOW DATABASES;               # Показать базы данных
    SHOW GPO "Default Domain";    # ldbsearch по displayName
    SHOW DNS;                     # DNS записи из БД (через ldbsearch)
    SHOW HELP;                    # Справка по SHOW
    LIST USERS;                   # = TOOL user list
    LIST GROUPS;                  # = TOOL group list
    LIST COMPUTERS;               # = TOOL computer list
    ENABLE admin;                 # = TOOL user enable admin
    DISABLE admin;                # = TOOL user disable admin
    DELETE USER admin;            # = TOOL user delete admin
    DELETE GROUP "Old Group";     # = TOOL group delete "Old Group"

    # Анализ схемы БД (новое в 1.2.3-4)
    SYNTHESIS;                    # Полный анализ схемы
    SYNTHESIS SCHEMA;             # То же самое
    SYNTHESIS ENTITY;             # Сущности -> Таблицы
    SYNTHESIS RELATION;           # Связи 1:M -> Внешние ключи
    SYNTHESIS ASSOCIATION;        # Связи M:M -> Ассоциативные таблицы
    SYNTHESIS NORMALIZE;          # Промежуточный итог схемы (до нормализации)

    # Переменные (простые)
    SET domain = "DC=kcrb,DC=local";

    # Показать только указанные атрибуты
    FIELDS dn, cn, sAMAccountName;

    # Лимит записей
    LIMIT 10;

    # Поиск подстроки
    SEARCH "administrator";

    # Экспорт в pandas DataFrame (Python API)
    DATAFRAME;
─────────────────────────────────────────────
"""

import re
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from enum import Enum


class CommandType(Enum):
    """Типы команд скриптового языка SDB."""
    USE = "USE"
    SELECT = "SELECT"
    WHERE = "WHERE"
    FORMAT = "FORMAT"
    OUTPUT = "OUTPUT"
    TOOL = "TOOL"
    SHOW = "SHOW"
    SET = "SET"
    FIELDS = "FIELDS"
    LIMIT = "LIMIT"
    SEARCH = "SEARCH"
    DATAFRAME = "DATAFRAME"
    IMPORT = "IMPORT"
    CREATE = "CREATE"
    ENABLE = "ENABLE"
    DISABLE = "DISABLE"
    DELETE = "DELETE"
    LIST = "LIST"
    SYNTHESIS = "SYNTHESIS"
    COMMENT = "COMMENT"
    EMPTY = "EMPTY"


# Типы объектов для SHOW/DELETE/LIST (регистронезависимые)
_OBJECT_TYPES = {
    "USER": "user",
    "USERS": "user",
    "GROUP": "group",
    "GROUPS": "group",
    "COMPUTER": "computer",
    "COMPUTERS": "computer",
    "OU": "ou",
    "OUS": "ou",
    "DNS": "dns",
    "GPO": "gpo",
    "CONTACT": "contact",
    "CONTACTS": "contact",
}

# Подтипы для SHOW, где имя может быть многословным
_MULTI_WORD_NAME_TYPES = {"USER", "GROUP", "COMPUTER", "OU", "GPO", "CONTACT"}


@dataclass
class ScriptCommand:
    """
    Одна команда скрипта SDB.

    Attributes:
        cmd_type: Тип команды
        args: Позиционные аргументы
        kwargs: Именованные аргументы
        raw: Исходная строка команды
        line_num: Номер строки в скрипте
    """
    cmd_type: CommandType
    args: List[str] = field(default_factory=list)
    kwargs: Dict[str, str] = field(default_factory=dict)
    raw: str = ""
    line_num: int = 0


class ScriptParser:
    """
    Парсер скриптового языка SDB.

    Разбирает текст скрипта в список ScriptCommand,
    которые затем выполняет движок ScriptEngine.

    Поддерживает:
      - Многострочные команды (SELECT ... FROM ... WHERE ... ;)
      - Несколько команд на одной строке через ;
      - Комментарии (#)
      - Строки в кавычках ("...")
      - Переменные ($name)
      - Регистронезависимые команды
      - Сокращённые команды (ENABLE, DISABLE, DELETE, LIST, SHOW)
      - Многословные имена объектов (Domain Admins, Default Domain Policy)
      - SQL-like SELECT (SELECT ... FROM USERS;)
      - SYNTHESIS команда
    """

    _RE_QUOTED_STRING = re.compile(r'"([^"]*)"')
    _RE_VARIABLE = re.compile(r'\$(\w+)')
    _RE_SEMICOLON_END = re.compile(r';\s*$')

    def __init__(self):
        self.variables: Dict[str, str] = {}

    def parse(self, script_text: str) -> List[ScriptCommand]:
        """
        Разобрать текст скрипта в список команд.

        Args:
            script_text: Текст скрипта

        Returns:
            Список ScriptCommand
        """
        commands = []
        lines = script_text.split("\n")
        line_num = 0
        buffer = ""
        buffer_start_line = 0

        for raw_line in lines:
            line_num += 1
            stripped = raw_line.strip()

            if not stripped:
                continue

            if stripped.startswith("#"):
                commands.append(ScriptCommand(
                    cmd_type=CommandType.COMMENT,
                    args=[stripped],
                    raw=raw_line,
                    line_num=line_num,
                ))
                continue

            stmts = self._split_semicolons(stripped)

            for stmt in stmts:
                stmt = stmt.strip()
                if not stmt:
                    continue

                if buffer:
                    buffer += " " + stmt
                else:
                    buffer = stmt
                    buffer_start_line = line_num

                if buffer.endswith(";"):
                    cmd_str = buffer.rstrip(";").strip()
                    buffer = ""

                    cmd = self._parse_single_command(cmd_str, buffer_start_line)
                    if cmd is not None:
                        commands.append(cmd)

        if buffer.strip():
            cmd_str = buffer.rstrip(";").strip()
            cmd = self._parse_single_command(cmd_str, buffer_start_line)
            if cmd is not None:
                commands.append(cmd)

        return commands

    def _split_semicolons(self, line: str) -> List[str]:
        """
        Разбить строку на части по ; с учётом кавычек.

        Символ ; внутри кавычек "..." не считается разделителем.
        """
        parts = []
        current = ""
        in_quotes = False

        for ch in line:
            if ch == '"':
                in_quotes = not in_quotes
                current += ch
            elif ch == ';' and not in_quotes:
                current += ch
                parts.append(current)
                current = ""
            else:
                current += ch

        if current.strip():
            parts.append(current)

        return parts

    def _parse_single_command(self, cmd_str: str, line_num: int) -> Optional[ScriptCommand]:
        """
        Разобрать одну команду (без точки с запятой).

        Все ключевые слова регистронезависимые.
        Поддерживает многословные имена объектов:
          SHOW GROUP Domain Admins  →  args=["group", "Domain Admins"]
          SHOW GPO "Default Domain Policy"  →  args=["gpo", "Default Domain Policy"]
        """
        if not cmd_str:
            return None

        upper = cmd_str.upper().strip()

        # ─── USE <database> ────────────────────────────────────────────────
        if upper.startswith("USE "):
            db_name = cmd_str[4:].strip().strip('"').strip("'")
            return ScriptCommand(
                cmd_type=CommandType.USE,
                args=[db_name],
                raw=cmd_str,
                line_num=line_num,
            )

        # ─── SELECT <fields> FROM <scope> [WHERE <filter>] ────────────────
        if upper.startswith("SELECT "):
            return self._parse_select(cmd_str, line_num)

        # ─── WHERE <filter> ───────────────────────────────────────────────
        if upper.startswith("WHERE "):
            filter_str = cmd_str[6:].strip()
            return ScriptCommand(
                cmd_type=CommandType.WHERE,
                args=[filter_str],
                raw=cmd_str,
                line_num=line_num,
            )

        # ─── FORMAT <format_name> ─────────────────────────────────────────
        if upper.startswith("FORMAT "):
            fmt = cmd_str[7:].strip().strip('"').strip("'").lower()
            return ScriptCommand(
                cmd_type=CommandType.FORMAT,
                args=[fmt],
                raw=cmd_str,
                line_num=line_num,
            )

        # ─── OUTPUT <filepath> ────────────────────────────────────────────
        if upper.startswith("OUTPUT "):
            filepath = cmd_str[7:].strip().strip('"').strip("'")
            return ScriptCommand(
                cmd_type=CommandType.OUTPUT,
                args=[filepath],
                raw=cmd_str,
                line_num=line_num,
            )

        # ─── TOOL <subcommand> <args...> ──────────────────────────────────
        if upper.startswith("TOOL "):
            tool_args_str = cmd_str[5:].strip()
            tool_args = self._split_tool_args(tool_args_str)
            return ScriptCommand(
                cmd_type=CommandType.TOOL,
                args=tool_args,
                raw=cmd_str,
                line_num=line_num,
            )

        # ─── SYNTHESIS [SCHEMA|ENTITY|RELATION|ASSOCIATION|NORMALIZE] ─────
        if upper.startswith("SYNTHESIS"):
            rest = cmd_str[9:].strip() if len(cmd_str) > 9 else ""
            subcmd = rest.upper() if rest else "SCHEMA"
            return ScriptCommand(
                cmd_type=CommandType.SYNTHESIS,
                args=[subcmd],
                raw=cmd_str,
                line_num=line_num,
            )

        # ─── ENABLE <name> [опции] ───────────────────────────────────────
        if upper.startswith("ENABLE"):
            rest = cmd_str[6:].strip()
            if not rest:
                return ScriptCommand(
                    cmd_type=CommandType.ENABLE,
                    args=["user", ""],
                    raw=cmd_str,
                    line_num=line_num,
                )
            # Многословное имя: ENABLE USER Domain Admin
            parts = self._split_tool_args(rest)
            if parts and parts[0].upper() in _OBJECT_TYPES:
                obj_type = _OBJECT_TYPES[parts[0].upper()]
                # Склеиваем все оставшиеся части как имя
                obj_name = " ".join(parts[1:]) if len(parts) > 1 else ""
                return ScriptCommand(
                    cmd_type=CommandType.ENABLE,
                    args=[obj_type, obj_name],
                    raw=cmd_str,
                    line_num=line_num,
                )
            else:
                # По умолчанию - пользователь, все части - имя
                return ScriptCommand(
                    cmd_type=CommandType.ENABLE,
                    args=["user", " ".join(parts)],
                    raw=cmd_str,
                    line_num=line_num,
                )

        # ─── DISABLE <name> [опции] ──────────────────────────────────────
        if upper.startswith("DISABLE"):
            rest = cmd_str[7:].strip()
            if not rest:
                return ScriptCommand(
                    cmd_type=CommandType.DISABLE,
                    args=["user", ""],
                    raw=cmd_str,
                    line_num=line_num,
                )
            parts = self._split_tool_args(rest)
            if parts and parts[0].upper() in _OBJECT_TYPES:
                obj_type = _OBJECT_TYPES[parts[0].upper()]
                obj_name = " ".join(parts[1:]) if len(parts) > 1 else ""
                return ScriptCommand(
                    cmd_type=CommandType.DISABLE,
                    args=[obj_type, obj_name],
                    raw=cmd_str,
                    line_num=line_num,
                )
            else:
                return ScriptCommand(
                    cmd_type=CommandType.DISABLE,
                    args=["user", " ".join(parts)],
                    raw=cmd_str,
                    line_num=line_num,
                )

        # ─── DELETE <type> <name> [опции] ────────────────────────────────
        if upper.startswith("DELETE "):
            rest = cmd_str[7:].strip()
            parts = self._split_tool_args(rest)
            if parts and parts[0].upper() in _OBJECT_TYPES:
                obj_type = _OBJECT_TYPES[parts[0].upper()]
                # Склеиваем все оставшиеся части как имя
                obj_name = " ".join(parts[1:]) if len(parts) > 1 else ""
                return ScriptCommand(
                    cmd_type=CommandType.DELETE,
                    args=[obj_type, obj_name],
                    raw=cmd_str,
                    line_num=line_num,
                )
            else:
                return ScriptCommand(
                    cmd_type=CommandType.DELETE,
                    args=["user", " ".join(parts)],
                    raw=cmd_str,
                    line_num=line_num,
                )

        # ─── LIST <type> [опции] ─────────────────────────────────────────
        if upper.startswith("LIST "):
            rest = cmd_str[5:].strip()
            parts = self._split_tool_args(rest)
            if parts and parts[0].upper() in _OBJECT_TYPES:
                obj_type = _OBJECT_TYPES[parts[0].upper()]
                extra = parts[1:] if len(parts) > 1 else []
                return ScriptCommand(
                    cmd_type=CommandType.LIST,
                    args=[obj_type] + extra,
                    raw=cmd_str,
                    line_num=line_num,
                )
            else:
                return ScriptCommand(
                    cmd_type=CommandType.LIST,
                    args=["user"] + parts,
                    raw=cmd_str,
                    line_num=line_num,
                )

        # ─── SHOW <what> [name] ──────────────────────────────────────────
        # Важное исправление: многословные имена склеиваются
        # SHOW GROUP Domain Admins → args=["group", "Domain Admins"]
        # SHOW GPO "Default Domain Policy" → args=["gpo", "Default Domain Policy"]
        if upper.startswith("SHOW "):
            rest = cmd_str[5:].strip()
            rest_upper = rest.upper()

            # SHOW DATABASES
            if rest_upper in ("DATABASES", "DBS"):
                return ScriptCommand(
                    cmd_type=CommandType.SHOW,
                    args=["DATABASES"],
                    raw=cmd_str,
                    line_num=line_num,
                )

            # SHOW HELP
            if rest_upper == "HELP":
                return ScriptCommand(
                    cmd_type=CommandType.SHOW,
                    args=["HELP"],
                    raw=cmd_str,
                    line_num=line_num,
                )

            # SHOW DNS — особый случай (без имени)
            if rest_upper == "DNS" or rest_upper.startswith("DNS ") and len(rest.split()) == 1:
                return ScriptCommand(
                    cmd_type=CommandType.SHOW,
                    args=["dns", ""],
                    raw=cmd_str,
                    line_num=line_num,
                )

            # SHOW USER/GROUP/COMPUTER/OU/GPO/CONTACT [name]
            # Многословное имя: склеиваем все после типа объекта
            parts = self._split_tool_args(rest)
            if parts and parts[0].upper() in _OBJECT_TYPES:
                obj_type_key = parts[0].upper()
                obj_type = _OBJECT_TYPES[obj_type_key]

                if obj_type_key in _MULTI_WORD_NAME_TYPES:
                    # Склеиваем все оставшиеся части как имя объекта
                    obj_name = " ".join(parts[1:]) if len(parts) > 1 else ""
                else:
                    obj_name = parts[1] if len(parts) > 1 else ""
                    extra = parts[2:] if len(parts) > 2 else []

                if obj_type_key in _MULTI_WORD_NAME_TYPES:
                    return ScriptCommand(
                        cmd_type=CommandType.SHOW,
                        args=[obj_type, obj_name],
                        raw=cmd_str,
                        line_num=line_num,
                    )
                else:
                    return ScriptCommand(
                        cmd_type=CommandType.SHOW,
                        args=[obj_type, obj_name] + extra,
                        raw=cmd_str,
                        line_num=line_num,
                    )

            # Fallback: SHOW <что-то> → храним как есть
            return ScriptCommand(
                cmd_type=CommandType.SHOW,
                args=[rest.upper()],
                raw=cmd_str,
                line_num=line_num,
            )

        # ─── SET <name> = <value> ─────────────────────────────────────────
        if upper.startswith("SET "):
            set_expr = cmd_str[4:].strip()
            if "=" in set_expr:
                name, value = set_expr.split("=", 1)
                name = name.strip()
                value = value.strip().strip('"').strip("'")
                return ScriptCommand(
                    cmd_type=CommandType.SET,
                    args=[name, value],
                    raw=cmd_str,
                    line_num=line_num,
                )

        # ─── FIELDS <field_list> ──────────────────────────────────────────
        if upper.startswith("FIELDS "):
            fields_str = cmd_str[7:].strip()
            fields = [f.strip() for f in fields_str.split(",")]
            return ScriptCommand(
                cmd_type=CommandType.FIELDS,
                args=fields,
                raw=cmd_str,
                line_num=line_num,
            )

        # ─── LIMIT <number> ──────────────────────────────────────────────
        if upper.startswith("LIMIT "):
            limit_str = cmd_str[6:].strip()
            try:
                limit = int(limit_str)
            except ValueError:
                limit = 0
            return ScriptCommand(
                cmd_type=CommandType.LIMIT,
                args=[str(limit)],
                raw=cmd_str,
                line_num=line_num,
            )

        # ─── SEARCH <term> ────────────────────────────────────────────────
        if upper.startswith("SEARCH "):
            term = cmd_str[7:].strip().strip('"').strip("'")
            return ScriptCommand(
                cmd_type=CommandType.SEARCH,
                args=[term],
                raw=cmd_str,
                line_num=line_num,
            )

        # ─── DATAFRAME ────────────────────────────────────────────────────
        if upper == "DATAFRAME" or upper.startswith("DATAFRAME"):
            return ScriptCommand(
                cmd_type=CommandType.DATAFRAME,
                args=[],
                raw=cmd_str,
                line_num=line_num,
            )

        # ─── IMPORT <file> [TYPE <type>] ──────────────────────────────────
        if upper.startswith("IMPORT "):
            import_rest = cmd_str[7:].strip()
            parts = self._split_tool_args(import_rest)
            filepath = parts[0] if parts else ""
            import_type = ""
            if len(parts) >= 3 and parts[1].upper() == "TYPE":
                import_type = parts[2]
            return ScriptCommand(
                cmd_type=CommandType.IMPORT,
                args=[filepath],
                kwargs={"type": import_type},
                raw=cmd_str,
                line_num=line_num,
            )

        # ─── CREATE USER/GROUP/COMPUTER/OU/USERS ... ────────────────────
        if upper.startswith("CREATE "):
            create_rest = cmd_str[7:].strip()
            create_args = self._parse_create_args(create_rest)
            return ScriptCommand(
                cmd_type=CommandType.CREATE,
                args=create_args,
                raw=cmd_str,
                line_num=line_num,
            )

        # Неизвестная команда
        return ScriptCommand(
            cmd_type=CommandType.COMMENT,
            args=[f"# UNKNOWN: {cmd_str}"],
            raw=cmd_str,
            line_num=line_num,
        )

    def _parse_create_args(self, create_rest: str) -> List[str]:
        """
        Разобрать аргументы CREATE с особым сохранением --base-dn и FROM.

        CREATE USER <name> <password> [опции]     → ["USER", name, password, ...опции]
        CREATE USERS FROM <file>                   → ["USERS", "FROM", file]
        CREATE GROUP <name> [опции]                → ["GROUP", name, ...опции]
        CREATE COMPUTER <name> [опции]             → ["COMPUTER", name, ...опции]
        CREATE OU <name> [--base-dn=DN] [опции]   → ["OU", name, ...опции]
        """
        parts = self._split_tool_args(create_rest)
        if not parts:
            return []

        obj_type = parts[0].upper()

        # CREATE USERS FROM <file> - особый случай
        if obj_type == "USERS" and len(parts) >= 2:
            if parts[1].upper() == "FROM":
                filepath = " ".join(parts[2:]) if len(parts) > 2 else ""
                return ["USERS", "FROM", filepath]

        # CREATE USER ... FROM <file> - альтернативный синтаксис
        if obj_type == "USER" and len(parts) >= 3:
            if parts[1].upper() == "USERS" and parts[2].upper() == "FROM":
                filepath = " ".join(parts[3:]) if len(parts) > 3 else ""
                return ["USERS", "FROM", filepath]

        return parts

    def _parse_select(self, cmd_str: str, line_num: int) -> ScriptCommand:
        """
        Разобрать команду SELECT.

        Форматы:
          SELECT dn, cn FROM * WHERE objectClass=user
          SELECT * FROM "CN=Admin,DC=kcrb,DC=local"
          SELECT sAMAccountName, cn FROM USERS           (SQL-like)
          SELECT * FROM GROUPS WHERE cn=*Admin*          (SQL-like + фильтр)

        Args:
            cmd_str: Полная строка SELECT
            line_num: Номер строки

        Returns:
            ScriptCommand с разобранными полями
        """
        rest = cmd_str[7:].strip()  # Убираем "SELECT "

        from_idx = rest.upper().find(" FROM ")
        if from_idx == -1:
            return ScriptCommand(
                cmd_type=CommandType.SELECT,
                args=[rest],
                raw=cmd_str,
                line_num=line_num,
            )

        fields_str = rest[:from_idx].strip()
        after_from = rest[from_idx + 6:].strip()

        # Разбираем FROM <scope> [WHERE <filter>]
        where_idx = after_from.upper().find(" WHERE ")
        if where_idx == -1:
            scope = after_from.strip().strip('"').strip("'")
            filter_str = ""
        else:
            scope = after_from[:where_idx].strip().strip('"').strip("'")
            filter_str = after_from[where_idx + 7:].strip()

        # Разбираем список полей
        if fields_str == "*":
            fields = ["*"]
        else:
            fields = [f.strip() for f in fields_str.split(",")]

        return ScriptCommand(
            cmd_type=CommandType.SELECT,
            args=fields,
            kwargs={"scope": scope, "filter": filter_str},
            raw=cmd_str,
            line_num=line_num,
        )

    def _split_tool_args(self, args_str: str) -> List[str]:
        """
        Разбить аргументы TOOL на список, учитывая кавычки.

        Кавычки снимаются, но содержимое сохраняется как один аргумент.

        Args:
            args_str: Строка аргументов

        Returns:
            Список аргументов
        """
        result = []
        current = ""
        in_quotes = False

        for ch in args_str:
            if ch == '"':
                in_quotes = not in_quotes
                continue
            if ch == " " and not in_quotes:
                if current:
                    result.append(current)
                    current = ""
                continue
            current += ch

        if current:
            result.append(current)

        return result
