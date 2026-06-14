# SDB — Samba Database Query Tool v1.2.3-5

**SDB** — интерактивный CLI инструмент для удобной работы с базами данных Samba LDB (sam.ldb, privilege.ldb, idmap.ldb и др.). Простой скриптовый язык, SQL-like запросы, экспорт в JSON/CSV/TSV/XLSX/DataFrame, поддержка ldbsearch и samba-tool, 3-уровневое TAB-автодополнение.

---

## Содержание

- [Что нового в v1.2.3-5](#что-нового-в-v123-5)
- [Установка](#установка)
- [Быстрый старт](#быстрый-старт)
- [Формат вывода](#формат-вывода)
- [XLSX экспорт — полное руководство](#xlsx-экспорт--полное-руководство)
  - [Пример 1: Простой экспорт пользователей в XLSX](#пример-1-простой-экспорт-пользователей-в-xlsx)
  - [Пример 2: Экспорт групп с формулой проверки заполненности](#пример-2-экспорт-групп-с-формулой-проверки-заполненности)
  - [Пример 3: Многостраничная книга XLSX (пользователи + группы + компьютеры)](#пример-3-многостраничная-книга-xlsx-пользователи--группы--компьютеры)
  - [Пример 4: Экспорт с формулой ВПР (VLOOKUP)](#пример-4-экспорт-с-формулой-впр-vlookup)
  - [Пример 5: Вложенная формула ЕСЛИ + И + ИЛИ](#пример-5-вложенная-формула-если--и--или)
  - [Пример 6: Пользовательская формула через шаблон](#пример-6-пользовательская-формула-через-шаблон)
  - [Пример 7: Экспорт DNS записей в XLSX](#пример-7-экспорт-dns-записей-в-xlsx)
  - [Пример 8: Полный аудит домена в одну XLSX книгу](#пример-8-полный-аудит-домена-в-одну-xlsx-книгу)
  - [Пример 9: Экспорт привилегий с формулой «не пусто»](#пример-9-экспорт-привилегий-с-формулой-не-пусто)
  - [Пример 10: Экспорт OU и GPO с ВПР-связкой](#пример-10-экспорт-ou-и-gpo-с-впр-связкой)
  - [Пример 11: Конвейер: SELECT → WHERE → FORMAT xlsx → OUTPUT](#пример-11-конвейер-select--where--format-xlsx--output)
  - [Пример 12: XLSX через Python API с формулами](#пример-12-xlsx-через-python-api-с-формулами)
  - [Пример 13: Скрипт автоматического ежедневного отчёта](#пример-13-скрипт-автоматического-ежедневного-отчёта)
  - [Пример 14: Экспорт результатов SYNTHESIS в XLSX](#пример-14-экспорт-результатов-synthesis-в-xlsx)
  - [Пример 15: Массовый экспорт всех баз в XLSX](#пример-15-массовый-экспорт-всех-баз-в-xlsx)
  - [Предустановленные формулы](#предустановленные-формулы)
  - [Вложенные функции Excel — справочник](#вложенные-функции-excel--справочник)
- [Команды SHOW](#команды-show)
- [SQL-like SELECT](#sql-like-select)
- [Команды управления](#команды-управления)
- [TOOL — доступ к samba-tool](#tool--доступ-к-samba-tool)
- [SYNTHESIS — анализ схемы БД](#synthesis--анализ-схемы-бд)
- [TAB-автодополнение](#tab-автодополнение)
- [Python API](#python-api)
- [Скриптовый язык DSL](#скриптовый-язык-dsl)
- [Форматеры вывода](#форматеры-вывода)
- [Решение проблем](#решение-проблем)

---

## Что нового в v1.2.3-5

- **XLSX экспорт с формулами Excel**: вложенные ЕСЛИ/И/ИЛИ, ВПР, ЕЧИСЛО, ПОИСК и другие функции прямо в ячейках Excel. Формулы автоматически подставляют номер строки.
- **Многостраничные XLSX книги**: разные типы объектов (пользователи, группы, компьютеры) на отдельных листах.
- **Предустановленные формулы**: `check_vl`, `check_filled`, `vlookup`, `not_empty` — быстрые шаблоны для типичных проверок.
- **Авто-определение формата по расширению**: `OUTPUT report.xlsx` → автоматически XLSX, без явного `FORMAT xlsx`.
- **Декодирование DNS бинарных записей**: dnsRecord теперь отображается как `A ttl=900 192.168.1.1` вместо бинарного мусора.
- **Правильное экранирование LDAP**: спецсимволы `\`, `*`, `(`, `)` корректно экранируются в фильтрах.
- **Кириллица восстановлена**: все сообщения интерфейса снова на русском (устранена транслитерация из v1.2.3.post4).
- **Многословные имена**: `SHOW GROUP Domain Admins` и `SHOW GPO "Default Domain Policy"` работают корректно.

---

## Быстрый старт

```bash
# Показать доступные базы данных
sdb --databases

# Интерактивный режим
sdb

# Выполнить одну команду
sdb -e "USE sam; SELECT dn, cn, sAMAccountName FROM * WHERE objectClass=user;"

# Выполнить скрипт из файла
sdb -f audit.sdb

# Экспорт LDIF файла в JSON
sdb --parse-ldif /var/lib/samba/private/sam.ldb.d/DC=kcrb,DC=local.ldb --format json --output sam.json
```

Интерактивный режим:

```
$ sdb
[sdb] Режим: sudo включён
SDB - Samba Database Query Tool v1.2.3-5 (sudo)
Введите команду или 'help' для справки, 'quit' для выхода

sdb> SHOW DATABASES
  [+] sam          - Основная база AD (пользователи, группы, компьютеры)
  [+] privilege    - Привилегии
  [+] idmap        - Маппинг ID (UID/GID ↔ SID)
  [+] hklm         - Реестр HKLM
  [+] share        - Шары (CIFS/SMB)
  [+] secrets      - Секреты (пароли, ключи)
  [+] dns          - DNS записи

sdb> SHOW USER admin
dn: CN=Administrator,CN=Users,DC=kcrb,DC=local
cn: Administrator
sAMAccountName: Administrator
...

sdb> SHOW GROUP "Domain Admins"
dn: CN=Domain Admins,CN=Users,DC=kcrb,DC=local
sAMAccountName: Domain Admins
...

sdb> FORMAT xlsx
sdb> OUTPUT /tmp/admins.xlsx
Записано 5 записей в: /tmp/admins.xlsx
```

---

## Формат вывода

SDB поддерживает следующие форматы вывода:

| Формат | Описание | Команда |
|--------|----------|---------|
| `json` | JSON (pretty print, UTF-8) | `FORMAT json` |
| `csv` | CSV (запятая) | `FORMAT csv` |
| `tsv` | TSV (табуляция) | `FORMAT tsv` |
| `table` | Таблица (стиль Presto) | `FORMAT table` |
| `table_presto` | Таблица PrestoDB/Trino | `FORMAT table_presto` |
| `table_grid` | Таблица с сеткой | `FORMAT table_grid` |
| `table_simple` | Минимальная таблица | `FORMAT table_simple` |
| `table_rounded` | Закруглённые рамки | `FORMAT table_rounded` |
| `table_double` | Двойные рамки | `FORMAT table_double` |
| `ldif` | LDIF (обратный экспорт) | `FORMAT ldif` |
| `dataframe` | pandas DataFrame | `FORMAT dataframe` |
| `xlsx` | Excel XLSX с формулами | `FORMAT xlsx` |

> **Важно**: Форматы `xlsx` и `dataframe` требуют записи в файл через `OUTPUT`. XLSX не выводится в терминал — используйте `OUTPUT файл.xlsx`.

---

## XLSX экспорт — полное руководство

XLSX форматер SDB создаёт полноценные книги Excel с:
- **Стилизованными заголовками** (жирный белый текст на синем фоне)
- **Авто-шириной колонок** (по содержимому, до 50 символов)
- **Авто-фильтрами** на заголовках
- **Заморозкой верхней строки** (скроллинг с видимыми заголовками)
- **Тонкими рамками** на всех ячейках
- **Формулами Excel** (предустановленные и пользовательские шаблоны)
- **Многостраничными книгами** (каждый тип объекта на отдельном листе)

### Требования

```bash
sudo pip3 install openpyxl
```

### Пример 1: Простой экспорт пользователей в XLSX

Самый простой способ — выполнить SELECT и записать результат в файл с расширением `.xlsx`. Формат определяется автоматически по расширению файла.

```sql
USE sam;
SELECT sAMAccountName, cn, mail, department, description
FROM USERS;
OUTPUT /tmp/samba_users.xlsx;
```

Или в интерактивном режиме:

```
sdb> USE sam
sdb> SELECT sAMAccountName, cn, mail, department, description FROM USERS
sdb> OUTPUT /tmp/samba_users.xlsx
```

Результат: файл `/tmp/samba_users.xlsx` с колонками DN, SAMACCOUNTNAME, CN, MAIL, DEPARTMENT, DESCRIPTION, авто-фильтрами и замороженной первой строкой.

---

### Пример 2: Экспорт групп с формулой проверки заполненности

Предустановленная формула `check_filled` добавляет колонку, которая проверяет заполнены ли обе указанные колонки, и выводит «ОК» или «Ошибка».

```python
from sdb import SdbClient
from sdb.formatters.xlsx_fmt import XlsxFormatter

client = SdbClient()
records = client.ldb.query(
    filter_expr="(objectClass=group)",
    attrs=["sAMAccountName", "cn", "description", "groupType", "dn"],
)

fmt = XlsxFormatter()
# Добавляем колонку с формулой: =ЕСЛИ(ИЛИ(C{n}=""; L{n}=""); ""; ЕСЛИ(И(C{n}<>""; L{n}<>""); "ОК"; "Ошибка"))
fmt.add_formula_column(
    header="Проверка",
    formula_preset="check_filled",
    formula_params={"col_c": "C", "col_l": "D"},  # C=CN, D=DESCRIPTION
)

fmt.write_to_file(
    records,
    "/tmp/groups_check.xlsx",
    fields=["sAMAccountName", "cn", "description"],
    sheet_name="Группы",
)
```

Результат: к стандартным колонкам добавится колонка «ПРОВЕРКА» с формулой `=ЕСЛИ(ИЛИ(C2="";D2="");"";ЕСЛИ(И(C2<>"";D2<>"");"ОК";"Ошибка"))` для каждой строки.

---

### Пример 3: Многостраничная книга XLSX (пользователи + группы + компьютеры)

Метод `format_records_multi_sheet` / `write_multi_sheet_to_file` создаёт книгу, где каждый тип объекта — на отдельном листе.

```python
from sdb import SdbClient
from sdb.formatters.xlsx_fmt import XlsxFormatter

client = SdbClient()

# Собираем записи разных типов
users = client.ldb.query(
    filter_expr="(&(objectClass=user)(sAMAccountType=805306368))",
    attrs=["sAMAccountName", "cn", "mail", "department"],
)
groups = client.ldb.query(
    filter_expr="(objectClass=group)",
    attrs=["sAMAccountName", "cn", "description"],
)
computers = client.ldb.query(
    filter_expr="(objectClass=computer)",
    attrs=["sAMAccountName", "cn", "operatingSystem"],
)

fmt = XlsxFormatter()
fmt.write_multi_sheet_to_file(
    {
        "Пользователи": users,
        "Группы": groups,
        "Компьютеры": computers,
    },
    "/tmp/full_audit.xlsx",
)
```

Результат: книга с тремя листами — «Пользователи», «Группы», «Компьютеры», каждый с авто-фильтрами и стилизованными заголовками.

---

### Пример 4: Экспорт с формулой ВПР (VLOOKUP)

Предустановленная формула `vlookup` добавляет колонку с функцией ВПР для подстановки значений из справочной таблицы. Это удобно, когда нужно сопоставить данные Active Directory со справочником отделов, должностей или подразделений.

```python
from sdb import SdbClient
from sdb.formatters.xlsx_fmt import XlsxFormatter

client = SdbClient()
records = client.ldb.query(
    filter_expr="(&(objectClass=user)(sAMAccountType=805306368))",
    attrs=["sAMAccountName", "cn", "department", "mail"],
)

fmt = XlsxFormatter()
# Добавляем колонку ВПР: =ВПР(C{n}; Отделы!A:B; 2; ЛОЖЬ)
# где C — колонка department, таблица "Отделы!A:B" — на другом листе
fmt.add_formula_column(
    header="Название отдела",
    formula_preset="vlookup",
    formula_params={
        "col_a": "C",                      # колонка department
        "table": "Отделы!A:B",             # диапазон справочника
        "col_idx": "2",                    # номер колонки для возврата
    },
)

fmt.write_to_file(records, "/tmp/users_vlookup.xlsx", sheet_name="Сотрудники")
```

Результат: колонка «НАЗВАНИЕ ОТДЕЛА» с формулой `=ВПР(C2;Отделы!A:B;2;ЛОЖЬ)` для каждой строки. При наличии листа «Отделы» в этой же книге Excel автоматически подставит названия.

---

### Пример 5: Вложенная формула ЕСЛИ + И + ИЛИ

Предустановленная формула `check_vl` демонстрирует вложенные функции: ЕСЛИ с вложенными И и ИЛИ. Идеально подходит для сложных проверок статуса, когда нужно учитывать несколько условий одновременно.

```python
from sdb import SdbClient
from sdb.formatters.xlsx_fmt import XlsxFormatter

client = SdbClient()
records = client.ldb.query(
    filter_expr="(&(objectClass=user)(sAMAccountType=805306368))",
    attrs=["sAMAccountName", "cn", "userAccountControl", "description"],
)

fmt = XlsxFormatter()
# Формула: =ЕСЛИ(И(K{n}="V"; ИЛИ(AP{n}="L"; AR{n}="L")); "ИСТИНА"; "ЛОЖЬ")
# K — колонка userAccountControl, AP/AR — произвольные колонки статуса
fmt.add_formula_column(
    header="Проверка V/L",
    formula_preset="check_vl",
    formula_params={
        "col_k": "D",   # userAccountControl
        "col_ap": "E",  # первая колонка статуса
        "col_ar": "F",  # вторая колонка статуса
    },
)

fmt.write_to_file(records, "/tmp/users_check_vl.xlsx", sheet_name="Проверка")
```

Результат: колонка «ПРОВЕРКА V/L» с формулой `=ЕСЛИ(И(D2="V";ИЛИ(E2="L";F2="L"));"ИСТИНА";"ЛОЖЬ")`.

---

### Пример 6: Пользовательская формула через шаблон

Если предустановленные формулы не подходят, можно задать свой шаблон. Плейсхолдер `{n}` автоматически заменяется на номер строки (2, 3, 4...). Это позволяет создавать произвольные формулы любой сложности.

```python
from sdb import SdbClient
from sdb.formatters.xlsx_fmt import XlsxFormatter

client = SdbClient()
records = client.ldb.query(
    filter_expr="(&(objectClass=user)(sAMAccountType=805306368))",
    attrs=["sAMAccountName", "cn", "mail", "whenCreated"],
)

fmt = XlsxFormatter()

# Пользовательская формула: проверка email + дата
fmt.add_formula_column(
    header="Email валиден",
    formula_template='=ЕСЛИ(И(D{n}<>""; ЕЧИСЛО(ПОИСК("@"; D{n}))); "Да"; "Нет")',
)

# Вторая пользовательская формула: сложная вложенная проверка
fmt.add_formula_column(
    header="Статус аккаунта",
    formula_template='=ЕСЛИ(C{n}=""; "Нет данных"; ЕСЛИ(D{n}=""; "Нет email"; "Полный"))',
)

fmt.write_to_file(records, "/tmp/users_custom_formulas.xlsx", sheet_name="Сотрудники")
```

Результат: колонка «EMAIL ВАЛИДЕН» с `=ЕСЛИ(И(D2<>"";ЕЧИСЛО(ПОИСК("@";D2)));"Да";"Нет")` и колонка «СТАТУС АККАУНТА» с `=ЕСЛИ(C2="";"Нет данных";ЕСЛИ(D2="";"Нет email";"Полный"))`.

---

### Пример 7: Экспорт DNS записей в XLSX

DNS записи из Samba LDB декодируются из бинарного формата в человекочитаемый вид (IP адреса, TTL, тип записи) и экспортируются в Excel.

```sql
USE sam;
FORMAT xlsx;
SELECT dc, dnsRecord, dn FROM * WHERE objectClass=dnsNode;
OUTPUT /tmp/dns_records.xlsx;
```

Или через Python API с дополнительной формулой:

```python
from sdb import SdbClient
from sdb.formatters.xlsx_fmt import XlsxFormatter

client = SdbClient()
records = client.ldb.query(
    filter_expr="(objectClass=dnsNode)",
    attrs=["dc", "dnsRecord", "dn"],
)

fmt = XlsxFormatter()
fmt.add_formula_column(
    header="Есть A-запись?",
    formula_template='=ЕСЛИ(ЕЧИСЛО(ПОИСК("A ttl"; B{n})); "Да"; "Нет")',
)

fmt.write_to_file(records, "/tmp/dns_check.xlsx", sheet_name="DNS")
```

---

### Пример 8: Полный аудит домена в одну XLSX книгу

Скрипт для полного аудита: все объекты AD на отдельных листах с формулами проверки.

```sql
# ═══ Файл: full_audit.sdb ═══

# Переменная для пути
SET outdir = "/tmp/samba_audit";

# ─── Пользователи ──────────────────────────────
USE sam;
SELECT sAMAccountName, cn, mail, department, description, whenCreated
FROM USERS;
OUTPUT /tmp/samba_audit/users.xlsx;

# ─── Группы ────────────────────────────────────
SELECT sAMAccountName, cn, description, groupType
FROM GROUPS;
OUTPUT /tmp/samba_audit/groups.xlsx;

# ─── Компьютеры ────────────────────────────────
SELECT sAMAccountName, cn, operatingSystem, dn
FROM COMPUTERS;
OUTPUT /tmp/samba_audit/computers.xlsx;

# ─── GPO ───────────────────────────────────────
SELECT cn, displayName, dn
FROM GPOS;
OUTPUT /tmp/samba_audit/gpo.xlsx;

# ─── OU ────────────────────────────────────────
SELECT ou, description, dn
FROM OUS;
OUTPUT /tmp/samba_audit/ou.xlsx;
```

Для многостраничной книги через Python API:

```python
from sdb import SdbClient
from sdb.formatters.xlsx_fmt import XlsxFormatter

client = SdbClient()
fmt = XlsxFormatter()

users = client.ldb.query(
    filter_expr="(&(objectClass=user)(sAMAccountType=805306368))",
    attrs=["sAMAccountName", "cn", "mail", "department"],
)
groups = client.ldb.query(
    filter_expr="(objectClass=group)",
    attrs=["sAMAccountName", "cn", "description"],
)
computers = client.ldb.query(
    filter_expr="(objectClass=computer)",
    attrs=["sAMAccountName", "cn", "operatingSystem"],
)
gpos = client.ldb.query(
    filter_expr="(objectClass=groupPolicyContainer)",
    attrs=["cn", "displayName"],
)
ous = client.ldb.query(
    filter_expr="(objectClass=organizationalUnit)",
    attrs=["ou", "description"],
)

fmt.write_multi_sheet_to_file(
    {
        "Пользователи": users,
        "Группы": groups,
        "Компьютеры": computers,
        "GPO": gpos,
        "OU": ous,
    },
    "/tmp/full_domain_audit.xlsx",
)
```

---

### Пример 9: Экспорт привилегий с формулой «не пусто»

Предустановленная формула `not_empty` добавляет колонку, которая проверяет заполнена ли указанная колонка, и выводит «Да» или «Нет».

```python
from sdb import SdbClient
from sdb.formatters.xlsx_fmt import XlsxFormatter

client = SdbClient()
client.use_database("privilege")

records = client.ldb.query(
    filter_expr="(objectClass=privilege)",
    attrs=["cn", "objectSid", "description"],
)

fmt = XlsxFormatter()
# Проверяем заполнена ли колонка description (C)
fmt.add_formula_column(
    header="Есть описание",
    formula_preset="not_empty",
    formula_params={"col": "C"},  # C = колонка description
)

fmt.write_to_file(records, "/tmp/privileges.xlsx", sheet_name="Привилегии")
```

---

### Пример 10: Экспорт OU и GPO с ВПР-связкой

Создание XLSX с двумя листами: справочник GPO и список OU, где колонка GPO связана через ВПР.

```python
from sdb import SdbClient
from sdb.formatters.xlsx_fmt import XlsxFormatter

client = SdbClient()

ous = client.ldb.query(
    filter_expr="(objectClass=organizationalUnit)",
    attrs=["ou", "dn", "description"],
)
gpos = client.ldb.query(
    filter_expr="(objectClass=groupPolicyContainer)",
    attrs=["cn", "displayName", "gPCFileSysPath"],
)

# Сначала создаём форматер с формулой ВПР для OU
fmt_ou = XlsxFormatter()
fmt_ou.add_formula_column(
    header="Политика (ВПР)",
    formula_preset="vlookup",
    formula_params={"col_a": "A", "table": "GPO!A:B", "col_idx": "2"},
)

# Книга с двумя листами
from openpyxl import Workbook

fmt = XlsxFormatter()
fmt.write_multi_sheet_to_file(
    {"OU": ous, "GPO": gpos},
    "/tmp/ou_gpo_link.xlsx",
)
```

---

### Пример 11: Конвейер: SELECT → WHERE → FORMAT xlsx → OUTPUT

В интерактивном режиме можно уточнять запрос шаг за шагом, фильтровать и затем экспортировать:

```
sdb> USE sam
sdb> SELECT sAMAccountName, cn, mail, department FROM USERS
  #  | SAMACCOUNTNAME   | CN               | MAIL                  | DEPARTMENT
  1  | admin            | Administrator    | admin@kcrb.local      | IT
  2  | ivanov           | Иванов И.И.      | ivanov@kcrb.local     | Бухгалтерия
  3  | petrov           | Петров П.П.      | petrov@kcrb.local     | IT
  4  | sidorov          | Сидоров С.С.     |                       | Кадры
  ...

sdb> WHERE department=IT
  #  | SAMACCOUNTNAME   | CN               | MAIL                  | DEPARTMENT
  1  | admin            | Administrator    | admin@kcrb.local      | IT
  2  | petrov           | Петров П.П.      | petrov@kcrb.local     | IT

sdb> FORMAT xlsx
sdb> OUTPUT /tmp/it_department.xlsx
Записано 2 записей в: /tmp/it_department.xlsx
```

---

### Пример 12: XLSX через Python API с формулами

Полный пример Python скрипта с несколькими формульными колонками:

```python
#!/usr/bin/env python3
"""Экспорт пользователей AD в XLSX с формулами проверки."""

from sdb import SdbClient
from sdb.formatters.xlsx_fmt import XlsxFormatter

def main():
    client = SdbClient()

    # Запрашиваем пользователей
    records = client.ldb.query(
        filter_expr="(&(objectClass=user)(sAMAccountType=805306368))",
        attrs=["sAMAccountName", "cn", "mail", "department", "description", "whenCreated"],
    )

    fmt = XlsxFormatter()

    # Формула 1: проверка email
    fmt.add_formula_column(
        header="Email валиден",
        formula_template='=ЕСЛИ(И(C{n}<>""; ЕЧИСЛО(ПОИСК("@"; C{n}))); "Да"; "Нет")',
    )

    # Формула 2: проверка заполненности department
    fmt.add_formula_column(
        header="Отдел указан",
        formula_preset="not_empty",
        formula_params={"col": "D"},  # D = department
    )

    # Формула 3: комплексная проверка
    fmt.add_formula_column(
        header="Статус",
        formula_template='=ЕСЛИ(И(D{n}<>""; C{n}<>""); "Полный"; ЕСЛИ(D{n}<>""; "Без email"; "Неполный"))',
    )

    # Записываем в файл
    filepath = fmt.write_to_file(
        records,
        "/tmp/users_full_check.xlsx",
        fields=["sAMAccountName", "cn", "mail", "department", "description"],
        sheet_name="Сотрудники",
    )

    print(f"Экспортировано {len(records)} записей в: {filepath}")

if __name__ == "__main__":
    main()
```

---

### Пример 13: Скрипт автоматического ежедневного отчёта

SDB-скрипт для cron: каждый день экспортирует текущее состояние AD в XLSX.

```sql
# ═══ Файл: daily_report.sdb ═══
# Запуск: sdb -f daily_report.sdb
# Рекомендуется добавить в crontab:
# 0 8 * * * /usr/local/bin/sdb -f /opt/sdb/scripts/daily_report.sdb

# Переменные
SET date = "2025-01-15";
SET outdir = "/var/reports/samba";

# ─── Пользователи ──────────────────────────────
USE sam;

FIELDS sAMAccountName, cn, mail, department, description;
SELECT sAMAccountName, cn, mail, department, description
FROM USERS;
FORMAT xlsx;
OUTPUT /var/reports/samba/users_daily.xlsx;

# ─── Группы ────────────────────────────────────
FIELDS sAMAccountName, cn, description;
SELECT sAMAccountName, cn, description
FROM GROUPS;
FORMAT xlsx;
OUTPUT /var/reports/samba/groups_daily.xlsx;

# ─── Компьютеры ────────────────────────────────
FIELDS sAMAccountName, cn, operatingSystem;
SELECT sAMAccountName, cn, operatingSystem
FROM COMPUTERS;
FORMAT xlsx;
OUTPUT /var/reports/samba/computers_daily.xlsx;
```

Crontab:

```bash
0 8 * * * /usr/local/bin/sdb -f /opt/sdb/scripts/daily_report.sdb 2>&1 | logger -t sdb-daily
```

---

### Пример 14: Экспорт результатов SYNTHESIS в XLSX

Анализ схемы БД и экспорт результатов:

```python
from sdb import SdbClient
from sdb.formatters.xlsx_fmt import XlsxFormatter

client = SdbClient()

# Собираем данные о разных типах объектов для анализа
entity_types = {
    "Пользователи": client.ldb.query(
        filter_expr="(&(objectClass=user)(sAMAccountType=805306368))",
        attrs=["sAMAccountName", "cn"],
    ),
    "Группы": client.ldb.query(
        filter_expr="(objectClass=group)",
        attrs=["sAMAccountName", "cn"],
    ),
    "Компьютеры": client.ldb.query(
        filter_expr="(objectClass=computer)",
        attrs=["sAMAccountName", "cn"],
    ),
    "OU": client.ldb.query(
        filter_expr="(objectClass=organizationalUnit)",
        attrs=["ou", "description"],
    ),
    "GPO": client.ldb.query(
        filter_expr="(objectClass=groupPolicyContainer)",
        attrs=["cn", "displayName"],
    ),
    "DNS": client.ldb.query(
        filter_expr="(objectClass=dnsNode)",
        attrs=["dc"],
    ),
    "Контакты": client.ldb.query(
        filter_expr="(objectClass=contact)",
        attrs=["cn", "mail"],
    ),
}

fmt = XlsxFormatter()
fmt.write_multi_sheet_to_file(
    entity_types,
    "/tmp/synthesis_schema.xlsx",
)

print(f"Схема БД экспортирована в /tmp/synthesis_schema.xlsx")
for name, recs in entity_types.items():
    print(f"  {name}: {len(recs)} записей")
```

---

### Пример 15: Массовый экспорт всех баз в XLSX

Полный экспорт каждой LDB базы в отдельный XLSX файл:

```sql
# ═══ Файл: export_all.sdb ═══

SET outdir = "/tmp/samba_export";

# ─── SAM ────────────────────────────────────────
USE sam;
FORMAT xlsx;

SELECT sAMAccountName, cn, mail, department, description, objectSid
FROM * WHERE objectClass=user;
OUTPUT /tmp/samba_export/sam_users.xlsx;

SELECT sAMAccountName, cn, description, groupType
FROM * WHERE objectClass=group;
OUTPUT /tmp/samba_export/sam_groups.xlsx;

SELECT sAMAccountName, cn, objectClass
FROM * WHERE objectClass=computer;
OUTPUT /tmp/samba_export/sam_computers.xlsx;

# ─── Привилегии ────────────────────────────────
USE privilege;
FORMAT xlsx;
SELECT * FROM *;
OUTPUT /tmp/samba_export/privilege.xlsx;

# ─── Шары ──────────────────────────────────────
USE share;
FORMAT xlsx;
SELECT * FROM *;
OUTPUT /tmp/samba_export/shares.xlsx;

# ─── ID маппинг ────────────────────────────────
USE idmap;
FORMAT xlsx;
FIELDS cn, objectSid, xidNumber, type;
SELECT * FROM *;
OUTPUT /tmp/samba_export/idmap.xlsx;

# ─── Реестр ────────────────────────────────────
USE hklm;
FORMAT xlsx;
SELECT * FROM *;
OUTPUT /tmp/samba_export/hklm.xlsx;

# ─── Секреты ───────────────────────────────────
USE secrets;
FORMAT json;
SELECT * FROM *;
OUTPUT /tmp/samba_export/secrets.json;
```

---

### Предустановленные формулы

SDB поставляется с 4 предустановленными формулами, которые покрывают наиболее частые сценарии проверки данных:

| Имя | Формула | Описание |
|-----|---------|----------|
| `check_vl` | `=ЕСЛИ(И(K{n}="V"; ИЛИ(AP{n}="L"; AR{n}="L")); "ИСТИНА"; "ЛОЖЬ")` | Проверка двух условий: K="V" И хотя бы одно из AP/AR="L" |
| `check_filled` | `=ЕСЛИ(ИЛИ(C{n}=""; L{n}=""); ""; ЕСЛИ(И(C{n}<>""; L{n}<>""); "ОК"; "Ошибка"))` | Проверка заполненности двух колонок |
| `vlookup` | `=ВПР(A{n}; таблица; 2; ЛОЖЬ)` | Подстановка значения из справочной таблицы |
| `not_empty` | `=ЕСЛИ(A{n}<>""; "Да"; "Нет")` | Простая проверка: заполнена ли ячейка |

Использование предустановленной формулы:

```python
fmt = XlsxFormatter()
fmt.add_formula_column(
    header="Моя проверка",
    formula_preset="check_vl",
    formula_params={"col_k": "D", "col_ap": "E", "col_ar": "F"},
)
```

Использование пользовательского шаблона:

```python
fmt = XlsxFormatter()
fmt.add_formula_column(
    header="Статус",
    formula_template='=ЕСЛИ(И(D{n}<>""; E{n}<>""); "ОК"; "Проверить")',
)
```

Плейсхолдер `{n}` заменяется на номер строки (начиная с 2, т.к. строка 1 = заголовки).

---

### Вложенные функции Excel — справочник

SDB поддерживает любые формулы Excel, включая вложенные функции. Ниже — справочник по функциям, которые чаще всего используются в связке с SDB:

#### ЕСЛИ (IF)

Условная проверка. Может быть вложенной до 64 уровней.

```
=ЕСЛИ(условие; значение_истина; значение_ложь)
=ЕСЛИ(A2="admin"; "Администратор"; "Пользователь")
```

Вложенный ЕСЛИ:

```
=ЕСЛИ(A2=""; "Пусто"; ЕСЛИ(B2=""; "Нет данных"; "ОК"))
```

#### И (AND)

Возвращает ИСТИНА, если ВСЕ условия истинны.

```
=И(условие1; условие2; ...)
=ЕСЛИ(И(A2<>""; B2<>""); "Оба заполнены"; "Не хватает данных")
```

#### ИЛИ (OR)

Возвращает ИСТИНА, если ХОТЯ БЫ ОДНО условие истинно.

```
=ИЛИ(условие1; условие2; ...)
=ЕСЛИ(ИЛИ(A2="admin"; A2="root"); "Привилегированный"; "Обычный")
```

#### ЕЧИСЛО (ISNUMBER)

Проверяет, является ли значение числом. Часто используется в связке с ПОИСК.

```
=ЕЧИСЛО(ПОИСК("@"; C2))    → ИСТИНА, если в C2 есть символ @
```

#### ПОИСК (SEARCH)

Ищет подстроку в строке (без учёта регистра). Возвращает позицию или ошибку.

```
=ПОИСК("текст"; A2)         → позиция найденного текста или #ЗНАЧ!
=ЕСЛИ(ЕЧИСЛО(ПОИСК("@"; C2)); "Email OK"; "Нет email")
```

#### ВПР (VLOOKUP)

Вертикальный поиск значения в первом столбце таблицы и возврат значения из указанной колонки.

```
=ВПР(искомое_значение; таблица; номер_колонки; ЛОЖЬ)
=ВПР(A2; Отделы!A:B; 2; ЛОЖЬ)    → подставить название отдела
```

Параметр `ЛОЖЬ` означает точное совпадение (аналог `FALSE` в английском Excel).

#### Примеры сложных вложенных формул

Проверка email с помощью ЕСЛИ + ЕЧИСЛО + ПОИСК:

```
=ЕСЛИ(И(C2<>""; ЕЧИСЛО(ПОИСК("@"; C2))); "Email валиден"; "Проверить email")
```

Многоуровневая проверка статуса:

```
=ЕСЛИ(И(A2<>""; B2<>""; C2<>""); "Полный"; ЕСЛИ(ИЛИ(A2=""; B2=""); "Критичный"; "Частичный"))
```

Комплексная проверка V/L (как в `check_vl`):

```
=ЕСЛИ(И(K2="V"; ИЛИ(AP2="L"; AR2="L")); "ИСТИНА"; "ЛОЖЬ")
```

ВПР с обработкой ошибок:

```
=ЕСЛИ(ЕЧИСЛО(ВПР(A2; Справочник!A:B; 2; ЛОЖЬ)); ВПР(A2; Справочник!A:B; 2; ЛОЖЬ); "Не найден")
```

---

## Команды SHOW

Все SHOW команды работают через ldbsearch (напрямую из БД), а не через samba-tool, что обеспечивает работу даже когда samba-tool не может подключиться к DC.

| Команда | Описание | Пример |
|---------|----------|--------|
| `SHOW DATABASES` | Показать базы данных | `SHOW DATABASES` |
| `SHOW USER <name>` | Подробности пользователя | `SHOW USER admin` |
| `SHOW USER` | Список всех пользователей | `SHOW USER` |
| `SHOW GROUP <name>` | Подробности группы | `SHOW GROUP "Domain Admins"` |
| `SHOW GROUP` | Список всех групп | `SHOW GROUP` |
| `SHOW COMPUTER <name>` | Подробности компьютера | `SHOW COMPUTER KUSHNRSERVERALT` |
| `SHOW COMPUTER` | Список всех компьютеров | `SHOW COMPUTER` |
| `SHOW OU <name>` | Подробности OU | `SHOW OU "Domain Controllers"` |
| `SHOW OU` | Список всех OU | `SHOW OU` |
| `SHOW GPO [<name>]` | GPO из БД | `SHOW GPO "Default Domain Policy"` |
| `SHOW DNS` | DNS записи из БД | `SHOW DNS` |
| `SHOW CONTACT [<name>]` | Контакты из БД | `SHOW CONTACT` |
| `SHOW HELP` | Справка по SHOW | `SHOW HELP` |

### Многословные имена

Группы, GPO, OU и контакты часто имеют имена из нескольких слов. SDB поддерживает два варианта записи:

```
# С кавычками (рекомендуется):
SHOW GROUP "Domain Admins"
SHOW GPO "Default Domain Policy"
SHOW OU "Domain Controllers"

# Без кавычек (слова склеиваются):
SHOW GROUP Domain Admins
SHOW GPO Default Domain Policy
```

Оба варианта работают одинаково — SDB автоматически склеивает все слова после типа объекта в одно имя.

---

## SQL-like SELECT

SDB поддерживает SQL-like синтаксис для удобных запросов к типовым объектам Active Directory:

```sql
-- Все пользователи
SELECT sAMAccountName, cn, mail FROM USERS;

-- Все группы с фильтром
SELECT * FROM GROUPS WHERE cn=*Admin*;

-- Все компьютеры
SELECT sAMAccountName, cn FROM COMPUTERS;

-- OU
SELECT ou, description FROM OUS;

-- GPO
SELECT cn, displayName FROM GPOS;

-- Контакты
SELECT cn, mail FROM CONTACTS;

-- DNS записи
SELECT dc, dnsRecord FROM DNS_RECORDS;
```

### Доступные SQL-таблицы

| Таблица | Фильтр LDAP | Ключевой атрибут |
|---------|------------|-----------------|
| `USERS` | `(&(objectClass=user)(sAMAccountType=805306368))` | `sAMAccountName` |
| `GROUPS` | `(objectClass=group)` | `sAMAccountName` |
| `COMPUTERS` | `(objectClass=computer)` | `sAMAccountName` |
| `OUS` | `(objectClass=organizationalUnit)` | `ou` |
| `GPOS` | `(objectClass=groupPolicyContainer)` | `displayName` |
| `CONTACTS` | `(objectClass=contact)` | `cn` |
| `DNS_RECORDS` | `(objectClass=dnsNode)` | `dc` |

### WHERE фильтры

Фильтр WHERE поддерживает несколько форматов:

```sql
-- LDAP-фильтр (в скобках)
SELECT * FROM USERS WHERE (cn=*admin*);

-- Простой фильтр attr=value
SELECT * FROM USERS WHERE cn=*Admin*;

-- Подстрока (без =)
SELECT * FROM USERS WHERE Admin;
```

---

## Команды управления

### CREATE

```sql
-- Создание пользователя
CREATE USER ivanov P@ssw0rd --given-name=Иван --surname=Иванов --mail-address=ivanov@kcrb.local --department=IT;

-- Массовое создание из файла
CREATE USERS FROM /tmp/bulk_users.json;

-- Создание группы
CREATE GROUP "IT Department" --description="IT отдел";

-- Создание OU
CREATE OU Staff --base-dn=DC=kcrb,DC=local;
```

### DELETE

```sql
DELETE USER ivanov;
DELETE GROUP "Old Group";
DELETE COMPUTER OLDPC;
```

### ENABLE / DISABLE

```sql
ENABLE ivanov;
DISABLE petrov;
ENABLE USER ivanov;
DISABLE USER petrov;
```

### LIST

```sql
LIST USERS;
LIST GROUPS;
LIST COMPUTERS;
LIST OUS;
```

### SET (переменные)

```sql
SET domain = "DC=kcrb,DC=local";
SET outdir = "/tmp/export";
```

Переменные используются через `$name`:

```sql
SET filter = "objectClass=user";
SELECT * FROM * WHERE $filter;
```

### FIELDS

```sql
FIELDS dn, sAMAccountName, cn, mail;
SELECT * FROM USERS;
```

### LIMIT

```sql
LIMIT 10;
SELECT * FROM USERS;
```

### SEARCH

```sql
SEARCH "administrator";
```

### DATAFRAME

```sql
SELECT * FROM USERS;
DATAFRAME;
```

Требует установленного pandas: `pip3 install pandas`

---

## TOOL — доступ к samba-tool

Команда TOOL даёт прямой доступ ко всем подкомандам samba-tool:

```sql
-- Список пользователей
TOOL user list;

-- Создание пользователя
TOOL user create username P@ssw0rd --given-name=Иван;

-- Удаление пользователя
TOOL user delete username;

-- Члены группы
TOOL group listmembers "Domain Admins";

-- DNS запрос
TOOL dns query 127.0.0.1 kcrb.local @ ALL;

-- Список GPO
TOOL gpo listall;

-- Информация о домене
TOOL domain info;

-- FSMO роли
TOOL fsmo show;

-- Справка по подкоманде
TOOL HELP user;

-- Все подкоманды
TOOL LIST;
```

### Доступные подкоманды samba-tool

| Подкоманда | Описание |
|-----------|----------|
| `user` | Управление пользователями |
| `group` | Управление группами |
| `computer` | Управление компьютерами |
| `dns` | Управление DNS |
| `gpo` | Групповые политики |
| `ou` | Организационные подразделения |
| `domain` | Информация о домене |
| `fsmo` | FSMO роли |
| `drs` | Репликация |
| `spn` | Service Principal Names |
| `delegation` | Делегирование |
| `ntacl` | NT ACL |
| `rodc` | Read-Only DC |
| `schema` | Схема AD |
| `dbcheck` | Проверка БД |
| `ldapcmp` | Сравнение LDAP |
| `contact` | Контакты |
| `testparm` | Проверка конфигурации |

---

## SYNTHESIS — анализ схемы БД

SYNTHESIS анализирует схему базы данных Samba AD как реляционную СУБД: определяет сущности (таблицы), связи (внешние ключи), ассоциации (M:M) и предлагает нормализованную схему.

```sql
-- Полный анализ
SYNTHESIS;

-- То же самое
SYNTHESIS SCHEMA;

-- Сущности → Таблицы
SYNTHESIS ENTITY;

-- Связи 1:M → Внешние ключи
SYNTHESIS RELATION;

-- Связи M:M → Ассоциативные таблицы
SYNTHESIS ASSOCIATION;

-- Промежуточный итог (до нормализации)
SYNTHESIS NORMALIZE;
```

Пример вывода `SYNTHESIS ENTITY`:

```
Сущности (objectClass → Таблица):
  user       → USERS           (ключ: sAMAccountName)
  group      → GROUPS          (ключ: sAMAccountName)
  computer   → COMPUTERS       (ключ: sAMAccountName)
  ou         → OUS             (ключ: ou)
  gpo        → GPOS            (ключ: cn)
  contact    → CONTACTS        (ключ: cn)
  dnsNode    → DNS_RECORDS     (ключ: dc)
```

---

## TAB-автодополнение

SDB поддерживает 3-уровневое контекстное TAB-автодополнение. Имена объектов подгружаются из БД и кэшируются.

```
USE <TAB>              → sam, privilege, idmap, hklm, secrets, share, dns
TOOL <TAB>             → user, group, computer, dns, gpo, ou, domain, fsmo, ...
TOOL user <TAB>        → list, create, delete, enable, disable, setpassword, ...
SHOW <TAB>             → DATABASES, USER, GROUP, COMPUTER, OU, GPO, DNS, CONTACT, HELP
SHOW USER <TAB>        → admin, guest, ivanov, petrov, ... (имена из БД!)
SHOW GROUP <TAB>       → Domain Admins, Domain Users, ... (имена из БД!)
SHOW GPO <TAB>         → {GUID}, ... (имена из БД!)
DELETE USER <TAB>      → имена пользователей из БД
ENABLE <TAB>           → имена пользователей из БД
DISABLE <TAB>          → имена пользователей из БД
FORMAT <TAB>           → json, csv, tsv, table, xlsx, dataframe, ldif, ...
SELECT ... FROM <TAB>  → USERS, GROUPS, COMPUTERS, OUS, GPOS, CONTACTS, DNS_RECORDS
CREATE <TAB>           → USER, GROUP, COMPUTER, OU, USERS
```

---

## Python API

SDB можно использовать как Python-библиотеку:

### Базовые запросы

```python
from sdb import SdbClient

client = SdbClient()  # sudo включён по умолчанию

# Запрос к БД
records = client.query("sam", "(objectClass=user)", attrs=["sAMAccountName", "cn"])

# Форматирование
print(client.format_output(records, fmt="json"))
print(client.format_output(records, fmt="table"))
print(client.format_output(records, fmt="csv"))
```

### XLSX экспорт с формулами

```python
from sdb import SdbClient
from sdb.formatters.xlsx_fmt import XlsxFormatter

client = SdbClient()
records = client.query("sam", "(objectClass=user)", attrs=["sAMAccountName", "cn", "mail"])

fmt = XlsxFormatter()
fmt.add_formula_column(
    header="Email OK",
    formula_template='=ЕСЛИ(И(C{n}<>""; ЕЧИСЛО(ПОИСК("@"; C{n}))); "Да"; "Нет")',
)
fmt.write_to_file(records, "/tmp/users.xlsx", sheet_name="Пользователи")
```

### Многостраничная XLSX книга

```python
from sdb import SdbClient
from sdb.formatters.xlsx_fmt import XlsxFormatter

client = SdbClient()

fmt = XlsxFormatter()
fmt.write_multi_sheet_to_file(
    {
        "Пользователи": client.query("sam", "(objectClass=user)"),
        "Группы": client.query("sam", "(objectClass=group)"),
    },
    "/tmp/audit.xlsx",
)
```

### pandas DataFrame

```python
from sdb import SdbClient

client = SdbClient()
records = client.query("sam", "(objectClass=user)")
df = client.to_dataframe(records, fields=["dn", "cn", "sAMAccountName", "mail"])
print(df.head())
print(df.describe())
df.to_excel("/tmp/df_export.xlsx")
```

### Запись в файл

```python
# Авто-определение формата по расширению
client.write_output(records, "/tmp/output.xlsx")  # → XLSX
client.write_output(records, "/tmp/output.json")  # → JSON
client.write_output(records, "/tmp/output.csv")   # → CSV
client.write_output(records, "/tmp/output.tsv")   # → TSV
client.write_output(records, "/tmp/output.ldif")  # → LDIF
```

### Выполнение скриптов

```python
# Из строки
client.run_script("USE sam; SELECT * FROM USERS; FORMAT xlsx; OUTPUT /tmp/out.xlsx;")

# Из файла
client.run_script_file("/opt/sdb/scripts/audit.sdb")
```

### Парсинг LDIF

```python
# Из строки
records = client.parse_ldif("dn: CN=Admin\nCN: Admin\n")

# Из файла
records = client.parse_ldif_file("/var/lib/samba/private/sam.ldb.d/CN=xxx.ldb")
```

### Имена из БД

```python
users = client.get_names_from_db("user")
groups = client.get_names_from_db("group")
computers = client.get_names_from_db("computer")

# Сброс кэша
client.clear_names_cache()
client.clear_names_cache("user")  # только для пользователей
```

---

## Скриптовый язык DSL

SDB имеет собственный скриптовый язык (DSL) для автоматизации задач:

### Синтаксис

```sql
# Комментарий

# Выбор базы данных
USE sam;

# SQL-like запросы
SELECT sAMAccountName, cn, mail FROM USERS;
SELECT * FROM GROUPS WHERE cn=*Admin*;

# Фильтр
WHERE department=IT;

# Формат и вывод
FORMAT xlsx;
OUTPUT /tmp/report.xlsx;

# Переменные
SET domain = "DC=kcrb,DC=local";
SET outdir = "/tmp/export";

# Поля и лимит
FIELDS dn, cn, sAMAccountName;
LIMIT 50;

# Поиск
SEARCH "administrator";

# SHOW команды
SHOW DATABASES;
SHOW USER admin;
SHOW GROUP "Domain Admins";
SHOW DNS;
SHOW HELP;

# Управление объектами
CREATE USER ivanov P@ssw0rd --given-name=Иван;
DELETE USER olduser;
ENABLE ivanov;
DISABLE petrov;
LIST USERS;

# TOOL команды
TOOL user list;
TOOL group listmembers "Domain Admins";
TOOL HELP user;

# SYNTHESIS
SYNTHESIS;
SYNTHESIS ENTITY;

# DataFrame
DATAFRAME;
```

### Правила

- Команды **регистронезависимые**: `USE sam`, `use sam`, `Use Sam` — всё работает.
- Точка с запятой `;` **не обязательна** в интерактивном режиме (авто-выполнение по Enter).
- В скриптах `.sdb` рекомендуется использовать `;` для разделения команд.
- Комментарии начинаются с `#`.
- Строки с пробелами можно брать в кавычки: `"Domain Admins"`.
- Переменные: `SET name = value;`, использование: `$name`.

---

## Форматеры вывода

### JsonFormatter

```python
from sdb.formatters.json_fmt import JsonFormatter

fmt = JsonFormatter()
output = fmt.format_records(records, fields=["cn", "mail"])
fmt.write_to_file(records, "/tmp/out.json")
```

Особенности: pretty print, `ensure_ascii=False` (кириллица как есть), `indent=2`.

### CsvFormatter / TsvFormatter

```python
from sdb.formatters.csv_fmt import CsvFormatter
from sdb.formatters.tsv_fmt import TsvFormatter

fmt_csv = CsvFormatter()
fmt_tsv = TsvFormatter()
```

Многозначные атрибуты (например, `memberOf`) объединяются через `; `.

### TableFormatter

```python
from sdb.formatters.table_fmt import TableFormatter, TABLE_STYLES

fmt = TableFormatter(style="grid")  # presto, grid, simple, rounded, double, mixed, outline
```

Стили: `table_presto`, `table_grid`, `table_simple`, `table_rounded`, `table_double`, `table_mixed`, `table_outline`.

### LdifFormatter

```python
from sdb.formatters.ldif_fmt import LdifFormatter

fmt = LdifFormatter()
output = fmt.format_records(records)
```

Обратный экспорт: записи → LDIF формат с base64 для не-ASCII значений.

### DataframeFormatter

```python
from sdb.formatters.dataframe_fmt import DataframeFormatter

fmt = DataframeFormatter()
df = fmt.to_dataframe(records, fields=["cn", "mail"])
fmt.write_to_file(records, "/tmp/out.xlsx")  # требует pandas + openpyxl
```

Поддерживаемые форматы: `.csv`, `.tsv`, `.xlsx`, `.json`, `.pkl`.

### XlsxFormatter

```python
from sdb.formatters.xlsx_fmt import XlsxFormatter

fmt = XlsxFormatter()

# Добавить формульные колонки
fmt.add_formula_column(header="Проверка", formula_preset="not_empty", formula_params={"col": "C"})

# Один лист
fmt.write_to_file(records, "/tmp/out.xlsx", sheet_name="Данные")

# Много листов
fmt.write_multi_sheet_to_file({"Лист1": recs1, "Лист2": recs2}, "/tmp/multi.xlsx")
```

---

## Решение проблем

### SHOW GPO — ошибка "uncaught exception"

Начиная с v1.2.3-2, `SHOW GPO` работает через ldbsearch, а не samba-tool. Если samba не запущена, `samba-tool gpo listall` выдаёт ошибку, но `SHOW GPO` через ldbsearch работает всегда (читает sam.ldb напрямую).

### DNS — "Connecting to DNS RPC server failed"

Команда `samba-tool dns query` требует запущенную samba и указание сервера. Альтернатива: `SHOW DNS` через ldbsearch — работает без запущенной samba.

Если нужен именно samba-tool DNS:

```
sdb> TOOL dns query 127.0.0.1 kcrb.local @ ALL
```

Убедитесь, что samba запущена: `sudo systemctl start samba`.

### Нет доступа к LDB файлам

LDB файлы Samba обычно доступны только root. Запускайте SDB с sudo:

```bash
sudo sdb
# или
sdb  # sudo включено по умолчанию
```

Если запускаете от root — можно использовать `--no-sudo`:

```bash
sdb --no-sudo
```

### xterm-256color spam

Если после команд DNS терминал заполняется строками `xterm-256color`, это баг обработки терминальных escape-последовательностей. Решение: после выхода из SDB выполните `reset`.

### Кэш имён не обновляется

После CREATE/DELETE кэш имён для автодополнения автоматически обновляется. Если имена не обновились, выполните `SHOW USER` или `SHOW GROUP` — это принудительно обновит кэш.

### Кодировка (вместо русского — транслитерация)

В v1.2.3-5 эта проблема устранена. Если вы видите транслитерацию (`Rezhim` вместо `Режим`), убедитесь, что установлена именно версия 1.2.3-5:

```bash
sdb -e "help" | head -3
# Должно быть: [sdb] Режим: sudo включён
```

### Переустановка

```bash
sudo pip3 uninstall sdb -y
cd sdb/
sudo pip3 install .
```

*Документация SDB v1.2.3-5 — Samba Database Query Tool*
