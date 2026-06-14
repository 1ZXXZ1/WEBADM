"""
Тесты коннектора ldbsearch — sdb.connectors.ldb

Проверяет (с моками subprocess):
  - Создание коннектора с базой по умолчанию
  - Переключение базы (use_database)
  - Запросы (query) — формирование команды
  - Поиск по подстроке (search_term)
  - Запрос по DN (query_by_dn)
  - Список всех записей (list_all)
  - Обработка ошибок (нет прав, файл не найден)
  - Экранирование LDAP фильтров
  - Построение команды (_build_command)
"""

import pytest
from unittest.mock import patch, MagicMock

from sdb.connectors.ldb import LdbConnector
from sdb.parser.ldif import LdifRecord
from tests.conftest import SAMPLE_LDIF_SAM_USERS, SAMPLE_LDIF_PRIVILEGE, SAMPLE_LDIF_EMPTY


class TestLdbConnectorInit:
    """Тесты инициализации коннектора."""

    def test_default_database(self):
        """По умолчанию — база sam."""
        conn = LdbConnector("sam", use_sudo=False)
        assert "sam.ldb" in conn.ldb_path

    def test_privilege_database(self):
        """База privilege."""
        conn = LdbConnector("privilege", use_sudo=False)
        assert "privilege.ldb" in conn.ldb_path

    def test_sudo_flag(self):
        """Флаг sudo сохраняется."""
        conn = LdbConnector("sam", use_sudo=True)
        assert conn.use_sudo is True
        conn2 = LdbConnector("sam", use_sudo=False)
        assert conn2.use_sudo is False

    def test_url_equals_path(self):
        """URL равен пути."""
        conn = LdbConnector("sam", use_sudo=False)
        assert conn.url == conn.ldb_path


class TestLdbConnectorUseDatabase:
    """Тесты переключения базы данных."""

    def test_switch_to_privilege(self):
        """Переключение на privilege."""
        conn = LdbConnector("sam", use_sudo=False)
        path = conn.use_database("privilege")
        assert "privilege.ldb" in path
        assert "privilege.ldb" in conn.ldb_path

    def test_switch_to_idmap(self):
        """Переключение на idmap."""
        conn = LdbConnector("sam", use_sudo=False)
        path = conn.use_database("idmap")
        assert "idmap.ldb" in path

    def test_switch_updates_url(self):
        """URL обновляется при переключении."""
        conn = LdbConnector("sam", use_sudo=False)
        conn.use_database("privilege")
        assert conn.url == conn.ldb_path


class TestLdbConnectorQuery:
    """Тесты запросов к LDB."""

    @patch('subprocess.run')
    def test_query_returns_records(self, mock_run):
        """Запрос возвращает список LdifRecord."""
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout=SAMPLE_LDIF_SAM_USERS,
            stderr="",
        )
        conn = LdbConnector("sam", use_sudo=False)
        records = conn.query(filter_expr="(objectClass=user)")
        assert isinstance(records, list)
        assert len(records) > 0
        assert isinstance(records[0], LdifRecord)

    @patch('subprocess.run')
    def test_query_empty_result(self, mock_run):
        """Пустой результат — пустой список."""
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout="",
            stderr="",
        )
        conn = LdbConnector("sam", use_sudo=False)
        records = conn.query(filter_expr="(objectClass=nonexistent)")
        assert records == []

    @patch('subprocess.run')
    def test_query_with_filter(self, mock_run):
        """Запрос с фильтром передаёт фильтр в команду."""
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout=SAMPLE_LDIF_SAM_USERS,
            stderr="",
        )
        conn = LdbConnector("sam", use_sudo=False)
        conn.query(filter_expr="(objectClass=user)")
        cmd = mock_run.call_args[0][0]
        assert "(objectClass=user)" in cmd

    @patch('subprocess.run')
    def test_query_with_attrs(self, mock_run):
        """Запрос с атрибутами передаёт их в команду."""
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout=SAMPLE_LDIF_SAM_USERS,
            stderr="",
        )
        conn = LdbConnector("sam", use_sudo=False)
        conn.query(filter_expr="(objectClass=user)", attrs=["cn", "sAMAccountName"])
        cmd = mock_run.call_args[0][0]
        assert "cn" in cmd
        assert "sAMAccountName" in cmd

    @patch('subprocess.run')
    def test_query_with_base_dn(self, mock_run):
        """Запрос с base_dn передаёт -b в команду."""
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout=SAMPLE_LDIF_SAM_USERS,
            stderr="",
        )
        conn = LdbConnector("sam", use_sudo=False)
        conn.query(filter_expr="", base_dn="CN=Users,DC=kcrb,DC=local")
        cmd = mock_run.call_args[0][0]
        assert "-b" in cmd
        assert "CN=Users,DC=kcrb,DC=local" in cmd

    @patch('subprocess.run')
    def test_query_with_scope(self, mock_run):
        """Запрос с scope передаёт -s в команду."""
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout=SAMPLE_LDIF_SAM_USERS,
            stderr="",
        )
        conn = LdbConnector("sam", use_sudo=False)
        conn.query(filter_expr="", scope="base")
        cmd = mock_run.call_args[0][0]
        assert "-s" in cmd
        assert "base" in cmd


