# API Документация

## Обзор

Фронтенд общается с Python/FastAPI бэкендом через REST API. Базовый URL по умолчанию — `/api/v1` (проксируется через Next.js API Proxy на `http://localhost:8080/api/v1`).

Все типы запросов и ответов определены в `src/lib/api-types.ts`.

## Аутентификация

### POST /auth/login — Вход по паролю

**Запрос:**
```json
{
  "username": "admin",
  "password": "secret"
}
```

**Успешный ответ (200):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin",
    "permissions": ["user.list", "user.create", "group.list", "..."],
    "is_active": true
  }
}
```

**Ошибка (401):**
```json
{
  "detail": "Invalid credentials"
}
```

### POST /auth/check — Проверка прав (по API-ключу или паролю)

**С API-ключом (заголовок `X-API-Key`):**
```
POST /auth/check
X-API-Key: sk-xxxxxxxxxxxx
```

**С паролем (body):**
```json
{
  "username": "admin",
  "password": "secret"
}
```

**Ответ:**
```json
{
  "valid": true,
  "role": "admin",
  "user_id": 1,
  "permissions": ["user.list", "user.create", "..."]
}
```

### GET /auth/me — Информация о текущем пользователе

**Заголовок:** `Authorization: Bearer <access_token>`

**Ответ:**
```json
{
  "username": "admin",
  "role": "admin",
  "permissions": ["user.list", "user.create", "..."]
}
```

### POST /auth/refresh — Обновление JWT токена

**Запрос:**
```json
{
  "refresh_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Ответ:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

## Пользователи AD

### GET /users/list — Список пользователей
### POST /users/create — Создание пользователя
### GET /users/{username} — Информация о пользователе
### PUT /users/{username} — Обновление пользователя
### DELETE /users/{username} — Удаление пользователя
### POST /users/{username}/enable — Включение учётной записи
### POST /users/{username}/disable — Отключение учётной записи
### POST /users/{username}/password — Сброс пароля

**Пример POST /users/create:**
```json
{
  "username": "jdoe",
  "password": "P@ssw0rd123",
  "given_name": "John",
  "surname": "Doe",
  "mail_address": "jdoe@example.com",
  "department": "IT",
  "job_title": "System Administrator",
  "userou": "OU=IT,DC=example,DC=com",
  "must_change_at_next_login": true
}
```

## Группы

### GET /groups/list — Список групп
### POST /groups/create — Создание группы
### GET /groups/{groupname} — Информация о группе
### DELETE /groups/{groupname} — Удаление группы
### POST /groups/{groupname}/members/add — Добавление участников
### POST /groups/{groupname}/members/remove — Удаление участников

## Компьютеры

### GET /computers/list — Список компьютеров
### GET /computers/{computername} — Информация о компьютере
### DELETE /computers/{computername} — Удаление компьютера

## DNS

### GET /dns/zones — Список DNS зон
### GET /dns/zones/{zone}/records — Записи зоны
### POST /dns/zones/{zone}/records — Добавление записи
### DELETE /dns/zones/{zone}/records — Удаление записи

## GPO

### GET /gpo/list — Список групповых политик
### GET /gpo/{gpo_id} — Информация о GPO

## Домен

### GET /domain/info — Информация о домене
### GET /domain/level — Уровни функциональности
### GET /domain/password-policy — Политика паролей
### GET /domain/fsmo-roles — FSMO роли

## Shell

### GET /shell/list — Доступные оболочки
### POST /shell/exec — Выполнение команды
### POST /shell/script — Выполнение скрипта

**Пример POST /shell/exec:**
```json
{
  "shell": "bash",
  "sudo": false,
  "cmd": "samba-tool domain level show",
  "timeout": 30
}
```

## Shell Projects

### GET /shell/projects — Список проектов
### POST /shell/projects — Создание проекта
### GET /shell/projects/{id} — Информация о проекте
### POST /shell/projects/{id}/run — Запуск проекта
### DELETE /shell/projects/{id} — Удаление проекта

## Batch (ETL)

### POST /batch — Выполнение пакетных операций

```json
{
  "actions": [
    { "id": "1", "method": "users.create", "params": { "username": "user1" } },
    { "id": "2", "method": "groups.add_member", "params": { "groupname": "Users", "username": "user1" } }
  ],
  "stop_on_failure": true
}
```

## AI

### GET /ai/config — Конфигурация AI
### GET /ai/schema — Схема API для AI
### POST /ai/assistant — Запрос к AI ассистенту
### POST /ai/agent — Запрос к AI агенту

## Управление

### GET /mgmt/users — Список API пользователей
### POST /mgmt/users — Создание API пользователя
### GET /mgmt/keys — Список API ключей
### POST /mgmt/keys — Создание API ключа
### GET /mgmt/roles — Список ролей

## Health

### GET /health — Проверка состояния бэкенда
### GET /dashboard/overview — Обзор дашборда

## Формат ошибок

Бэкенд возвращает ошибки в формате FastAPI:

```json
{
  "detail": "Error message string"
}
```

Или при ошибках валидации:
```json
{
  "detail": [
    {
      "type": "missing",
      "loc": ["body", "username"],
      "msg": "Field required",
      "input": null
    }
  ]
}
```

Клиентский код в `api.ts` автоматически парсит оба формата через функцию `getErrorMessage()`.
