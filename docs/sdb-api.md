# SDB API — Документация v-a.1.2

## Обзор

SDB (Samba Database Query Tool) — это REST API для прямого доступа к базам данных Samba LDB. Позволяет выполнять запросы к Active Directory, экспортировать данные в различные форматы (XLSX, CSV, JSON, TSV, LDIF) и скачивать файлы через веб-интерфейс.

### Ключевые преимущества

- **Прямой доступ к LDB** — обходит samba-tool, читает напрямую из баз Samba
- **ONE-STEP экспорт** — запрос + форматирование + сохранение + скачивание за один вызов API
- **NumPy-free** — XLSX экспорт использует openpyxl напрямую, без pandas/NumPy
- **ZIP скачивание** — автоматическая упаковка в ZIP архив
- **Авто-fallback** — при ошибке NumPy X86_V2 автоматически переключается на ldbsearch
- **Web-friendly эндпоинты** — `/full/{N}` и `/info/{N}` возвращают только данные, нужные вебу

### Что нового в v-a.1.2

- ✅ **Удалён SDB TaskBuilder** (`/api/v1/sdb/tasks`, `/templates`, `/schedules`, `/executions`).
  Все соответствующие файлы (`app/routers/sdb_taskbuilder.py`,
  `app/services/sdb_taskbuilder_service.py`,
  `docs/WebSDB_TaskBuilder_Spec.md`) удалены из проекта.
- ✅ **Добавлены web-friendly эндпоинты** `/full/{N}` и `/info/{N}` для
  удобной работы из веб-фронтенда: можно запросить `count`, конкретные
  поля или полный набор данных за один вызов.

---

## Базовый URL

```
http://<server>:8099/api/v1/sdb
```

Все эндпоинты требуют API-ключ в заголовке `X-API-Key`.

---

## Эндпоинты

### 1. GET /databases — Список баз данных

Возвращает список доступных LDB баз Samba с путями и описаниями.

**Запрос:**
```bash
curl -X GET http://192.168.104.12:8099/api/v1/sdb/databases \
  -H "X-API-Key: YOUR_API_KEY"
```

**Ответ:**
```json
{
  "success": true,
  "databases": {
    "sam": {
      "description": "Main AD database",
      "path": "/var/lib/samba/private/sam.ldb",
      "exists": true
    }
  }
}
```

---

### 2. GET /full/{entity} — Полный список записей сущности ⭐ (web-friendly)

Возвращает полный список записей указанного типа сущности.
Эндпоинт оптимизирован для веб-фронтенда: можно запросить конкретные
атрибуты, `*` (ВСЕ атрибуты LDAP) или оставить curated-набор.

**Поддерживаемые типы сущностей:**

| Entity | Описание | Принимаемые алиасы |
|--------|----------|-------------------|
| `users` | Пользователи | `user`, `пользователь`, `пользователи` |
| `groups` | Группы | `group`, `группа`, `группы` |
| `computers` | Компьютеры | `computer`, `компьютер`, `компьютеры` |
| `ous` | Организационные подразделения | `ou`, `organizationalunit`, `организационное подразделение` |
| `gpos` | Групповые политики | `gpo`, `grouppolicy`, `групповая политика` |
| `contacts` | Контакты | `contact`, `контакт`, `контакты` |
| `dns` | DNS записи | `dns_records`, `dnsrecords`, `dns запись` |

**Параметры запроса (Query):**

| Параметр | По умолч. | Описание |
|----------|-----------|----------|
| `fields` | `*` | Список атрибутов через запятую. `*` = ВСЕ атрибуты LDAP (без фильтрации). Если параметр не указан — curated-набор для веба |
| `where` | `""` | Необязательный фильтр вида `cn=*Admin*` |
| `exclude` | `""` | Исключить sAMAccountName через запятую |
| `limit` | `0` | Максимум записей (0 = все) |

**Три режима работы параметра `fields`:**

