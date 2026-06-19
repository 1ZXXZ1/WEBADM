"""
SdbClient - главный класс для работы с базами Samba LDB.

Объединяет все коннекторы, парсеры и форматеры в единый интерфейс.
Поддерживает sudo для доступа к LDB файлам Samba.
"""

import os
from typing import List, Optional, Dict, Any

from app.sdb_lib.config import get_ldb_path, list_databases, LDB_DATABASES, SQL_TABLES
from app.sdb_lib.parser.ldif import LdifRecord, parse_ldif_string, parse_ldif_file
from app.sdb_lib.parser.script import ScriptParser, ScriptCommand, CommandType
from app.sdb_lib.connectors.ldb import LdbConnector
from app.sdb_lib.connectors.sambatool import SambaToolConnector
from app.sdb_lib.formatters import get_formatter
from app.sdb_lib.commands.query import QueryCommands
from app.sdb_lib.commands.user import UserCommands
from app.sdb_lib.commands.group import GroupCommands
from app.sdb_lib.commands.computer import ComputerCommands
from app.sdb_lib.commands.dns_cmd import DnsCommands
from app.sdb_lib.commands.share import ShareCommands
from app.sdb_lib.commands.privilege import PrivilegeCommands
from app.sdb_lib.commands.registry import RegistryCommands
from app.sdb_lib.commands.idmap import IdmapCommands
from app.sdb_lib.script_engine import ScriptEngine


