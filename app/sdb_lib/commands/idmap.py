"""
Команды для работы с маппингом ID (idmap.ldb).
"""

from typing import List, Optional, Dict

from app.sdb_lib.parser.ldif import LdifRecord
from app.sdb_lib.connectors.ldb import LdbConnector


class IdmapCommands:
    """
    Команды для работы с маппингом SID ↔ UID/GID.

    Читает данные из idmap.ldb.
    """

    def __init__(self, ldb: LdbConnector):
        self.ldb = ldb

    def list_mappings(self, attrs: Optional[List[str]] = None) -> List[LdifRecord]:
        """
        Список всех маппингов SID → xidNumber.

        Args:
            attrs: Атрибуты для возврата

        Returns:
            Список маппингов
        """
        return self.ldb.query(
            filter_expr="(objectClass=sidMap)",
            attrs=attrs,
        )

    def get_by_sid(self, sid: str) -> Optional[LdifRecord]:
        """
        Найти маппинг по SID.

        Args:
            sid: SID (например S-1-5-32-544)

        Returns:
            Запись маппинга или None
        """
        records = self.ldb.query(
            filter_expr=f"(objectSid={sid})",
        )
        return records[0] if records else None

    def get_by_xid(self, xid: str) -> Optional[LdifRecord]:
        """
        Найти маппинг по xidNumber (UID/GID).

        Args:
            xid: xidNumber (например 3000000)

        Returns:
            Запись маппинга или None
        """
        records = self.ldb.query(
            filter_expr=f"(xidNumber={xid})",
        )
        return records[0] if records else None

    def get_config(self) -> Optional[LdifRecord]:
        """
        Получить конфигурацию маппинга (CN=CONFIG).

        Returns:
            Запись конфигурации или None
        """
        records = self.ldb.query(
            filter_expr="(cn=CONFIG)",
        )
        return records[0] if records else None

    def get_mapping_table(self) -> List[Dict[str, str]]:
        """
        Получить таблицу маппингов SID ↔ xidNumber.

        Returns:
            Список словарей [{sid, xid, type, cn}]
        """
        records = self.list_mappings(attrs=["cn", "objectSid", "xidNumber", "type"])

        result = []
        for rec in records:
            result.append({
                "cn": rec.get("cn", ""),
                "sid": rec.get("objectSid", ""),
                "xid": rec.get("xidNumber", ""),
                "type": rec.get("type", ""),
            })
        return result

    def find_uid_mappings(self) -> List[Dict[str, str]]:
        """
        Найти все UID маппинги (type=ID_TYPE_UID или ID_TYPE_BOTH).

        Returns:
            Список UID маппингов
        """
        records = self.list_mappings(attrs=["cn", "objectSid", "xidNumber", "type"])
        result = []
        for rec in records:
            id_type = rec.get("type", "")
            if id_type in ("ID_TYPE_UID", "ID_TYPE_BOTH"):
                result.append({
                    "sid": rec.get("objectSid", ""),
                    "uid": rec.get("xidNumber", ""),
                    "type": id_type,
                })
        return result

    def find_gid_mappings(self) -> List[Dict[str, str]]:
        """
        Найти все GID маппинги (type=ID_TYPE_GID или ID_TYPE_BOTH).

        Returns:
            Список GID маппингов
        """
        records = self.list_mappings(attrs=["cn", "objectSid", "xidNumber", "type"])
        result = []
        for rec in records:
            id_type = rec.get("type", "")
            if id_type in ("ID_TYPE_GID", "ID_TYPE_BOTH"):
                result.append({
                    "sid": rec.get("objectSid", ""),
                    "gid": rec.get("xidNumber", ""),
                    "type": id_type,
                })
        return result
