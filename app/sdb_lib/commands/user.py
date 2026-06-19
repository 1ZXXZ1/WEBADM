"""
Команды для работы с пользователями Samba AD.
"""

from typing import List, Optional

from app.sdb_lib.parser.ldif import LdifRecord
from app.sdb_lib.connectors.ldb import LdbConnector
from app.sdb_lib.connectors.sambatool import SambaToolConnector


class UserCommands:
    """
    Команды для управления пользователями Samba AD.

    Объединяет возможности ldbsearch (чтение) и samba-tool (управление).
    """

    def __init__(self, ldb: LdbConnector, samba_tool: SambaToolConnector):
        self.ldb = ldb
        self.samba_tool = samba_tool

    # ─── Чтение (через ldbsearch) ──────────────────────────────────────────

    def list_users(self, attrs: Optional[List[str]] = None) -> List[LdifRecord]:
        """
        Список всех пользователей.

        Args:
            attrs: Атрибуты для возврата

        Returns:
            Список записей пользователей
        """
        return self.ldb.query(
            filter_expr="(&(objectClass=user)(sAMAccountType=805306368))",
            attrs=attrs,
        )

    def get_user(self, username: str, attrs: Optional[List[str]] = None) -> Optional[LdifRecord]:
        """
        Найти пользователя по sAMAccountName.

        Args:
            username: Имя пользователя (sAMAccountName)
            attrs: Атрибуты

        Returns:
            Запись пользователя или None
        """
        records = self.ldb.query(
            filter_expr=f"(sAMAccountName={username})",
            attrs=attrs,
        )
        return records[0] if records else None

    def search_users(self, term: str, attrs: Optional[List[str]] = None) -> List[LdifRecord]:
        """
        Поиск пользователей по подстроке.

        Args:
            term: Подстрока для поиска
            attrs: Атрибуты

        Returns:
            Список найденных пользователей
        """
        return self.ldb.query(
            filter_expr=f"(&(objectClass=user)(sAMAccountName=*{term}*))",
            attrs=attrs,
        )

    def get_user_groups(self, username: str) -> List[LdifRecord]:
        """
        Получить группы, в которых состоит пользователь.

        Args:
            username: Имя пользователя

        Returns:
            Список групп
        """
        user = self.get_user(username, attrs=["dn"])
        if not user:
            return []

        return self.ldb.query(
            filter_expr=f"(member={user.dn})",
            attrs=["cn", "sAMAccountName", "distinguishedName"],
        )

    def get_disabled_users(self, attrs: Optional[List[str]] = None) -> List[LdifRecord]:
        """Получить отключённых пользователей."""
        return self.ldb.query(
            filter_expr="(&(objectClass=user)(userAccountControl:1.2.840.113556.1.4.803:=2))",
            attrs=attrs,
        )

    # ─── Управление (через samba-tool) ─────────────────────────────────────

    def create(self, username: str, password: str, **kwargs) -> dict:
        """
        Создать пользователя.

        Args:
            username: Имя пользователя
            password: Пароль
            **kwargs: Дополнительные параметры

        Returns:
            Результат операции
        """
        extra = []
        if kwargs.get("surname"):
            extra.extend(["--surname", kwargs["surname"]])
        if kwargs.get("given_name"):
            extra.extend(["--given-name", kwargs["given_name"]])
        if kwargs.get("mail"):
            extra.extend(["--mail-address", kwargs["mail"]])
        if kwargs.get("department"):
            extra.extend(["--department", kwargs["department"]])
        if kwargs.get("company"):
            extra.extend(["--company", kwargs["company"]])

        result = self.samba_tool.user_create(username, password, extra_args=extra or None)
        return result.to_dict()

    def delete(self, username: str) -> dict:
        """Удалить пользователя."""
        result = self.samba_tool.user_delete(username)
        return result.to_dict()

    def disable(self, username: str) -> dict:
        """Отключить пользователя."""
        result = self.samba_tool.user_disable(username)
        return result.to_dict()

    def enable(self, username: str) -> dict:
        """Включить пользователя."""
        result = self.samba_tool.user_enable(username)
        return result.to_dict()

    def set_password(self, username: str, password: str) -> dict:
        """Установить пароль пользователя."""
        result = self.samba_tool.user_setpassword(username, password)
        return result.to_dict()

    def list_names(self) -> List[str]:
        """
        Получить список имён пользователей (через samba-tool).

        Returns:
            Список sAMAccountName
        """
        result = self.samba_tool.user_list()
        return result.lines if result.success else []