class SdbClient:
    """
    Главный клиент для работы с базами Samba LDB.

    Предоставляет высокоуровневый API для:
      - Запросов к LDB базам (ldbsearch)
      - Управления AD (samba-tool)
      - Выполнения скриптов SDB
      - Экспорта в JSON, CSV, TSV, таблицу, DataFrame, XLSX

    По умолчанию использует sudo для доступа к LDB файлам,
    так как они обычно доступны только root.
    """

    def __init__(self, default_database: str = "sam", use_sudo: bool = True):
        self.use_sudo = use_sudo

        # Коннекторы
        self.ldb = LdbConnector(database=default_database, use_sudo=use_sudo)
        self.samba_tool = SambaToolConnector(use_sudo=use_sudo)

        # Команды
        self.queries = QueryCommands(self.ldb)
        self.users = UserCommands(self.ldb, self.samba_tool)
        self.groups = GroupCommands(self.ldb, self.samba_tool)
        self.computers = ComputerCommands(self.ldb, self.samba_tool)
        self.dns = DnsCommands(self.ldb, self.samba_tool)

        # Базы, требующие отдельный коннектор
        self._share_ldb = None
        self._privilege_ldb = None
        self._hklm_ldb = None
        self._idmap_ldb = None
        self._secrets_ldb = None

        # Движок скриптов
        self._engine = ScriptEngine(self)

        # Текущее состояние
        self._current_database = default_database
        self._current_format = "table"
        self._current_output = None
        self._current_fields = None
        self._current_limit = 0

        # Кэш имён из БД для автодополнения
        self._names_cache = {
            "user": None,
            "group": None,
            "computer": None,
            "ou": None,
            "gpo": None,
            "contact": None,
            "dns": None,
        }

    def clear_names_cache(self, obj_type: str = None):
        """Сбросить кэш имён (чтобы обновить из БД)."""
        if obj_type:
            self._names_cache[obj_type] = None
        else:
            for k in self._names_cache:
                self._names_cache[k] = None

    def get_names_from_db(self, obj_type: str) -> List[str]:
        """
        Получить имена объектов из БД (через ldbsearch).

        Кэширует результат до явного сброса.

        Args:
            obj_type: Тип объекта ('user', 'group', 'computer', 'ou', 'gpo', 'dns', 'contact')

        Returns:
            Список имён (sAMAccountName, cn, displayName, ou, dc)
        """
        if self._names_cache.get(obj_type):
            return self._names_cache[obj_type]

        try:
            if obj_type == "user":
                records = self.ldb.query(
                    filter_expr="(&(objectClass=user)(sAMAccountType=805306368))",
                    attrs=["sAMAccountName"],
                )
                names = sorted([r.get("sAMAccountName", "") for r in records if r.get("sAMAccountName")])
            elif obj_type == "group":
                records = self.ldb.query(
                    filter_expr="(objectClass=group)",
                    attrs=["sAMAccountName"],
                )
                names = sorted([r.get("sAMAccountName", "") for r in records if r.get("sAMAccountName")])
            elif obj_type == "computer":
                records = self.ldb.query(
                    filter_expr="(objectClass=computer)",
                    attrs=["sAMAccountName"],
                )
                names = sorted([r.get("sAMAccountName", "").rstrip("$") for r in records if r.get("sAMAccountName")])
            elif obj_type == "ou":
                records = self.ldb.query(
                    filter_expr="(objectClass=organizationalUnit)",
                    attrs=["ou", "dn"],
                )
                names = sorted([r.get("ou", r.dn) for r in records if r.get("ou") or r.dn])
            elif obj_type == "gpo":
                records = self.ldb.query(
                    filter_expr="(objectClass=groupPolicyContainer)",
                    attrs=["cn", "displayName"],
                )
                names = sorted([r.get("displayName", r.get("cn", "")) for r in records if r.get("displayName") or r.get("cn")])
            elif obj_type == "dns":
                records = self.ldb.query(
                    filter_expr="(objectClass=dnsNode)",
                    attrs=["dc"],
                )
                names = sorted(set([r.get("dc", "") for r in records if r.get("dc")]))
            elif obj_type == "contact":
                records = self.ldb.query(
                    filter_expr="(objectClass=contact)",
                    attrs=["cn"],
                )
                names = sorted([r.get("cn", "") for r in records if r.get("cn")])
            else:
                names = []

            self._names_cache[obj_type] = names
            return names
        except Exception:
            return []

    # ─── Управление базами данных ──────────────────────────────────────────

    def use_database(self, database: str) -> str:
        """Переключиться на другую базу данных."""
        self._current_database = database
        path = self.ldb.use_database(database)

        # Обновляем специфичные коннекторы
        if database == "share":
            if self._share_ldb is None:
                self._share_ldb = LdbConnector("share", use_sudo=self.use_sudo)
            self.shares = ShareCommands(self._share_ldb)
        elif database == "privilege":
            if self._privilege_ldb is None:
                self._privilege_ldb = LdbConnector("privilege", use_sudo=self.use_sudo)
            self.privileges = PrivilegeCommands(self._privilege_ldb)
        elif database == "hklm":
            if self._hklm_ldb is None:
                self._hklm_ldb = LdbConnector("hklm", use_sudo=self.use_sudo)
            self.registry = RegistryCommands(self._hklm_ldb)
        elif database == "idmap":
            if self._idmap_ldb is None:
                self._idmap_ldb = LdbConnector("idmap", use_sudo=self.use_sudo)
            self.idmap = IdmapCommands(self._idmap_ldb)

        return path

    def show_databases(self) -> Dict[str, Dict]:
        """Показать все доступные базы данных."""
        return list_databases()

    # ─── Запросы ───────────────────────────────────────────────────────────

    def query(
        self,
        database: str = None,
        filter_expr: str = "",
        attrs: Optional[List[str]] = None,
        base_dn: Optional[str] = None,
    ) -> List[LdifRecord]:
        """Выполнить запрос к LDB базе."""
        if database:
            connector = LdbConnector(database, use_sudo=self.use_sudo)
        else:
            connector = self.ldb

        return connector.query(
            filter_expr=filter_expr,
            attrs=attrs,
            base_dn=base_dn,
        )

    def search(self, term: str, database: str = None) -> List[LdifRecord]:
        """Поиск подстроки."""
        if database:
            connector = LdbConnector(database, use_sudo=self.use_sudo)
        else:
            connector = self.ldb

        return connector.search_term(term)

    # ─── Форматирование и вывод ────────────────────────────────────────────

    def format_output(
        self,
        records: List[LdifRecord],
        fmt: str = None,
        fields: Optional[List[str]] = None,
        include_dn: bool = True,
    ) -> str:
        """Отформатировать записи в строку."""
        fmt = fmt or self._current_format

        # XLSX формат не поддерживает форматирование в строку
        if fmt == "xlsx":
            return f"(XLSX формат: {len(records)} записей. Используйте OUTPUT file.xlsx для записи в файл)"

        formatter = get_formatter(fmt)
        return formatter.format_records(records, fields=fields, include_dn=include_dn)

    def write_output(
        self,
        records: List[LdifRecord],
        filepath: str,
        fmt: str = None,
        fields: Optional[List[str]] = None,
        include_dn: bool = True,
    ) -> str:
        """Записать записи в файл."""
        fmt = fmt or self._current_format

        # Авто-определение формата по расширению
        ext = os.path.splitext(filepath)[1].lower()
        if ext == ".xlsx":
            fmt = "xlsx"
        elif ext == ".json":
            fmt = "json"
        elif ext == ".csv":
            fmt = "csv"
        elif ext == ".tsv":
            fmt = "tsv"
        elif ext == ".ldif":
            fmt = "ldif"

        formatter = get_formatter(fmt)
        return formatter.write_to_file(records, filepath, fields=fields, include_dn=include_dn)

    # ─── pandas DataFrame ──────────────────────────────────────────────────

    def to_dataframe(
        self,
        records: List[LdifRecord] = None,
        fields: Optional[List[str]] = None,
        include_dn: bool = True,
    ):
        """Преобразовать записи в pandas DataFrame."""
        from app.sdb_lib.formatters.dataframe_fmt import DataframeFormatter

        if records is None:
            records = self._engine.last_records

        df_formatter = DataframeFormatter()
        return df_formatter.to_dataframe(records, fields=fields, include_dn=include_dn)

    # ─── Parsing LDIF файлов ───────────────────────────────────────────────

    def parse_ldif(self, text: str) -> List[LdifRecord]:
        """Разобрать LDIF из строки."""
        return parse_ldif_string(text)

    def parse_ldif_file(self, filepath: str) -> List[LdifRecord]:
        """Разобрать LDIF из файла."""
        return parse_ldif_file(filepath)

    # ─── Скрипты ───────────────────────────────────────────────────────────

    def run_script(self, script_text: str) -> Any:
        """Выполнить скрипт SDB."""
        return self._engine.execute(script_text)

    def run_script_file(self, filepath: str) -> Any:
        """Выполнить скрипт SDB из файла."""
        return self._engine.execute_file(filepath)

    # ─── Ленивая инициализация специфичных команд ──────────────────────────

    @property
    def shares(self) -> ShareCommands:
        """Команды для работы с шарами."""
        if self._share_ldb is None:
            self._share_ldb = LdbConnector("share", use_sudo=self.use_sudo)
        return ShareCommands(self._share_ldb)

    @shares.setter
    def shares(self, value):
        pass

    @property
    def privileges(self) -> PrivilegeCommands:
        """Команды для работы с привилегиями."""
        if self._privilege_ldb is None:
            self._privilege_ldb = LdbConnector("privilege", use_sudo=self.use_sudo)
        return PrivilegeCommands(self._privilege_ldb)

    @privileges.setter
    def privileges(self, value):
        pass

    @property
    def registry(self) -> RegistryCommands:
        """Команды для работы с реестром."""
        if self._hklm_ldb is None:
            self._hklm_ldb = LdbConnector("hklm", use_sudo=self.use_sudo)
        return RegistryCommands(self._hklm_ldb)

    @registry.setter
    def registry(self, value):
        pass

    @property
    def idmap(self) -> IdmapCommands:
        """Команды для работы с маппингом ID."""
        if self._idmap_ldb is None:
            self._idmap_ldb = LdbConnector("idmap", use_sudo=self.use_sudo)
        return IdmapCommands(self._idmap_ldb)

    @idmap.setter
    def idmap(self, value):
        pass
