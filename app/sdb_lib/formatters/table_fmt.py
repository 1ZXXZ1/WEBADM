"""
Форматер таблиц - красивый табличный вывод через библиотеку tabulate.

Использует tabulate для профессионального табличного вывода
вместо ручного Python форматирования.

Поддерживает несколько стилей таблиц:
  - "presto" — стиль как в PrestoDB/Trino (подчёркивание, выделенные заголовки)
  - "grid" — сетка с рамками
  - "simple" — минимальный стиль
  - "rounded" — закруглённые рамки
  - "double_grid" — двойные рамки
"""

import os
from typing import List, Optional

from sdb.parser.ldif import LdifRecord
from sdb.config import TABLE_MAX_COL_WIDTH, TABLE_TRUNCATE

# Стили таблиц (выбираются через FORMAT table_presto, table_grid, и т.д.)
TABLE_STYLES = {
    "table": "presto",
    "table_presto": "presto",
    "table_grid": "grid",
    "table_simple": "simple",
    "table_rounded": "rounded_grid",
    "table_double": "double_grid",
    "table_mixed": "mixed_grid",
    "table_outline": "outline",
}


class TableFormatter:
    """
    Форматер для вывода записей в виде красивой таблицы через tabulate.

    Поддерживает:
      - Автоматическую подгонку ширины колонок
      - Усечение длинных значений
      - Нумерацию строк
      - Различные стили таблиц (presto, grid, simple, rounded, и т.д.)
    """

    def __init__(self, style: str = "presto"):
        """
        Инициализация форматера.

        Args:
            style: Стиль таблицы для tabulate (presto, grid, simple, и т.д.)
        """
        self.style = style

    def format_records(
        self,
        records: List[LdifRecord],
        fields: Optional[List[str]] = None,
        include_dn: bool = True,
        max_width: int = TABLE_MAX_COL_WIDTH,
        truncate: bool = TABLE_TRUNCATE,
        show_row_numbers: bool = True,
    ) -> str:
        """
        Преобразовать записи в таблицу через tabulate.

        Args:
            records: Список LdifRecord
            fields: Список полей (None = автоопределение)
            include_dn: Включать ли DN
            max_width: Максимальная ширина колонки
            truncate: Усекать ли длинные значения
            show_row_numbers: Показывать ли номер строки

        Returns:
            Строка с таблицей
        """
        if not records:
            return "(нет записей)"

        try:
            from tabulate import tabulate
        except ImportError:
            # Fallback на простой вывод если tabulate не установлен
            return self._format_simple(records, fields, include_dn)

        # Собираем плоские словари
        flat_records = [r.flatten(include_dn=include_dn) for r in records]

        # Определяем колонки
        columns = self._determine_columns(flat_records, fields, include_dn)

        # Подготавливаем данные
        rows = []
        for flat_rec in flat_records:
            row = []
            for col in columns:
                value = flat_rec.get(col, "")
                if truncate and len(str(value)) > max_width:
                    value = str(value)[:max_width - 3] + "..."
                row.append(value)
            rows.append(row)

        # Заголовки
        headers = [col.upper() for col in columns]

        # Выбираем стиль таблицы
        tabulate_fmt = TABLE_STYLES.get(self.style, "presto")

        # Используем tabulate
        if show_row_numbers:
            # Добавляем номер строки в начало
            numbered_rows = []
            for i, row in enumerate(rows, 1):
                numbered_rows.append([i] + row)
            numbered_headers = ["#"] + headers
            table_str = tabulate(
                numbered_rows,
                headers=numbered_headers,
                tablefmt=tabulate_fmt,
                numalign="right",
                stralign="left",
            )
        else:
            table_str = tabulate(
                rows,
                headers=headers,
                tablefmt=tabulate_fmt,
                numalign="right",
                stralign="left",
            )

        # Итоговая информация
        table_str += f"\n\nВсего записей: {len(records)}"

        return table_str

    def _determine_columns(
        self,
        flat_records: List[dict],
        fields: Optional[List[str]],
        include_dn: bool,
    ) -> List[str]:
        """Определить список колонок для вывода."""
        if fields and fields != ["*"]:
            columns = list(fields)
            if include_dn and "dn" not in columns:
                columns.insert(0, "dn")
            return columns

        columns = []
        seen = set()

        if include_dn:
            columns.append("dn")
            seen.add("dn")

        # Приоритетные атрибуты первыми
        priority_attrs = [
            "sAMAccountName", "cn", "name", "objectClass",
            "displayName", "description", "ou", "mail",
            "department", "objectSid", "whenCreated",
        ]
        for attr in priority_attrs:
            for rec in flat_records:
                if attr in rec and attr not in seen:
                    columns.append(attr)
                    seen.add(attr)
                    break

        # Потом все остальные
        for rec in flat_records:
            for key in rec.keys():
                if key not in seen:
                    columns.append(key)
                    seen.add(key)

        return columns

    def _format_simple(
        self,
        records: List[LdifRecord],
        fields: Optional[List[str]],
        include_dn: bool,
    ) -> str:
        """Простой fallback если tabulate не доступен."""
        flat_records = [r.flatten(include_dn=include_dn) for r in records]
        columns = self._determine_columns(flat_records, fields, include_dn)

        lines = []
        for rec in flat_records:
            for col in columns:
                val = rec.get(col, "")
                lines.append(f"  {col}: {val}")
            lines.append("")

        return "\n".join(lines)

    def write_to_file(
        self,
        records: List[LdifRecord],
        filepath: str,
        fields: Optional[List[str]] = None,
        include_dn: bool = True,
    ) -> str:
        """Записать таблицу в файл."""
        table_str = self.format_records(records, fields, include_dn)

        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(table_str)
            f.write("\n")

        return filepath
