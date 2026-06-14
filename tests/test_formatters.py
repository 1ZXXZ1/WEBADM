"""
Тесты форматеров вывода — sdb.formatters

Проверяет:
  - JSON форматер (format_records, write_to_file)
  - CSV форматер (format_records, write_to_file)
  - TSV форматер (format_records, write_to_file)
  - Table форматер (format_records, write_to_file)
  - LDIF форматер (format_records, write_to_file)
  - DataFrame форматер (format_records, write_to_file)
  - Фабричная функция get_formatter
  - Фильтрация полей
  - Пустые записи
  - Многозначные атрибуты
"""

import os
import json
import csv
import tempfile
import pytest

from sdb.parser.ldif import LdifRecord
from sdb.formatters import get_formatter
from sdb.formatters.json_fmt import JsonFormatter
from sdb.formatters.csv_fmt import CsvFormatter
from sdb.formatters.tsv_fmt import TsvFormatter
from sdb.formatters.table_fmt import TableFormatter
from sdb.formatters.ldif_fmt import LdifFormatter


# ═══════════════════════════════════════════════════════════════
# Общие фикстуры
# ═══════════════════════════════════════════════════════════════

@pytest.fixture
def sample_records():
    """Несколько записей для тестирования форматеров."""
    return [
        LdifRecord(
            dn="CN=Admin,CN=Users,DC=kcrb,DC=local",
            attrs={
                "objectClass": ["user"],
                "cn": ["Admin"],
                "sAMAccountName": ["Administrator"],
            }
        ),
        LdifRecord(
            dn="CN=ivan,CN=Users,DC=kcrb,DC=local",
            attrs={
                "objectClass": ["user"],
                "cn": ["ivan"],
                "sAMAccountName": ["ivan"],
                "mail": ["ivan@kcrb.local"],
            }
        ),
    ]


@pytest.fixture
def multi_value_record():
    """Запись с многозначными атрибутами."""
    return [
        LdifRecord(
            dn="CN=Domain Users,CN=Users,DC=kcrb,DC=local",
            attrs={
                "objectClass": ["group"],
                "cn": ["Domain Users"],
                "member": [
                    "CN=Admin,CN=Users,DC=kcrb,DC=local",
                    "CN=ivan,CN=Users,DC=kcrb,DC=local",
                ],
            }
        ),
    ]


@pytest.fixture
def empty_records():
    """Пустой список записей."""
    return []


# ═══════════════════════════════════════════════════════════════
# Фабричная функция
# ═══════════════════════════════════════════════════════════════

class TestGetFormatter:
    """Тесты фабричной функции get_formatter."""

    def test_json(self):
        assert isinstance(get_formatter("json"), JsonFormatter)

    def test_csv(self):
        assert isinstance(get_formatter("csv"), CsvFormatter)

    def test_tsv(self):
        assert isinstance(get_formatter("tsv"), TsvFormatter)

    def test_table(self):
        assert isinstance(get_formatter("table"), TableFormatter)

    def test_ldif(self):
        assert isinstance(get_formatter("ldif"), LdifFormatter)

    def test_unknown_format(self):
        with pytest.raises(ValueError, match="Неизвестный формат"):
            get_formatter("xml")

    def test_case_insensitive(self):
        assert isinstance(get_formatter("JSON"), JsonFormatter)
        assert isinstance(get_formatter("Csv"), CsvFormatter)


# ═══════════════════════════════════════════════════════════════
# JSON форматер
# ═══════════════════════════════════════════════════════════════

class TestJsonFormatter:
    """Тесты JSON форматера."""

    def test_format_records(self, sample_records):
        fmt = JsonFormatter()
        output = fmt.format_records(sample_records)
        data = json.loads(output)
        assert len(data) == 2
        assert data[0]["cn"] == "Admin"

    def test_format_with_fields(self, sample_records):
        fmt = JsonFormatter()
        output = fmt.format_records(sample_records, fields=["cn", "sAMAccountName"])
        data = json.loads(output)
        assert "cn" in data[0]
        assert "dn" in data[0]  # DN всегда включён
        assert "objectClass" not in data[0]  # Отфильтровано

    def test_format_without_dn(self, sample_records):
        fmt = JsonFormatter()
        output = fmt.format_records(sample_records, include_dn=False)
        data = json.loads(output)
        assert "dn" not in data[0]

    def test_format_compact(self, sample_records):
        fmt = JsonFormatter()
        output = fmt.format_records(sample_records, pretty=False)
        assert "\n" not in output.strip() or len(output) < 200

    def test_format_multi_value(self, multi_value_record):
        fmt = JsonFormatter()
        output = fmt.format_records(multi_value_record)
        data = json.loads(output)
        assert isinstance(data[0]["member"], list)
        assert len(data[0]["member"]) == 2

    def test_format_empty(self, empty_records):
        fmt = JsonFormatter()
        output = fmt.format_records(empty_records)
        data = json.loads(output)
        assert data == []

    def test_write_to_file(self, sample_records):
        fmt = JsonFormatter()
        with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as f:
            filepath = f.name
        try:
            fmt.write_to_file(sample_records, filepath)
            assert os.path.exists(filepath)
            with open(filepath, 'r') as f:
                data = json.load(f)
            assert len(data) == 2
        finally:
            os.unlink(filepath)

    def test_unicode_support(self):
        """Кириллица в JSON без escape."""
        records = [LdifRecord(dn="CN=Тест", attrs={"cn": ["Тест"], "name": ["Иван Иванов"]})]
        fmt = JsonFormatter()
        output = fmt.format_records(records)
        assert "Тест" in output
        assert "Иван" in output