| Значение `fields` | Режим (`fields_mode`) | Что вернётся |
|-------------------|----------------------|--------------|
| (не указан) | `curated` | Минимальный набор полей, удобный для веба |
| `*` | `all` | **ВСЕ атрибуты LDAP**, которые есть у записей (без фильтрации) |
| `sAMAccountName,cn,mail` | `specific` | Только указанные поля |

**Curated-набор атрибутов (когда `fields` не указан):**

| Entity | Поля |
|--------|------|
| `users` | sAMAccountName, cn, displayName, mail, department, title, whenCreated, lastLogon, userAccountControl, memberOf, dn |
| `groups` | sAMAccountName, cn, description, groupType, member, whenCreated, dn |
| `computers` | sAMAccountName, cn, operatingSystem, operatingSystemVersion, lastLogon, whenCreated, userAccountControl, dn |
| `ous` | ou, name, description, whenCreated, dn |
| `gpos` | cn, displayName, gPCFileSysPath, versionNumber, whenCreated, dn |
| `contacts` | cn, displayName, mail, telephoneNumber, whenCreated, dn |
| `dns` | dc, dnsRecord, objectClass, dn |

**Запрос 1: ВСЕ атрибуты LDAP всех пользователей (без фильтрации)**
```bash
curl -X GET "http://192.168.104.12:8099/api/v1/sdb/full/users?fields=*" \
  -H "X-API-Key: YOUR_API_KEY"
```

**Запрос 2: curated-набор всех групп (короткий ответ для дашборда)**
```bash
curl -X GET "http://192.168.104.12:8099/api/v1/sdb/full/groups" \
  -H "X-API-Key: YOUR_API_KEY"
```

**Запрос 3: только имя и почта**
```bash
curl -X GET "http://192.168.104.12:8099/api/v1/sdb/full/users?fields=sAMAccountName,mail" \
  -H "X-API-Key: YOUR_API_KEY"
```

**Ответ (для `fields=*`, режим `all`):**
```json
{
  "success": true,
  "type": "users",
  "count": 17,
  "fields_mode": "all",
  "fields": ["dn", "cn", "sn", "givenName", "sAMAccountName", "mail",
             "displayName", "userAccountControl", "memberOf", "objectClass",
             "objectSid", "objectGUID", "whenCreated", "whenChanged",
             "lastLogon", "lastLogonTimestamp", "logonCount", "badPwdCount",
             "primaryGroupID", "userPrincipalName", "...все остальные атрибуты LDAP..."],
  "data": [
    {
      "dn": "CN=Administrator,CN=Users,DC=corp,DC=local",
      "cn": "Administrator",
      "sAMAccountName": "Administrator",
      "mail": "",
      "objectClass": ["top", "person", "organizationalPerson", "user"],
      "...": "..."
    }
  ]
}
```

**Ответ (для curated, когда `fields` не указан):**
```json
{
  "success": true,
  "type": "users",
  "count": 17,
  "fields_mode": "curated",
  "fields": ["sAMAccountName", "cn", "displayName", "mail", "department", "title",
             "whenCreated", "lastLogon", "userAccountControl", "memberOf", "dn"],
  "data": [
    {
      "sAMAccountName": "admin",
      "cn": "Administrator",
      "displayName": "Administrator",
      "mail": "",
      "department": "",
      "title": "",
      "whenCreated": "20230101120000.0Z",
      "lastLogon": "133...",
      "userAccountControl": "512",
      "memberOf": "CN=Domain Admins,CN=Users,DC=corp,DC=local",
      "dn": "CN=Administrator,CN=Users,DC=corp,DC=local"
    }
  ]
}
```

---

### 3. GET /info/{entity} — Лёгкая информация о сущности ⭐ (web-friendly)

Возвращает лёгкую сводку по сущности — только то, что нужно вебу.
По умолчанию возвращает только `count` (для дашбордов и счётчиков).

**Параметры запроса (Query):**

