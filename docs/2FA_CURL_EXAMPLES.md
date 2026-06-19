# 2FA — curl команды для проверки

> Все команды предполагают, что сервер запущен на `http://localhost:8099`.
> Замените `<PASSWORD>` на реальный пароль пользователя `admin`.

---

## Шаг 1. Логин БЕЗ 2FA (чтобы получить токен для setup)

```bash
# Логин (2FA ещё не включена) → получаем JWT
curl -s -X POST http://localhost:8099/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username": "admin", "password": "<PASSWORD>"}' | jq

# Сохраняем access_token в переменную
export TOKEN=$(curl -s -X POST http://localhost:8099/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username": "admin", "password": "<PASSWORD>"}' | jq -r .access_token)

echo "TOKEN=$TOKEN"
```

---

## Шаг 2. Сгенерировать TOTP-секрет

```bash
# Получить secret + otpauth:// URI
curl -s -X POST http://localhost:8099/api/v1/auth/2fa/setup \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Пример ответа:**

```json
{
  "status": "ok",
  "data": {
    "secret": "JBSWY3DPEHPK3PXP",
    "otpauth_uri": "otpauth://totp/SambaAD:admin?secret=JBSWY3DPEHPK3PXP&issuer=SambaAD&algorithm=SHA1&digits=6&period=30",
    "username": "admin"
  },
  "next_step": "..."
}
```

Сохраните `secret` в переменную:

```bash
export TOTP_SECRET="JBSWY3DPEHPK3PXP"
```

---

## Шаг 3. Добавить секрет в Google Authenticator

**Вариант A — вручную:**
1. Откройте Google Authenticator
2. Нажмите "+" → "Ввести ключ настройки"
3. Учетная запись: `admin`
4. Ключ: `$TOTP_SECRET` (например `JBSWY3DPEHPK3PXP`)
5. Тип: "На основе времени"
6. Сохранить

**Вариант B — через QR-код** (нужен пакет `qrencode`):

```bash
# Сгенерировать QR-код в терминале из otpauth:// URI
OTPAUTH=$(curl -s -X POST http://localhost:8099/api/v1/auth/2fa/setup \
  -H "Authorization: Bearer $TOKEN" | jq -r .data.otpauth_uri)

qrencode -t ANSI "$OTPAUTH"
```

После этого в приложении появится 6-значный код, меняющийся каждые 30 секунд.

---

## Шаг 4. Включить 2FA (подтвердить кодом)

```bash
# Замените 123456 на ТЕКУЩИЙ код из Google Authenticator
export TOTP_CODE="123456"

curl -s -X POST http://localhost:8099/api/v1/auth/2fa/enable \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"secret\": \"$TOTP_SECRET\", \"code\": \"$TOTP_CODE\"}" | jq
```

**Ожидаемый ответ:**

```json
{
  "status": "ok",
  "message": "2FA enabled",
  "username": "admin"
}
```

---

## Шаг 5. Проверить статус 2FA

```bash
curl -s -X GET http://localhost:8099/api/v1/auth/2fa/status \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Ожидаемый ответ:**

```json
{
  "status": "ok",
  "data": {
    "enabled": true,
    "username": "admin"
  }
}
```

---

## Шаг 6. Логин С 2FA (двухшаговый)

### 6.1. Шаг 1 — обычный логин, получаем temp_token

```bash
# Теперь login НЕ возвращает access_token — вместо этого temp_token
curl -s -X POST http://localhost:8099/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username": "admin", "password": "<PASSWORD>"}' | jq
```

**Ожидаемый ответ:**

```json
{
  "status": "ok",
  "totp_required": true,
  "temp_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 300,
  "username": "admin",
  "next_step": "POST /api/v1/auth/login/verify with {temp_token, totp_code}"
}
```

Сохраняем temp_token:

```bash
export TEMP_TOKEN=$(curl -s -X POST http://localhost:8099/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username": "admin", "password": "<PASSWORD>"}' | jq -r .temp_token)

echo "TEMP_TOKEN=$TEMP_TOKEN"
```

### 6.2. Шаг 2 — верифицировать TOTP-код, получить полноценные токены

