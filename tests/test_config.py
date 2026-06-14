"""
Тесты конфигурации SDB — sdb.config

Проверяет:
  - Карта LDB_DATABASES (пути к базам)
  - Регистронезависимый поиск баз данных (get_ldb_path)
  - list_databases()
  - Описания баз данных
  - Пути samba-tool и ldbsearch
  - Форматы вывода
"""

import os
import pytest

from sdb.config import (
    LDB_DATABASES,
    LDB_DESCRIPTIONS,
    SAMBA_TOOL_SUBCOMMANDS,
    SAMBA_TOOL_HELP,
    OUTPUT_FORMATS,
    DEFAULT_FORMAT,
    TABLE_MAX_COL_WIDTH,
    get_ldb_path,
    list_databases,
)


class TestLdbDatabases:
    """Тесты карты баз данных."""

    def test_sam_exists(self):
        """База sam есть в карте."""
        assert "sam" in LDB_DATABASES

    def test_privilege_exists(self):
        """База privilege есть в карте."""
        assert "privilege" in LDB_DATABASES

    def test_idmap_exists(self):
        """База idmap есть в карте."""
        assert "idmap" in LDB_DATABASES

    def test_hklm_exists(self):
        """База hklm есть в карте."""
        assert "hklm" in LDB_DATABASES

    def test_secrets_exists(self):
        """База secrets есть в карте."""
        assert "secrets" in LDB_DATABASES

    def test_share_exists(self):
        """База share есть в карте."""
        assert "share" in LDB_DATABASES

    def test_all_six_databases(self):
        """Всего 6 баз данных."""
        assert len(LDB_DATABASES) == 6

    def test_sam_path(self):
        """Путь к sam.ldb корректный."""
        assert LDB_DATABASES["sam"] == "/var/lib/samba/private/sam.ldb"

    def test_all_paths_end_with_ldb(self):
        """Все пути заканчиваются на .ldb."""
        for name, path in LDB_DATABASES.items():
            assert path.endswith(".ldb"), f"Путь к {name} не заканчивается на .ldb: {path}"

    def test_all_paths_in_private_dir(self):
        """Все пути внутри /var/lib/samba/private/."""
        for name, path in LDB_DATABASES.items():
            assert path.startswith("/var/lib/samba/private/"), f"Путь к {name} вне private: {path}"


class TestLdbDescriptions:
    """Тесты описаний баз данных."""

    def test_all_dbs_have_descriptions(self):
        """У каждой базы есть описание."""
        for name in LDB_DATABASES:
            assert name in LDB_DESCRIPTIONS, f"Нет описания для {name}"

    def test_descriptions_non_empty(self):
        """Описания не пустые."""
        for name, desc in LDB_DESCRIPTIONS.items():
            assert len(desc) > 0, f"Пустое описание для {name}"


class TestGetLdbPath:
    """Тесты функции get_ldb_path()."""

    def test_sam_lowercase(self):
        """sam → полный путь."""
        path = get_ldb_path("sam")
        assert path == "/var/lib/samba/private/sam.ldb"

    def test_sam_uppercase(self):
        """SAM → тот же путь (регистронезависимо)."""
        path = get_ldb_path("SAM")
        assert path == "/var/lib/samba/private/sam.ldb"

    def test_sam_mixed_case(self):
        """Sam → тот же путь."""
        path = get_ldb_path("Sam")
        assert path == "/var/lib/samba/private/sam.ldb"

    def test_unknown_db_raises(self):
        """Неизвестная база → ValueError."""
        with pytest.raises(ValueError, match="Неизвестная база данных"):
            get_ldb_path("nonexistent")

    def test_custom_ldb_path(self):
        """Полный путь к .ldb файлу возвращается как есть."""
        custom = "/custom/path/test.ldb"
        path = get_ldb_path(custom)
        assert path == os.path.abspath(custom)

    def test_path_with_slash(self):
        """Путь с / — считается пользовательским."""
        path = get_ldb_path("/var/lib/samba/private/sam.ldb")
        assert path == "/var/lib/samba/private/sam.ldb"

    def test_all_known_dbs(self):
        """Все известные короткие имена работают."""
        for name in LDB_DATABASES:
            path = get_ldb_path(name)
            assert path == LDB_DATABASES[name]


class TestListDatabases:
    """Тесты функции list_databases()."""

    def test_returns_dict(self):
        """Возвращает словарь."""
        dbs = list_databases()
        assert isinstance(dbs, dict)

    def test_all_dbs_present(self):
        """Все базы присутствуют в результате."""
        dbs = list_databases()
        for name in LDB_DATABASES:
            assert name in dbs

    def test_entry_has_required_fields(self):
        """Каждая запись содержит path, description, exists."""
        dbs = list_databases()
        for name, info in dbs.items():
            assert "path" in info
            assert "description" in info
            assert "exists" in info

    def test_exists_is_bool(self):
        """Поле exists — булево."""
        dbs = list_databases()
        for name, info in dbs.items():
            assert isinstance(info["exists"], bool)


class TestSambaToolConfig:
    """Тесты конфигурации samba-tool."""

    def test_subcommands_list(self):
        """Список подкоманд не пуст."""
        assert len(SAMBA_TOOL_SUBCOMMANDS) > 0

    def test_key_subcommands_present(self):
        """Ключевые подкоманды присутствуют."""
        for subcmd in ["user", "group", "computer", "dns", "ou", "gpo", "domain", "fsmo"]:
            assert subcmd in SAMBA_TOOL_SUBCOMMANDS

    def test_help_map_structure(self):
        """Карта справки имеет структуру desc + subcmds."""
        for subcmd, info in SAMBA_TOOL_HELP.items():
            assert "desc" in info
            assert "subcmds" in info

    def test_user_help_subcmds(self):
        """Справка user содержит list, create, delete."""
        user_help = SAMBA_TOOL_HELP["user"]
        for sub in ["list", "create", "delete", "disable", "enable"]:
            assert sub in user_help["subcmds"]

    def test_dns_help_subcmds(self):
        """Справка dns содержит query, add, delete."""
        dns_help = SAMBA_TOOL_HELP["dns"]
        for sub in ["query", "add", "delete"]:
            assert sub in dns_help["subcmds"]


class TestOutputFormats:
    """Тесты конфигурации форматов вывода."""

    def test_formats_list(self):
        """Список форматов содержит все ожидаемые."""
        for fmt in ["json", "csv", "tsv", "table", "ldif", "dataframe"]:
            assert fmt in OUTPUT_FORMATS

    def test_default_format(self):
        """Формат по умолчанию — table."""
        assert DEFAULT_FORMAT == "table"

    def test_table_max_col_width(self):
        """Максимальная ширина колонки — число."""
        assert isinstance(TABLE_MAX_COL_WIDTH, int)
        assert TABLE_MAX_COL_WIDTH > 0
