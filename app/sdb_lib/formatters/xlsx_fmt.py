"""
Форматер XLSX — экспорт записей LDB в Excel формат с поддержкой формул.

Поддерживает:
  - Многостраничные книги (разные типы объектов на разных листах)
  - Формулы Excel с вложенными функциями:
    =ЕСЛИ(И(K3="V"; ИЛИ(AP3="L"; AR3="L")); "ИСТИНА"; "ЛОЖЬ")
    =ЕСЛИ(ИЛИ(C1=""; L1=""); ""; ЕСЛИ(И(C1<>""; L1<>""); "ОК"; "Ошибка"))
    =ВПР(A2; таблица_соответствий; 2; ЛОЖЬ)
  - Авто-определение ширины колонок
  - Стилизация заголовков
  - Фильтры на заголовках
"""

import os
from typing import List, Optional, Dict, Any

# Disable numpy to avoid X86_V2 CPU compatibility errors on older hardware
# openpyxl can work without numpy for basic XLSX generation
os.environ.setdefault("OPENPYXL_USE_NUMPY", "0")
# Also prevent numpy from being imported by any dependency
os.environ.setdefault("NUMPY_EXPERIMENTAL_DTYPE_API", "0")

from app.sdb_lib.parser.ldif import LdifRecord


# ─── Предустановленные формулы ──────────────────────────────────────────

PRESET_FORMULAS = {
    # Проверка: ЕСЛИ(И(K{n}="V"; ИЛИ(AP{n}="L"; AR{n}="L")); "ИСТИНА"; "ЛОЖЬ")
    "check_vl": lambda n, col_k="K", col_ap="AP", col_ar="AR":
        f'=ЕСЛИ(И({col_k}{n}="V"; ИЛИ({col_ap}{n}="L"; {col_ar}{n}="L")); "ИСТИНА"; "ЛОЖЬ")',

    # Проверка заполненности: ЕСЛИ(ИЛИ(C{n}=""; L{n}=""); ""; ЕСЛИ(И(C{n}<>""; L{n}<>""); "ОК"; "Ошибка"))
    "check_filled": lambda n, col_c="C", col_l="L":
        f'=ЕСЛИ(ИЛИ({col_c}{n}=""; {col_l}{n}=""); ""; ЕСЛИ(И({col_c}{n}<>""; {col_l}{n}<>""); "ОК"; "Ошибка"))',

    # ВПР: =ВПР(A{n}; таблица_соответствий; 2; ЛОЖЬ)
    "vlookup": lambda n, col_a="A", table="таблица_соответствий", col_idx="2":
        f'=ВПР({col_a}{n}; {table}; {col_idx}; ЛОЖЬ)',

    # Простая проверка: =ЕСЛИ(A{n}<>""; "Да"; "Нет")
    "not_empty": lambda n, col="A":
        f'=ЕСЛИ({col}{n}<>""; "Да"; "Нет")',
}