| Параметр | По умолч. | Описание |
|----------|-----------|----------|
| `fields` | `count` | `count` (только счётчик), `*` (ВСЕ атрибуты LDAP), или список конкретных атрибутов |
| `where` | `""` | Необязательный фильтр (применяется только если `fields != count`) |
| `exclude` | `""` | Исключить sAMAccountName через запятую |
| `limit` | `0` | Максимум записей (применяется только если `fields != count`) |

**Три режима работы параметра `fields`:**

| Значение `fields` | Режим (`fields_mode`) | Что вернётся |
|-------------------|----------------------|--------------|
| `count` (или не указан) | — | Только счётчик: `{success, type, count}` |
| `*` | `all` | **ВСЕ атрибуты LDAP** (без фильтрации) |
| `sAMAccountName,mail` | `specific` | Только указанные поля |

#### Режим 1: `fields=count` (по умолчанию) — только количество

```bash
curl -X GET "http://192.168.104.12:8099/api/v1/sdb/info/users" \
  -H "X-API-Key: YOUR_API_KEY"
```

```json
{
  "success": true,
  "type": "users",
  "count": 17
}
```

#### Режим 2: `fields=*` — ВСЕ атрибуты LDAP (без фильтрации)

```bash
curl -X GET "http://192.168.104.12:8099/api/v1/sdb/info/users?fields=*" \
  -H "X-API-Key: YOUR_API_KEY"
```

```json
{
  "success": true,
  "type": "users",
  "count": 17,
  "fields_mode": "all",
  "fields": ["dn", "cn", "sAMAccountName", "mail", "objectClass",
             "userAccountControl", "memberOf", "..."],
  "data": [
    {"dn": "...", "cn": "...", "sAMAccountName": "admin", "...": "..."}
  ]
}
```

#### Режим 3: конкретные поля — лёгкий список

Например, вебу нужны только имена и почты пользователей:

```bash
curl -X GET "http://192.168.104.12:8099/api/v1/sdb/info/users?fields=sAMAccountName,mail" \
  -H "X-API-Key: YOUR_API_KEY"
```

```json
{
  "success": true,
  "type": "users",
  "count": 17,
  "fields_mode": "specific",
  "fields": ["sAMAccountName", "mail"],
  "data": [
    {"sAMAccountName": "admin", "mail": ""},
    {"sAMAccountName": "ivan", "mail": "ivan@corp.local"}
  ]
}
```

**Типичный сценарий для дашборда:**

1. Сначала получаем только счётчики (дёшево, можно параллельно):
   ```bash
   GET /info/users         → {"count": 17}
   GET /info/groups        → {"count": 24}
   GET /info/computers     → {"count": 5}
   ```

2. При клике на «Пользователи» подгружаем минимальный набор для списка:
   ```bash
   GET /info/users?fields=sAMAccountName,cn,mail
   ```

3. При открытии карточки пользователя — ВСЕ атрибуты LDAP:
   ```bash
   GET /full/users?fields=*&where=sAMAccountName=admin
   ```

---

### 4. POST /query — Прямой LDB запрос

Выполняет запрос к LDB базе данных с LDAP фильтром.

**Параметры тела запроса:**

| Параметр | Тип | По умолч. | Описание |
|----------|-----|-----------|----------|
| database | string | "sam" | Имя LDB базы |
| filter | string | "" | LDAP фильтр |
| attrs | string | null | Атрибуты через запятую |
| base_dn | string | null | Base DN для поиска |
| exclude | string | "" | Исключить sAMAccountName через запятую |
| limit | int | 0 | Максимум записей (0=все) |
| format | string | "json" | Формат вывода |

**Запрос:**
```bash
curl -X POST http://192.168.104.12:8099/api/v1/sdb/query \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "database": "sam",
    "filter": "(objectClass=user)",
    "attrs": "sAMAccountName,cn,mail",
    "limit": 10
  }'
```

