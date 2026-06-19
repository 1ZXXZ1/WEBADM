# CFG API — Документация v2.1

## Обзор

CFG API — это REST API для управления конфигурацией WebADC (файлом `.env`) «на лету», **без перезагрузки сервиса `webadc`**. Все изменения применяются немедленно через горячую перезагрузку настроек в работающем процессе.

### Ключевые возможности

- **Просмотр** переменных окружения с автоматическим маскированием секретов
- **Обновление** и **создание** новых переменных
- **Удаление** переменных из `.env`
- **Отключение** переменных (пустое значение или `false`)
- **Включение** переменных (`true` или восстановление предыдущего значения)
- **Массовое обновление** нескольких переменных за одну атомарную операцию
- **Принудительная перезагрузка** настроек из `.env`
- **Скачивание** raw `.env` файла для бэкапа
- **Метаданные** (схема) всех известных настроек с описаниями

### Принцип горячего релоада

После каждой операции изменения (update/delete/disable/enable/bulk) роутер автоматически:

1. Вызывает `get_settings.cache_clear()` — очищает кэш `pydantic-settings`.
2. Триггерит повторное чтение `.env` через `get_settings()`.
3. Синхронизирует новые значения в `os.environ`, чтобы дочерние процессы (samba-tool и др.) также их получили.

В результате **перезагружать webadc не нужно** — следующий HTTP-запрос уже увидит обновлённые настройки.

---

## Базовый URL

```
http://<server>:8099/api/v1/cfg
```

Все эндпоинты требуют API-ключ в заголовке `X-API-Key` или JWT-токен в `Authorization: Bearer ...`.

---

## Права доступа (Permissions)

Эндпоинты CFG разделены на две категории прав:

### Read-only (доступны operator и auditor)

| Permission     | Эндпоинт                                   |
|----------------|---------------------------------------------|
| `cfg.list`     | `GET  /api/v1/cfg`                          |
| `cfg.show`     | `GET  /api/v1/cfg/{key}`                    |
| `cfg.schema`   | `GET  /api/v1/cfg/schema`                   |
| `cfg.reload`   | `POST /api/v1/cfg/reload`                   |

### Admin-only (только admin)

| Permission      | Эндпоинт                                    |
|-----------------|---------------------------------------------|
| `cfg.raw`       | `GET    /api/v1/cfg/raw`                    |
| `cfg.update`    | `PUT    /api/v1/cfg/{key}`                  |
| `cfg.bulk`      | `POST   /api/v1/cfg/bulk`                   |
| `cfg.delete`    | `DELETE /api/v1/cfg/{key}`                  |
| `cfg.disable`   | `POST   /api/v1/cfg/{key}/disable`          |
| `cfg.enable`    | `POST   /api/v1/cfg/{key}/enable`           |

Дополнительно `auditor` имеет доступ к `cfg.raw` (чтение raw `.env` для аудита), но не может изменять настройки.

---

## Маскирование секретов

Ключи, в имени которых есть (case-insensitive) следующие подстроки, считаются чувствительными и **маскируются** в ответах `GET`:

- `PASSWORD`, `PASSWD`
- `SECRET`
- `API_KEY`, `APIKEY`
- `TOKEN`
- `PRIVATE_KEY`, `CERT_KEY`, `KEYFILE_PASSWORD`
- `POLZA_AI_KEY`, `JWT_SECRET_KEY`

Маскированное значение отображается как `************` (12 звёздочек).

Чтобы увидеть реальные значения секретов, передайте `?reveal=true` (требуется admin).

---

## Эндпоинты

### 1. GET / — Список всех переменных

Возвращает все ключи из `.env` с их значениями (секреты маскируются).

```bash
curl -X GET http://192.168.104.12:8099/api/v1/cfg \
  -H "X-API-Key: YOUR_API_KEY"
```

**Ответ:**
```json
{
  "status": "ok",
  "env_file": "/etc/webadc/.env",
  "env_file_exists": true,
  "count": 6,
  "items": [
    {"key": "SAMBA_API_KEY",       "value": "************",         "masked": true,  "sensitive": true,  "comment": "Test config"},
    {"key": "SAMBA_API_PORT",      "value": "8099",                 "masked": false, "sensitive": false, "comment": null},
    {"key": "WEB_ENABLED",         "value": "true",                 "masked": false, "sensitive": false, "comment": null},
    {"key": "SAMBA_POLZA_AI_KEY",  "value": "************",         "masked": true,  "sensitive": true,  "comment": null},
    {"key": "SAMBA_LOG_LEVEL",     "value": "INFO",                 "masked": false, "sensitive": false, "comment": "A comment for LOG_LEVEL"},
    {"key": "SAMBA_USE_SUDO",      "value": "auto",                 "masked": false, "sensitive": false, "comment": null}
  ]
}
```