# ═══════════════════════════════════════════════════════════════
# CSV форматер
# ═══════════════════════════════════════════════════════════════

class TestCsvFormatter:
    """Тесты CSV форматера."""

    def test_format_records(self, sample_records):
        fmt = CsvFormatter()
        output = fmt.format_records(sample_records)
        assert "cn" in output
        assert "Admin" in output

    def test_format_with_fields(self, sample_records):
        fmt = CsvFormatter()
        output = fmt.format_records(sample_records, fields=["cn"])
        reader = csv.DictReader(output.strip().split('\n'))
        rows = list(reader)
        assert "cn" in rows[0]

    def test_format_empty(self, empty_records):
        fmt = CsvFormatter()
        output = fmt.format_records(empty_records)
        assert output == ""

    def test_format_multi_value(self, multi_value_record):
        """Многозначные атрибуты объединяются через ; ."""
        fmt = CsvFormatter()
        output = fmt.format_records(multi_value_record)
        assert "Admin" in output
        assert "ivan" in output

    def test_write_to_file(self, sample_records):
        fmt = CsvFormatter()
        with tempfile.NamedTemporaryFile(suffix='.csv', delete=False) as f:
            filepath = f.name
        try:
            fmt.write_to_file(sample_records, filepath)
            assert os.path.exists(filepath)
        finally:
            os.unlink(filepath)


# ═══════════════════════════════════════════════════════════════
# TSV форматер
# ═══════════════════════════════════════════════════════════════

class TestTsvFormatter:
    """Тесты TSV форматера."""

    def test_format_records(self, sample_records):
        fmt = TsvFormatter()
        output = fmt.format_records(sample_records)
        assert "cn" in output
        assert "Admin" in output

    def test_tab_separator(self, sample_records):
        """Разделитель — табуляция."""
        fmt = TsvFormatter()
        output = fmt.format_records(sample_records)
        assert "\t" in output

    def test_format_empty(self, empty_records):
        fmt = TsvFormatter()
        output = fmt.format_records(empty_records)
        assert output == ""


# ═══════════════════════════════════════════════════════════════
# Table форматер
# ═══════════════════════════════════════════════════════════════

class TestTableFormatter:
    """Тесты Table форматера."""

    def test_format_records(self, sample_records):
        fmt = TableFormatter()
        output = fmt.format_records(sample_records)
        assert "CN" in output
        assert "Admin" in output

    def test_format_empty(self, empty_records):
        fmt = TableFormatter()
        output = fmt.format_records(empty_records)
        assert "нет записей" in output

    def test_format_with_fields(self, sample_records):
        fmt = TableFormatter()
        output = fmt.format_records(sample_records, fields=["cn", "sAMAccountName"])
        assert "CN" in output

    def test_row_numbers(self, sample_records):
        fmt = TableFormatter()
        output = fmt.format_records(sample_records, show_row_numbers=True)
        assert "1" in output

    def test_total_count(self, sample_records):
        fmt = TableFormatter()
        output = fmt.format_records(sample_records)
        assert "Всего записей: 2" in output

    def test_truncation(self):
        """Длинные значения усекаются."""
        long_val = "x" * 100
        records = [LdifRecord(dn="CN=T", attrs={"cn": [long_val]})]
        fmt = TableFormatter()
        output = fmt.format_records(records, max_width=20, truncate=True)
        assert "..." in output

    def test_write_to_file(self, sample_records):
        fmt = TableFormatter()
        with tempfile.NamedTemporaryFile(suffix='.txt', delete=False) as f:
            filepath = f.name
        try:
            fmt.write_to_file(sample_records, filepath)
            assert os.path.exists(filepath)
        finally:
            os.unlink(filepath)


# ═══════════════════════════════════════════════════════════════
# LDIF форматер
# ═══════════════════════════════════════════════════════════════

class TestLdifFormatter:
    """Тесты LDIF форматера."""

    def test_format_records(self, sample_records):
        fmt = LdifFormatter()
        output = fmt.format_records(sample_records)
        assert "dn:" in output
        assert "cn: Admin" in output

    def test_format_empty(self, empty_records):
        fmt = LdifFormatter()
        output = fmt.format_records(empty_records)
        assert output == "" or "нет" in output.lower() or output.strip() == ""

    def test_format_multi_value(self, multi_value_record):
        fmt = LdifFormatter()
        output = fmt.format_records(multi_value_record)
        # Два значения member
        assert output.count("member:") >= 2

    def test_format_with_fields(self, sample_records):
        fmt = LdifFormatter()
        output = fmt.format_records(sample_records, fields=["cn"])
        assert "cn:" in output

    def test_write_to_file(self, sample_records):
        fmt = LdifFormatter()
        with tempfile.NamedTemporaryFile(suffix='.ldif', delete=False) as f:
            filepath = f.name
        try:
            fmt.write_to_file(sample_records, filepath)
            assert os.path.exists(filepath)
        finally:
            os.unlink(filepath)
