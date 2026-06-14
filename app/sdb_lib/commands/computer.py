"""
Команды для работы с компьютерами Samba AD.
"""

from typing import List, Optional

from sdb.parser.ldif import LdifRecord
from sdb.connectors.ldb import LdbConnector
from sdb.connectors.sambatool import SambaToolConnector


class ComputerCommands:
    """
    Команды для управления компьютерами Samba AD.
    """

    def __init__(self, ldb: LdbConnector, samba_tool: SambaToolConnector):
        self.ldb = ldb
        self.samba_tool = samba_tool

    def list_computers(self, attrs: Optional[List[str]] = None) -> List[LdifRecord]:
        """Список всех компьютеров."""
        return self.ldb.query(
            filter_expr="(objectClass=computer)",
            attrs=attrs,
        )

    def get_computer(self, computername: str, attrs: Optional[List[str]] = None) -> Optional[LdifRecord]:
        """Найти компьютер по sAMAccountName."""
        records = self.ldb.query(
            filter_expr=f"(sAMAccountName={computername}$)",
            attrs=attrs,
        )
        return records[0] if records else None

    def list_names(self) -> List[str]:
        """Список имён компьютеров (через samba-tool)."""
        result = self.samba_tool.computer_list()
        return result.lines if result.success else []

    def search_computers(self, term: str, attrs: Optional[List[str]] = None) -> List[LdifRecord]:
        """Поиск компьютеров по подстроке."""
        return self.ldb.query(
            filter_expr=f"(&(objectClass=computer)(cn=*{term}*))",
            attrs=attrs,
        )