```bash
# Новый код из Google Authenticator (НЕ тот, что был при включении!)
export TOTP_CODE="234567"

curl -s -X POST http://localhost:8099/api/v1/auth/login/verify \
  -H 'Content-Type: application/json' \
  -d "{\"temp_token\": \"$TEMP_TOKEN\", \"totp_code\": \"$TOTP_CODE\"}" | jq
```

**Ожидаемый ответ:**

```json
{
  "status": "ok",
  "data": {
    "access_token": "eyJhbGci...",
    "refresh_token": "eyJhbGci...",
    "token_type": "bearer",
    "expires_in": 1800,
    "role": "admin",
    "permissions": ["user.create", "user.delete", ...],
    "username": "admin"
  }
}
```

Сохраняем новый access_token:

```bash
export TOKEN=$(curl -s -X POST http://localhost:8099/api/v1/auth/login/verify \
  -H 'Content-Type: application/json' \
  -d "{\"temp_token\": \"$TEMP_TOKEN\", \"totp_code\": \"$TOTP_CODE\"}" \
  | jq -r .data.access_token)

echo "TOKEN=$TOKEN"
```

---

## Шаг 7. Использовать полученный токен как обычно

```bash
# Список пользователей
curl -s http://localhost:8099/api/v1/users/ \
  -H "Authorization: Bearer $TOKEN" | jq

# Список mgmt-пользователей
curl -s http://localhost:8099/api/v1/mgmt/users \
  -H "Authorization: Bearer $TOKEN" | jq

# Создать пользователя
curl -s -X POST http://localhost:8099/api/v1/mgmt/users \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"username": "testuser", "password": "Test123!", "role": "operator"}' | jq
```

---

## Шаг 8. Отключить 2FA (если нужно)

```bash
# Требует текущий пароль для подтверждения
curl -s -X POST http://localhost:8099/api/v1/auth/2fa/disable \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"password": "<PASSWORD>"}' | jq
```

**Ожидаемый ответ:**

```json
{
  "status": "ok",
  "message": "2FA disabled",
  "username": "admin"
}
```

После этого логин снова работает в один шаг (без TOTP-кода).

---

## Полный сценарий одной командой (для тестирования)

```bash
#!/bin/bash
# test-2fa.sh — полный цикл: setup → enable → login → verify → use

set -e
SERVER="http://localhost:8099"
USER="admin"
PASS="<PASSWORD>"

echo "=== 1. Login (без 2FA) ==="
TOKEN=$(curl -s -X POST $SERVER/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\": \"$USER\", \"password\": \"$PASS\"}" | jq -r .access_token)
echo "TOKEN=${TOKEN:0:50}..."

echo ""
echo "=== 2. Setup 2FA ==="
SETUP=$(curl -s -X POST $SERVER/api/v1/auth/2fa/setup \
  -H "Authorization: Bearer $TOKEN")
SECRET=$(echo "$SETUP" | jq -r .data.secret)
echo "SECRET=$SECRET"
echo "otpauth:// URI:"
echo "$SETUP" | jq -r .data.otpauth_uri

echo ""
echo "=== 3. Сгенерировать TOTP-код из секрета ==="
# Нужен пакет: pip install pyotp
CODE=$(python3 -c "import pyotp; print(pyotp.TOTP('$SECRET').now())")
echo "CODE=$CODE (действителен 30 сек)"

echo ""
echo "=== 4. Enable 2FA ==="
curl -s -X POST $SERVER/api/v1/auth/2fa/enable \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"secret\": \"$SECRET\", \"code\": \"$CODE\"}" | jq

echo ""
echo "=== 5. Status ==="
curl -s $SERVER/api/v1/auth/2fa/status \
  -H "Authorization: Bearer $TOKEN" | jq

echo ""
echo "=== 6. Login (теперь требует 2FA) ==="
TEMP_TOKEN=$(curl -s -X POST $SERVER/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\": \"$USER\", \"password\": \"$PASS\"}" | jq -r .temp_token)
echo "TEMP_TOKEN=${TEMP_TOKEN:0:50}..."

echo ""
echo "=== 7. Сгенерировать НОВЫЙ код (старый уже использован) ==="
sleep 1
CODE2=$(python3 -c "import pyotp; print(pyotp.TOTP('$SECRET').now())")
echo "CODE2=$CODE2"

echo ""
echo "=== 8. Verify (получаем полноценные токены) ==="
NEW_TOKEN=$(curl -s -X POST $SERVER/api/v1/auth/login/verify \
  -H 'Content-Type: application/json' \
  -d "{\"temp_token\": \"$TEMP_TOKEN\", \"totp_code\": \"$CODE2\"}" \
  | jq -r .data.access_token)
echo "NEW_TOKEN=${NEW_TOKEN:0:50}..."

echo ""
echo "=== 9. Использовать новый токен ==="
curl -s $SERVER/api/v1/auth/me \
  -H "Authorization: Bearer $NEW_TOKEN" | jq

echo ""
echo "=== 10. Отключить 2FA (для повторного теста) ==="
CODE3=$(python3 -c "import pyotp; print(pyotp.TOTP('$SECRET').now())")
# Сначала нужно залогиниться с 2FA (повтор шагов 6-8), потом disable
# Этот шаг оставляем как упражнение
echo "Для отключения: curl -X POST /api/v1/auth/2fa/disable -H 'Authorization: Bearer $NEW_TOKEN' -d '{\"password\": \"$PASS\"}'"
```