class TestLdbConnectorSudo:
    """Тесты использования sudo."""

    @patch('subprocess.run')
    def test_sudo_in_command(self, mock_run):
        """sudo включён — команда начинается с sudo."""
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout=SAMPLE_LDIF_SAM_USERS,
            stderr="",
        )
        conn = LdbConnector("sam", use_sudo=True)
        conn.query(filter_expr="")
        cmd = mock_run.call_args[0][0]
        assert cmd[0] == "sudo"

    @patch('subprocess.run')
    def test_no_sudo_in_command(self, mock_run):
        """sudo выключен — команда без sudo."""
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout=SAMPLE_LDIF_SAM_USERS,
            stderr="",
        )
        conn = LdbConnector("sam", use_sudo=False)
        conn.query(filter_expr="")
        cmd = mock_run.call_args[0][0]
        assert cmd[0] != "sudo"


class TestLdbConnectorSearch:
    """Тесты поиска по подстроке."""

    @patch('subprocess.run')
    def test_search_by_cn(self, mock_run):
        """Поиск сначала по cn."""
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout=SAMPLE_LDIF_SAM_USERS,
            stderr="",
        )
        conn = LdbConnector("sam", use_sudo=False)
        records = conn.search_term("Admin")
        assert len(records) > 0

    @patch('subprocess.run')
    def test_search_escalates_to_samaccountname(self, mock_run):
        """Если не найдено по cn, пробуем sAMAccountName."""
        # Первый запрос (cn) — пустой, второй (sAMAccountName) — с данными
        mock_run.side_effect = [
            MagicMock(returncode=0, stdout="", stderr=""),
            MagicMock(returncode=0, stdout=SAMPLE_LDIF_SAM_USERS, stderr=""),
        ]
        conn = LdbConnector("sam", use_sudo=False)
        records = conn.search_term("ivan")
        # Должен был сделать минимум 2 запроса
        assert mock_run.call_count >= 2


class TestLdbConnectorQueryByDn:
    """Тесты запроса по DN."""

    @patch('subprocess.run')
    def test_query_by_dn(self, mock_run):
        """Запрос по DN возвращает запись."""
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout="# record 1\ndn: CN=Admin,CN=Users,DC=kcrb,DC=local\ncn: Admin\n\n",
            stderr="",
        )
        conn = LdbConnector("sam", use_sudo=False)
        rec = conn.query_by_dn("CN=Admin,CN=Users,DC=kcrb,DC=local")
        assert rec is not None
        assert rec.dn == "CN=Admin,CN=Users,DC=kcrb,DC=local"

    @patch('subprocess.run')
    def test_query_by_dn_not_found(self, mock_run):
        """Запрос по несуществующему DN → None."""
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout="",
            stderr="",
        )
        conn = LdbConnector("sam", use_sudo=False)
        rec = conn.query_by_dn("CN=Nonexistent,DC=local")
        assert rec is None


