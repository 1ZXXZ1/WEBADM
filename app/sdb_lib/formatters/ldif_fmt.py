"""
Форматер LDIF — вывод записей обратно в LDIF формат.
"""

import os
import base64
from typing import List, Optional

from sdb.parser.ldif import LdifRecord


class LdifFormatter:
    """
    Форматер для вывода записей в LDIF формате.

    Полезно для реэкспорта данных или создания LDIF файлов
    для импорта в другую базу.
    """

    def format_records(
        self,
        records: List[LdifRecord],
        fields: Optional[List[str]] = None,
        include_dn: bool = True,
        wrap_lines: bool = True,
        wrap_width: int = 76,
    ) -> str:
        """
        Преобразовать записи в LDIF строку.

        Args:
            records: Список LdifRecord
            fields: Список полей (None = все)
            include_dn: Включать ли DN
            wrap_lines: Переносить ли длинные строки
            wrap_width: Ширина переноса

        Returns:
            LDIF строка
        """
        lines = []

        for idx, record in enumerate(records, 1):
            lines.append(f"# record {idx}")

            if include_dn and record.dn:
                dn_line = f"dn: {record.dn}"
                if wrap_lines:
                    lines.append(self._wrap_line(dn_line, wrap_width))
                else:
                    lines.append(dn_line)

            for attr_name, values in record.attrs.items():
                # Фильтрация полей
                if fields and fields != ["*"]:
                    if attr_name not in fields and attr_name.lower() not in [f.lower() for f in fields]:
                        continue

                for value in values:
                    # Проверяем, нужно ли base64 кодирование
                    if self._needs_base64(value):
                        encoded = base64.b64encode(value.encode("utf-8")).decode("ascii")
                        line = f"{attr_name}:: {encoded}"
                    else:
                        line = f"{attr_name}: {value}"

                    if wrap_lines:
                        lines.append(self._wrap_line(line, wrap_width))
                    else:
                        lines.append(line)

            lines.append("")  # Пустая строка между записями

        return "\n".join(lines)

    def write_to_file(
        self,
        records: List[LdifRecord],
        filepath: str,
        fields: Optional[List[str]] = None,
        include_dn: bool = True,
    ) -> str:
        """
        Записать записи в LDIF файл.

        Args:
            records: Список LdifRecord
            filepath: Путь к файлу
            fields: Список полей
            include_dn: Включать ли DN

        Returns:
            Путь к созданному файлу
        """
        ldif_str = self.format_records(records, fields, include_dn)

        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(ldif_str)
            f.write("\n")

        return filepath

    @staticmethod
    def _needs_base64(value: str) -> bool:
        """
        Проверить, нужно ли base64 кодирование для значения.

        По стандарту LDIF, base64 нужен если значение содержит:
          - Непечатные символы (код < 32, кроме пробела)
          - NUL (код 0)
          - Начинается с пробела, двоеточия или знака '<'
          - Содержит non-ASCII символы

        Args:
            value: Значение атрибута

        Returns:
            True, если нужно base64 кодирование
        """
        if not value:
            return False

        if value[0] in (" ", ":", "<"):
            return True

        for ch in value:
            code = ord(ch)
            if code < 32 and code != 10 and code != 13:
                return True
            if code > 127:
                return True

        return False

    @staticmethod
    def _wrap_line(line: str, width: int) -> str:
        """
        Перенести длинную строку по стандарту LDIF.

        Продолжение строки начинается с одного пробела.

        Args:
            line: Исходная строка
            width: Ширина переноса

        Returns:
            Перенесённая строка
        """
        if len(line) <= width:
            return line

        result = line[:width]
        remaining = line[width:]

        while remaining:
            result += "\n " + remaining[:width - 1]
            remaining = remaining[width - 1:]

        return result
