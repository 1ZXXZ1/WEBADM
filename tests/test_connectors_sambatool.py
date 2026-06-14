"""
Тесты коннектора samba-tool — sdb.connectors.sambatool

Проверяет (с моками subprocess):
  - Создание коннектора
  - Выполнение произвольной команды (run)
  - Удобные методы (user_list, user_create, group_list, dns_query, etc.)
  - Обработка ошибок
  - Таймаут
  - SambaToolResult (форматирование результата)
"""

import pytest
from unittest.mock import patch, MagicMock, call

from sdb.connectors.sambatool import SambaToolConnector, SambaToolResult


class TestSambaToolResult:
    """Тесты объекта результата SambaToolResult."""

    def test_success_result(self):
        """Успешный результат."""
        result = SambaToolResult(returncode=0, stdout="User created\n", stderr="")
        assert result.success is True
        assert result.returncode == 0
        assert result.stdout == "User created\n"
        assert len(result.lines) == 1
        assert result.lines[0] == "User created"

    def test_error_result(self):
        """Ошибочный результат."""
        result = SambaToolResult(returncode=1, stdout="", stderr="ERROR: User not found\n")
        assert result.success is False
        assert result.returncode == 1
        assert len(result.lines) == 0

    def test_to_dict(self):
        """Преобразование в словарь."""
        result = SambaToolResult(returncode=0, stdout="OK\n", stderr="")
        d = result.to_dict()
        assert d["success"] is True
        assert d["returncode"] == 0
        assert d["output"] == "OK"
        assert "lines" in d

    def test_empty_stdout(self):
        """Пустой stdout — lines = []."""
        result = SambaToolResult(returncode=0, stdout="", stderr="")
        assert result.lines == []

    def test_multiline_stdout(self):
        """Многострочный stdout — несколько lines."""
        result = SambaToolResult(
            returncode=0,
            stdout="Administrator\nivan\nmaria\n",
            stderr=""
        )
        assert len(result.lines) == 3
        assert "Administrator" in result.lines
        assert "ivan" in result.lines

    def test_repr(self):
        """repr() содержит статус."""
        r_ok = SambaToolResult(returncode=0, stdout="OK", stderr="")
        assert "OK" in repr(r_ok)
        r_fail = SambaToolResult(returncode=1, stdout="", stderr="ERR")
        assert "FAIL" in repr(r_fail)


class TestSambaToolConnectorInit:
    """Тесты инициализации коннектора."""

    def test_default_sudo(self):
        """По умолчанию sudo включён."""
        conn = SambaToolConnector(use_sudo=True)
        assert conn.use_sudo is True

    def test_no_sudo(self):
        """Без sudo."""
        conn = SambaToolConnector(use_sudo=False)
        assert conn.use_sudo is False


