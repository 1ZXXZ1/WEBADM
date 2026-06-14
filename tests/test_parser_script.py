"""
Тесты парсера скриптового языка SDB — sdb.parser.script

Проверяет:
  - Разбор всех типов команд (USE, SELECT, WHERE, FORMAT, OUTPUT, TOOL, SHOW, SET, FIELDS, LIMIT, SEARCH, DATAFRAME)
  - Многострочные команды
  - Несколько команд на одной строке через ;
  - Комментарии
  - Строки в кавычках
  - Переменные ($name)
  - TOOL аргументы с кавычками
  - Граничные случаи (пустой ввод, неизвестные команды)
"""

import pytest

from sdb.parser.script import ScriptParser, ScriptCommand, CommandType


class TestScriptParserUse:
    """Тесты команды USE."""

    def test_use_sam(self):
        """USE sam; — переключение на базу sam."""
        parser = ScriptParser()
        cmds = parser.parse("USE sam;")
        assert len(cmds) == 1
        assert cmds[0].cmd_type == CommandType.USE
        assert cmds[0].args == ["sam"]

    def test_use_privilege(self):
        """USE privilege; — переключение на базу privilege."""
        parser = ScriptParser()
        cmds = parser.parse("USE privilege;")
        assert cmds[0].args == ["privilege"]

    def test_use_case_insensitive(self):
        """USE SAM; — регистр не важен для имени БД (сохраняется оригинал)."""
        parser = ScriptParser()
        cmds = parser.parse("USE SAM;")
        assert cmds[0].args == ["SAM"]

    def test_use_with_quotes(self):
        """USE "sam"; — с кавычками."""
        parser = ScriptParser()
        cmds = parser.parse('USE "sam";')
        assert cmds[0].args == ["sam"]

    def test_use_custom_path(self):
        """USE /path/to/custom.ldb; — пользовательский путь."""
        parser = ScriptParser()
        cmds = parser.parse("USE /var/lib/samba/private/custom.ldb;")
        assert cmds[0].args == ["/var/lib/samba/private/custom.ldb"]


class TestScriptParserSelect:
    """Тесты команды SELECT."""

    def test_select_all(self):
        """SELECT * FROM *; — выбрать все записи."""
        parser = ScriptParser()
        cmds = parser.parse("SELECT * FROM *;")
        assert cmds[0].cmd_type == CommandType.SELECT
        assert cmds[0].args == ["*"]
        assert cmds[0].kwargs["scope"] == "*"
        assert cmds[0].kwargs["filter"] == ""

    def test_select_with_fields(self):
        """SELECT dn, cn FROM *; — с указанием полей."""
        parser = ScriptParser()
        cmds = parser.parse("SELECT dn, cn FROM *;")
        assert cmds[0].args == ["dn", "cn"]

    def test_select_with_where(self):
        """SELECT * FROM * WHERE objectClass=user; — с фильтром."""
        parser = ScriptParser()
        cmds = parser.parse("SELECT * FROM * WHERE objectClass=user;")
        assert cmds[0].kwargs["filter"] == "objectClass=user"

    def test_select_fields_and_where(self):
        """SELECT dn, cn, sAMAccountName FROM * WHERE objectClass=user;"""
        parser = ScriptParser()
        cmds = parser.parse("SELECT dn, cn, sAMAccountName FROM * WHERE objectClass=user;")
        assert cmds[0].args == ["dn", "cn", "sAMAccountName"]
        assert cmds[0].kwargs["filter"] == "objectClass=user"

    def test_select_by_dn(self):
        """SELECT * FROM "CN=Admin,CN=Users,DC=kcrb,DC=local"; — по DN."""
        parser = ScriptParser()
        cmds = parser.parse('SELECT * FROM "CN=Admin,CN=Users,DC=kcrb,DC=local";')
        assert cmds[0].kwargs["scope"] == "CN=Admin,CN=Users,DC=kcrb,DC=local"

    def test_select_multiline(self):
        """Многострочный SELECT."""
        script = """SELECT dn, cn, sAMAccountName
FROM *
WHERE objectClass=user;"""
        parser = ScriptParser()
        cmds = parser.parse(script)
        assert len(cmds) == 1
        assert cmds[0].cmd_type == CommandType.SELECT
        assert cmds[0].args == ["dn", "cn", "sAMAccountName"]
        assert cmds[0].kwargs["filter"] == "objectClass=user"

    def test_select_without_from(self):
        """SELECT без FROM — поля без scope."""
        parser = ScriptParser()
        cmds = parser.parse("SELECT dn, cn;")
        assert cmds[0].cmd_type == CommandType.SELECT
        assert cmds[0].args == ["dn, cn"]


