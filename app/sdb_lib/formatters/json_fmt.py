"""
Форматер JSON — экспорт записей LDB в JSON формат.
"""

import json
import os
from typing import List, Optional, Any

from sdb.parser.ldif import LdifRecord


class JsonFormatter:
    """
    Форматер для вывода записей в JSON.

    Поддерживает:
      - Pretty-print (с отступами) для чтения человеком
      - Compact (без отступов) для передачи данных
      - Запись в файл или возврат строки
    """

    def format_records(
        self,
        records: List[LdifRecord],
        fields: Optional[List[str]] = None,
        pretty: bool = True,
        include_dn: bool = True,
    ) -> str:
        """
        Преобразовать записи в JSON строку.

        Args:
            records: Список LdifRecord
            fields: Список полей для включения (None = все)
            pretty: Форматировать с отступами
            include_dn: Включать ли DN

        Returns:
            JSON строка
        """
        data = self._records_to_dicts(records, fields, include_dn)

        indent = 2 if pretty else None
        ensure_ascii = False  # Для корректного отображения кириллицы

        return json.dumps(data, indent=indent, ensure_ascii=ensure_ascii, default=str)

    def format_record(
        self,
        record: LdifRecord,
        fields: Optional[List[str]] = None,
        pretty: bool = True,
        include_dn: bool = True,
    ) -> str:
        """
        Преобразовать одну запись в JSON строку.

        Args:
            record: LdifRecord
            fields: Список полей
            pretty: Форматировать с отступами
            include_dn: Включать ли DN

        Returns:
            JSON строка
        """
        return self.format_records([record], fields, pretty, include_dn)

    def write_to_file(
        self,
        records: List[LdifRecord],
        filepath: str,
        fields: Optional[List[str]] = None,
        pretty: bool = True,
        include_dn: bool = True,
    ) -> str:
        """
        Записать записи в JSON файл.

        Args:
            records: Список LdifRecord
            filepath: Путь к файлу
            fields: Список полей
            pretty: Форматировать с отступами
            include_dn: Включать ли DN

        Returns:
            Путь к созданному файлу
        """
        json_str = self.format_records(records, fields, pretty, include_dn)

        # Создаём директории, если их нет
        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(json_str)
            f.write("\n")

        return filepath

    def _records_to_dicts(
        self,
        records: List[LdifRecord],
        fields: Optional[List[str]],
        include_dn: bool,
    ) -> List[dict]:
        """
        Преобразовать записи в список словарей с фильтрацией полей.

        Args:
            records: Список записей
            fields: Фильтр полей (None = все)
            include_dn: Включать ли DN

        Returns:
            Список словарей
        """
        result = []
        for record in records:
            d = record.to_dict(include_dn=include_dn)

            if fields and fields != ["*"]:
                # Фильтруем поля
                filtered = {}
                for field in fields:
                    field_lower = field.lower()
                    # Поиск без учёта регистра
                    for key, value in d.items():
                        if key.lower() == field_lower:
                            filtered[key] = value
                            break
                # DN всегда включаем если нужно
                if include_dn and "dn" not in filtered and "dn" in d:
                    filtered["dn"] = d["dn"]
                result.append(filtered)
            else:
                result.append(d)

        return result
