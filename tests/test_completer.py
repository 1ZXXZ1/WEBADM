"""
Тесты TAB-автодополнения SDB — sdb.completer

Проверяет:
  - Автодополнение SDB команд
  - Автодополнение баз данных (USE)
  - Автодополнение форматов (FORMAT)
  - Автодополнение подкоманд samba-tool (TOOL)
  - Автодополнение опций samba-tool
  - Автодополнение LDAP атрибутов (WHERE)
  - Автодополнение путей файлов (OUTPUT, IMPORT)
"""

import pytest
from unittest.mock import MagicMock, patch

from sdb.completer import SdbCompleter, LDAP_ATTRIBUTES, OBJECT_CLASSES, DNS_RECORD_TYPES


class TestSdbCompleterInit:
    """Тесты инициализации SdbCompleter."""

    def test_default_init(self):
        """Инициализация без engine."""
        completer = SdbCompleter()
        assert completer.engine is None
        assert len(completer.sdb_commands) > 0
        assert len(completer.db_names) > 0
        assert len(completer.output_formats) > 0

    def test_init_with_engine(self):
        """Инициализация с engine."""
        engine = MagicMock()
        completer = SdbCompleter(engine=engine)
        assert completer.engine is engine

    def test_has_required_commands(self):
        """Проверка наличия всех SDB команд в комплитере."""
        completer = SdbCompleter()
        cmd_upper = [c.upper() for c in completer.sdb_commands]
        assert "USE" in cmd_upper
        assert "SELECT" in cmd_upper
        assert "TOOL" in cmd_upper
        assert "FORMAT" in cmd_upper
        assert "IMPORT" in cmd_upper
        assert "CREATE" in cmd_upper

    def test_has_database_names(self):
        """Проверка наличия всех баз данных."""
        completer = SdbCompleter()
        assert "sam" in completer.db_names
        assert "privilege" in completer.db_names
        assert "idmap" in completer.db_names
        assert "hklm" in completer.db_names
        assert "secrets" in completer.db_names
        assert "share" in completer.db_names


class TestSdbCompleterSdbCommands:
    """Тесты автодополнения SDB команд."""

    def test_complete_use(self):
        """USE → автодополнение баз данных."""
        completer = SdbCompleter()
        with patch('readline.get_line_buffer', return_value='USE '), \
             patch('readline.get_begidx', return_value=4), \
             patch('readline.get_endidx', return_value=4):
            matches = completer._get_completions('')
            assert any('sam' in m for m in matches)

    def test_complete_format(self):
        """FORMAT → автодополнение форматов."""
        completer = SdbCompleter()
        with patch('readline.get_line_buffer', return_value='FORMAT '), \
             patch('readline.get_begidx', return_value=7), \
             patch('readline.get_endidx', return_value=7):
            matches = completer._get_completions('')
            assert any('json' in m for m in matches)
            assert any('csv' in m for m in matches)
            assert any('table' in m for m in matches)

    def test_complete_show(self):
        """SHOW → автодополнение DATABASES."""
        completer = SdbCompleter()
        with patch('readline.get_line_buffer', return_value='SHOW '), \
             patch('readline.get_begidx', return_value=5), \
             patch('readline.get_endidx', return_value=5):
            matches = completer._get_completions('')
            assert any('DATABASES' in m for m in matches)


class TestSdbCompleterTool:
    """Тесты автодополнения TOOL команд."""

    def test_tool_subcommands(self):
        """TOOL → автодополнение подкоманд."""
        completer = SdbCompleter()
        with patch('readline.get_line_buffer', return_value='TOOL '), \
             patch('readline.get_begidx', return_value=5), \
             patch('readline.get_endidx', return_value=5):
            matches = completer._complete_tool('', '')
            assert any('user' in m for m in matches)
            assert any('group' in m for m in matches)
            assert any('HELP' in m for m in matches)

    def test_tool_user_actions(self):
        """TOOL user → автодополнение действий."""
        completer = SdbCompleter()
        matches = completer._complete_tool('user', '')
        assert any('list' in m for m in matches)
        assert any('create' in m for m in matches)
        assert any('delete' in m for m in matches)

    def test_tool_user_create_options(self):
        """TOOL user create → автодополнение опций."""
        completer = SdbCompleter()
        matches = completer._complete_tool('user create admin P@ssw0rd', '--')
        assert any('--given-name' in m for m in matches)
        assert any('--surname' in m for m in matches)
        assert any('--department' in m for m in matches)

    def test_tool_dns_record_types(self):
        """DNS → типы записей."""
        assert "A" in DNS_RECORD_TYPES
        assert "AAAA" in DNS_RECORD_TYPES
        assert "ALL" in DNS_RECORD_TYPES


