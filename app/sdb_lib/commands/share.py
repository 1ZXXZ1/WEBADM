"""
Команды для работы с файловыми шарами Samba.
"""

from typing import List, Optional

from sdb.parser.ldif import LdifRecord
from sdb.connectors.ldb import LdbConnector


class ShareCommands:
    """
    Команды для работы с файловыми шарами Samba.

    Читает данные из share.ldb.
    """

    def __init__(self, ldb: LdbConnector):
        self.ldb = ldb

    def list_shares(self, attrs: Optional[List[str]] = None) -> List[LdifRecord]:
        """
        Список всех файловых шар.

        Args:
            attrs: Атрибуты для возврата

        Returns:
            Список шар
        """
        return self.ldb.query(
            filter_expr="(objectClass=share)",
            attrs=attrs,
        )

    def get_share(self, sharename: str, attrs: Optional[List[str]] = None) -> Optional[LdifRecord]:
        """
        Найти шару по имени.

        Args:
            sharename: Имя шары
            attrs: Атрибуты

        Returns:
            Запись шары или None
        """
        records = self.ldb.query(
            filter_expr=f"(&(objectClass=share)(cn={sharename}))",
            attrs=attrs,
        )
        return records[0] if records else None

    def get_share_info(self) -> List[dict]:
        """
        Получить сводную информацию о всех шарах.

        Returns:
            Список словарей с информацией о шарах
        """
        records = self.list_shares(attrs=["cn", "name", "path", "comment", "type", "readonly", "browseable", "available"])

        result = []
        for rec in records:
            result.append({
                "name": rec.get("name", rec.get("cn", "")),
                "path": rec.get("path", ""),
                "comment": rec.get("comment", ""),
                "type": rec.get("type", ""),
                "readonly": rec.get("readonly", ""),
                "browseable": rec.get("browseable", ""),
                "available": rec.get("available", ""),
            })
        return result
