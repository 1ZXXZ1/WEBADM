# Samba API Server v2.0 — Изменения

## Новые функции

### 1. SDB (Samba Database Query Tool) — ИНТЕГРАЦИЯ
- **Новый AI инструмент `sdb_execute`** — заменяет 10-24 шаговые цепочки операций одним вызовом
- Прямой доступ к LDB базам Samba (sam, share, privilege, hklm, idmap, secrets, dns)
- SQL-like SELECT запросы: `SELECT cn,mail FROM USERS WHERE cn=*Admin*`
- SDB скриптовый движок для пакетных операций
- SYNTHESIS анализ схемы AD (сущности, связи, ассоциации)
- One-step экспорт: запрос + сохранение + ссылка для скачивания за 1 вызов

### 2. REST API `/api/v1/sdb/` — веб-доступ к SDB
- `POST /api/v1/sdb/query` — LDB запрос с LDAP фильтром
- `POST /api/v1/sdb/select` — SQL-like SELECT
- `POST /api/v1/sdb/show` — просмотр AD объектов из БД
- `POST /api/v1/sdb/script` — выполнение SDB скриптов
- `GET /api/v1/sdb/synthesis` — анализ схемы AD
- `POST /api/v1/sdb/export` — one-step экспорт + ссылка для скачивания
- `GET /api/v1/sdb/exports` — список экспортированных файлов
- `GET /api/v1/sdb/exports/{filename}` — скачивание файла

### 3. AI SKILL для SDB
- Создан навык `sdb` в `app/models/ai/SKILL/sdb/`
- SKILL.md с документацией по всем действиям SDB
- _meta.json с метаданными навыка

### 4. Лимит шагов AI — максимум 3 шага
- Если AI не может выполнить задачу за 3 шага → стоп + отчёт о невыполненном
- Новый параметр `AI_AGENT_MAX_STEPS_SIMPLE=3` (по умолчанию)
- Подробный отчёт о неудаче: какие шаги выполнены, какие нет, почему
- Подсказка использовать `sdb_execute` для одношаговых альтернатив

### 5. Веб-скачивание экспортов
- Все ссылки `download_url` теперь дополняются `download_url_full` с полным URL
- Формат: `http://host:port/api/v1/ai/exports/filename.xlsx`
- Работает из браузера без дополнительной настройки

## Новые файлы
- `app/sdb_lib/` — библиотека SDB (скопирована из sdb.zip)
- `app/services/sdb_service.py` — обёртка SDB для AI и REST API
- `app/routers/sdb.py` — REST API роутер для SDB
- `app/models/ai/SKILL/sdb/SKILL.md` — навык SDB для AI
- `app/models/ai/SKILL/sdb/_meta.json` — метаданные навыка

## Изменённые файлы
- `app/services/ai_agent_service.py` — добавлен `sdb_execute` в системный промпт, лимит шагов, отчёт о неудаче
- `app/services/ai_extended_tools.py` — добавлен инструмент `sdb_execute` и диспетчеризация
- `app/services/ai_data_tools.py` — добавлен `download_url_full` для веб-скачивания
- `app/routers/ai.py` — добавлен `download_url_full` в список экспортов
- `app/main.py` — зарегистрирован роутер SDB

## Примеры использования SDB

### AI (через sdb_execute):
```
# Экспорт пользователей в XLSX — 1 шаг вместо 10-24!
sdb_execute(action='export', filename='users.xlsx', filter='(objectClass=user)', 
             attrs='sAMAccountName,cn,department', exclude='Administrator,Guest,krbtgt')

# SQL-like запрос
sdb_execute(action='select', fields='sAMAccountName,cn,mail', scope='USERS', where='cn=*Ivan*')

# Анализ схемы AD
sdb_execute(action='synthesis', subcmd='SCHEMA')

# Запрос к другой БД
sdb_execute(action='query', database='share', filter='(objectClass=*)')
```

### REST API (через /api/v1/sdb/):
```bash
# SQL-like SELECT
curl -X POST http://localhost:8099/api/v1/sdb/select \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"fields": "sAMAccountName,cn,mail", "scope": "USERS"}'

# One-step экспорт
curl -X POST http://localhost:8099/api/v1/sdb/export \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"filename": "users.xlsx", "filter": "(objectClass=user)"}'

# Скачать файл
curl -O http://localhost:8099/api/v1/sdb/exports/users.xlsx \
  -H "X-API-Key: YOUR_KEY"
```
