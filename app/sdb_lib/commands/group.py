"""
Команды для работы с группами Samba AD.
"""

from typing import List, Optional

from sdb.parser.ldif import LdifRecord
from sdb.connectors.ldb import LdbConnector
from sdb.connectors.sambatool import SambaToolConnector


class GroupCommands:
    """
    Команды для управления группами Samba AD.
    """

    def __init__(self, ldb: LdbConnector, samba_tool: SambaToolConnector):
        self.ldb = ldb
        self.samba_tool = samba_tool

    def list_groups(self, attrs: Optional[List[str]] = None) -> List[LdifRecord]:
        """Список всех групп."""
        return self.ldb.query(
            filter_expr="(objectClass=group)",
            attrs=attrs,
        )

    def get_group(self, groupname: str, attrs: Optional[List[str]] = None) -> Optional[LdifRecord]:
        """Найти группу по sAMAccountName."""
        records = self.ldb.query(
            filter_expr=f"(sAMAccountName={groupname})",
            attrs=attrs,
        )
        return records[0] if records else None

    def get_members(self, groupname: str) -> List[LdifRecord]:
        """
        Получить членов группы.

        Args:
            groupname: Имя группы

        Returns:
            Список записей членов группы
        """
        group = self.get_group(groupname, attrs=["dn"])
        if not group:
            return []

        members = group.get_all("member")
        result = []
        for member_dn in members:
            rec = self.ldb.query_by_dn(member_dn, attrs=["cn", "sAMAccountName", "objectClass", "distinguishedName"])
            if rec:
                result.append(rec)
        return result

    def get_member_names(self, groupname: str) -> List[str]:
        """
        Получить имена членов группы (через samba-tool).

        Args:
            groupname: Имя группы

        Returns:
            Список sAMAccountName членов
        """
        result = self.samba_tool.group_listmembers(groupname)
        return result.lines if result.success else []

    def add_members(self, groupname: str, members: List[str]) -> dict:
        """Добавить членов в группу."""
        result = self.samba_tool.group_addmembers(groupname, members)
        return result.to_dict()

    def remove_members(self, groupname: str, members: List[str]) -> dict:
        """Удалить членов из группы."""
        result = self.samba_tool.group_removemembers(groupname, members)
        return result.to_dict()

    def list_names(self) -> List[str]:
        """Список имён групп (через samba-tool)."""
        result = self.samba_tool.group_list()
        return result.lines if result.success else []

    def search_groups(self, term: str, attrs: Optional[List[str]] = None) -> List[LdifRecord]:
        """Поиск групп по подстроке."""
        return self.ldb.query(
            filter_expr=f"(&(objectClass=group)(cn=*{term}*))",
            attrs=attrs,
        )

    def get_groups_for_user(self, username: str) -> List[LdifRecord]:
        """
        Получить группы, в которых состоит пользователь.

        Args:
            username: Имя пользователя

        Returns:
            Список групп
        """
        user = self.ldb.query(
            filter_expr=f"(sAMAccountName={username})",
            attrs=["dn"],
        )
        if not user:
            return []

        return self.ldb.query(
            filter_expr=f"(member={user[0].dn})",
            attrs=["cn", "sAMAccountName", "distinguishedName"],
        )