class TestScriptParserWhere:
    """Тесты команды WHERE."""

    def test_where_simple(self):
        """WHERE objectClass=user;"""
        parser = ScriptParser()
        cmds = parser.parse("WHERE objectClass=user;")
        assert cmds[0].cmd_type == CommandType.WHERE
        assert cmds[0].args == ["objectClass=user"]

    def test_where_complex(self):
        """WHERE sAMAccountName=admin;"""
        parser = ScriptParser()
        cmds = parser.parse("WHERE sAMAccountName=admin;")
        assert cmds[0].args == ["sAMAccountName=admin"]


class TestScriptParserFormat:
    """Тесты команды FORMAT."""

    def test_format_json(self):
        """FORMAT json;"""
        parser = ScriptParser()
        cmds = parser.parse("FORMAT json;")
        assert cmds[0].cmd_type == CommandType.FORMAT
        assert cmds[0].args == ["json"]

    def test_format_csv(self):
        """FORMAT csv;"""
        parser = ScriptParser()
        cmds = parser.parse("FORMAT csv;")
        assert cmds[0].args == ["csv"]

    def test_format_table(self):
        """FORMAT table;"""
        parser = ScriptParser()
        cmds = parser.parse("FORMAT table;")
        assert cmds[0].args == ["table"]

    def test_format_ldif(self):
        """FORMAT ldif;"""
        parser = ScriptParser()
        cmds = parser.parse("FORMAT ldif;")
        assert cmds[0].args == ["ldif"]

    def test_format_dataframe(self):
        """FORMAT dataframe;"""
        parser = ScriptParser()
        cmds = parser.parse("FORMAT dataframe;")
        assert cmds[0].args == ["dataframe"]

    def test_format_uppercase(self):
        """FORMAT JSON; — регистр приводится к нижнему."""
        parser = ScriptParser()
        cmds = parser.parse("FORMAT JSON;")
        assert cmds[0].args == ["json"]


class TestScriptParserOutput:
    """Тесты команды OUTPUT."""

    def test_output_path(self):
        """OUTPUT /tmp/result.json;"""
        parser = ScriptParser()
        cmds = parser.parse("OUTPUT /tmp/result.json;")
        assert cmds[0].cmd_type == CommandType.OUTPUT
        assert cmds[0].args == ["/tmp/result.json"]

    def test_output_with_quotes(self):
        """OUTPUT "/tmp/result.json";"""
        parser = ScriptParser()
        cmds = parser.parse('OUTPUT "/tmp/result.json";')
        assert cmds[0].args == ["/tmp/result.json"]