**Параметры запроса:**

| Параметр | Тип    | Default | Описание                                                |
|----------|--------|---------|---------------------------------------------------------|
| `reveal` | bool   | `false` | Если true — показать реальные значения секретов (admin). |

---

### 2. GET /schema — Схема известных настроек

Возвращает метаданные всех полей модели `Settings`: имена env-переменных, дефолтные значения, описания и флаг чувствительности. Удобно для построения админ-панели с подсказками.

```bash
curl -X GET http://192.168.104.12:8099/api/v1/cfg/schema \
  -H "X-API-Key: YOUR_API_KEY"
```

**Ответ (фрагмент):**
```json
{
  "status": "ok",
  "count": 78,
  "fields": [
    {
      "field": "API_KEY",
      "env_names": ["SAMBA_API_KEY"],
      "default": "",
      "description": "Static API key for authenticating API requests...",
      "sensitive": true
    },
    {
      "field": "API_PORT",
      "env_names": ["SAMBA_API_PORT"],
      "default": 8099,
      "description": "TCP port for the API HTTP server (1-65535).",
      "sensitive": false
    }
  ]
}
```

---

### 3. GET /raw — Скачать raw .env

Возвращает содержимое `.env` как `text/plain`. Полезно для бэкапа или переноса конфигурации.

```bash
curl -X GET http://192.168.104.12:8099/api/v1/cfg/raw \
  -H "X-API-Key: YOUR_API_KEY" \
  -o webadc.env.backup
```

**Ответ:** `text/plain` с `Content-Disposition: attachment; filename=".env"`.

---

### 4. GET /{key} — Посмотреть конкретную переменную

```bash
curl -X GET http://192.168.104.12:8099/api/v1/cfg/SAMBA_API_PORT \
  -H "X-API-Key: YOUR_API_KEY"
```

**Ответ:**
```json
{
  "status": "ok",
  "source": "env_file",
  "key": "SAMBA_API_PORT",
  "value": "8099",
  "masked": false,
  "sensitive": false,
  "comment": null,
  "in_env_file": true
}
```

Если ключ не найден в `.env`, но есть в `os.environ`, возвращается `source: "os.environ"`. Если не найден нигде — `404 Not Found`.

---

### 5. PUT /{key} — Обновить или создать переменную (hot-reload)

Обновляет значение переменной. Если ключа нет — он добавляется в конец `.env`. После записи настройки автоматически перезагружаются.

```bash
curl -X PUT http://192.168.104.12:8099/api/v1/cfg/SAMBA_API_PORT \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"value": "9000", "comment": "Changed via CFG API"}'
```

**Тело запроса (`CfgUpdateRequest`):**

| Поле     | Тип    | Описание                                                         |
|----------|--------|------------------------------------------------------------------|
| `value`  | string | Новое значение. Пустая строка = очистить (отключить).           |
| `comment`| string?| Необязательный комментарий над ключом (заменяет существующий).  |

**Параметры запроса:**

| Параметр | Тип   | Default | Описание                                              |
|----------|-------|---------|-------------------------------------------------------|
| `reload` | bool  | `true`  | Если true — перезагрузить настройки в работающем процессе. |

**Ответ:**
```json
{
  "status": "ok",
  "key": "SAMBA_API_PORT",
  "old_value": "8099",
  "new_value": "9000",
  "action": "updated",
  "env_file": "/etc/webadc/.env",
  "reloaded": {
    "ok": true,
    "errors": [],
    "method": "lru_cache_clear"
  }
}
```

---

### 6. POST /bulk — Массовое обновление

Принимает объект `{KEY: value, ...}` и обновляет все ключи за одну атомарную запись в `.env`. Затем перезагружает настройки.

```bash
curl -X POST http://192.168.104.12:8099/api/v1/cfg/bulk \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "items": {
      "SAMBA_API_PORT": "9000",
      "SAMBA_LOG_LEVEL": "DEBUG",
      "WEB_ENABLED": "true"
    },
    "reload": true
  }'
```

**Тело запроса (`CfgBulkUpdateRequest`):**

| Поле    | Тип                | Описание                              |
|---------|--------------------|---------------------------------------|
| `items` | `Dict[str, str]`  | Словарь KEY → новое значение.         |
| `reload`| bool (default true)| Перезагрузить настройки после записи. |

**Ответ:**
```json
{
  "status": "ok",
  "updated": 3,
  "results": [
    {"key": "SAMBA_API_PORT",  "action": "updated", "old_value": "8099",  "new_value": "9000"},
    {"key": "SAMBA_LOG_LEVEL", "action": "updated", "old_value": "INFO",  "new_value": "DEBUG"},
    {"key": "WEB_ENABLED",     "action": "updated", "old_value": "true",  "new_value": "true"}
  ],
  "env_file": "/etc/webadc/.env",
  "reloaded": {"ok": true, "errors": [], "method": "lru_cache_clear"}
}
```

