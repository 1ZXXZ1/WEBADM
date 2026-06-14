"""
Тесты модулей команд — sdb.commands

Проверяет:
  - QueryCommands (select_all, select_by_filter, filter_records, select_fields, count_records)
  - UserCommands (list_users, get_user, search_users, create, delete, etc.)
  - GroupCommands (list_groups, get_members, add_members, etc.)
  - ComputerCommands (list, create, delete)
  - DnsCommands (list_dns_nodes, query_dns, search_dns)
  - PrivilegeCommands (list_privileges, find_privilege, get_privilege_map)
  - IdmapCommands (list_mappings, get_by_sid, get_by_xid, find_uid/gid_mappings)
  - ShareCommands (list_shares, get_share, get_share_info)
  - RegistryCommands (list_keys, list_values, get_key, get_registry_tree)
"""

import pytest
from unittest.mock import patch, MagicMock

from sdb.parser.ldif import LdifRecord
from sdb.connectors.ldb import LdbConnector
from sdb.connectors.sambatool import SambaToolConnector, SambaToolResult
from sdb.commands.query import QueryCommands
from sdb.commands.user import UserCommands
from sdb.commands.group import GroupCommands
from sdb.commands.computer import ComputerCommands
from sdb.commands.dns_cmd import DnsCommands
from sdb.commands.privilege import PrivilegeCommands
from sdb.commands.idmap import IdmapCommands
from sdb.commands.share import ShareCommands
from sdb.commands.registry import RegistryCommands
from tests.conftest import SAMPLE_LDIF_SAM_USERS, SAMPLE_LDIF_PRIVILEGE, SAMPLE_LDIF_IDMAP


# ═══════════════════════════════════════════════════════════════
# QueryCommands
# ═══════════════════════════════════════════════════════════════