**Ответ:**
```json
{
  "success": true,
  "database": "sam",
  "filter": "(objectClass=user)",
  "rows": 4,
  "columns": ["sAMAccountName", "cn", "mail", "dn"],
  "data": [
    {"sAMAccountName": "admin", "cn": "Administrator", "mail": "", "dn": "CN=Administrator,..."},
    {"sAMAccountName": "ivan", "cn": "Ivan Ivanov", "mail": "ivan@corp.local", "dn": "CN=Ivan,..."}
  ],
  "total_rows": 4,
  "preview_rows": 4
}
```

---

### 5. POST /select — SQL-подобный SELECT

Выполняет SQL-подобный запрос к таблицам AD.

**Доступные таблицы:**

| Таблица | Описание | Ключевые атрибуты |
|---------|----------|-------------------|
| USERS | Пользователи | sAMAccountName, cn, mail, department |
| GROUPS | Группы | sAMAccountName, cn, description |
| COMPUTERS | Компьютеры | sAMAccountName, cn, operatingSystem |
| OUS | Подразделения | ou, description |
| GPOS | GPO политики | cn, displayName |
| CONTACTS | Контакты | cn, mail |
| DNS_RECORDS | DNS записи | dc, dnsRecord |

**Запрос:**
```bash
curl -X POST http://192.168.104.12:8099/api/v1/sdb/select \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "fields": "sAMAccountName,cn,mail",
    "scope": "USERS",
    "where": "cn=*Admin*"
  }'
```

**Ответ:**
```json
{
  "success": true,
  "query": "FORMAT json\nSELECT sAMAccountName, cn, mail FROM USERS WHERE cn=*Admin*",
  "rows": 2,
  "columns": ["sAMAccountName", "cn", "mail"],
  "data": [...],
  "total_rows": 2,
  "preview_rows": 2
}
```

---

### 6. POST /show — Показать объект AD

Показывает детали объекта AD напрямую из базы (без samba-tool).

**Запрос:**
```bash
curl -X POST http://192.168.104.12:8099/api/v1/sdb/show \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "object_type": "user",
    "name": "admin"
  }'
```

---

### 7. POST /script — Выполнить SDB скрипт

Выполняет SDB DSL скрипт с несколькими командами.

**Команды SDB:**
```
USE <database>        — Переключить базу
SELECT <fields> FROM <table> [WHERE <filter>]
FORMAT <format>       — Установить формат вывода
OUTPUT <filepath>     — Записать результат в файл
SHOW <type> [<name>]  — Показать объекты
TOOL <cmd> [args...]  — Выполнить samba-tool
LIST <type>           — Список объектов
SYNTHESIS [subcmd]    — Анализ схемы
```

**Запрос:**
```bash
curl -X POST http://192.168.104.12:8099/api/v1/sdb/script \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "script": "USE sam\nFORMAT json\nSELECT cn,mail FROM USERS WHERE cn=*Admin*\nOUTPUT /tmp/admins.json"
  }'
```

---

### 8. GET /synthesis — Анализ схемы AD

Анализирует схему базы данных Samba AD.

**Подкоманды:** SCHEMA, ENTITY, RELATION, ASSOCIATION, NORMALIZE

**Запрос:**
```bash
curl -X GET "http://192.168.104.12:8099/api/v1/sdb/synthesis?subcmd=SCHEMA" \
  -H "X-API-Key: YOUR_API_KEY"
```

---

### 9. POST /export — One-step экспорт ⭐

**Главный эндпоинт для экспорта.** Запрос + форматирование + сохранение + ZIP скачивание за один вызов.

**Параметры:**

| Параметр | Тип | По умолч. | Описание |
|----------|-----|-----------|----------|
| database | string | "sam" | Имя LDB базы |
| filter | string | "" | LDAP фильтр |
| attrs | string | null | Атрибуты через запятую |
| filename | string | "export.xlsx" | Имя файла (расширение = формат) |
| exclude | string | "" | Исключить sAMAccountName |
| base_dn | string | null | Base DN |
| as_zip | bool | true | Упаковать в ZIP |
| zip_name | string | "Samba-api-server-1.9-3.zip" | Имя ZIP архива |

**Поддерживаемые форматы (по расширению):**