---

### 7. DELETE /{key} — Удалить переменную (hot-reload)

Полностью удаляет переменную из `.env`. Если ключа нет — `404 Not Found`.

```bash
curl -X DELETE http://192.168.104.12:8099/api/v1/cfg/SAMBA_USE_SUDO \
  -H "X-API-Key: YOUR_API_KEY"
```

**Ответ:**
```json
{
  "status": "ok",
  "key": "SAMBA_USE_SUDO",
  "old_value": "auto",
  "deleted": true,
  "env_file": "/etc/webadc/.env",
  "reloaded": {"ok": true, "errors": [], "method": "lru_cache_clear"}
}
```

---

### 8. POST /{key}/disable — Отключить переменную

Устанавливает `KEY=` (пустое значение) или `KEY=false` (если `?as_false=true`). Сам ключ остаётся в `.env`.

```bash
# Установить WEB_ENABLED=false
curl -X POST "http://192.168.104.12:8099/api/v1/cfg/WEB_ENABLED/disable?as_false=true" \
  -H "X-API-Key: YOUR_API_KEY"

# Или установить пустое значение KEY=
curl -X POST http://192.168.104.12:8099/api/v1/cfg/SAMBA_POLZA_AI_KEY/disable \
  -H "X-API-Key: YOUR_API_KEY"
```

**Параметры запроса:**

| Параметр   | Тип   | Default | Описание                                                            |
|------------|-------|---------|---------------------------------------------------------------------|
| `reload`   | bool  | `true`  | Перезагрузить настройки после изменения.                            |
| `as_false` | bool  | `false` | Если true — записать `false` вместо пустой строки (для boolean).    |

**Ответ:**
```json
{
  "status": "ok",
  "key": "WEB_ENABLED",
  "old_value": "true",
  "new_value": "false",
  "action": "disabled",
  "env_file": "/etc/webadc/.env",
  "reloaded": {"ok": true, "errors": [], "method": "lru_cache_clear"}
}
```

---

### 9. POST /{key}/enable — Включить переменную

Включает переменную:

- Если передан `?value=...` — устанавливает указанное значение.
- Иначе пытается восстановить предыдущее значение из комментария (если ключ был отключён через `/disable`).
- Иначе устанавливает `true` (для boolean-флагов).

```bash
# Включить WEB_ENABLED=true
curl -X POST http://192.168.104.12:8099/api/v1/cfg/WEB_ENABLED/enable \
  -H "X-API-Key: YOUR_API_KEY"

# Включить с конкретным значением
curl -X POST "http://192.168.104.12:8099/api/v1/cfg/SAMBA_API_PORT/enable?value=8099" \
  -H "X-API-Key: YOUR_API_KEY"
```

**Параметры запроса:**

| Параметр | Тип    | Default | Описание                                              |
|----------|--------|---------|-------------------------------------------------------|
| `reload` | bool   | `true`  | Перезагрузить настройки после изменения.              |
| `value`  | string | `null`  | Явно указать новое значение. По умолчанию `true`.     |

**Ответ:**
```json
{
  "status": "ok",
  "key": "WEB_ENABLED",
  "old_value": "false",
  "new_value": "true",
  "action": "enabled",
  "env_file": "/etc/webadc/.env",
  "reloaded": {"ok": true, "errors": [], "method": "lru_cache_clear"}
}
```

---

### 10. POST /reload — Принудительно перезагрузить настройки

Перечитывает `.env` и обновляет настройки в работающем процессе. Полезно, если `.env` был изменён вручную (vim, ansible и т.п.).

```bash
curl -X POST http://192.168.104.12:8099/api/v1/cfg/reload \
  -H "X-API-Key: YOUR_API_KEY"
```

**Ответ:**
```json
{
  "status": "ok",
  "reloaded": {
    "ok": true,
    "errors": [],
    "method": "lru_cache_clear"
  },
  "env_file": "/etc/webadc/.env"
}
```

---

## Поиск .env файла

Роутер ищет `.env` в следующем порядке (совпадает с `app/config.py`):

1. `/etc/webadc/.env` — production (systemd deployment)
2. `./.env` — текущая рабочая директория (development)
3. `<project_root>/.env` — рядом с `app/`

Если ни один файл не найден, используется `/etc/webadc/.env` (будет создан при первой записи).

---

## Атомарная запись

Все операции записи (update/delete/disable/enable/bulk) используют атомарную запись:

1. Создаётся временный файл в той же директории.
2. Контент пишется во временный файл.
3. `os.replace()` атомарно заменяет оригинал.
4. Сохраняются права доступа (mode, owner, group) оригинального файла.

