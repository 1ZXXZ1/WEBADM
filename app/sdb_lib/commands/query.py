"""
Общие команды запросов — работа с любой LDB базой.
"""

from typing import List, Optional

from sdb.parser.ldif import LdifRecord
from sdb.connectors.ldb import LdbConnector


class QueryCommands:
    """
    Общие команды для запросов к любым LDB базам.

    Содержит методы для поиска, фильтрации и выборки записей.
    Работает поверх LdbConnector.
    """

    def __init__(self, connector: LdbConnector):
        self.connector = connector

    def select_all(self, attrs: Optional[List[str]] = None) -> List[LdifRecord]:
        """
        Выбрать все записи из текущей базы.

        Args:
            attrs: Список атрибутов (None = все)

        Returns:
            Список всех записей
        """
        return self.connector.list_all(attrs=attrs)

    def select_by_filter(
        self,
        filter_expr: str,
        attrs: Optional[List[str]] = None,
    ) -> List[LdifRecord]:
        """
        Выбрать записи по LDAP фильтру.

        Поддерживаемые форматы фильтров:
          - objectClass=user
          - (objectClass=user)
          - (&(objectClass=user)(sAMAccountName=admin))
          - sAMAccountType=805306368

        Args:
            filter_expr: LDAP фильтр
            attrs: Список атрибутов

        Returns:
            Список найденных записей
        """
        return self.connector.query(filter_expr=filter_expr, attrs=attrs)

    def select_by_dn(self, dn: str, attrs: Optional[List[str]] = None) -> Optional[LdifRecord]:
        """
        Получить запись по DN.

        Args:
            dn: Distinguished Name
            attrs: Список атрибутов

        Returns:
            Запись или None
        """
        return self.connector.query_by_dn(dn, attrs=attrs)

    def search(self, term: str, attrs: Optional[List[str]] = None) -> List[LdifRecord]:
        """
        Поиск по подстроке (cn, sAMAccountName, description).

        Args:
            term: Подстрока для поиска
            attrs: Список атрибутов

        Returns:
            Список найденных записей
        """
        return self.connector.search_term(term, attrs=attrs)

    def select_users(self, attrs: Optional[List[str]] = None) -> List[LdifRecord]:
        """Выбрать всех пользователей (objectClass=user, sAMAccountType=805306368)."""
        return self.connector.query(
            filter_expr="(&(objectClass=user)(sAMAccountType=805306368))",
            attrs=attrs,
        )

    def select_groups(self, attrs: Optional[List[str]] = None) -> List[LdifRecord]:
        """Выбрать все группы."""
        return self.connector.query(
            filter_expr="(objectClass=group)",
            attrs=attrs,
        )

    def select_computers(self, attrs: Optional[List[str]] = None) -> List[LdifRecord]:
        """Выбрать все компьютеры."""
        return self.connector.query(
            filter_expr="(objectClass=computer)",
            attrs=attrs,
        )

    def select_by_object_class(
        self,
        object_class: str,
        attrs: Optional[List[str]] = None,
    ) -> List[LdifRecord]:
        """
        Выбрать записи по objectClass.

        Args:
            object_class: Имя objectClass
            attrs: Список атрибутов

        Returns:
            Список записей
        """
        return self.connector.query(
            filter_expr=f"(objectClass={object_class})",
            attrs=attrs,
        )

    def count_records(self, filter_expr: str = "") -> int:
        """
        Подсчитать количество записей.

        Args:
            filter_expr: LDAP фильтр

        Returns:
            Количество записей
        """
        # Запрашиваем только DN для скорости
        records = self.connector.query(filter_expr=filter_expr, attrs=["dn"])
        return len(records)

    def filter_records(
        self,
        records: List[LdifRecord],
        field: str,
        value: str,
        case_sensitive: bool = False,
    ) -> List[LdifRecord]:
        """
        Отфильтровать записи по значению атрибута (пост-фильтрация).

        Args:
            records: Список записей
            field: Имя атрибута
            value: Значение для сравнения
            case_sensitive: С учётом регистра

        Returns:
            Отфильтрованный список
        """
        result = []
        for rec in records:
            all_values = rec.get_all(field)
            for v in all_values:
                if case_sensitive:
                    if value in v:
                        result.append(rec)
                        break
                else:
                    if value.lower() in v.lower():
                        result.append(rec)
                        break
        return result

    def select_fields(
        self,
        records: List[LdifRecord],
        fields: List[str],
    ) -> List[LdifRecord]:
        """
        Оставить только указанные атрибуты в записях.

        Args:
            records: Список записей
            fields: Список имён атрибутов

        Returns:
            Записи с отфильтрованными атрибутами
        """
        result = []
        for rec in records:
            new_attrs = {}
            for field in fields:
                if field == "dn":
                    continue
                values = rec.get_all(field)
                if values:
                    new_attrs[field] = values
            result.append(LdifRecord(dn=rec.dn, attrs=new_attrs))
        return result