| Расширение | Формат | Зависимости |
|------------|--------|-------------|
| .xlsx | Excel | openpyxl (без NumPy!) |
| .csv | CSV | стандартная библиотека |
| .json | JSON | стандартная библиотека |
| .tsv | TSV | стандартная библиотека |
| .ldif | LDIF | стандартная библиотека |

**Запрос (экспорт пользователей в XLSX + ZIP):**
```bash
curl -X POST http://192.168.104.12:8099/api/v1/sdb/export \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "database": "sam",
    "filter": "(objectClass=user)",
    "attrs": "sAMAccountName,cn,mail,department",
    "filename": "users.xlsx",
    "exclude": "Administrator,Guest,krbtgt",
    "as_zip": true,
    "zip_name": "Samba-api-server-1.9-3.zip"
  }'
```

**Ответ:**
```json
{
  "success": true,
  "path": "/home/AD-API-USER/ai-exports/Samba-api-server-1.9-3.zip",
  "filename": "Samba-api-server-1.9-3.zip",
  "inner_filename": "users.xlsx",
  "download_url": "/api/v1/sdb/exports/Samba-api-server-1.9-3.zip",
  "download_url_full": "http://192.168.104.12:8099/api/v1/sdb/exports/Samba-api-server-1.9-3.zip",
  "format": "xlsx",
  "rows": 4,
  "size_bytes": 6994,
  "raw_size_bytes": 7450
}
```

**Экспорт без ZIP:**
```bash
curl -X POST http://192.168.104.12:8099/api/v1/sdb/export \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"filename": "groups.csv", "filter": "(objectClass=group)", "as_zip": false}'
```

---

### 10. GET /export-download — Мгновенное скачивание ZIP

Тот же экспорт, но сразу возвращает файл как streaming download (без JSON ответа).

**Параметры запроса (Query):**

| Параметр | По умолч. | Описание |
|----------|-----------|----------|
| database | "sam" | Имя LDB базы |
| filter | "" | LDAP фильтр |
| filename | "export.xlsx" | Имя файла внутри ZIP |
| attrs | "" | Атрибуты через запятую |
| exclude | "" | Исключить записи |
| zip_name | "Samba-api-server-1.9-3.zip" | Имя ZIP архива |

**Запрос:**
```bash
curl -O -J "http://192.168.104.12:8099/api/v1/sdb/export-download?filename=users.xlsx&zip_name=Samba-api-server-1.9-3.zip" \
  -H "X-API-Key: YOUR_API_KEY"
```

Ответ: streaming ZIP файл с заголовками:
- `Content-Disposition: attachment; filename="Samba-api-server-1.9-3.zip"`
- `X-Export-Rows: 4`
- `X-Export-Format: xlsx`
- `X-Zip-Size: 6994`

---

### 11. GET /exports — Список файлов экспорта

Возвращает список всех экспортированных файлов.

**Запрос:**
```bash
curl -X GET http://192.168.104.12:8099/api/v1/sdb/exports \
  -H "X-API-Key: YOUR_API_KEY"
```

**Ответ:**
```json
{
  "files": [
    {
      "filename": "Samba-api-server-1.9-3.zip",
      "size_bytes": 6994,
      "modified": 1717692000.0,
      "download_url": "/api/v1/sdb/exports/Samba-api-server-1.9-3.zip"
    },
    {
      "filename": "users.xlsx",
      "size_bytes": 7450,
      "modified": 1717692000.0,
      "download_url": "/api/v1/sdb/exports/users.xlsx"
    }
  ],
  "total": 2,
  "export_dir": "/home/AD-API-USER/ai-exports"
}
```

---

### 12. GET /exports/{filename} — Скачать файл

Скачивает экспортированный файл по имени.

**Запрос:**
```bash
curl -O http://192.168.104.12:8099/api/v1/sdb/exports/Samba-api-server-1.9-3.zip \
  -H "X-API-Key: YOUR_API_KEY"
```

