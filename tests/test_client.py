"""
Тесты главного клиента SDB — sdb.client

Проверяет (с моками subprocess):
  - Инициализация SdbClient
  - Переключение баз данных (use_database)
  - Запросы (query)
  - Поиск (search)
  - Форматирование вывода (format_output)
  - Запись в файл (write_output)
  - Выполнение скриптов (run_script, run_script_file)
  - Показ баз данных (show_databases)
  - pandas DataFrame (to_dataframe)
  - Парсинг LDIF
"""

import os
import json
import tempfile
import pytest
from unittest.mock import patch, MagicMock

from sdb.client import SdbClient
from sdb.parser.ldif import LdifRecord
from tests.conftest import SAMPLE_LDIF_SAM_USERS, SAMPLE_LDIF_PRIVILEGE


class TestSdbClientInit:
    """Тесты инициализации клиента."""

    @patch('subprocess.run')
    def test_default_database(self, mock_run):
        """По умолчанию база — sam."""
        client = SdbClient(default_database="sam", use_sudo=False)
        assert client._current_database == "sam"

    @patch('subprocess.run')
    def test_default_format(self, mock_run):
        """Формат по умолчанию — table."""
        client = SdbClient(use_sudo=False)
        assert client._current_format == "table"

    @patch('subprocess.run')
    def test_sudo_flag(self, mock_run):
        """Флаг sudo передаётся."""
        client = SdbClient(use_sudo=True)
        assert client.use_sudo is True


class TestSdbClientUseDatabase:
    """Тесты переключения базы данных."""

    @patch('subprocess.run')
    def test_switch_to_privilege(self, mock_run):
        """Переключение на privilege."""
        client = SdbClient(use_sudo=False)
        path = client.use_database("privilege")
        assert "privilege.ldb" in path

    @patch('subprocess.run')
    def test_switch_to_idmap(self, mock_run):
        """Переключение на idmap."""
        client = SdbClient(use_sudo=False)
        path = client.use_database("idmap")
        assert "idmap.ldb" in path

    @patch('subprocess.run')
    def test_switch_updates_current(self, mock_run):
        """Текущая база обновляется."""
        client = SdbClient(use_sudo=False)
        client.use_database("privilege")
        assert client._current_database == "privilege"


class TestSdbClientQuery:
    """Тесты запросов."""

    @patch('subprocess.run')
    def test_query_default_db(self, mock_run):
        """Запрос к текущей базе."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_SAM_USERS, stderr="")
        client = SdbClient(use_sudo=False)
        records = client.query()
        assert len(records) > 0

    @patch('subprocess.run')
    def test_query_named_db(self, mock_run):
        """Запрос к указанной базе."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_PRIVILEGE, stderr="")
        client = SdbClient(use_sudo=False)
        records = client.query(database="privilege")
        assert len(records) > 0

    @patch('subprocess.run')
    def test_query_with_filter(self, mock_run):
        """Запрос с фильтром."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_SAM_USERS, stderr="")
        client = SdbClient(use_sudo=False)
        records = client.query(filter_expr="(objectClass=user)")
        assert isinstance(records, list)


class TestSdbClientSearch:
    """Тесты поиска."""

    @patch('subprocess.run')
    def test_search_default_db(self, mock_run):
        """Поиск в текущей базе."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_SAM_USERS, stderr="")
        client = SdbClient(use_sudo=False)
        records = client.search("Admin")
        assert isinstance(records, list)


class TestSdbClientFormatOutput:
    """Тесты форматирования."""

    def test_format_json(self):
        """Форматирование в JSON."""
        client = SdbClient(use_sudo=False)
        records = [LdifRecord(dn="CN=Test", attrs={"cn": ["Test"], "sAMAccountName": ["test"]})]
        output = client.format_output(records, fmt="json")
        assert '"cn"' in output or '"Test"' in output

    def test_format_csv(self):
        """Форматирование в CSV."""
        client = SdbClient(use_sudo=False)
        records = [LdifRecord(dn="CN=Test", attrs={"cn": ["Test"]})]
        output = client.format_output(records, fmt="csv")
        assert "cn" in output

    def test_format_table(self):
        """Форматирование в таблицу."""
        client = SdbClient(use_sudo=False)
        records = [LdifRecord(dn="CN=Test", attrs={"cn": ["Test"]})]
        output = client.format_output(records, fmt="table")
        assert "CN" in output or "Test" in output

    def test_format_empty_records(self):
        """Пустые записи — (нет записей)."""
        client = SdbClient(use_sudo=False)
        output = client.format_output([], fmt="table")
        assert "нет записей" in output