class XlsxFormatter:
    """
    Форматер для вывода записей в Excel (.xlsx) формат.

    Поддерживает:
      - Многостраничные книги (разные типы объектов на разных листах)
      - Формулы Excel с вложенными функциями
      - Авто-определение ширины колонок
      - Стилизация заголовков (жирный шрифт, заливка)
      - Фильтры на заголовках
      - Предустановленные формулы (check_vl, check_filled, vlookup, not_empty)
    """

    def __init__(self):
        self.formula_columns: List[Dict[str, Any]] = []

    def add_formula_column(
        self,
        header: str,
        formula_preset: str = None,
        formula_template: str = None,
        formula_params: Dict[str, str] = None,
    ):
        """
        Добавить колонку с формулой Excel.

        Args:
            header: Заголовок колонки
            formula_preset: Имя предустановленной формулы (check_vl, check_filled, vlookup, not_empty)
            formula_template: Пользовательский шаблон формулы ({n} заменяется на номер строки)
            formula_params: Дополнительные параметры для предустановленной формулы
        """
        self.formula_columns.append({
            "header": header,
            "formula_preset": formula_preset,
            "formula_template": formula_template,
            "formula_params": formula_params or {},
        })

    def format_records(
        self,
        records: List[LdifRecord],
        fields: Optional[List[str]] = None,
        include_dn: bool = True,
        sheet_name: str = "Данные",
    ) -> bytes:
        """
        Преобразовать записи в XLSX формат (в памяти).

        Args:
            records: Список LdifRecord
            fields: Список полей (None = автоопределение)
            include_dn: Включать ли DN
            sheet_name: Имя листа

        Returns:
            Байты XLSX файла
        """
        try:
            import openpyxl
            from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
            from openpyxl.utils import get_column_letter
        except ImportError:
            raise ImportError(
                "Для XLSX экспорта нужна библиотека openpyxl. "
                "Установите: pip install openpyxl"
            )
        except RuntimeError as e:
            # Catch NumPy X86_V2 CPU compatibility errors
            if "X86_V2" in str(e) or "baseline optimizations" in str(e):
                # Try again with numpy disabled
                os.environ["OPENPYXL_USE_NUMPY"] = "0"
                os.environ["NUMPY_EXPERIMENTAL_DTYPE_API"] = "0"
                try:
                    import openpyxl
                    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
                    from openpyxl.utils import get_column_letter
                except ImportError:
                    raise ImportError(
                        "Для XLSX экспорта нужна библиотека openpyxl. "
                        "Установите: pip install openpyxl"
                    )
            else:
                raise

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = sheet_name[:31]  # Лимит Excel: 31 символ

        # Собираем плоские словари
        flat_records = [r.flatten(include_dn=include_dn) for r in records]

        # Определяем колонки
        columns = self._determine_columns(flat_records, fields, include_dn)

        # Добавляем колонки с формулами
        formula_col_start = len(columns)
        for fc in self.formula_columns:
            columns.append(fc["header"])

        # ─── Заголовки ──────────────────────────────────────────────
        header_font = Font(bold=True, color="FFFFFF", size=11)
        header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
        header_alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        thin_border = Border(
            left=Side(style="thin"),
            right=Side(style="thin"),
            top=Side(style="thin"),
            bottom=Side(style="thin"),
        )

        for col_idx, col_name in enumerate(columns, 1):
            cell = ws.cell(row=1, column=col_idx, value=col_name.upper())
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = header_alignment
            cell.border = thin_border

        # ─── Данные ─────────────────────────────────────────────────
        data_font = Font(size=10)
        data_alignment = Alignment(vertical="top", wrap_text=True)

        for row_idx, flat_rec in enumerate(flat_records, 2):
            for col_idx, col in enumerate(columns[:formula_col_start], 1):
                value = flat_rec.get(col, "")
                # Ограничиваем длину значения для Excel
                if isinstance(value, str) and len(value) > 32767:
                    value = value[:32767]
                cell = ws.cell(row=row_idx, column=col_idx, value=value)
                cell.font = data_font
                cell.alignment = data_alignment
                cell.border = thin_border

            # Формульные колонки
            for fc_idx, fc in enumerate(self.formula_columns):
                col_idx = formula_col_start + fc_idx + 1
                formula = self._build_formula(fc, row_idx)
                if formula:
                    cell = ws.cell(row=row_idx, column=col_idx, value=formula)
                    cell.font = data_font
                    cell.alignment = data_alignment
                    cell.border = thin_border

        # ─── Авто-ширина колонок ────────────────────────────────────
        for col_idx in range(1, len(columns) + 1):
            max_length = 0
            col_letter = get_column_letter(col_idx)
            for row in ws.iter_rows(min_row=1, max_row=min(len(flat_records) + 1, 100),
                                     min_col=col_idx, max_col=col_idx):
                for cell in row:
                    if cell.value:
                        max_length = max(max_length, len(str(cell.value)))
            adjusted_width = min(max(max_length + 2, 8), 50)
            ws.column_dimensions[col_letter].width = adjusted_width

        # ─── Фильтры на заголовках ──────────────────────────────────
        if columns:
            ws.auto_filter.ref = f"A1:{get_column_letter(len(columns))}{len(flat_records) + 1}"

        # ─── Заморозка верхней строки ───────────────────────────────
        ws.freeze_panes = "A2"

        # Сохраняем в байты
        from io import BytesIO
        output = BytesIO()
        wb.save(output)
        return output.getvalue()

    def format_records_multi_sheet(
        self,
        records_by_type: Dict[str, List[LdifRecord]],
        fields: Optional[List[str]] = None,
        include_dn: bool = True,
    ) -> bytes:
        """
        Создать XLSX книгу с несколькими листами (разные типы объектов).

        Args:
            records_by_type: Словарь {тип_объекта: [записи]}
                Пример: {"Пользователи": [rec1, rec2], "Группы": [rec3]}
            fields: Список полей
            include_dn: Включать ли DN

        Returns:
            Байты XLSX файла
        """
        try:
            import openpyxl
        except ImportError:
            raise ImportError(
                "Для XLSX экспорта нужна библиотека openpyxl. "
                "Установите: pip install openpyxl"
            )
        except RuntimeError as e:
            # Catch NumPy X86_V2 CPU compatibility errors
            if "X86_V2" in str(e) or "baseline optimizations" in str(e):
                os.environ["OPENPYXL_USE_NUMPY"] = "0"
                os.environ["NUMPY_EXPERIMENTAL_DTYPE_API"] = "0"
                try:
                    import openpyxl
                except ImportError:
                    raise ImportError(
                        "Для XLSX экспорта нужна библиотека openpyxl. "
                        "Установите: pip install openpyxl"
                    )
            else:
                raise

        wb = openpyxl.Workbook()
        # Удаляем первый пустой лист
        if "Sheet" in wb.sheetnames:
            wb.remove(wb["Sheet"])

        for sheet_name, records in records_by_type.items():
            # Формируем безопасное имя листа (макс 31 символ, без специальных символов)
            safe_name = sheet_name.replace("/", "_").replace("\\", "_").replace("*", "_")[:31]
            ws = wb.create_sheet(title=safe_name)
            self._write_sheet(ws, records, fields, include_dn)

        from io import BytesIO
        output = BytesIO()
        wb.save(output)
        return output.getvalue()

    def _write_sheet(self, ws, records: List[LdifRecord],
                     fields: Optional[List[str]] = None,
                     include_dn: bool = True):
        """Записать данные на один лист Excel."""
        try:
            from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
            from openpyxl.utils import get_column_letter
        except ImportError:
            raise ImportError("openpyxl не установлен")

        flat_records = [r.flatten(include_dn=include_dn) for r in records]
        columns = self._determine_columns(flat_records, fields, include_dn)

        # Заголовки
        header_font = Font(bold=True, color="FFFFFF", size=11)
        header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
        header_alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        thin_border = Border(
            left=Side(style="thin"),
            right=Side(style="thin"),
            top=Side(style="thin"),
            bottom=Side(style="thin"),
        )

        for col_idx, col_name in enumerate(columns, 1):
            cell = ws.cell(row=1, column=col_idx, value=col_name.upper())
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = header_alignment
            cell.border = thin_border

        # Данные
        data_font = Font(size=10)
        data_alignment = Alignment(vertical="top", wrap_text=True)

        for row_idx, flat_rec in enumerate(flat_records, 2):
            for col_idx, col in enumerate(columns, 1):
                value = flat_rec.get(col, "")
                if isinstance(value, str) and len(value) > 32767:
                    value = value[:32767]
                cell = ws.cell(row=row_idx, column=col_idx, value=value)
                cell.font = data_font
                cell.alignment = data_alignment
                cell.border = thin_border

        # Авто-ширина
        for col_idx in range(1, len(columns) + 1):
            max_length = 0
            col_letter = get_column_letter(col_idx)
            for row in ws.iter_rows(min_row=1, max_row=min(len(flat_records) + 1, 100),
                                     min_col=col_idx, max_col=col_idx):
                for cell in row:
                    if cell.value:
                        max_length = max(max_length, len(str(cell.value)))
            adjusted_width = min(max(max_length + 2, 8), 50)
            ws.column_dimensions[col_letter].width = adjusted_width

        # Фильтры
        if columns:
            ws.auto_filter.ref = f"A1:{get_column_letter(len(columns))}{len(flat_records) + 1}"

        # Заморозка
        ws.freeze_panes = "A2"

    def _build_formula(self, formula_config: Dict[str, Any], row_num: int) -> str:
        """
        Построить формулу Excel для заданной строки.

        Args:
            formula_config: Конфигурация формулы
            row_num: Номер строки (2-based, т.к. 1 = заголовки)

        Returns:
            Строка формулы Excel
        """
        preset = formula_config.get("formula_preset")
        template = formula_config.get("formula_template")
        params = formula_config.get("formula_params", {})

        if preset and preset in PRESET_FORMULAS:
            formula_fn = PRESET_FORMULAS[preset]
            try:
                return formula_fn(row_num, **params)
            except Exception:
                return ""

        if template:
            try:
                return template.replace("{n}", str(row_num))
            except Exception:
                return ""

        return ""

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

    def write_to_file(
        self,
        records: List[LdifRecord],
        filepath: str,
        fields: Optional[List[str]] = None,
        include_dn: bool = True,
        sheet_name: str = "Данные",
    ) -> str:
        """
        Записать записи в XLSX файл.

        Args:
            records: Список LdifRecord
            filepath: Путь к файлу
            fields: Список полей
            include_dn: Включать ли DN
            sheet_name: Имя листа

        Returns:
            Путь к созданному файлу
        """
        xlsx_bytes = self.format_records(records, fields, include_dn, sheet_name)

        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)

        with open(filepath, "wb") as f:
            f.write(xlsx_bytes)

        return filepath

    def write_multi_sheet_to_file(
        self,
        records_by_type: Dict[str, List[LdifRecord]],
        filepath: str,
        fields: Optional[List[str]] = None,
        include_dn: bool = True,
    ) -> str:
        """
        Записать записи в XLSX файл с несколькими листами.

        Args:
            records_by_type: Словарь {тип_объекта: [записи]}
            filepath: Путь к файлу
            fields: Список полей
            include_dn: Включать ли DN

        Returns:
            Путь к созданному файлу
        """
        xlsx_bytes = self.format_records_multi_sheet(records_by_type, fields, include_dn)

        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)

        with open(filepath, "wb") as f:
            f.write(xlsx_bytes)

        return filepath
