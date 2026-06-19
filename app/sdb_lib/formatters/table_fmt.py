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
import shutil
from typing import List, Optional

from app.sdb_lib.parser.ldif import LdifRecord
from app.sdb_lib.config import TABLE_MAX_COL_WIDTH, TABLE_TRUNCATE

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

# Минимальная ширина колонки (для заголовка)
_MIN_COL_WIDTH = 4

# Максимальное количество колонок для широкого вывода.
# Если колонок больше — автоматически переключаемся на compact-режим
_MAX_COLUMNS_WIDE = 10


def _get_terminal_width() -> int:
    """Определить ширину терминала. Возвращает 200 если не удалось."""
    try:
        cols = shutil.get_terminal_size((200, 25)).columns
        return max(cols, 80)
    except Exception:
        return 200


class TableFormatter:
    """
    Форматер для вывода записей в виде красивой таблицы через tabulate.

    Поддерживает:
      - Автоматическую подгонку ширины колонок под терминал
      - Усечение длинных значений
      - Нумерацию строк
      - Различные стили таблиц (presto, grid, simple, rounded, и т.д.)
      - Автоматическое переключение в compact-режим при большом числе колонок
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

        # Определяем ширину терминала и рассчитываем max_width для колонок
        term_width = _get_terminal_width()
        n_cols = len(columns) + (1 if show_row_numbers else 0)

        # Рассчитываем доступную ширину с учётом разделителей
        # Для presto: | col1 | col2 | ... → 3 * n_cols символов на разделители
        sep_overhead = 3 * n_cols + 2  # примерно
        available_width = term_width - sep_overhead
        col_max = max(available_width // max(n_cols, 1), _MIN_COL_WIDTH)

        # Если колонок слишком много — переключаемся на compact-режим
        compact_mode = len(columns) > _MAX_COLUMNS_WIDE

        if compact_mode:
            # В compact-режиме показываем только приоритетные колонки
            columns = self._select_compact_columns(flat_records, columns, term_width)
            n_cols = len(columns) + (1 if show_row_numbers else 0)
            sep_overhead = 3 * n_cols + 2
            available_width = term_width - sep_overhead
            col_max = max(available_width // max(n_cols, 1), _MIN_COL_WIDTH)

        # Ограничиваем max_width до рассчитанного col_max
        effective_max = min(max_width, col_max)

        # Подготавливаем данные
        rows = []
        for flat_rec in flat_records:
            row = []
            for col in columns:
                value = flat_rec.get(col, "")
                value_str = str(value)
                if truncate and len(value_str) > effective_max:
                    value_str = value_str[:effective_max - 3] + "..."
                row.append(value_str)
            rows.append(row)

        # Заголовки — усекаем если длиннее effective_max
        headers = []
        for col in columns:
            h = col.upper()
            if len(h) > effective_max:
                h = h[:effective_max - 2] + ".."
            headers.append(h)

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
        total_info = f"\n\nВсего записей: {len(records)}"
        if compact_mode:
            total_info += f" (показано {len(columns)} из {_determine_all_columns(flat_records, fields, include_dn)} колонок)"
        table_str += total_info

        return table_str

    def _select_compact_columns(
        self,
        flat_records: List[dict],
        all_columns: List[str],
        term_width: int,
    ) -> List[str]:
        """Выбрать компактный набор колонок, чтобы таблица влезла в терминал."""
        # Приоритетные колонки для compact-режима
        compact_priority = [
            "dn", "sAMAccountName", "cn", "name", "objectClass",
            "displayName", "description", "ou", "mail",
            "department", "objectSid", "whenCreated",
            "userAccountControl", "memberOf", "sAMAccountType",
        ]

        selected = []
        seen = set()
        current_width = 0

        # Сначала добавляем приоритетные, если они есть в данных
        for attr in compact_priority:
            if attr in all_columns and attr not in seen:
                # Примерная ширина колонки: max(заголовок, самое длинное значение)
                col_width = self._estimate_col_width(flat_records, attr)
                if current_width + col_width + 3 < term_width:
                    selected.append(attr)
                    seen.add(attr)
                    current_width += col_width + 3

        # Потом добавляем оставшиеся, пока есть место
        for col in all_columns:
            if col not in seen:
                col_width = self._estimate_col_width(flat_records, col)
                if current_width + col_width + 3 < term_width:
                    selected.append(col)
                    seen.add(col)
                    current_width += col_width + 3

        # Если не выбрали ни одной — берём первые 6
        if not selected:
            selected = all_columns[:6]

        return selected

    def _estimate_col_width(
        self,
        flat_records: List[dict],
        col: str,
        max_sample: int = 20,
    ) -> int:
        """Оценить ширину колонки по заголовку и значениям."""
        width = len(col)  # заголовок
        for rec in flat_records[:max_sample]:
            val = str(rec.get(col, ""))
            width = max(width, min(len(val), TABLE_MAX_COL_WIDTH))
        return min(width, TABLE_MAX_COL_WIDTH)

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


def _determine_all_columns(
    flat_records: List[dict],
    fields: Optional[List[str]],
    include_dn: bool,
) -> int:
    """Подсчитать общее количество колонок."""
    seen = set()
    if include_dn:
        seen.add("dn")
    for rec in flat_records:
        for key in rec.keys():
            seen.add(key)
    return len(seen)