---

## CLI альтернатива (ds_auth.py)

Все то же самое через CLI:

```bash
# 1. Логин + сохранение токена
python3 ds_auth.py login admin <PASSWORD> --save

# 2. Сгенерировать секрет
python3 ds_auth.py 2fa setup

# 3. (в Google Authenticator добавить secret)

# 4. Включить 2FA
python3 ds_auth.py 2fa enable --secret JBSWY3DPEHPK3PXP --code 123456

# 5. Проверить статус
python3 ds_auth.py 2fa status

# 6. Логин (вернёт totp_required + temp_token)
python3 ds_auth.py login admin <PASSWORD> --save
# → в выводе будет temp_token

# 7. Верифицировать (с новым кодом)
python3 ds_auth.py 2fa verify \
  --temp-token "eyJhbGci..." \
  --code 234567 \
  --save

# 8. Теперь ~/.ds_auth_token содержит полноценный токен
python3 ds_auth.py whoami
python3 ds_auth.py user list

# 9. Отключить 2FA (если нужно)
python3 ds_auth.py 2fa disable --password <PASSWORD>
```

---

## Диагностика ошибок

### `401 Not authenticated` на `/2fa/setup`

**Причина:** Не передан `Authorization: Bearer <token>` заголовок.

**Решение:** Сначала залогиньтесь без 2FA и получите токен.

### `400 Invalid TOTP code — try again` на `/2fa/enable`

**Причина:** Код из приложения не совпадает с ожидаемым.

**Решения:**
- Проверьте, что время на сервере синхронизировано: `timedatectl status`
- Допускается окно ±30 секунд (1 step)
- Убедитесь, что ввели тот же secret, что вернул `/2fa/setup`

### `401 Invalid temp_token` на `/auth/login/verify`

**Причина:** temp_token истёк (TTL 5 минут) или подписан другим ключом.

**Решение:** Повторите шаг 6.1 — получите новый temp_token.

### `401 Invalid TOTP code` на `/auth/login/verify`

**Причина:** Код неверный или уже использован.

**Решение:** Подождите новый 30-секундный window и введите свежий код.

### `500 Failed to enable 2FA: ...` на `/2fa/enable`

**Причина:** Чаще всего — `cryptography` пакет не установлен (нужен для Fernet-шифрования секрета в БД).

**Решение:**

```bash
pip install cryptography
```

### `400 2FA management requires a JWT or a DB-backed API key`

**Причина:** Вы используете статический API-key из `.env` (`SAMBA_API_KEY`), у которого нет ассоциированного пользователя в БД.

**Решение:** Используйте JWT-токен (через `login`) или DB-backed API-key (созданный через `ds_auth.py key create`).

---

## Использование 2FA с API-ключами

API-ключи **не требуют** 2FA — 2FA применяется только к JWT-логину по логину/паролю. Это сделано осознанно, потому что:

- API-ключи — это long-lived токены для автоматизации (CI/CD, скрипты)
- 2FA требует интерактивного ввода кода из приложения
- API-ключи можно ротировать (rotate) или отключить (disable) при компрометации

Если нужно «отозвать» доступ при включенной 2FA — отключите все API-ключи пользователя через `ds_auth.py user keys <id> --include-inactive` и затем `ds_auth.py key disable <key_id>` для каждого.

---

