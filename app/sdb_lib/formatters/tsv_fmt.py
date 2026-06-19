"""
Форматер TSV — экспорт записей LDB в TSV формат (табуляция как разделитель).
"""

import csv
import io
import os
from typing import List, Optional

from app.sdb_lib.parser.ldif import LdifRecord


class TsvFormatter:
    """
    Форматер для вывода записей в TSV (Tab-Separated Values).

    Тот же принцип, что и CSV, но с табуляцией в качестве разделителя.
    Удобно для вставки в Excel, LibreOffice Calc, Google Sheets.
    """

    def format_records(
        self,
        records: List[LdifRecord],
        fields: Optional[List[str]] = None,
        include_dn: bool = True,
    ) -> str:
        """
        Преобразовать записи в TSV строку.

        Args:
            records: Список LdifRecord
            fields: Список полей (None = все обнаруженные)
            include_dn: Включать ли DN

        Returns:
            TSV строка с заголовком и данными
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
            columns = []
            seen = set()
            for rec in flat_records:
                for key in rec.keys():
                    if key not in seen:
                        columns.append(key)
                        seen.add(key)

        # Пишем TSV (csv с delimiter='\t')
        output = io.StringIO()
        writer = csv.DictWriter(
            output,
            fieldnames=columns,
            extrasaction="ignore",
            delimiter="\t",
            quoting=csv.QUOTE_MINIMAL,
        )
        writer.writeheader()

        for flat_rec in flat_records:
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
        Записать записи в TSV файл.

        Args:
            records: Список LdifRecord
            filepath: Путь к файлу
            fields: Список полей
            include_dn: Включать ли DN

        Returns:
            Путь к созданному файлу
        """
        tsv_str = self.format_records(records, fields, include_dn)

        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)

        with open(filepath, "w", encoding="utf-8", newline="") as f:
            f.write(tsv_str)

        return filepath
