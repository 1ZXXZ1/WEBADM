"""
Тесты CLI интерфейса — sdb.cli

Проверяет:
  - Парсинг аргументов командной строки
  - Показ баз данных (--databases)
  - Выполнение команды (-e)
  - Выполнение скрипта из файла (-f)
  - Режим --no-sudo
  - Разбор LDIF файла (--parse-ldif)
  - Формат вывода (--format)
  - Файл вывода (-o)
"""

import sys
import os
import tempfile
import pytest
from unittest.mock import patch, MagicMock

from sdb.cli import main, _print_help


class TestCliArgParsing:
    """Тесты парсинга аргументов."""

    def test_default_args(self):
        """Аргументы по умолчанию."""
        with patch('sys.argv', ['sdb', '--no-sudo']):
            with patch('sdb.cli.SdbClient') as mock_client:
                mock_instance = MagicMock()
                mock_client.return_value = mock_instance
                # Интерактивный режим — нужно мокать input()
                with patch('builtins.input', side_effect=EOFError):
                    main()

    def test_databases_flag(self):
        """Флаг --databases."""
        with patch('sys.argv', ['sdb', '--databases', '--no-sudo']):
            with patch('sdb.cli.SdbClient') as mock_client:
                mock_instance = MagicMock()
                mock_instance.show_databases.return_value = {
                    "sam": {"path": "/var/lib/samba/private/sam.ldb", "description": "SAM", "exists": True}
                }
                mock_client.return_value = mock_instance
                main()
                mock_instance.show_databases.assert_called_once()

    def test_execute_flag(self):
        """Флаг -e."""
        with patch('sys.argv', ['sdb', '-e', 'USE sam;', '--no-sudo']):
            with patch('sdb.cli.SdbClient') as mock_client:
                mock_instance = MagicMock()
                mock_client.return_value = mock_instance
                main()
                mock_instance.run_script.assert_called_once_with('USE sam;')

    def test_file_flag(self):
        """Флаг -f."""
        script_content = "USE sam;\nFORMAT json;\n"
        with tempfile.NamedTemporaryFile(mode='w', suffix='.sdb', delete=False, encoding='utf-8') as f:
            f.write(script_content)
            filepath = f.name

        try:
            with patch('sys.argv', ['sdb', '-f', filepath, '--no-sudo']):
                with patch('sdb.cli.SdbClient') as mock_client:
                    mock_instance = MagicMock()
                    mock_client.return_value = mock_instance
                    main()
                    mock_instance.run_script_file.assert_called_once_with(filepath)
        finally:
            os.unlink(filepath)

    def test_no_sudo_flag(self):
        """Флаг --no-sudo."""
        with patch('sys.argv', ['sdb', '--no-sudo']):
            with patch('sdb.cli.SdbClient') as mock_client:
                mock_instance = MagicMock()
                mock_client.return_value = mock_instance
                with patch('builtins.input', side_effect=EOFError):
                    main()
                # Проверяем, что use_sudo=False
                call_kwargs = mock_client.call_args[1]
                assert call_kwargs['use_sudo'] is False

    def test_format_flag(self):
        """Флаг --format."""
        with patch('sys.argv', ['sdb', '--format', 'json', '--no-sudo']):
            with patch('sdb.cli.SdbClient') as mock_client:
                mock_instance = MagicMock()
                mock_client.return_value = mock_instance
                with patch('builtins.input', side_effect=EOFError):
                    main()

    def test_parse_ldif_flag(self):
        """Флаг --parse-ldif."""
        ldif_content = """# record 1
dn: CN=Test
cn: Test

"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.ldif', delete=False, encoding='utf-8') as f:
            f.write(ldif_content)
            filepath = f.name

        try:
            with patch('sys.argv', ['sdb', '--parse-ldif', filepath, '--no-sudo']):
                with patch('sdb.cli.SdbClient') as mock_client:
                    mock_instance = MagicMock()
                    mock_client.return_value = mock_instance
                    main()
        finally:
            os.unlink(filepath)


class TestCliHelp:
    """Тесты справки."""

    def test_print_help(self, capsys):
        """_print_help() выводит справку."""
        _print_help(use_sudo=True)
        captured = capsys.readouterr()
        assert "USE" in captured.out
        assert "SELECT" in captured.out
        assert "TOOL" in captured.out
        assert "FORMAT" in captured.out

    def test_print_help_no_sudo(self, capsys):
        """_print_help() без sudo — нет предупреждения."""
        _print_help(use_sudo=False)
        captured = capsys.readouterr()
        assert "ВНИМАНИЕ" not in captured.out


class TestCliFileNotFound:
    """Тесты обработки отсутствующих файлов."""

    def test_script_file_not_found(self):
        """Скрипт не найден → ошибка."""
        with patch('sys.argv', ['sdb', '-f', '/nonexistent/script.sdb', '--no-sudo']):
            with patch('sdb.cli.SdbClient'):
                with pytest.raises(SystemExit):
                    main()

    def test_ldif_file_not_found(self):
        """LDIF файл не найден → ошибка."""
        with patch('sys.argv', ['sdb', '--parse-ldif', '/nonexistent/file.ldif', '--no-sudo']):
            with patch('sdb.cli.SdbClient'):
                with pytest.raises(SystemExit):
                    main()


class TestCliOutputFlag:
    """Тесты флага -o/--output."""

    def test_output_with_parse_ldif(self):
        """--parse-ldif с -o записывает в файл."""
        ldif_content = """# record 1
dn: CN=Test
cn: Test

"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.ldif', delete=False, encoding='utf-8') as f:
            f.write(ldif_content)
            ldif_path = f.name

        with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as f:
            out_path = f.name

        try:
            with patch('sys.argv', ['sdb', '--parse-ldif', ldif_path, '--format', 'json', '-o', out_path, '--no-sudo']):
                with patch('sdb.cli.SdbClient') as mock_client:
                    mock_instance = MagicMock()
                    mock_client.return_value = mock_instance
                    main()
        finally:
            os.unlink(ldif_path)
            if os.path.exists(out_path):
                os.unlink(out_path)