class TestScriptParserTool:
    """Тесты команды TOOL."""

    def test_tool_user_list(self):
        """TOOL user list;"""
        parser = ScriptParser()
        cmds = parser.parse("TOOL user list;")
        assert cmds[0].cmd_type == CommandType.TOOL
        assert cmds[0].args == ["user", "list"]

    def test_tool_user_create(self):
        """TOOL user create admin P@ssw0rd;"""
        parser = ScriptParser()
        cmds = parser.parse("TOOL user create admin P@ssw0rd;")
        assert cmds[0].args == ["user", "create", "admin", "P@ssw0rd"]

    def test_tool_user_create_with_options(self):
        """TOOL user create admin P@ssw0rd --given-name=Иван;"""
        parser = ScriptParser()
        cmds = parser.parse("TOOL user create admin P@ssw0rd --given-name=Иван;")
        assert cmds[0].args == ["user", "create", "admin", "P@ssw0rd", "--given-name=Иван"]

    def test_tool_group_listmembers_quoted(self):
        """TOOL group listmembers "Domain Admins";"""
        parser = ScriptParser()
        cmds = parser.parse('TOOL group listmembers "Domain Admins";')
        assert cmds[0].args == ["group", "listmembers", "Domain Admins"]

    def test_tool_dns_query(self):
        """TOOL dns query kcrb.local @ ALL;"""
        parser = ScriptParser()
        cmds = parser.parse("TOOL dns query kcrb.local @ ALL;")
        assert cmds[0].args == ["dns", "query", "kcrb.local", "@", "ALL"]

    def test_tool_fsmo_show(self):
        """TOOL fsmo show;"""
        parser = ScriptParser()
        cmds = parser.parse("TOOL fsmo show;")
        assert cmds[0].args == ["fsmo", "show"]

    def test_tool_dbcheck(self):
        """TOOL dbcheck;"""
        parser = ScriptParser()
        cmds = parser.parse("TOOL dbcheck;")
        assert cmds[0].args == ["dbcheck"]

    def test_tool_list(self):
        """TOOL LIST;"""
        parser = ScriptParser()
        cmds = parser.parse("TOOL LIST;")
        assert cmds[0].args == ["LIST"]

    def test_tool_help(self):
        """TOOL HELP user;"""
        parser = ScriptParser()
        cmds = parser.parse("TOOL HELP user;")
        assert cmds[0].args == ["HELP", "user"]

    def test_tool_samba_tool_args_with_equals(self):
        """TOOL user setpassword admin --newpassword=NewP@ss;"""
        parser = ScriptParser()
        cmds = parser.parse("TOOL user setpassword admin --newpassword=NewP@ss;")
        assert "--newpassword=NewP@ss" in cmds[0].args


class TestScriptParserShow:
    """Тесты команды SHOW."""

    def test_show_databases(self):
        """SHOW DATABASES;"""
        parser = ScriptParser()
        cmds = parser.parse("SHOW DATABASES;")
        assert cmds[0].cmd_type == CommandType.SHOW
        assert cmds[0].args == ["DATABASES"]


class TestScriptParserSet:
    """Тесты команды SET."""

    def test_set_variable(self):
        """SET domain = "DC=kcrb,DC=local";"""
        parser = ScriptParser()
        cmds = parser.parse('SET domain = "DC=kcrb,DC=local";')
        assert cmds[0].cmd_type == CommandType.SET
        assert cmds[0].args[0] == "domain"
        assert cmds[0].args[1] == "DC=kcrb,DC=local"

    def test_set_without_quotes(self):
        """SET name = value;"""
        parser = ScriptParser()
        cmds = parser.parse("SET name = value;")
        assert cmds[0].args == ["name", "value"]


class TestScriptParserFields:
    """Тесты команды FIELDS."""

    def test_fields_list(self):
        """FIELDS dn, cn, sAMAccountName;"""
        parser = ScriptParser()
        cmds = parser.parse("FIELDS dn, cn, sAMAccountName;")
        assert cmds[0].cmd_type == CommandType.FIELDS
        assert cmds[0].args == ["dn", "cn", "sAMAccountName"]


class TestScriptParserLimit:
    """Тесты команды LIMIT."""

    def test_limit_number(self):
        """LIMIT 10;"""
        parser = ScriptParser()
        cmds = parser.parse("LIMIT 10;")
        assert cmds[0].cmd_type == CommandType.LIMIT
        assert cmds[0].args == ["10"]

    def test_limit_zero(self):
        """LIMIT 0;"""
        parser = ScriptParser()
        cmds = parser.parse("LIMIT 0;")
        assert cmds[0].args == ["0"]

    def test_limit_invalid(self):
        """LIMIT abc; — невалидное число → 0."""
        parser = ScriptParser()
        cmds = parser.parse("LIMIT abc;")
        assert cmds[0].args == ["0"]


class TestScriptParserSearch:
    """Тесты команды SEARCH."""

    def test_search_term(self):
        """SEARCH administrator;"""
        parser = ScriptParser()
        cmds = parser.parse("SEARCH administrator;")
        assert cmds[0].cmd_type == CommandType.SEARCH
        assert cmds[0].args == ["administrator"]

    def test_search_quoted(self):
        """SEARCH "administrator";"""
        parser = ScriptParser()
        cmds = parser.parse('SEARCH "administrator";')
        assert cmds[0].args == ["administrator"]


