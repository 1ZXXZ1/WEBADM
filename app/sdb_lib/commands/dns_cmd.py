"""
Команды для работы с DNS в Samba AD.
"""

from typing import List, Optional

from app.sdb_lib.parser.ldif import LdifRecord
from app.sdb_lib.connectors.ldb import LdbConnector
from app.sdb_lib.connectors.sambatool import SambaToolConnector


class DnsCommands:
    """
    Команды для управления DNS записями Samba AD.

    Работает через ldbsearch (чтение) и samba-tool dns (управление).
    """

    def __init__(self, ldb: LdbConnector, samba_tool: SambaToolConnector):
        self.ldb = ldb
        self.samba_tool = samba_tool

    def list_dns_nodes(self, attrs: Optional[List[str]] = None) -> List[LdifRecord]:
        """
        Список всех DNS узлов (через ldbsearch по sam.ldb).

        Args:
            attrs: Атрибуты для возврата

        Returns:
            Список DNS записей
        """
        return self.ldb.query(
            filter_expr="(objectClass=dnsNode)",
            attrs=attrs,
        )

    def query_dns(
        self,
        server: str,
        zone: str,
        name: str = "@",
        record_type: str = "ALL",
    ) -> dict:
        """
        Запрос DNS записей через samba-tool.

        Args:
            server: DNS сервер (имя домена)
            zone: Зона DNS
            name: Имя записи (@ = корень зоны)
            record_type: Тип записи (ALL = все)

        Returns:
            Результат операции
        """
        result = self.samba_tool.dns_query(server, zone, name, record_type)
        return result.to_dict()

    def search_dns(self, term: str, attrs: Optional[List[str]] = None) -> List[LdifRecord]:
        """
        Поиск DNS записей по подстроке.

        Args:
            term: Подстрока для поиска
            attrs: Атрибуты

        Returns:
            Список найденных DNS записей
        """
        return self.ldb.query(
            filter_expr=f"(&(objectClass=dnsNode)(dc=*{term}*))",
            attrs=attrs,
        )