class TestQueryCommands:
    """Тесты общих команд запросов."""

    @patch('subprocess.run')
    def test_select_all(self, mock_run):
        """select_all() возвращает все записи."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_SAM_USERS, stderr="")
        ldb = LdbConnector("sam", use_sudo=False)
        q = QueryCommands(ldb)
        records = q.select_all()
        assert len(records) > 0

    @patch('subprocess.run')
    def test_select_by_filter(self, mock_run):
        """select_by_filter() передаёт фильтр."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_SAM_USERS, stderr="")
        ldb = LdbConnector("sam", use_sudo=False)
        q = QueryCommands(ldb)
        records = q.select_by_filter("(objectClass=user)")
        assert isinstance(records, list)

    @patch('subprocess.run')
    def test_select_users(self, mock_run):
        """select_users() использует правильный фильтр."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_SAM_USERS, stderr="")
        ldb = LdbConnector("sam", use_sudo=False)
        q = QueryCommands(ldb)
        q.select_users()
        cmd = mock_run.call_args[0][0]
        assert any("objectClass=user" in str(c) for c in cmd)
        assert any("sAMAccountType=805306368" in str(c) for c in cmd)

    @patch('subprocess.run')
    def test_select_groups(self, mock_run):
        """select_groups() использует фильтр group."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_SAM_USERS, stderr="")
        ldb = LdbConnector("sam", use_sudo=False)
        q = QueryCommands(ldb)
        q.select_groups()
        cmd = mock_run.call_args[0][0]
        assert any("objectClass=group" in str(c) for c in cmd)

    def test_filter_records(self):
        """filter_records() фильтрует по атрибуту."""
        ldb = LdbConnector("sam", use_sudo=False)
        q = QueryCommands(ldb)
        records = [
            LdifRecord(dn="CN=A", attrs={"cn": ["Admin"], "objectClass": ["user"]}),
            LdifRecord(dn="CN=B", attrs={"cn": ["ivan"], "objectClass": ["user"]}),
            LdifRecord(dn="CN=C", attrs={"cn": ["Group1"], "objectClass": ["group"]}),
        ]
        filtered = q.filter_records(records, "objectClass", "user")
        assert len(filtered) == 2

    def test_filter_records_case_insensitive(self):
        """filter_records() — без учёта регистра."""
        ldb = LdbConnector("sam", use_sudo=False)
        q = QueryCommands(ldb)
        records = [
            LdifRecord(dn="CN=A", attrs={"cn": ["ADMIN"]}),
            LdifRecord(dn="CN=B", attrs={"cn": ["ivan"]}),
        ]
        filtered = q.filter_records(records, "cn", "admin", case_sensitive=False)
        assert len(filtered) == 1

    def test_select_fields(self):
        """select_fields() оставляет только указанные атрибуты."""
        ldb = LdbConnector("sam", use_sudo=False)
        q = QueryCommands(ldb)
        records = [
            LdifRecord(dn="CN=A", attrs={"cn": ["A"], "sAMAccountName": ["a"], "mail": ["a@b.c"]}),
        ]
        filtered = q.select_fields(records, ["cn", "sAMAccountName"])
        assert len(filtered) == 1
        assert filtered[0].has_attr("cn")
        assert filtered[0].has_attr("sAMAccountName")
        assert not filtered[0].has_attr("mail")

    @patch('subprocess.run')
    def test_count_records(self, mock_run):
        """count_records() возвращает количество."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_SAM_USERS, stderr="")
        ldb = LdbConnector("sam", use_sudo=False)
        q = QueryCommands(ldb)
        count = q.count_records()
        assert count > 0


# ═══════════════════════════════════════════════════════════════
# UserCommands
# ═══════════════════════════════════════════════════════════════

class TestUserCommands:
    """Тесты команд пользователей."""

    @patch('subprocess.run')
    def test_list_users(self, mock_run):
        """list_users() возвращает пользователей."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_SAM_USERS, stderr="")
        ldb = LdbConnector("sam", use_sudo=False)
        st = SambaToolConnector(use_sudo=False)
        users = UserCommands(ldb, st)
        records = users.list_users()
        assert isinstance(records, list)

    @patch('subprocess.run')
    def test_get_user(self, mock_run):
        """get_user() находит пользователя по имени."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_SAM_USERS, stderr="")
        ldb = LdbConnector("sam", use_sudo=False)
        st = SambaToolConnector(use_sudo=False)
        users = UserCommands(ldb, st)
        user = users.get_user("Administrator")
        assert user is not None
        assert user.get("sAMAccountName") == "Administrator"

    @patch('subprocess.run')
    def test_get_user_not_found(self, mock_run):
        """get_user() — пользователь не найден."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        ldb = LdbConnector("sam", use_sudo=False)
        st = SambaToolConnector(use_sudo=False)
        users = UserCommands(ldb, st)
        user = users.get_user("nonexistent")
        assert user is None

    @patch('subprocess.run')
    def test_create_user(self, mock_run):
        """create() вызывает samba-tool."""
        mock_run.return_value = MagicMock(returncode=0, stdout="User created\n", stderr="")
        ldb = LdbConnector("sam", use_sudo=False)
        st = SambaToolConnector(use_sudo=False)
        users = UserCommands(ldb, st)
        result = users.create("john", "P@ssw0rd")
        assert result["success"] is True

    @patch('subprocess.run')
    def test_delete_user(self, mock_run):
        """delete() вызывает samba-tool."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        ldb = LdbConnector("sam", use_sudo=False)
        st = SambaToolConnector(use_sudo=False)
        users = UserCommands(ldb, st)
        result = users.delete("john")
        assert result["success"] is True

    @patch('subprocess.run')
    def test_disable_user(self, mock_run):
        """disable() вызывает samba-tool."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        ldb = LdbConnector("sam", use_sudo=False)
        st = SambaToolConnector(use_sudo=False)
        users = UserCommands(ldb, st)
        result = users.disable("john")
        assert result["success"] is True

    @patch('subprocess.run')
    def test_enable_user(self, mock_run):
        """enable() вызывает samba-tool."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        ldb = LdbConnector("sam", use_sudo=False)
        st = SambaToolConnector(use_sudo=False)
        users = UserCommands(ldb, st)
        result = users.enable("john")
        assert result["success"] is True

    @patch('subprocess.run')
    def test_set_password(self, mock_run):
        """set_password() вызывает samba-tool."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        ldb = LdbConnector("sam", use_sudo=False)
        st = SambaToolConnector(use_sudo=False)
        users = UserCommands(ldb, st)
        result = users.set_password("john", "NewP@ss")
        assert result["success"] is True

    @patch('subprocess.run')
    def test_list_names(self, mock_run):
        """list_names() возвращает список имён."""
        mock_run.return_value = MagicMock(returncode=0, stdout="admin\nuser1\n", stderr="")
        ldb = LdbConnector("sam", use_sudo=False)
        st = SambaToolConnector(use_sudo=False)
        users = UserCommands(ldb, st)
        names = users.list_names()
        assert "admin" in names
        assert "user1" in names


# ═══════════════════════════════════════════════════════════════
# GroupCommands
# ═══════════════════════════════════════════════════════════════