class TestSdbCompleterWhere:
    """Тесты автодополнения WHERE."""

    def test_where_attributes(self):
        """WHERE → автодополнение LDAP атрибутов."""
        completer = SdbCompleter()
        with patch('readline.get_line_buffer', return_value='WHERE '), \
             patch('readline.get_begidx', return_value=6), \
             patch('readline.get_endidx', return_value=6):
            matches = completer._get_completions('')
            assert any('objectClass' in m for m in matches)
            assert any('sAMAccountName' in m for m in matches)

    def test_ldap_attributes_list(self):
        """Проверка наличия ключевых LDAP атрибутов."""
        assert "objectClass" in LDAP_ATTRIBUTES
        assert "cn" in LDAP_ATTRIBUTES
        assert "sAMAccountName" in LDAP_ATTRIBUTES
        assert "userAccountControl" in LDAP_ATTRIBUTES
        assert "memberOf" in LDAP_ATTRIBUTES

    def test_object_classes_list(self):
        """Проверка наличия ключевых objectClass."""
        assert "user" in OBJECT_CLASSES
        assert "group" in OBJECT_CLASSES
        assert "computer" in OBJECT_CLASSES
        assert "organizationalUnit" in OBJECT_CLASSES


class TestSdbCompleterFromList:
    """Тесты метода _complete_from_list."""

    def test_empty_prefix(self):
        """Пустой префикс — все кандидаты."""
        completer = SdbCompleter()
        matches = completer._complete_from_list("", ["sam", "privilege", "idmap"])
        assert len(matches) == 3

    def test_matching_prefix(self):
        """Совпадающий префикс."""
        completer = SdbCompleter()
        matches = completer._complete_from_list("sa", ["sam", "privilege", "idmap"])
        assert len(matches) == 1
        assert "sam" in matches[0]

    def test_case_insensitive(self):
        """Регистронезависимый поиск."""
        completer = SdbCompleter()
        matches = completer._complete_from_list("SA", ["sam", "privilege"])
        assert len(matches) == 1
        assert "sam" in matches[0]

    def test_no_match(self):
        """Нет совпадений."""
        completer = SdbCompleter()
        matches = completer._complete_from_list("xyz", ["sam", "privilege"])
        assert len(matches) == 0


class TestSdbCompleterDynamicNames:
    """Тесты динамических имён из last_records."""

    def test_no_engine(self):
        """Без engine — пустой список."""
        completer = SdbCompleter()
        assert completer.get_dynamic_names() == []

    def test_no_records(self):
        """Нет записей — пустой список."""
        engine = MagicMock()
        engine.last_records = []
        completer = SdbCompleter(engine=engine)
        assert completer.get_dynamic_names() == []

    def test_with_records(self):
        """Есть записи с sAMAccountName."""
        from sdb.parser.ldif import LdifRecord
        engine = MagicMock()
        engine.last_records = [
            LdifRecord(dn="CN=ivan,CN=Users,DC=kcrb,DC=local",
                       attrs={"sAMAccountName": ["ivan"]}),
            LdifRecord(dn="CN=maria,CN=Users,DC=kcrb,DC=local",
                       attrs={"sAMAccountName": ["maria"]}),
        ]
        completer = SdbCompleter(engine=engine)
        names = completer.get_dynamic_names()
        assert "ivan" in names
        assert "maria" in names


class TestSdbCompleterPath:
    """Тесты автодополнения путей."""

    def test_complete_path_existing_dir(self):
        """Автодополнение существующего каталога."""
        completer = SdbCompleter()
        matches = completer._complete_path("/tmp/")
        # /tmp/ существует — должны быть результаты
        assert isinstance(matches, list)

    def test_complete_path_empty(self):
        """Пустой путь — автодополнение от текущего каталога."""
        completer = SdbCompleter()
        matches = completer._complete_path("")
        assert isinstance(matches, list)


class TestSetupReadline:
    """Тесты настройки readline."""

    def test_setup_without_readline(self):
        """Если readline недоступен — не падает."""
        # На Linux readline обычно доступен
        from sdb.completer import setup_readline
        completer = SdbCompleter()
        try:
            setup_readline(completer, history_file="/tmp/.sdb_test_history")
        except ImportError:
            pass  # OK если readline недоступен