class TestScriptParserDataframe:
    """Тесты команды DATAFRAME."""

    def test_dataframe(self):
        """DATAFRAME;"""
        parser = ScriptParser()
        cmds = parser.parse("DATAFRAME;")
        assert cmds[0].cmd_type == CommandType.DATAFRAME
        assert cmds[0].args == []


class TestScriptParserComments:
    """Тесты комментариев."""

    def test_comment_line(self):
        """# Комментарий — пропускается."""
        parser = ScriptParser()
        cmds = parser.parse("# This is a comment")
        assert len(cmds) == 1
        assert cmds[0].cmd_type == CommandType.COMMENT

    def test_comment_with_command(self):
        """Комментарий + команда."""
        parser = ScriptParser()
        cmds = parser.parse("# Comment\nUSE sam;")
        assert len(cmds) == 2
        assert cmds[0].cmd_type == CommandType.COMMENT
        assert cmds[1].cmd_type == CommandType.USE


class TestScriptParserMultipleCommands:
    """Тесты нескольких команд на одной строке."""

    def test_two_commands_semicolon(self):
        """USE sam; FORMAT json;"""
        parser = ScriptParser()
        cmds = parser.parse("USE sam; FORMAT json;")
        assert len(cmds) == 2
        assert cmds[0].cmd_type == CommandType.USE
        assert cmds[1].cmd_type == CommandType.FORMAT

    def test_three_commands(self):
        """USE sam; FORMAT json; SELECT * FROM *;"""
        parser = ScriptParser()
        cmds = parser.parse("USE sam; FORMAT json; SELECT * FROM *;")
        assert len(cmds) == 3

    def test_full_pipeline(self):
        """Полный конвейер: USE → FORMAT → SELECT → OUTPUT."""
        script = 'USE sam; FORMAT json; SELECT dn, cn FROM * WHERE objectClass=user; OUTPUT /tmp/users.json;'
        parser = ScriptParser()
        cmds = parser.parse(script)
        assert len(cmds) == 4
        assert cmds[0].cmd_type == CommandType.USE
        assert cmds[1].cmd_type == CommandType.FORMAT
        assert cmds[2].cmd_type == CommandType.SELECT
        assert cmds[3].cmd_type == CommandType.OUTPUT


class TestScriptParserEdgeCases:
    """Граничные случаи парсера скриптов."""

    def test_empty_script(self):
        """Пустой скрипт → нет команд."""
        parser = ScriptParser()
        cmds = parser.parse("")
        assert cmds == []

    def test_whitespace_only(self):
        """Только пробелы → нет команд."""
        parser = ScriptParser()
        cmds = parser.parse("   \n   \n")
        assert cmds == []

    def test_unknown_command(self):
        """Неизвестная команда → COMMENT с пометкой UNKNOWN."""
        parser = ScriptParser()
        cmds = parser.parse("FOOBAR xyz;")
        assert len(cmds) == 1
        assert cmds[0].cmd_type == CommandType.COMMENT
        assert "UNKNOWN" in cmds[0].args[0]

    def test_incomplete_command_no_semicolon(self):
        """Команда без ; — всё равно разбирается (буфер в конце)."""
        parser = ScriptParser()
        cmds = parser.parse("USE sam")
        assert len(cmds) == 1
        assert cmds[0].cmd_type == CommandType.USE

    def test_semicolon_in_quotes(self):
        """Точка с запятой внутри кавычек — не разделитель."""
        parser = ScriptParser()
        cmds = parser.parse('SET desc = "value;with;semicolons";')
        assert len(cmds) == 1
        assert cmds[0].cmd_type == CommandType.SET
        assert "value;with;semicolons" in cmds[0].args[1]

    def test_tool_with_quoted_group_name(self):
        """TOOL group addmembers "Domain Admins" user1;"""
        parser = ScriptParser()
        cmds = parser.parse('TOOL group addmembers "Domain Admins" user1;')
        assert cmds[0].args == ["group", "addmembers", "Domain Admins", "user1"]


class TestSplitToolArgs:
    """Тесты метода _split_tool_args."""

    def test_simple_args(self):
        """Простые аргументы."""
        parser = ScriptParser()
        result = parser._split_tool_args("user list")
        assert result == ["user", "list"]

    def test_quoted_args(self):
        """Аргументы с кавычками."""
        parser = ScriptParser()
        result = parser._split_tool_args('group listmembers "Domain Admins"')
        assert result == ["group", "listmembers", "Domain Admins"]

    def test_empty_string(self):
        """Пустая строка → пустой список."""
        parser = ScriptParser()
        result = parser._split_tool_args("")
        assert result == []

    def test_multiple_spaces(self):
        """Несколько пробелов между аргументами."""
        parser = ScriptParser()
        result = parser._split_tool_args("user   list")
        assert result == ["user", "list"]