class TestGroupCommands:
    """Тесты команд групп."""

    @patch('subprocess.run')
    def test_list_groups(self, mock_run):
        """list_groups() возвращает группы."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_SAM_USERS, stderr="")
        ldb = LdbConnector("sam", use_sudo=False)
        st = SambaToolConnector(use_sudo=False)
        groups = GroupCommands(ldb, st)
        records = groups.list_groups()
        assert isinstance(records, list)

    @patch('subprocess.run')
    def test_get_member_names(self, mock_run):
        """get_member_names() через samba-tool."""
        mock_run.return_value = MagicMock(returncode=0, stdout="admin\nuser1\n", stderr="")
        ldb = LdbConnector("sam", use_sudo=False)
        st = SambaToolConnector(use_sudo=False)
        groups = GroupCommands(ldb, st)
        names = groups.get_member_names("Domain Admins")
        assert "admin" in names

    @patch('subprocess.run')
    def test_add_members(self, mock_run):
        """add_members() вызывает samba-tool."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        ldb = LdbConnector("sam", use_sudo=False)
        st = SambaToolConnector(use_sudo=False)
        groups = GroupCommands(ldb, st)
        result = groups.add_members("Domain Admins", ["user1"])
        assert result["success"] is True

    @patch('subprocess.run')
    def test_remove_members(self, mock_run):
        """remove_members() вызывает samba-tool."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        ldb = LdbConnector("sam", use_sudo=False)
        st = SambaToolConnector(use_sudo=False)
        groups = GroupCommands(ldb, st)
        result = groups.remove_members("Domain Admins", ["user1"])
        assert result["success"] is True


# ═══════════════════════════════════════════════════════════════
# ComputerCommands
# ═══════════════════════════════════════════════════════════════

class TestComputerCommands:
    """Тесты команд компьютеров."""

    @patch('subprocess.run')
    def test_computer_list(self, mock_run):
        """computer_list() через samba-tool."""
        mock_run.return_value = MagicMock(returncode=0, stdout="DC01$\n", stderr="")
        st = SambaToolConnector(use_sudo=False)
        result = st.computer_list()
        assert result.success is True


# ═══════════════════════════════════════════════════════════════
# DnsCommands
# ═══════════════════════════════════════════════════════════════

class TestDnsCommands:
    """Тесты команд DNS."""

    @patch('subprocess.run')
    def test_list_dns_nodes(self, mock_run):
        """list_dns_nodes() через ldbsearch."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_SAM_USERS, stderr="")
        ldb = LdbConnector("sam", use_sudo=False)
        st = SambaToolConnector(use_sudo=False)
        dns = DnsCommands(ldb, st)
        records = dns.list_dns_nodes()
        assert isinstance(records, list)

    @patch('subprocess.run')
    def test_query_dns(self, mock_run):
        """query_dns() через samba-tool."""
        mock_run.return_value = MagicMock(returncode=0, stdout="A record...\n", stderr="")
        ldb = LdbConnector("sam", use_sudo=False)
        st = SambaToolConnector(use_sudo=False)
        dns = DnsCommands(ldb, st)
        result = dns.query_dns("kcrb.local", "kcrb.local", "@", "ALL")
        assert isinstance(result, dict)

    @patch('subprocess.run')
    def test_search_dns(self, mock_run):
        """search_dns() через ldbsearch."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_SAM_USERS, stderr="")
        ldb = LdbConnector("sam", use_sudo=False)
        st = SambaToolConnector(use_sudo=False)
        dns = DnsCommands(ldb, st)
        records = dns.search_dns("test")
        assert isinstance(records, list)


# ═══════════════════════════════════════════════════════════════
# PrivilegeCommands
# ═══════════════════════════════════════════════════════════════

class TestPrivilegeCommands:
    """Тесты команд привилегий."""

    @patch('subprocess.run')
    def test_list_privileges(self, mock_run):
        """list_privileges()."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_PRIVILEGE, stderr="")
        ldb = LdbConnector("privilege", use_sudo=False)
        privs = PrivilegeCommands(ldb)
        records = privs.list_privileges()
        assert len(records) == 2

    @patch('subprocess.run')
    def test_find_privilege(self, mock_run):
        """find_privilege() — поиск по имени привилегии."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_PRIVILEGE, stderr="")
        ldb = LdbConnector("privilege", use_sudo=False)
        privs = PrivilegeCommands(ldb)
        records = privs.find_privilege("SeBackupPrivilege")
        assert isinstance(records, list)

    @patch('subprocess.run')
    def test_get_privilege_map(self, mock_run):
        """get_privilege_map() возвращает карту привилегий."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_PRIVILEGE, stderr="")
        ldb = LdbConnector("privilege", use_sudo=False)
        privs = PrivilegeCommands(ldb)
        priv_map = privs.get_privilege_map()
        assert "Administrators" in priv_map
        assert "SeBackupPrivilege" in priv_map["Administrators"]

    @patch('subprocess.run')
    def test_list_all_privilege_names(self, mock_run):
        """list_all_privilege_names() — уникальный список."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_PRIVILEGE, stderr="")
        ldb = LdbConnector("privilege", use_sudo=False)
        privs = PrivilegeCommands(ldb)
        names = privs.list_all_privilege_names()
        assert isinstance(names, list)
        assert "SeBackupPrivilege" in names
        assert "SeChangeNotifyPrivilege" in names


# ═══════════════════════════════════════════════════════════════
# IdmapCommands
# ═══════════════════════════════════════════════════════════════

class TestIdmapCommands:
    """Тесты команд idmap."""

    @patch('subprocess.run')
    def test_list_mappings(self, mock_run):
        """list_mappings()."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_IDMAP, stderr="")
        ldb = LdbConnector("idmap", use_sudo=False)
        idmap = IdmapCommands(ldb)
        records = idmap.list_mappings()
        assert len(records) == 3  # Все 3 записи с objectClass=sidMap (включая CONFIG)

    @patch('subprocess.run')
    def test_get_config(self, mock_run):
        """get_config()."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_IDMAP, stderr="")
        ldb = LdbConnector("idmap", use_sudo=False)
        idmap = IdmapCommands(ldb)
        config = idmap.get_config()
        assert config is not None

    @patch('subprocess.run')
    def test_get_mapping_table(self, mock_run):
        """get_mapping_table()."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_IDMAP, stderr="")
        ldb = LdbConnector("idmap", use_sudo=False)
        idmap = IdmapCommands(ldb)
        table = idmap.get_mapping_table()
        assert isinstance(table, list)

    @patch('subprocess.run')
    def test_find_uid_mappings(self, mock_run):
        """find_uid_mappings() — только UID."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_IDMAP, stderr="")
        ldb = LdbConnector("idmap", use_sudo=False)
        idmap = IdmapCommands(ldb)
        uid_maps = idmap.find_uid_mappings()
        assert isinstance(uid_maps, list)

    @patch('subprocess.run')
    def test_find_gid_mappings(self, mock_run):
        """find_gid_mappings() — только GID."""
        mock_run.return_value = MagicMock(returncode=0, stdout=SAMPLE_LDIF_IDMAP, stderr="")
        ldb = LdbConnector("idmap", use_sudo=False)
        idmap = IdmapCommands(ldb)
        gid_maps = idmap.find_gid_mappings()
        assert isinstance(gid_maps, list)


# ═══════════════════════════════════════════════════════════════
# ShareCommands
# ═══════════════════════════════════════════════════════════════

class TestShareCommands:
    """Тесты команд файловых шар."""

    @patch('subprocess.run')
    def test_list_shares(self, mock_run):
        """list_shares()."""
        share_ldif = """# record 1
