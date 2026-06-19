---

## ds_auth.py — CLI утилита для управления аутентификацией

> **v2.3** — добавлены: full system prompt override для AI, webhooks,
> backup/restore, 2FA setup, dashboard charts, bulk AD-users, audit
> export, live events. См. `docs/MGMT_API_v3.md` для полного API-справочника.

### Команды верхнего уровня

| Команда | Описание |
|---------|----------|
| `login` | Войти по логину/паролю, получить JWT |
| `refresh` | Обновить JWT-токен |
| `whoami` | Информация о текущем пользователе |
| `status` | Проверить подключение к API |
| `quickkey` | Быстрое создание ключа (логин + создать ключ одной командой) |
| `stats` | **(v2.2)** Сводная статистика Management API (пользователи, ключи, роли) |
| `bulk` | **(v2.2)** Массовые операции над пользователями/ключами |

### user — Управление пользователями

```bash
python3 ds_auth.py user list                                    # Список пользователей
python3 ds_auth.py user list -s ivan                            # Поиск по username/имени/email
python3 ds_auth.py user create operator1 -p secret123 -r operator          # Создать
python3 ds_auth.py user create boss -p P@ss -r admin -w 100                # С высоким весом
python3 ds_auth.py user show 2                                  # Показать по ID
python3 ds_auth.py user edit 2 --role admin --weight 50         # Изменить роль и вес
python3 ds_auth.py user edit 2 --password newpass               # Сменить пароль
python3 ds_auth.py user delete 2 --confirm                      # Деактивировать (мягко)
python3 ds_auth.py user delete 2 --hard --confirm               # Безвозвратно (с каскадом ключей)
python3 ds_auth.py user enable 2                                # (v2.2) Включить
python3 ds_auth.py user disable 2                               # (v2.2) Отключить + все ключи
python3 ds_auth.py user purge 2 --confirm                       # (v2.2) Безвозвратно удалить
python3 ds_auth.py user reset-password 2                        # (v2.2) Случайный пароль (генерирует сервер)
python3 ds_auth.py user reset-password 2 -p MyNewPass           # (v2.2) Задать свой пароль
python3 ds_auth.py user keys 2                                  # (v2.2) Список API-ключей пользователя
python3 ds_auth.py user keys 2 --include-inactive               # Включая отключённые
```

### key — Управление API-ключами

```bash
python3 ds_auth.py key list                                     # Список ключей
python3 ds_auth.py key list -s ci                               # Поиск по name/description
python3 ds_auth.py key create --user-id 1 -n "my-key" -r operator  # Создать
python3 ds_auth.py key create --user-id 1 -n "ci" -w 50 --expires-days 90  # С весом и TTL
python3 ds_auth.py key show 3                                   # Детали ключа
python3 ds_auth.py key edit 3 --role admin --weight 100         # Изменить роль и вес
python3 ds_auth.py key delete 3 --confirm                       # Деактивировать (мягко)
python3 ds_auth.py key delete 3 --hard --confirm                # Безвозвратно
python3 ds_auth.py key enable 3                                 # (v2.2) Включить (если user активен)
python3 ds_auth.py key disable 3                                # (v2.2) Отключить (мягко)
python3 ds_auth.py key purge 3 --confirm                        # (v2.2) Безвозвратно удалить
python3 ds_auth.py key rotate 3                                 # Ротация ключа
```

### role — Управление ролями