**Media types:**
| Расширение | Content-Type |
|------------|-------------|
| .zip | application/zip |
| .xlsx | application/vnd.openxmlformats-officedocument.spreadsheetml.sheet |
| .csv | text/csv |
| .json | application/json |
| .tsv | text/tab-separated-values |
| .ldif | text/plain |

**Ошибки:**
- `404` — файл не найден
- `400` — некорректное имя файла (попытка directory traversal)

---

## Архитектура: NumPy-free экспорт

### Проблема

На серверах с процессорами без поддержки X86_V2 инструкций (старые Intel/AMD CPU) NumPy вызывает RuntimeError:
```
NumPy was built with baseline optimizations: (X86_V2)
but your machine doesn't support: (X86_V2).
```

Это происходит при импорте цепочки: `sdb_service` → `sdb_lib` → `dataframe_fmt` → `pandas` → `numpy` → **CRASH**

### Решение (v1.9-3-2)

1. **Экспорт полностью изолирован** — `/export` и `/export-download` НЕ импортируют `sdb_service` для форматирования. Все форматирование делается локально в `sdb.py` с помощью openpyxl + stdlib.

2. **Ленивый импорт SDB клиента** — `_safe_get_sdb_client()` обёрнут в try/except, ловит NumPy ошибки и возвращает `None`.

3. **Авто-fallback на ldbsearch** — если SDB клиент недоступен, запросы выполняются через `ldbsearch` subprocess напрямую.

4. **Никакого pandas/NumPy** — XLSX экспорт использует только openpyxl, CSV/TSV/JSON/LDIF — стандартную библиотеку Python.

### Схема fallback

```
POST /export
    │
    ├── try: SdbClient.query() ──→ OK ──→ format with openpyxl
    │         │
    │         └── NumPy crash? ──→ _query_via_ldbsearch() ──→ format
    │
    └── any other error ──→ return {"success": false, "error": "..."}
```

---

## Примеры использования

### Экспорт всех пользователей в XLSX + ZIP

```bash
# 1. Экспорт
curl -X POST http://192.168.104.12:8099/api/v1/sdb/export \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"filename": "users.xlsx", "filter": "(objectClass=user)", "exclude": "Administrator,Guest,krbtgt"}'

# 2. Скачать ZIP
curl -O http://192.168.104.12:8099/api/v1/sdb/exports/Samba-api-server-1.9-3.zip \
  -H "X-API-Key: YOUR_KEY"

# 3. Распаковать
unzip Samba-api-server-1.9-3.zip
# → users.xlsx
```

### Экспорт групп в CSV

```bash
curl -X POST http://192.168.104.12:8099/api/v1/sdb/export \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"filename": "groups.csv", "filter": "(objectClass=group)", "as_zip": false}'
```

### Быстрый экспорт + скачивание в один шаг

```bash
curl -O -J "http://192.168.104.12:8099/api/v1/sdb/export-download?filename=users.xlsx&filter=(objectClass=user)" \
  -H "X-API-Key: YOUR_KEY"
```

### Запрос к share базе

```bash
curl -X POST http://192.168.104.12:8099/api/v1/sdb/query \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"database": "share", "filter": "(objectClass=*)"}'
```

### SQL-подобный поиск администраторов

```bash
curl -X POST http://192.168.104.12:8099/api/v1/sdb/select \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"fields": "sAMAccountName,cn,description", "scope": "GROUPS", "where": "cn=*Admin*"}'
```

---

## Коды ошибок

| Код | Описание |
|-----|----------|
| 200 | Успешный запрос |
| 400 | Некорректный запрос (невалидное имя файла и т.д.) |
| 404 | Файл не найден (для download) / Нет записей для экспорта |
| 500 | Внутренняя ошибка сервера |

---

## Переменные окружения

| Переменная | По умолч. | Описание |
|------------|-----------|----------|
| AI_AGENT_EXPORT_DIR | /home/AD-API-USER/ai-exports | Директория для экспорта |
| AI_API_BASE | http://127.0.0.1:8099 | Базовый URL API |