Это гарантирует, что даже при сбое питания или аварийном завершении процесса оригинальный `.env` не будет повреждён.

---

## Примеры сценариев

### Сценарий 1: Временно выключить AI Chat

```bash
# Отключить
curl -X POST http://192.168.104.12:8099/api/v1/cfg/AI_CHAT_ENABLED/disable?as_false=true \
  -H "X-API-Key: YOUR_API_KEY"

# Проверить
curl -X GET http://192.168.104.12:8099/api/v1/cfg/AI_CHAT_ENABLED \
  -H "X-API-Key: YOUR_API_KEY"
# → {"value": "false", ...}

# Включить обратно
curl -X POST http://192.168.104.12:8099/api/v1/cfg/AI_CHAT_ENABLED/enable \
  -H "X-API-Key: YOUR_API_KEY"
```

### Сценарий 2: Изменить порт и лог-уровень одновременно

```bash
curl -X POST http://192.168.104.12:8099/api/v1/cfg/bulk \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "items": {
      "SAMBA_API_PORT": "8443",
      "SAMBA_LOG_LEVEL": "DEBUG"
    }
  }'
```

### Сценарий 3: Сменить ключ Polza.ai

```bash
# Посмотреть текущий (замаскированный)
curl -X GET http://192.168.104.12:8099/api/v1/cfg/SAMBA_POLZA_AI_KEY \
  -H "X-API-Key: YOUR_API_KEY"
# → {"value": "************", "masked": true, ...}

# Установить новый (ззначение будет замаскировано в ответе)
curl -X PUT http://192.168.104.12:8099/api/v1/cfg/SAMBA_POLZA_AI_KEY \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"value": "pza_new_secret_key_abc123"}'

# Проверить (с reveal=true)
curl -X GET "http://192.168.104.12:8099/api/v1/cfg/SAMBA_POLZA_AI_KEY?reveal=true" \
  -H "X-API-Key: YOUR_API_KEY"
# → {"value": "pza_new_secret_key_abc123", ...}
```

### Сценарий 4: Бэкап и восстановление конфигурации

```bash
# Скачать бэкап
curl -X GET http://192.168.104.12:8099/api/v1/cfg/raw \
  -H "X-API-Key: YOUR_API_KEY" \
  -o webadc.env.backup

# После ручного редактирования — принудительно перезагрузить
curl -X POST http://192.168.104.12:8099/api/v1/cfg/reload \
  -H "X-API-Key: YOUR_API_KEY"
```

---

## Безопасность

1. **Маскирование секретов**: по умолчанию все `*PASSWORD*`, `*KEY*`, `*SECRET*`, `*TOKEN*` значения показываются как `************`. Используйте `?reveal=true` чтобы увидеть реальные значения (требует admin).

2. **Права доступа**: только `admin` может изменять настройки. `operator` и `auditor` имеют read-only доступ к `cfg.list/show/schema/reload`. `auditor` дополнительно имеет `cfg.raw` для аудита.

3. **Атомарная запись**: все изменения пишутся через временный файл + `os.replace()`. Оригинал `.env` не может быть повреждён даже при сбое посреди записи.

4. **Thread-safe**: используется `_WRITE_LOCK` для сериализации всех операций записи, предотвращая race conditions между параллельными запросами.

5. **Валидация имён ключей**: принимаются только имена вида `[A-Za-z_][A-Za-z0-9_]*`. Это предотвращает инъекции через имена переменных.

6. **Аудит**: все операции записи логируются через стандартный logger (`logging.getLogger(__name__)`).

---

## Что нового в v2.1

- ✅ **Новый роутер** `/api/v1/cfg` с 10 эндпоинтами для управления `.env`.
- ✅ **Hot-reload** настроек без перезагрузки webadc (`get_settings.cache_clear()`).
- ✅ **Маскирование секретов** (PASSWORD, KEY, SECRET, TOKEN) в GET-ответах.
- ✅ **Атомарная запись** с сохранением прав доступа оригинального файла.
- ✅ **Bulk-обновление** нескольких переменных за одну операцию.
- ✅ **Disable/Enable** для удобного включения/выключения фич.
- ✅ **Скачивание raw .env** для бэкапа.
- ✅ **Schema-эндпоинт** с метаданными всех известных настроек.
- ✅ **10 новых permissions** (`cfg.list/show/schema/raw/update/bulk/delete/disable/enable/reload`).
- ✅ **Полностью обновлённый `permissions.py`**: добавлены CFG permissions, обновлены `ALL_PERMISSIONS`, `READ_PERMISSIONS`, `DEFAULT_ROLE_PERMISSIONS`, `_PATH_PERM_MAP` и `resolve_permission()` с поддержкой динамических `{key}` сегментов.