class TestLdbConnectorListAll:
    """Тесты list_all."""

    @patch('subprocess.run')
    def test_list_all(self, mock_run):
        """list_all возвращает все записи."""
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout=SAMPLE_LDIF_SAM_USERS,
            stderr="",
        )
        conn = LdbConnector("sam", use_sudo=False)
        records = conn.list_all()
        assert len(records) > 0


class TestLdbConnectorErrors:
    """Тесты обработки ошибок."""

    @patch('subprocess.run')
    def test_permission_denied(self, mock_run):
        """Permission denied → RuntimeError."""
        mock_run.return_value = MagicMock(
            returncode=1,
            stdout="",
            stderr="Unable to open tdb or ldb database: Permission denied",
        )
        conn = LdbConnector("sam", use_sudo=False)
        with pytest.raises(RuntimeError, match="Отказано в доступе|Не удалось открыть"):
            conn.query()

    @patch('subprocess.run')
    def test_file_not_found(self, mock_run):
        """FileNotFoundError → RuntimeError."""
        mock_run.side_effect = FileNotFoundError()
        conn = LdbConnector("sam", use_sudo=False)
        with pytest.raises(RuntimeError, match="ldbsearch не найден"):
            conn.query()

    @patch('subprocess.run')
    def test_timeout(self, mock_run):
        """TimeoutExpired → RuntimeError."""
        import subprocess
        mock_run.side_effect = subprocess.TimeoutExpired(cmd="ldbsearch", timeout=60)
        conn = LdbConnector("sam", use_sudo=False)
        with pytest.raises(RuntimeError, match="таймаут"):
            conn.query()


class TestBuildCommand:
    """Тесты построения команды ldbsearch."""

    def test_basic_command(self):
        """Базовая команда без параметров."""
        conn = LdbConnector("sam", use_sudo=False)
        cmd = conn._build_command("", None, None, None, None)
        assert "ldbsearch" in cmd[0]
        assert "-H" in cmd

    def test_sudo_command(self):
        """Команда с sudo."""
        conn = LdbConnector("sam", use_sudo=True)
        cmd = conn._build_command("", None, None, None, None)
        assert cmd[0] == "sudo"

    def test_filter_wrapped(self):
        """Фильтр без скобок оборачивается."""
        conn = LdbConnector("sam", use_sudo=False)
        cmd = conn._build_command("objectClass=user", None, None, None, None)
        assert "(objectClass=user)" in cmd

    def test_filter_with_brackets(self):
        """Фильтр со скобками не оборачивается."""
        conn = LdbConnector("sam", use_sudo=False)
        cmd = conn._build_command("(objectClass=user)", None, None, None, None)
        assert "(objectClass=user)" in cmd

    def test_empty_filter_no_added(self):
        """Пустой фильтр не добавляется в команду."""
        conn = LdbConnector("sam", use_sudo=False)
        cmd = conn._build_command("", None, None, None, None)
        # Не должно быть фильтра в команде
        filter_items = [c for c in cmd if c.startswith("(")]
        assert len(filter_items) == 0


class TestEscapeLdapFilter:
    """Тесты экранирования LDAP фильтров."""

    def test_escape_asterisk(self):
        """* экранируется."""
        result = LdbConnector._escape_ldap_filter("test*")
        assert "\\2a" in result

    def test_escape_parentheses(self):
        """( и ) экранируются."""
        result = LdbConnector._escape_ldap_filter("test(value)")
        assert "\\28" in result
        assert "\\29" in result

    def test_escape_backslash(self):
        """\\ экранируется."""
        result = LdbConnector._escape_ldap_filter("test\\value")
        assert "\\5c" in result

    def test_no_escape_normal(self):
        """Обычная строка не экранируется."""
        result = LdbConnector._escape_ldap_filter("testvalue")
        assert result == "testvalue"


class TestLdbConnectorRepr:
    """Тесты repr()."""

    def test_repr_with_sudo(self):
        """repr с sudo."""
        conn = LdbConnector("sam", use_sudo=True)
        r = repr(conn)
        assert "sudo" in r

    def test_repr_without_sudo(self):
        """repr без sudo."""
        conn = LdbConnector("sam", use_sudo=False)
        r = repr(conn)
        assert "sudo" not in r