# Admin API — управление 2FA других пользователей (v2.3.1)

> Все admin endpoints требуют роль `admin`.
> Работают **с X-API-Key** (admin API key) **или** с `Authorization: Bearer <admin-JWT>`.

## Список admin endpoints

| Метод | Path | Описание |
|------|------|----------|
| GET | `/api/v1/mgmt/users/{user_id}/2fa/status` | Статус 2FA пользователя |
| POST | `/api/v1/mgmt/users/{user_id}/2fa/setup` | Сгенерировать секрет (НЕ сохраняется) |
| POST | `/api/v1/mgmt/users/{user_id}/2fa/enable` | Включить 2FA (с кодом или `?force=true`) |
| POST | `/api/v1/mgmt/users/{user_id}/2fa/disable` | Отключить 2FA (секрет сохраняется) |
| POST | `/api/v1/mgmt/users/{user_id}/2fa/reset` | Полный сброс (секрет удаляется) |
| GET | `/api/v1/mgmt/2fa/enabled` | Список всех с включённой 2FA |
| GET | `/api/v1/mgmt/2fa/disabled` | Список с секретом, но 2FA выключена |

---

## Подготовка — получить admin API-key

```bash
# Если у вас уже есть admin API-key в .env, используйте его
export ADMIN_KEY="ваш-admin-api-key"

# Или залогиньтесь как admin и используйте JWT
export ADMIN_TOKEN=$(curl -k -s -X POST https://192.168.104.12:8099/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<PASSWORD>"}' | jq -r .access_token)
```

Далее в примерах используется `$ADMIN_KEY` (или `$ADMIN_TOKEN` — замените заголовок).

---

## 1. Проверить статус 2FA пользователя

```bash
# По user_id (узнать можно через `ds_auth.py user list`)
curl -k -s https://192.168.104.12:8099/api/v1/mgmt/users/5/2fa/status \
  -H "X-API-Key: $ADMIN_KEY" | jq
```

**Ответ:**

```json
{
  "user_id": 5,
  "username": "operator1",
  "enabled": false,
  "has_secret": false
}
```

---

## 2. Сгенерировать TOTP-секрет для пользователя

```bash
curl -k -s -X POST https://192.168.104.12:8099/api/v1/mgmt/users/5/2fa/setup \
  -H "X-API-Key: $ADMIN_KEY" | jq
```

**Ответ:**

```json
{
  "user_id": 5,
  "username": "operator1",
  "secret": "JBSWY3DPEHPK3PXP",
  "otpauth_uri": "otpauth://totp/SambaAD:operator1?secret=JBSWY3DPEHPK3PXP&issuer=SambaAD&algorithm=SHA1&digits=6&period=30",
  "stored": false
}
```

**Важно:** `stored: false` — секрет пока НЕ сохранён в БД. Передайте секрет
пользователю через защищённый канал (зашифрованное письмо, password manager share).

Сохраните секрет в переменную:

```bash
export TOTP_SECRET="JBSWY3DPEHPK3PXP"
export TARGET_USER_ID=5
```

---

## 3. Включить 2FA для пользователя

### Вариант A — с кодом из приложения пользователя (рекомендуется)

Пользователь добавил секрет в Google Authenticator и сообщил вам 6-значный код:

```bash
# Код от пользователя
export TOTP_CODE="123456"

curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/users/$TARGET_USER_ID/2fa/enable" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"secret\":\"$TOTP_SECRET\",\"code\":\"$TOTP_CODE\"}" | jq
```

**Ответ:**

```json
{
  "status": "ok",
  "message": "2FA enabled for user #5 (operator1)",
  "user_id": 5,
  "username": "operator1",
  "force": false
}
```

### Вариант B — принудительно, без проверки кода (RECOVERY)

Если пользователь не может предоставить код прямо сейчас (например, ещё не
настроил приложение), можно включить 2FA с `?force=true` — секрет сохранится
без проверки. **Пользователь должен добавить секрет в приложение, иначе не
сможет войти!**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/users/$TARGET_USER_ID/2fa/enable?force=true" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"secret\":\"$TOTP_SECRET\"}" | jq
```

**Ответ:**

```json
{
  "status": "ok",
  "message": "2FA enabled for user #5 (operator1)",
  "user_id": 5,
  "username": "operator1",
  "force": true
}
```

---

## 4. Отключить 2FA (секрет сохраняется)

Если пользователь потерял телефон — отключите 2FA, чтобы он мог войти
по логину/паролю и заново настроить 2FA. Секрет остаётся в БД, потом
можно включить обратно через `enable` с тем же секретом.

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/users/$TARGET_USER_ID/2fa/disable" \
  -H "X-API-Key: $ADMIN_KEY" | jq
```

