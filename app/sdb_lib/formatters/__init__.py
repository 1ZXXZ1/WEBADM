"""
Форматеры вывода для SDB - JSON, CSV, TSV, таблица, LDIF, DataFrame, XLSX.
"""

from sdb.formatters.json_fmt import JsonFormatter
from sdb.formatters.csv_fmt import CsvFormatter
from sdb.formatters.tsv_fmt import TsvFormatter
from sdb.formatters.table_fmt import TableFormatter, TABLE_STYLES
from sdb.formatters.ldif_fmt import LdifFormatter

FORMATTERS = {
    "json": JsonFormatter,
    "csv": CsvFormatter,
    "tsv": TsvFormatter,
    "table": TableFormatter,
    "ldif": LdifFormatter,
}


def get_formatter(fmt: str):
    """
    Получить форматер по имени.

    Поддерживаемые форматы:
      - json:     JSON формат
      - csv:      CSV (запятая как разделитель)
      - tsv:      TSV (табуляция как разделитель)
      - table:    Красивая таблица для терминала (через tabulate, стиль presto)
      - table_presto:   Таблица в стиле PrestoDB/Trino
      - table_grid:     Таблица с сеткой
      - table_simple:   Минимальная таблица
      - table_rounded:  Таблица с закруглёнными рамками
      - table_double:   Таблица с двойными рамками
      - ldif:     LDIF формат (обратный экспорт)
      - dataframe: pandas DataFrame (требует pandas)
      - xlsx:     Excel XLSX формат (требует openpyxl)

    Args:
        fmt: Имя формата

    Returns:
        Экземпляр форматера
    """
    fmt_lower = fmt.lower()

    # DataFrame - загружаем лениво
    if fmt_lower == "dataframe":
        from sdb.formatters.dataframe_fmt import DataframeFormatter
        return DataframeFormatter()

    # XLSX - загружаем лениво
    if fmt_lower == "xlsx":
        from sdb.formatters.xlsx_fmt import XlsxFormatter
        return XlsxFormatter()

    # Проверяем стиль таблицы (table_presto, table_grid, и т.д.)
    if fmt_lower in TABLE_STYLES:
        style = TABLE_STYLES[fmt_lower]
        return TableFormatter(style=style)

    if fmt_lower not in FORMATTERS:
        available = ", ".join(
            list(FORMATTERS.keys()) + ["dataframe", "xlsx"] + list(TABLE_STYLES.keys())
        )
        raise ValueError(f"Неизвестный формат '{fmt}'. Доступные: {available}")
    return FORMATTERS[fmt_lower]()


__all__ = [
    "JsonFormatter", "CsvFormatter", "TsvFormatter",
    "TableFormatter", "LdifFormatter", "XlsxFormatter",
    "FORMATTERS", "get_formatter", "TABLE_STYLES",
]