```bash
python3 ds_auth.py role list                                    # Список ролей
python3 ds_auth.py role list --hide-disabled                    # Без отключённых
python3 ds_auth.py role show admin                              # Детали + все права
python3 ds_auth.py role create dns-admin -p dns.zonecreate,dns.zonedelete -w 50  # Создать
python3 ds_auth.py role edit dns-admin --add-permissions dns.recordcreate       # Добавить права
python3 ds_auth.py role edit dns-admin --remove-permissions dns.zonedelete      # Убрать права
python3 ds_auth.py role edit dns-admin --weight 100                              # Сменить вес
python3 ds_auth.py role delete dns-admin --confirm              # Удалить (если нет активных привязок)
python3 ds_auth.py role enable dns-admin                        # (v2.2) Включить
python3 ds_auth.py role disable dns-admin                       # (v2.2) Отключить (отклоняет все ключи)
python3 ds_auth.py role gen-key dns-admin --user-id 5 -n "dns-key"  # (v2.2) Сгенерировать ключ с этой ролью
python3 ds_auth.py role users dns-admin                         # (v2.2) Кто использует роль
python3 ds_auth.py role keys dns-admin                          # (v2.2) Какие API-ключи с этой ролью
```

### perms — Управление правами

```bash
python3 ds_auth.py perms list                                   # Все 252+ прав
python3 ds_auth.py perms list -c dns                            # Только DNS-права
python3 ds_auth.py perms list -s user                           # Поиск "user"
python3 ds_auth.py perms assign -r operator -p user.create,user.delete  # Назначить
python3 ds_auth.py perms revoke -r operator -p user.delete      # Отозвать
python3 ds_auth.py perms diff admin operator                    # Сравнить роли
```

### audit — Журнал аудита

```bash
python3 ds_auth.py audit list                                   # Все записи
python3 ds_auth.py audit list --user-id 1                       # По пользователю
python3 ds_auth.py audit list --action create                   # По действию
```

### bulk — Массовые операции (v2.2)

```bash
python3 ds_auth.py bulk users --ids 1,2,3 -a disable            # Отключить нескольких
python3 ds_auth.py bulk users --ids 5,7 -a enable               # Включить нескольких
python3 ds_auth.py bulk users --ids 9,10 -a purge               # Безвозвратно удалить
python3 ds_auth.py bulk keys  --ids 1,2,3 -a disable            # Отключить ключи
python3 ds_auth.py bulk keys  --ids 4,5 -a purge                # Удалить ключи
```

### stats — Сводная статистика (v2.2)

```bash
python3 ds_auth.py stats                                        # Пользователи/ключи/роли/аудит + разбивка по ролям
python3 ds_auth.py stats --json-output                          # В JSON для скриптов
```

### Типичный сценарий первого запуска

```bash
# 1. Логин + сохранение токена
python3 ds_auth.py login admin YOUR_PASSWORD --save

# 2. Создать пользователя (с весом для приоритета)
python3 ds_auth.py user create dev1 -p secret -r operator -w 50

# 3. Создать API-ключ для пользователя
python3 ds_auth.py key create --user-id 2 -n "dev-key" -r operator --expires-days 90 -w 50

# 4. Использовать полученный ключ
export SAMBA_API_KEY=sak_полученный_ключ
python3 cli.py user list
```

### Или одной командой (quickkey)

```bash
python3 ds_auth.py quickkey admin YOUR_PASSWORD --key-name "my-key" --role operator
```

### Полный сценарий управления ролями (v2.2)

```bash
# 1. Создать роль с правами на DNS
python3 ds_auth.py role create dns-admin \
  -p dns.zonelist,dns.zonecreate,dns.zonedelete,dns.recordlist,dns.recordcreate,dns.recorddelete \
  -d "Manage DNS zones only" -w 100

# 2. Создать пользователя
python3 ds_auth.py user create dnsop -p secret -r operator

# 3. Сгенерировать API-ключ сразу под роль
python3 ds_auth.py role gen-key dns-admin --user-id 3 -n "dns-ci-key" --expires-days 365

# 4. Проверить, кто использует роль
python3 ds_auth.py role users dns-admin
python3 ds_auth.py role keys  dns-admin

# 5. Если роль больше не нужна — отключить (все ключи отклоняются)
python3 ds_auth.py role disable dns-admin
# Позже — включить обратно
python3 ds_auth.py role enable  dns-admin

# 6. Полностью удалить роль (только если нет активных привязок)
python3 ds_auth.py role delete dns-admin --confirm
```
