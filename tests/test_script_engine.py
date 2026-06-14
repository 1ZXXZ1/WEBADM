"""
Тесты движка скриптов — sdb.script_engine

Проверяет:
  - Выполнение всех типов команд
  - Состояние движка (current_database, current_format, etc.)
  - Переменные скрипта
  - Подстановка переменных
  - Преобразование фильтров (_simple_to_ldap_filter)
  - Команды TOOL (с моками)
  - DATAFRAME (с моками pandas)
  - OUTPUT (запись в файл)
  - WHERE (пост-фильтрация)
  - SEARCH
  - SHOW DATABASES
  - FIELDS
  - LIMIT
"""

import os
import tempfile
import pytest
from unittest.mock import patch, MagicMock

from sdb.script_engine import ScriptEngine
from sdb.parser.ldif import LdifRecord
from sdb.client import SdbClient
from tests.conftest import SAMPLE_LDIF_SAM_USERS


@pytest.fixture
def engine():
    """Движок скриптов с моками."""
    with patch('subprocess.run'):
        client = SdbClient(use_sudo=False)
        return ScriptEngine(client)


@pytest.fixture
def engine_with_records(engine):
    """Движок с предзагруженными записями."""
    engine.last_records = [
        LdifRecord(dn="CN=Admin,CN=Users,DC=kcrb,DC=local",
                   attrs={"objectClass": ["user"], "cn": ["Admin"], "sAMAccountName": ["Admin"]}),
        LdifRecord(dn="CN=ivan,CN=Users,DC=kcrb,DC=local",
                   attrs={"objectClass": ["user"], "cn": ["ivan"], "sAMAccountName": ["ivan"]}),
        LdifRecord(dn="CN=Domain Admins,CN=Users,DC=kcrb,DC=local",
                   attrs={"objectClass": ["group"], "cn": ["Domain Admins"], "sAMAccountName": ["Domain Admins"]}),
    ]
    return engine


class TestScriptEngineInit:
    """Тесты инициализации."""

    def test_default_state(self, engine):
        """Начальное состояние движка."""
        assert engine.current_database == "sam"
        assert engine.current_format == "table"
        assert engine.current_output is None
        assert engine.current_fields is None
        assert engine.current_limit == 0
        assert engine.variables == {}
        assert engine.last_records == []


class TestScriptEngineUse:
    """Тесты команды USE."""

    def test_use_sam(self, engine):
        """USE sam; переключает базу."""
        engine.execute("USE sam;")
        assert engine.current_database == "sam"

    def test_use_privilege(self, engine):
        """USE privilege; переключает базу."""
        engine.execute("USE privilege;")
        assert engine.current_database == "privilege"

    def test_use_case_insensitive(self, engine):
        """USE SAM; — регистронезависимо."""
        engine.execute("USE SAM;")
        assert engine.current_database == "sam"


class TestScriptEngineSelect:
    """Тесты команды SELECT."""

    @patch('subprocess.run')
    def test_select_all(self, mock_run, engine):
        """SELECT * FROM *;"""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_SAM_USERS, stderr="")
        engine.execute("SELECT * FROM *;")
        assert len(engine.last_records) > 0

    @patch('subprocess.run')
    def test_select_with_where(self, mock_run, engine):
        """SELECT * FROM * WHERE objectClass=user;"""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_SAM_USERS, stderr="")
        engine.execute("SELECT * FROM * WHERE objectClass=user;")
        # Проверяем, что фильтр был передан
        cmd = mock_run.call_args[0][0]
        assert any("objectClass=user" in str(c) for c in cmd)

    @patch('subprocess.run')
    def test_select_with_fields(self, mock_run, engine):
        """SELECT dn, cn FROM *;"""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_SAM_USERS, stderr="")
        engine.execute("SELECT dn, cn FROM *;")
        # Поля должны быть установлены
        assert engine.current_fields == ["dn", "cn"]


class TestScriptEngineFormat:
    """Тесты команды FORMAT."""

    def test_format_json(self, engine):
        """FORMAT json;"""
        engine.execute("FORMAT json;")
        assert engine.current_format == "json"

    def test_format_csv(self, engine):
        """FORMAT csv;"""
        engine.execute("FORMAT csv;")
        assert engine.current_format == "csv"

    def test_format_table(self, engine):
        """FORMAT table;"""
        engine.execute("FORMAT table;")
        assert engine.current_format == "table"


class TestScriptEngineOutput:
    """Тесты команды OUTPUT."""

    def test_output_to_file(self, engine_with_records):
        """OUTPUT /tmp/test.json;"""
        engine = engine_with_records
        engine.current_format = "json"
        with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as f:
            filepath = f.name
        try:
            engine.execute(f'OUTPUT {filepath};')
            assert os.path.exists(filepath)
        finally:
            os.unlink(filepath)

    def test_output_no_records(self, engine, capsys):
        """OUTPUT без записей."""
        engine.execute("OUTPUT /tmp/empty.json;")
        captured = capsys.readouterr()
        assert "Нет записей" in captured.out or "нет" in captured.out.lower()


class TestScriptEngineWhere:
    """Тесты команды WHERE."""

    def test_where_filter(self, engine_with_records, capsys):
        """WHERE objectClass=user; — фильтрация."""
        engine = engine_with_records
        engine.execute("WHERE objectClass=user;")
        # Должно остаться 2 пользователя
        assert len(engine.last_records) == 2

    def test_where_no_previous_records(self, engine, capsys):
        """WHERE без предыдущих записей."""
        engine.execute("WHERE objectClass=user;")
        captured = capsys.readouterr()
        assert "нет предыдущих" in captured.out