**Ответ:**

```json
{
  "status": "ok",
  "message": "2FA disabled for user #5 (operator1). Secret kept — use /reset to wipe it.",
  "user_id": 5,
  "username": "operator1"
}
```

---

## 5. Полный сброс 2FA (секрет удаляется)

Если нужно полностью удалить секрет (например, секрет скомпрометирован),
используйте `reset` — это удалит секрет из БД. Пользователь должен будет
заново пройти `setup` → `enable`.

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/users/$TARGET_USER_ID/2fa/reset" \
  -H "X-API-Key: $ADMIN_KEY" | jq
```

**Ответ:**

```json
{
  "status": "ok",
  "message": "2FA fully reset for user #5 (operator1). User must run /setup again to re-enable.",
  "user_id": 5,
  "username": "operator1"
}
```

---

## 6. Список всех пользователей с включённой 2FA

```bash
curl -k -s https://192.168.104.12:8099/api/v1/mgmt/2fa/enabled \
  -H "X-API-Key: $ADMIN_KEY" | jq
```

**Ответ:**

```json
{
  "status": "ok",
  "total": 2,
  "data": [
    {"id": 1, "username": "admin", "role": "admin", "is_active": 1},
    {"id": 5, "username": "operator1", "role": "operator", "is_active": 1}
  ]
}
```

---

## 7. Список пользователей с секретом, но 2FA выключена

Полезно для аудита — кто раньше включал 2FA, но потом отключил.

```bash
curl -k -s https://192.168.104.12:8099/api/v1/mgmt/2fa/disabled \
  -H "X-API-Key: $ADMIN_KEY" | jq
```

---

## Типичный сценарий: настроить 2FA для нового сотрудника

```bash
#!/bin/bash
set -e
SERVER="https://192.168.104.12:8099"
ADMIN_KEY="ваш-admin-api-key"
NEW_USER_ID=7    # ID нового сотрудника (узнать через `ds_auth.py user list`)

echo "=== 1. Проверить текущий статус ==="
curl -k -s "$SERVER/api/v1/mgmt/users/$NEW_USER_ID/2fa/status" \
  -H "X-API-Key: $ADMIN_KEY" | jq

echo ""
echo "=== 2. Сгенерировать секрет ==="
SETUP=$(curl -k -s -X POST "$SERVER/api/v1/mgmt/users/$NEW_USER_ID/2fa/setup" \
  -H "X-API-Key: $ADMIN_KEY")
SECRET=$(echo "$SETUP" | jq -r .secret)
URI=$(echo "$SETUP" | jq -r .otpauth_uri)
echo "Secret: $SECRET"
echo "URI:    $URI"

echo ""
echo "=== 3. Передайте секрет сотруднику ==="
echo "Сотрудник должен:"
echo "  1. Открыть Google Authenticator"
echo "  2. Добавить запись: account=$NEW_USER_ID, key=$SECRET"
echo "  3. Сообщить вам 6-значный код из приложения"
echo ""
read -p "Введите код от сотрудника: " CODE

echo ""
echo "=== 4. Включить 2FA ==="
curl -k -s -X POST "$SERVER/api/v1/mgmt/users/$NEW_USER_ID/2fa/enable" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"secret\":\"$SECRET\",\"code\":\"$CODE\"}" | jq

echo ""
echo "=== 5. Проверить статус ==="
curl -k -s "$SERVER/api/v1/mgmt/users/$NEW_USER_ID/2fa/status" \
  -H "X-API-Key: $ADMIN_KEY" | jq
```

---

## Сценарий: пользователь потерял телефон (recovery)

```bash
SERVER="https://192.168.104.12:8099"
ADMIN_KEY="ваш-admin-api-key"
USER_ID=5

# Вариант 1: временно отключить 2FA (пользователь сможет войти без кода)
# Секрет сохраняется — потом можно включить обратно с тем же секретом
curl -k -s -X POST "$SERVER/api/v1/mgmt/users/$USER_ID/2fa/disable" \
  -H "X-API-Key: $ADMIN_KEY" | jq