class TestScriptParserImport:
    """Тесты команды IMPORT."""

    def test_import_csv(self):
        """IMPORT /tmp/users.csv;"""
        parser = ScriptParser()
        cmds = parser.parse("IMPORT /tmp/users.csv;")
        assert cmds[0].cmd_type == CommandType.IMPORT
        assert cmds[0].args == ["/tmp/users.csv"]
        assert cmds[0].kwargs.get("type", "") == ""

    def test_import_csv_with_type(self):
        """IMPORT /tmp/users.csv TYPE user;"""
        parser = ScriptParser()
        cmds = parser.parse("IMPORT /tmp/users.csv TYPE user;")
        assert cmds[0].cmd_type == CommandType.IMPORT
        assert cmds[0].args == ["/tmp/users.csv"]
        assert cmds[0].kwargs.get("type") == "user"

    def test_import_json_with_type(self):
        """IMPORT /tmp/groups.json TYPE group;"""
        parser = ScriptParser()
        cmds = parser.parse("IMPORT /tmp/groups.json TYPE group;")
        assert cmds[0].cmd_type == CommandType.IMPORT
        assert cmds[0].kwargs.get("type") == "group"

    def test_import_quoted_path(self):
        """IMPORT "/tmp/my users.csv" TYPE user;"""
        parser = ScriptParser()
        cmds = parser.parse('IMPORT "/tmp/my users.csv" TYPE user;')
        assert cmds[0].args == ["/tmp/my users.csv"]


class TestScriptParserCreate:
    """Тесты команды CREATE."""

    def test_create_user(self):
        """CREATE USER admin P@ssw0rd;"""
        parser = ScriptParser()
        cmds = parser.parse("CREATE USER admin P@ssw0rd;")
        assert cmds[0].cmd_type == CommandType.CREATE
        assert cmds[0].args == ["USER", "admin", "P@ssw0rd"]

    def test_create_user_with_options(self):
        """CREATE USER admin P@ssw0rd --given-name=Иван;"""
        parser = ScriptParser()
        cmds = parser.parse("CREATE USER admin P@ssw0rd --given-name=Иван;")
        assert cmds[0].cmd_type == CommandType.CREATE
        assert "USER" in cmds[0].args
        assert "--given-name=Иван" in cmds[0].args

    def test_create_group(self):
        """CREATE GROUP "Domain Admins";"""
        parser = ScriptParser()
        cmds = parser.parse('CREATE GROUP "Domain Admins";')
        assert cmds[0].cmd_type == CommandType.CREATE
        assert "GROUP" in cmds[0].args

    def test_create_computer(self):
        """CREATE COMPUTER PC01;"""
        parser = ScriptParser()
        cmds = parser.parse("CREATE COMPUTER PC01;")
        assert cmds[0].cmd_type == CommandType.CREATE
        assert "COMPUTER" in cmds[0].args

    def test_create_ou(self):
        """CREATE OU Staff --base-dn="DC=kcrb,DC=local";"""
        parser = ScriptParser()
        cmds = parser.parse('CREATE OU Staff --base-dn="DC=kcrb,DC=local";')
        assert cmds[0].cmd_type == CommandType.CREATE
        assert "OU" in cmds[0].args


class TestSplitSemicolons:
    """Тесты метода _split_semicolons."""

    def test_single_statement(self):
        """Одно выражение."""
        parser = ScriptParser()
        result = parser._split_semicolons("USE sam;")
        assert len(result) == 1

    def test_two_statements(self):
        """Два выражения."""
        parser = ScriptParser()
        result = parser._split_semicolons("USE sam; FORMAT json;")
        assert len(result) == 2

    def test_semicolon_in_quotes(self):
        """; внутри кавычек не разделяет."""
        parser = ScriptParser()
        result = parser._split_semicolons('SET x = "a;b"; USE sam;')
        assert len(result) == 2