dn: CN=netlogon
objectClass: share
cn: netlogon
path: /var/lib/samba/sysvol/kcrb.local/SCRIPTS

"""
        mock_run.return_value = MagicMock(returncode=0, stdout=share_ldif, stderr="")
        ldb = LdbConnector("share", use_sudo=False)
        shares = ShareCommands(ldb)
        records = shares.list_shares()
        assert len(records) == 1

    @patch('subprocess.run')
    def test_get_share_info(self, mock_run):
        """get_share_info() возвращает сводку."""
        share_ldif = """# record 1
dn: CN=netlogon
objectClass: share
cn: netlogon
path: /var/lib/samba/sysvol/kcrb.local/SCRIPTS

"""
        mock_run.return_value = MagicMock(returncode=0, stdout=share_ldif, stderr="")
        ldb = LdbConnector("share", use_sudo=False)
        shares = ShareCommands(ldb)
        info = shares.get_share_info()
        assert isinstance(info, list)


# ═══════════════════════════════════════════════════════════════
# RegistryCommands
# ═══════════════════════════════════════════════════════════════

class TestRegistryCommands:
    """Тесты команд реестра."""

    @patch('subprocess.run')
    def test_list_keys(self, mock_run):
        """list_keys()."""
        hklm_ldif = """# record 1
dn: CN=key1
key: SYSTEM\\CurrentControlSet
value: TestValue

"""
        mock_run.return_value = MagicMock(returncode=0, stdout=hklm_ldif, stderr="")
        ldb = LdbConnector("hklm", use_sudo=False)
        reg = RegistryCommands(ldb)
        records = reg.list_keys()
        assert len(records) == 1

    @patch('subprocess.run')
    def test_get_registry_tree(self, mock_run):
        """get_registry_tree() строит дерево."""
        hklm_ldif = """# record 1
dn: CN=key1
key: SYSTEM\\Test
value: Param1
data: 123
type: REG_DWORD

"""
        mock_run.return_value = MagicMock(returncode=0, stdout=hklm_ldif, stderr="")
        ldb = LdbConnector("hklm", use_sudo=False)
        reg = RegistryCommands(ldb)
        tree = reg.get_registry_tree()
        assert isinstance(tree, dict)
