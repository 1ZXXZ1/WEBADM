"""
Форматер DataFrame — экспорт записей LDB в pandas DataFrame.

Предоставляет удобный интерфейс для анализа данных Samba
с помощью pandas — фильтрация, группировка, агрегация,
экспорт в Excel, и т.д.

Требует установки pandas: pip3 install pandas
"""

import os
from typing import List, Optional

from sdb.parser.ldif import LdifRecord


def _check_pandas():
    """Проверить доступность pandas, выбросить понятную ошибку если нет."""
    try:
        import pandas
        return pandas
    except ImportError:
        raise ImportError(
            "pandas не установлен. Установите: pip3 install pandas  "
            "или: sudo pip3 install pandas"
        )
    except RuntimeError as _np_err:
        raise RuntimeError(
            f"pandas/NumPy import failed: {_np_err}. "
            f"Install a compatible NumPy: pip install numpy --no-binary numpy"
        )


class DataframeFormatter:
    """
    Форматер для вывода записей в виде pandas DataFrame.

    Поддерживает:
      - Прямое создание DataFrame из LdifRecord
      - Фильтрацию полей
      - Запись в CSV/Excel/JSON через pandas
      - Красивый табличный вывод в терминал
    """

    def format_records(
        self,
        records: List[LdifRecord],
        fields: Optional[List[str]] = None,
        include_dn: bool = True,
    ) -> str:
        """
        Преобразовать записи в строковое представление DataFrame.

        Args:
            records: Список LdifRecord
            fields: Список полей (None = все)
            include_dn: Включать ли DN

        Returns:
            Строка с таблицей DataFrame
        """
        pd = _check_pandas()
        df = self.to_dataframe(records, fields=fields, include_dn=include_dn)
        return df.to_string()

    def to_dataframe(
        self,
        records: List[LdifRecord],
        fields: Optional[List[str]] = None,
        include_dn: bool = True,
    ):
        """
        Преобразовать записи в pandas DataFrame.

        Args:
            records: Список LdifRecord
            fields: Список полей (None = все обнаруженные)
            include_dn: Включать ли DN

        Returns:
            pandas.DataFrame с данными
        """
        pd = _check_pandas()

        if not records:
            return pd.DataFrame()

        # Собираем плоские словари
        flat_records = [r.flatten(include_dn=include_dn) for r in records]

        # Создаём DataFrame
        df = pd.DataFrame(flat_records)

        # Фильтруем поля если нужно
        if fields and fields != ["*"]:
            available_cols = []
            for f in fields:
                # Поиск без учёта регистра
                matching = [c for c in df.columns if c.lower() == f.lower()]
                if matching:
                    available_cols.extend(matching)
            if include_dn and "dn" not in available_cols and "dn" in df.columns:
                available_cols.insert(0, "dn")
            if available_cols:
                df = df[available_cols]

        return df

    def write_to_file(
        self,
        records: List[LdifRecord],
        filepath: str,
        fields: Optional[List[str]] = None,
        include_dn: bool = True,
    ) -> str:
        """
        Записать DataFrame в файл.

        Автоматически определяет формат по расширению:
          .csv   → pandas to_csv
          .tsv   → pandas to_csv с tab
          .xlsx  → pandas to_excel (нужен openpyxl)
          .json  → pandas to_json
          .pkl   → pandas pickle

        Args:
            records: Список LdifRecord
            filepath: Путь к файлу
            fields: Список полей
            include_dn: Включать ли DN

        Returns:
            Путь к созданному файлу
        """
        pd = _check_pandas()
        df = self.to_dataframe(records, fields=fields, include_dn=include_dn)

        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)

        ext = os.path.splitext(filepath)[1].lower()

        if ext == ".csv":
            df.to_csv(filepath, index=False, encoding="utf-8")
        elif ext == ".tsv":
            df.to_csv(filepath, index=False, sep="\t", encoding="utf-8")
        elif ext == ".xlsx":
            try:
                df.to_excel(filepath, index=False, engine="openpyxl")
            except ImportError:
                raise ImportError(
                    "openpyxl не установлен. Установите: pip3 install openpyxl"
                )
        elif ext == ".json":
            df.to_json(filepath, orient="records", force_ascii=False, indent=2)
        elif ext == ".pkl":
            df.to_pickle(filepath)
        else:
            # По умолчанию — CSV
            df.to_csv(filepath, index=False, encoding="utf-8")

        return filepath
