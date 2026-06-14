"""
sdb - Samba Database Query Tool
================================

Инструмент для удобной работы с базами данных Samba LDB.

Поддерживает:
  - ldbsearch запросы к любым .ldb файлам Samba
  - samba-tool команды (user, group, computer, dns, gpo, domain, fsmo, drs,
    spn, delegation, ntacl, rodc, schema, dbcheck, и т.д.)
  - Собственный скриптовый язык (DSL)
  - Экспорт в JSON, CSV, TSV, таблицу, LDIF, XLSX
  - pandas DataFrame для анализа данных
  - Регистронезависимые имена баз данных
  - Многострочные команды в интерактивном режиме
  - SHOW команды через ldbsearch (напрямую из БД)
  - 3-уровневое TAB-автодополнение (имена из БД)
  - SYNTHESIS - анализ схемы БД как в СУБД
  - SQL-like SELECT запросы
  - Табличный вывод через tabulate
  - XLSX экспорт с формулами Excel и многостраничными книгами

Пример использования:
    from sdb import SdbClient

    client = SdbClient()  # sudo включён по умолчанию
    records = client.query("sam", "(objectClass=user)", attrs=["sAMAccountName", "cn"])
    print(client.format_output(records, fmt="json"))

    # pandas DataFrame
    df = client.to_dataframe(records, fields=["dn", "cn", "sAMAccountName"])
    print(df.head())

Установка для sudo:
    sudo bash install.sh
"""

__version__ = "1.2.3-5"
__author__ = "SDB Tool"

from sdb.client import SdbClient

__all__ = ["SdbClient"]