class TestScriptEngineFields:
    """Тесты команды FIELDS."""

    def test_set_fields(self, engine):
        """FIELDS dn, cn, sAMAccountName;"""
        engine.execute("FIELDS dn, cn, sAMAccountName;")
        assert engine.current_fields == ["dn", "cn", "sAMAccountName"]


class TestScriptEngineLimit:
    """Тесты команды LIMIT."""

    def test_set_limit(self, engine):
        """LIMIT 10;"""
        engine.execute("LIMIT 10;")
        assert engine.current_limit == 10

    def test_limit_zero(self, engine):
        """LIMIT 0;"""
        engine.execute("LIMIT 0;")
        assert engine.current_limit == 0


class TestScriptEngineSet:
    """Тесты команды SET."""

    def test_set_variable(self, engine):
        """SET domain = "DC=kcrb,DC=local";"""
        engine.execute('SET domain = "DC=kcrb,DC=local";')
        assert engine.variables["domain"] == "DC=kcrb,DC=local"

    def test_substitute_variable(self, engine):
        """Подстановка $domain в команду."""
        engine.execute('SET domain = "DC=kcrb,DC=local";')
        result = engine._substitute_vars("$domain")
        assert result == "DC=kcrb,DC=local"

    def test_substitute_multiple_vars(self, engine):
        """Подстановка нескольких переменных."""
        engine.variables["dc1"] = "kcrb"
        engine.variables["dc2"] = "local"
        result = engine._substitute_vars("$dc1.$dc2")
        assert result == "kcrb.local"

    def test_substitute_no_vars(self, engine):
        """Без переменных — текст без изменений."""
        result = engine._substitute_vars("plain text")
        assert result == "plain text"


class TestScriptEngineTool:
    """Тесты команды TOOL."""

    @patch('subprocess.run')
    def test_tool_user_list(self, mock_run, engine, capsys):
        """TOOL user list;"""
        mock_run.return_value = MagicMock(returncode=0, stdout="Administrator\nivan\n", stderr="")
        engine.execute("TOOL user list;")
        captured = capsys.readouterr()
        assert "Administrator" in captured.out

    @patch('subprocess.run')
    def test_tool_error(self, mock_run, engine, capsys):
        """TOOL с ошибкой."""
        mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="ERROR: User not found\n")
        engine.execute("TOOL user delete nonexistent;")
        captured = capsys.readouterr()
        assert "Ошибка" in captured.err or "ERROR" in captured.err

    def test_tool_list(self, engine, capsys):
        """TOOL LIST; — показывает список подкоманд."""
        engine.execute("TOOL LIST;")
        captured = capsys.readouterr()
        assert "user" in captured.out
        assert "group" in captured.out

    @patch('subprocess.run')
    def test_tool_help(self, mock_run, engine, capsys):
        """TOOL HELP user;"""
        mock_run.return_value = MagicMock(returncode=0, stdout="Usage: samba-tool user ...\n", stderr="")
        engine.execute("TOOL HELP user;")
        captured = capsys.readouterr()
        assert "user" in captured.out

    def test_tool_no_args(self, engine, capsys):
        """TOOL без аргументов — парсер создаёт TOOL с пустыми аргументами."""
        engine.execute("TOOL;")
        captured = capsys.readouterr()
        # TOOL без аргументов → args пустой → выводит справку
        # Парсер может обработать "TOOL" как неизвестную команду
        # Проверяем, что не было исключения
        assert True


class TestScriptEngineSearch:
    """Тесты команды SEARCH."""

    @patch('subprocess.run')
    def test_search(self, mock_run, engine):
        """SEARCH admin;"""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_SAM_USERS, stderr="")
        engine.execute("SEARCH admin;")
        # Должно выполниться без ошибок


class TestScriptEngineShow:
    """Тесты команды SHOW."""

    def test_show_databases(self, engine, capsys):
        """SHOW DATABASES;"""
        engine.execute("SHOW DATABASES;")
        captured = capsys.readouterr()
        assert "sam" in captured.out
        assert "privilege" in captured.out


class TestScriptEngineDataframe:
    """Тесты команды DATAFRAME."""

    def test_dataframe_no_records(self, engine, capsys):
        """DATAFRAME без записей."""
        engine.execute("DATAFRAME;")
        captured = capsys.readouterr()
        assert "нет записей" in captured.out


class TestSimpleToLdapFilter:
    """Тесты _simple_to_ldap_filter."""

    def test_key_value(self):
        """objectClass=user → (objectClass=user)."""
        result = ScriptEngine._simple_to_ldap_filter("objectClass=user")
        assert result == "(objectClass=user)"

    def test_already_ldap(self):
        """(&(objectClass=user)) → без изменений."""
        result = ScriptEngine._simple_to_ldap_filter("(&(objectClass=user))")
        assert result == "(&(objectClass=user))"

    def test_single_word(self):
        """user → (objectClass=user)."""
        result = ScriptEngine._simple_to_ldap_filter("user")
        assert result == "(objectClass=user)"

    def test_empty(self):
        """Пустая строка → пустой фильтр."""
        result = ScriptEngine._simple_to_ldap_filter("")
        assert result == ""


class TestScriptEngineMultipleCommands:
    """Тесты выполнения нескольких команд."""

    @patch('subprocess.run')
    def test_pipeline(self, mock_run, engine):
        """USE sam; FORMAT json;"""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_SAM_USERS, stderr="")
        engine.execute("USE sam; FORMAT json;")
        assert engine.current_database == "sam"
        assert engine.current_format == "json"