# Пользователь входит по логину/паролю, настраивает новое приложение
# с тем же секретом, затем просит admin включить 2FA обратно:
# curl -X POST .../enable -d '{"secret":"<тот же секрет>","code":"<новый код>"}'

# Вариант 2: полный сброс — секрет удалить, настроить заново
# Используется, если секрет скомпрометирован
curl -k -s -X POST "$SERVER/api/v1/mgmt/users/$USER_ID/2fa/reset" \
  -H "X-API-Key: $ADMIN_KEY" | jq

# После reset нужно заново: setup → передать секрет → enable
```

---

## CLI альтернатива (ds_auth.py)

Все admin операции доступны через CLI:

```bash
# Использовать admin API key
export SAMBA_API_KEY="ваш-admin-api-key"

# Или залогиниться как admin
python3 ds_auth.py login admin <PASSWORD> --save

# Статус 2FA пользователя
python3 ds_auth.py 2fa admin status 5

# Сгенерировать секрет для пользователя
python3 ds_auth.py 2fa admin setup 5

# Включить 2FA (с кодом)
python3 ds_auth.py 2fa admin enable 5 --secret JBSWY3DPEHPK3PXP --code 123456

# Включить 2FA принудительно (без кода — RECOVERY)
python3 ds_auth.py 2fa admin enable 5 --secret JBSWY3DPEHPK3PXP --force

# Отключить 2FA (секрет сохраняется)
python3 ds_auth.py 2fa admin disable 5

# Полный сброс (секрет удаляется)
python3 ds_auth.py 2fa admin reset 5

# Список всех с включённой 2FA
python3 ds_auth.py 2fa admin list-enabled

# Список с секретом, но 2FA выключена
python3 ds_auth.py 2fa admin list-disabled
```

---

## Сводная таблица: self-service vs admin

| Операция | Self-service (`/auth/2fa/*`) | Admin (`/mgmt/users/{id}/2fa/*`) |
|----------|------------------------------|----------------------------------|
| **Кто может** | Любой аутентифицированный пользователь | Только admin (X-API-Key или JWT) |
| **На ком** | Только на себе | На любом пользователе по user_id |
| **setup** (генерация секрета) | ✓ для себя | ✓ для любого |
| **enable** (включить с кодом) | ✓ требует свой код | ✓ требует код пользователя ИЛИ `?force=true` |
| **disable** (отключить) | ✓ требует свой пароль | ✓ без пароля (admin override) |
| **reset** (удалить секрет) | — (нет self-service reset) | ✓ |
| **status** (проверить) | ✓ для себя | ✓ для любого |
| **list-enabled/disabled** | — | ✓ |

---

## Защита и безопасность

1. **Admin endpoints требуют роль `admin`** — проверяется через `request.state.role` в `_require_admin()`.
2. **Не-админ получает 403** — даже если у него есть валидный JWT/API-key.
3. **Secret НЕ возвращается из `status`** — только флаг `has_secret: true/false`.
4. **Secret НЕ возвращается из `disable`/`reset`** — операция необратима для reset.
5. **`enable?force=true`** — помечен в ответе `"force": true`, чтобы было видно в аудите.
6. **Все admin-операции логируются** в `mgmt_audit_log` через стандартный middleware.

## Возможные ошибки

### `403 Admin role required (your role: 'operator')`

**Причина:** Ваш API-key/JWT принадлежит пользователю с ролью `operator`, а не `admin`.

**Решение:** Используйте admin API-key или залогиньтесь как admin.

### `404 User #5 not found`

**Причина:** В URL указан несуществующий `user_id`.

**Решение:** Проверьте ID через `curl .../api/v1/mgmt/users -H "X-API-Key: $ADMIN_KEY"`.

### `400 TOTP code is required (or pass ?force=true to skip verification)`

**Причина:** Вызов `enable` без `code` и без `?force=true`.

**Решение:** Добавьте `code` в body, либо `?force=true` в URL.

### `400 Invalid TOTP code — try again, or pass ?force=true to skip verification`

**Причина:** Код неверный или истёк (TTL 30 секунд).

**Решение:** Запросите новый код у пользователя, либо используйте `?force=true` для recovery.