class TestSambaToolConnectorRun:
    """Тесты выполнения команд через run()."""

    @patch('subprocess.run')
    def test_run_simple_command(self, mock_run):
        """Простая команда передаётся в subprocess."""
        mock_run.return_value = MagicMock(returncode=0, stdout="OK\n", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        result = conn.run(["user", "list"])
        assert result.success is True
        cmd = mock_run.call_args[0][0]
        assert "samba-tool" in cmd[0]
        assert "user" in cmd
        assert "list" in cmd

    @patch('subprocess.run')
    def test_run_with_sudo(self, mock_run):
        """Команда с sudo."""
        mock_run.return_value = MagicMock(returncode=0, stdout="OK\n", stderr="")
        conn = SambaToolConnector(use_sudo=True)
        result = conn.run(["user", "list"])
        cmd = mock_run.call_args[0][0]
        assert cmd[0] == "sudo"

    @patch('subprocess.run')
    def test_run_with_extra_args(self, mock_run):
        """Дополнительные аргументы добавляются в команду."""
        mock_run.return_value = MagicMock(returncode=0, stdout="OK\n", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.run(["user", "create", "john", "P@ss"], extra_args=["--given-name=John"])
        cmd = mock_run.call_args[0][0]
        assert "--given-name=John" in cmd

    @patch('subprocess.run')
    def test_run_error(self, mock_run):
        """Ошибка выполнения."""
        mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="ERROR\n")
        conn = SambaToolConnector(use_sudo=False)
        result = conn.run(["user", "delete", "nonexistent"])
        assert result.success is False
        assert result.returncode == 1

    @patch('subprocess.run')
    def test_run_file_not_found(self, mock_run):
        """samba-tool не найден → RuntimeError."""
        mock_run.side_effect = FileNotFoundError()
        conn = SambaToolConnector(use_sudo=False)
        with pytest.raises(RuntimeError, match="samba-tool не найден"):
            conn.run(["user", "list"])

    @patch('subprocess.run')
    def test_run_timeout(self, mock_run):
        """Таймаут → RuntimeError."""
        import subprocess
        mock_run.side_effect = subprocess.TimeoutExpired(cmd="samba-tool", timeout=120)
        conn = SambaToolConnector(use_sudo=False)
        with pytest.raises(RuntimeError, match="таймаут"):
            conn.run(["user", "list"])


class TestSambaToolUserMethods:
    """Тесты методов для работы с пользователями."""

    @patch('subprocess.run')
    def test_user_list(self, mock_run):
        """user_list() вызывает правильную команду."""
        mock_run.return_value = MagicMock(returncode=0, stdout="admin\nuser1\n", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        result = conn.user_list()
        cmd = mock_run.call_args[0][0]
        assert "user" in cmd
        assert "list" in cmd

    @patch('subprocess.run')
    def test_user_create(self, mock_run):
        """user_create() передаёт имя и пароль."""
        mock_run.return_value = MagicMock(returncode=0, stdout="User created\n", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.user_create("john", "P@ssw0rd")
        cmd = mock_run.call_args[0][0]
        assert "create" in cmd
        assert "john" in cmd
        assert "P@ssw0rd" in cmd

    @patch('subprocess.run')
    def test_user_create_with_extras(self, mock_run):
        """user_create() с дополнительными опциями."""
        mock_run.return_value = MagicMock(returncode=0, stdout="User created\n", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.user_create("john", "P@ss", extra_args=["--given-name=John", "--surname=Doe"])
        cmd = mock_run.call_args[0][0]
        assert "--given-name=John" in cmd
        assert "--surname=Doe" in cmd

    @patch('subprocess.run')
    def test_user_delete(self, mock_run):
        """user_delete() передаёт имя."""
        mock_run.return_value = MagicMock(returncode=0, stdout="User deleted\n", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.user_delete("john")
        cmd = mock_run.call_args[0][0]
        assert "delete" in cmd
        assert "john" in cmd

    @patch('subprocess.run')
    def test_user_disable(self, mock_run):
        """user_disable() передаёт имя."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.user_disable("john")
        cmd = mock_run.call_args[0][0]
        assert "disable" in cmd

    @patch('subprocess.run')
    def test_user_enable(self, mock_run):
        """user_enable() передаёт имя."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.user_enable("john")
        cmd = mock_run.call_args[0][0]
        assert "enable" in cmd

    @patch('subprocess.run')
    def test_user_setpassword(self, mock_run):
        """user_setpassword() передаёт --newpassword."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.user_setpassword("john", "NewP@ss")
        cmd = mock_run.call_args[0][0]
        assert "--newpassword" in cmd
        assert "NewP@ss" in cmd

    @patch('subprocess.run')
    def test_user_getgroups(self, mock_run):
        """user_getgroups() передаёт имя."""
        mock_run.return_value = MagicMock(returncode=0, stdout="Domain Users\n", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.user_getgroups("john")
        cmd = mock_run.call_args[0][0]
        assert "getgroups" in cmd
        assert "john" in cmd

    @patch('subprocess.run')
    def test_user_show(self, mock_run):
        """user_show() передаёт имя."""
        mock_run.return_value = MagicMock(returncode=0, stdout="DN: CN=john\n", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.user_show("john")
        cmd = mock_run.call_args[0][0]
        assert "show" in cmd

    @patch('subprocess.run')
    def test_user_rename(self, mock_run):
        """user_rename() передаёт --newname."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.user_rename("old_name", "new_name")
        cmd = mock_run.call_args[0][0]
        assert "--newname" in cmd
        assert "new_name" in cmd

    @patch('subprocess.run')
    def test_user_move(self, mock_run):
        """user_move() передаёт новый OU."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.user_move("john", "OU=NewOU,DC=kcrb,DC=local")
        cmd = mock_run.call_args[0][0]
        assert "move" in cmd
        # OU строка — отдельный аргумент в команде
        assert any("OU=NewOU" in c for c in cmd)

    @patch('subprocess.run')
    def test_user_setexpiry(self, mock_run):
        """user_setexpiry() с днями."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.user_setexpiry("john", days=90)
        cmd = mock_run.call_args[0][0]
        assert "--days" in cmd
        assert "90" in cmd

    @patch('subprocess.run')
    def test_user_setexpiry_no_expiry(self, mock_run):
        """user_setexpiry() с no_expiry."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.user_setexpiry("john", no_expiry=True)
        cmd = mock_run.call_args[0][0]
        assert "--noexpiry" in cmd


class TestSambaToolGroupMethods:
    """Тесты методов для работы с группами."""

    @patch('subprocess.run')
    def test_group_list(self, mock_run):
        """group_list()."""
        mock_run.return_value = MagicMock(returncode=0, stdout="Domain Admins\n", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.group_list()
        cmd = mock_run.call_args[0][0]
        assert "group" in cmd
        assert "list" in cmd

    @patch('subprocess.run')
    def test_group_listmembers(self, mock_run):
        """group_listmembers()."""
        mock_run.return_value = MagicMock(returncode=0, stdout="admin\n", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.group_listmembers("Domain Admins")
        cmd = mock_run.call_args[0][0]
        assert "listmembers" in cmd
        assert "Domain Admins" in cmd

    @patch('subprocess.run')
    def test_group_addmembers(self, mock_run):
        """group_addmembers()."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.group_addmembers("Domain Admins", ["user1", "user2"])
        cmd = mock_run.call_args[0][0]
        assert "addmembers" in cmd
        assert "user1" in cmd
        assert "user2" in cmd

    @patch('subprocess.run')
    def test_group_removemembers(self, mock_run):
        """group_removemembers()."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.group_removemembers("Domain Admins", ["user1"])
        cmd = mock_run.call_args[0][0]
        assert "removemembers" in cmd

    @patch('subprocess.run')
    def test_group_create(self, mock_run):
        """group_create()."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.group_create("NewGroup")
        cmd = mock_run.call_args[0][0]
        assert "create" in cmd
        assert "NewGroup" in cmd

    @patch('subprocess.run')
    def test_group_delete(self, mock_run):
        """group_delete()."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.group_delete("OldGroup")
        cmd = mock_run.call_args[0][0]
        assert "delete" in cmd


class TestSambaToolComputerMethods:
    """Тесты методов для работы с компьютерами."""

    @patch('subprocess.run')
    def test_computer_list(self, mock_run):
        """computer_list()."""
        mock_run.return_value = MagicMock(returncode=0, stdout="DC01$\n", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.computer_list()
        cmd = mock_run.call_args[0][0]
        assert "computer" in cmd
        assert "list" in cmd

    @patch('subprocess.run')
    def test_computer_create(self, mock_run):
        """computer_create() — без пароля (как в samba-tool)."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.computer_create("PC01")
        cmd = mock_run.call_args[0][0]
        assert "create" in cmd
        assert "PC01" in cmd
        # Пароль НЕ передаётся — отличие от user create
        assert "P@ss" not in cmd

    @patch('subprocess.run')
    def test_computer_create_with_options(self, mock_run):
        """computer_create() с дополнительными опциями."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.computer_create("PC01", extra_args=["--description=Test PC", "--computerou=OU=Computers"])
        cmd = mock_run.call_args[0][0]
        assert "PC01" in cmd
        assert "--description=Test PC" in cmd

    @patch('subprocess.run')
    def test_computer_delete(self, mock_run):
        """computer_delete()."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.computer_delete("PC01")
        cmd = mock_run.call_args[0][0]
        assert "delete" in cmd


class TestSambaToolDnsMethods:
    """Тесты методов для работы с DNS."""

    @patch('subprocess.run')
    def test_dns_query(self, mock_run):
        """dns_query() передаёт все параметры."""
        mock_run.return_value = MagicMock(returncode=0, stdout="A record...\n", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.dns_query("kcrb.local", "kcrb.local", "@", "ALL")
        cmd = mock_run.call_args[0][0]
        assert "dns" in cmd
        assert "query" in cmd
        assert "kcrb.local" in cmd
        assert "@" in cmd
        assert "ALL" in cmd

    @patch('subprocess.run')
    def test_dns_add(self, mock_run):
        """dns_add()."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.dns_add("kcrb.local", "kcrb.local", "test", "A", "192.168.1.100")
        cmd = mock_run.call_args[0][0]
        assert "add" in cmd
        assert "test" in cmd
        assert "192.168.1.100" in cmd

    @patch('subprocess.run')
    def test_dns_delete(self, mock_run):
        """dns_delete()."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.dns_delete("kcrb.local", "kcrb.local", "test", "A", "192.168.1.100")
        cmd = mock_run.call_args[0][0]
        assert "delete" in cmd


class TestSambaToolDomainMethods:
    """Тесты методов для работы с доменом."""

    @patch('subprocess.run')
    def test_domain_info(self, mock_run):
        """domain_info() без сервера."""
        mock_run.return_value = MagicMock(returncode=0, stdout="Domain info...\n", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.domain_info()
        cmd = mock_run.call_args[0][0]
        assert "domain" in cmd
        assert "info" in cmd

    @patch('subprocess.run')
    def test_domain_info_with_server(self, mock_run):
        """domain_info() с сервером."""
        mock_run.return_value = MagicMock(returncode=0, stdout="Domain info...\n", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.domain_info("192.168.1.1")
        cmd = mock_run.call_args[0][0]
        assert "192.168.1.1" in cmd

    @patch('subprocess.run')
    def test_domain_level_show(self, mock_run):
        """domain_level_show()."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.domain_level_show()
        cmd = mock_run.call_args[0][0]
        assert "level" in cmd
        assert "show" in cmd

    @patch('subprocess.run')
    def test_domain_passwordsettings(self, mock_run):
        """domain_passwordsettings()."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.domain_passwordsettings(extra_args=["--complexity=off"])
        cmd = mock_run.call_args[0][0]
        assert "passwordsettings" in cmd
        assert "--complexity=off" in cmd


class TestSambaToolFsmoMethods:
    """Тесты методов FSMO."""

    @patch('subprocess.run')
    def test_fsmo_show(self, mock_run):
        """fsmo_show()."""
        mock_run.return_value = MagicMock(returncode=0, stdout="FSMO roles...\n", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.fsmo_show()
        cmd = mock_run.call_args[0][0]
        assert "fsmo" in cmd
        assert "show" in cmd

    @patch('subprocess.run')
    def test_fsmo_transfer(self, mock_run):
        """fsmo_transfer() с ролью."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.fsmo_transfer("rid")
        cmd = mock_run.call_args[0][0]
        assert "--role=rid" in cmd

    @patch('subprocess.run')
    def test_fsmo_seize(self, mock_run):
        """fsmo_seize() с ролью."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.fsmo_seize("pdc")
        cmd = mock_run.call_args[0][0]
        assert "--role=pdc" in cmd


class TestSambaToolOtherMethods:
    """Тесты остальных методов."""

    @patch('subprocess.run')
    def test_drs_showrepl(self, mock_run):
        """drs_showrepl()."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.drs_showrepl()
        cmd = mock_run.call_args[0][0]
        assert "drs" in cmd
        assert "showrepl" in cmd

    @patch('subprocess.run')
    def test_spn_list(self, mock_run):
        """spn_list()."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.spn_list("john")
        cmd = mock_run.call_args[0][0]
        assert "spn" in cmd
        assert "john" in cmd

    @patch('subprocess.run')
    def test_delegation_show(self, mock_run):
        """delegation_show()."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.delegation_show("john")
        cmd = mock_run.call_args[0][0]
        assert "delegation" in cmd
        assert "show" in cmd

    @patch('subprocess.run')
    def test_ntacl_sysvolcheck(self, mock_run):
        """ntacl_sysvolcheck()."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.ntacl_sysvolcheck()
        cmd = mock_run.call_args[0][0]
        assert "ntacl" in cmd
        assert "sysvolcheck" in cmd

    @patch('subprocess.run')
    def test_schema_query(self, mock_run):
        """schema_query()."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.schema_query()
        cmd = mock_run.call_args[0][0]
        assert "schema" in cmd
        assert "query" in cmd

    @patch('subprocess.run')
    def test_dbcheck(self, mock_run):
        """dbcheck()."""
        mock_run.return_value = MagicMock(returncode=0, stdout="Checked 100 records\n", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.dbcheck()
        cmd = mock_run.call_args[0][0]
        assert "dbcheck" in cmd

    @patch('subprocess.run')
    def test_dbcheck_with_fix(self, mock_run):
        """dbcheck --fix."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.dbcheck(extra_args=["--fix"])
        cmd = mock_run.call_args[0][0]
        assert "--fix" in cmd

    @patch('subprocess.run')
    def test_testparm(self, mock_run):
        """testparm()."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.testparm()
        cmd = mock_run.call_args[0][0]
        assert "testparm" in cmd

    @patch('subprocess.run')
    def test_ou_list(self, mock_run):
        """ou_list()."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.ou_list()
        cmd = mock_run.call_args[0][0]
        assert "ou" in cmd
        assert "list" in cmd

    @patch('subprocess.run')
    def test_gpo_listall(self, mock_run):
        """gpo_listall()."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.gpo_listall()
        cmd = mock_run.call_args[0][0]
        assert "gpo" in cmd
        assert "listall" in cmd

    @patch('subprocess.run')
    def test_ldapcmp(self, mock_run):
        """ldapcmp()."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        conn = SambaToolConnector(use_sudo=False)
        conn.ldapcmp("server1", "server2", extra_args=["--filter=objectClass=user"])
        cmd = mock_run.call_args[0][0]
        assert "ldapcmp" in cmd
        assert "server1" in cmd
        assert "server2" in cmd
        assert "--filter=objectClass=user" in cmd


class TestSambaToolConnectorRepr:
    """Тесты repr()."""

    def test_repr_with_sudo(self):
        """repr с sudo."""
        conn = SambaToolConnector(use_sudo=True)
        r = repr(conn)
        assert "sudo" in r

    def test_repr_without_sudo(self):
        """repr без sudo."""
        conn = SambaToolConnector(use_sudo=False)
        r = repr(conn)
        assert "sudo" not in r
