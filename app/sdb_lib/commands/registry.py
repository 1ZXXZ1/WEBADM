"""
Команды для работы с реестром Samba (hklm.ldb).
"""

from typing import List, Optional, Dict

from app.sdb_lib.parser.ldif import LdifRecord
from app.sdb_lib.connectors.ldb import LdbConnector


class RegistryCommands:
    """
    Команды для работы с реестром HKEY_LOCAL_MACHINE Samba.

    Читает данные из hklm.ldb.
    """

    def __init__(self, ldb: LdbConnector):
        self.ldb = ldb

    def list_keys(self, attrs: Optional[List[str]] = None) -> List[LdifRecord]:
        """
        Список всех ключей реестра.

        Args:
            attrs: Атрибуты для возврата

        Returns:
            Список ключей реестра
        """
        return self.ldb.list_all(attrs=attrs)

    def list_values(self, attrs: Optional[List[str]] = None) -> List[LdifRecord]:
        """
        Список всех значений реестра (записи с атрибутом 'value').

        Args:
            attrs: Атрибуты

        Returns:
            Список значений реестра
        """
        return self.ldb.query(
            filter_expr="(value=*)",
            attrs=attrs,
        )

    def get_key(self, key_path: str, attrs: Optional[List[str]] = None) -> Optional[LdifRecord]:
        """
        Получить ключ реестра по пути.

        Args:
            key_path: Путь к ключу (например "key=SYSTEM,hive=NONE")
            attrs: Атрибуты

        Returns:
            Запись или None
        """
        records = self.ldb.query(
            filter_expr=f"(key={key_path})",
            attrs=attrs,
        )
        return records[0] if records else None

    def search_keys(self, term: str, attrs: Optional[List[str]] = None) -> List[LdifRecord]:
        """
        Поиск ключей реестра по подстроке.

        Args:
            term: Подстрока
            attrs: Атрибуты

        Returns:
            Список найденных ключей
        """
        return self.ldb.search_term(term, attrs=attrs)

    def get_registry_tree(self) -> Dict[str, Dict]:
        """
        Построить дерево реестра из LDIF записей.

        Returns:
            Иерархический словарь структуры реестра
        """
        records = self.list_keys(attrs=["key", "value", "data", "type", "distinguishedName"])

        tree = {}
        for rec in records:
            dn = rec.dn
            key = rec.get("key", "")
            value_name = rec.get("value", "")
            data = rec.get("data", "")
            reg_type = rec.get("type", "")

            if value_name:
                # Это значение ключа
                if key not in tree:
                    tree[key] = {"values": {}}
                tree[key]["values"][value_name] = {
                    "data": data,
                    "type": reg_type,
                    "dn": dn,
                }
            else:
                # Это ключ
                if key not in tree:
                    tree[key] = {"values": {}}
                tree[key]["dn"] = dn

        return tree
