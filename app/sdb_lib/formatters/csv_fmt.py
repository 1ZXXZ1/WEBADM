"""
Форматер CSV — экспорт записей LDB в CSV формат (запятая как разделитель).
"""

import csv
import io
import os
from typing import List, Optional

from sdb.parser.ldif import LdifRecord


class CsvFormatter:
    """
    Форматер для вывода записей в CSV.

    Использует стандартный модуль csv Python.
    Множественные значения атрибутов объединяются через '; '.
    """

    def format_records(
        self,
        records: List[LdifRecord],
        fields: Optional[List[str]] = None,
        include_dn: bool = True,
    ) -> str:
        """
        Преобразовать записи в CSV строку.

        Args:
            records: Список LdifRecord
            fields: Список полей (None = все обнаруженные)
            include_dn: Включать ли DN

        Returns:
            CSV строка с заголовком и данными
        """
        if not records:
            return ""

        # Собираем все записи в "плоские" словари
        flat_records = [r.flatten(include_dn=include_dn) for r in records]

        # Определяем колонки
        if fields and fields != ["*"]:
            columns = list(fields)
            if include_dn and "dn" not in columns:
                columns.insert(0, "dn")
        else:
            # Собираем все уникальные ключи из всех записей
            columns = []
            seen = set()
            for rec in flat_records:
                for key in rec.keys():
                    if key not in seen:
                        columns.append(key)
                        seen.add(key)

        # Пишем CSV
        output = io.StringIO()
        writer = csv.DictWriter(
            output,
            fieldnames=columns,
            extrasaction="ignore",
            quoting=csv.QUOTE_MINIMAL,
        )
        writer.writeheader()

        for flat_rec in flat_records:
            # Заполняем недостающие поля пустыми строками
            row = {col: flat_rec.get(col, "") for col in columns}
            writer.writerow(row)

        return output.getvalue()

    def write_to_file(
        self,
        records: List[LdifRecord],
        filepath: str,
        fields: Optional[List[str]] = None,
        include_dn: bool = True,
    ) -> str:
        """
        Записать записи в CSV файл.

        Args:
            records: Список LdifRecord
            filepath: Путь к файлу
            fields: Список полей
            include_dn: Включать ли DN

        Returns:
            Путь к созданному файлу
        """
        csv_str = self.format_records(records, fields, include_dn)

        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)

        with open(filepath, "w", encoding="utf-8", newline="") as f:
            f.write(csv_str)

        return filepath
