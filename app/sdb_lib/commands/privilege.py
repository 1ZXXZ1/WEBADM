"""
Команды для работы с привилегиями Samba.
"""

from typing import List, Optional, Dict

from app.sdb_lib.parser.ldif import LdifRecord
from app.sdb_lib.connectors.ldb import LdbConnector


class PrivilegeCommands:
    """
    Команды для работы с привилегиями Samba AD.

    Читает данные из privilege.ldb.
    """

    def __init__(self, ldb: LdbConnector):
        self.ldb = ldb

    def list_privileges(self, attrs: Optional[List[str]] = None) -> List[LdifRecord]:
        """
        Список всех записей привилегий.

        Args:
            attrs: Атрибуты для возврата

        Returns:
            Список записей привилегий
        """
        return self.ldb.query(
            filter_expr="(objectClass=privilege)",
            attrs=attrs,
        )

    def get_privilege_by_sid(self, sid: str) -> Optional[LdifRecord]:
        """
        Получить привилегии по SID.

        Args:
            sid: SID (например S-1-5-32-544)

        Returns:
            Запись или None
        """
        records = self.ldb.query(
            filter_expr=f"(objectSid={sid})",
        )
        return records[0] if records else None

    def get_privilege_by_name(self, name: str) -> Optional[LdifRecord]:
        """
        Получить привилегии по имени комментария.

        Args:
            name: Имя (например "Administrators")

        Returns:
            Запись или None
        """
        records = self.ldb.query(
            filter_expr=f"(comment={name})",
        )
        return records[0] if records else None

    def find_privilege(self, privilege_name: str) -> List[LdifRecord]:
        """
        Найти все SID, у которых есть указанная привилегия.

        Args:
            privilege_name: Имя привилегии (например SeBackupPrivilege)

        Returns:
            Список записей
        """
        return self.ldb.query(
            filter_expr=f"(privilege={privilege_name})",
        )

    def get_privilege_map(self) -> Dict[str, List[str]]:
        """
        Получить карту: имя_группы → список привилегий.

        Returns:
            Словарь {имя_группы: [priv1, priv2, ...]}
        """
        records = self.list_privileges(attrs=["comment", "privilege", "objectSid"])
        result = {}
        for rec in records:
            name = rec.get("comment", rec.get("objectSid", "unknown"))
            privileges = rec.get_all("privilege")
            result[name] = privileges
        return result

    def list_all_privilege_names(self) -> List[str]:
        """
        Получить уникальный список всех привилегий.

        Returns:
            Отсортированный список имён привилегий
        """
        records = self.list_privileges(attrs=["privilege"])
        priv_set = set()
        for rec in records:
            for p in rec.get_all("privilege"):
                priv_set.add(p)
        return sorted(priv_set)