class TestSdbClientWriteOutput:
    """Тесты записи в файл."""

    def test_write_json(self):
        """Запись JSON в файл."""
        client = SdbClient(use_sudo=False)
        records = [LdifRecord(dn="CN=Test", attrs={"cn": ["Test"]})]
        with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as f:
            filepath = f.name
        try:
            result = client.write_output(records, filepath, fmt="json")
            assert os.path.exists(filepath)
            with open(filepath, 'r') as f:
                content = f.read()
            data = json.loads(content)
            assert len(data) == 1
        finally:
            os.unlink(filepath)

    def test_write_csv(self):
        """Запись CSV в файл."""
        client = SdbClient(use_sudo=False)
        records = [LdifRecord(dn="CN=Test", attrs={"cn": ["Test"], "sAMAccountName": ["test"]})]
        with tempfile.NamedTemporaryFile(suffix='.csv', delete=False) as f:
            filepath = f.name
        try:
            client.write_output(records, filepath, fmt="csv")
            assert os.path.exists(filepath)
            with open(filepath, 'r') as f:
                content = f.read()
            assert "cn" in content
        finally:
            os.unlink(filepath)


class TestSdbClientShowDatabases:
    """Тесты показа баз данных."""

    def test_show_databases(self):
        """show_databases() возвращает словарь."""
        client = SdbClient(use_sudo=False)
        dbs = client.show_databases()
        assert isinstance(dbs, dict)
        assert "sam" in dbs
        assert "privilege" in dbs


class TestSdbClientScriptExecution:
    """Тесты выполнения скриптов."""

    @patch('subprocess.run')
    def test_run_script(self, mock_run):
        """run_script() выполняет скрипт."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_SAM_USERS, stderr="")
        client = SdbClient(use_sudo=False)
        # Простой скрипт: USE sam; FORMAT json;
        result = client.run_script("USE sam; FORMAT json;")
        # Должен выполниться без ошибок

    @patch('subprocess.run')
    def test_run_script_file(self, mock_run):
        """run_script_file() выполняет скрипт из файла."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_SAM_USERS, stderr="")
        client = SdbClient(use_sudo=False)

        script_content = "USE sam;\nFORMAT json;\n"
        with tempfile.NamedTemporaryFile(mode='w', suffix='.sdb', delete=False, encoding='utf-8') as f:
            f.write(script_content)
            filepath = f.name

        try:
            client.run_script_file(filepath)
        finally:
            os.unlink(filepath)


class TestSdbClientLdifParsing:
    """Тесты парсинга LDIF."""

    def test_parse_ldif_string(self):
        """parse_ldif() разбирает строку."""
        client = SdbClient(use_sudo=False)
        records = client.parse_ldif(SAMPLE_LDIF_SAM_USERS)
        assert len(records) == 7

    def test_parse_ldif_file(self):
        """parse_ldif_file() разбирает файл."""
        client = SdbClient(use_sudo=False)
        with tempfile.NamedTemporaryFile(mode='w', suffix='.ldif', delete=False, encoding='utf-8') as f:
            f.write(SAMPLE_LDIF_PRIVILEGE)
            filepath = f.name
        try:
            records = client.parse_ldif_file(filepath)
            assert len(records) == 2
        finally:
            os.unlink(filepath)


class TestSdbClientProperties:
    """Тесты свойств клиента."""

    def test_shares_property(self):
        """Свойство shares создаёт ShareCommands."""
        client = SdbClient(use_sudo=False)
        shares = client.shares
        assert shares is not None

    def test_privileges_property(self):
        """Свойство privileges создаёт PrivilegeCommands."""
        client = SdbClient(use_sudo=False)
        privs = client.privileges
        assert privs is not None

    def test_registry_property(self):
        """Свойство registry создаёт RegistryCommands."""
        client = SdbClient(use_sudo=False)
        reg = client.registry
        assert reg is not None

    def test_idmap_property(self):
        """Свойство idmap создаёт IdmapCommands."""
        client = SdbClient(use_sudo=False)
        idm = client.idmap
        assert idm is not None
