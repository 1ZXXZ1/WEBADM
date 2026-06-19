# fix.zip — v1.2.6_fix

Содержит исправления для `app/permissions.py` и обновлённую документацию.

## Что внутри

```
fix/
├── app/
│   └── permissions.py          # переписан (252 разрешения, regex-resolver)
└── docs/
    ├── PERMISSIONS.md          # полностью переписана
    ├── CHANGELOG.md            # добавлена запись v1.2.6_fix
    └── README_FIX.md           # этот файл
```

## Что исправлено

### Главная проблема

`resolve_permission()` использовал longest-prefix-match, который не умеет
работать с path-параметрами. Например, для `POST /api/v1/users/john/enable`:

- prefix `/api/v1/users/` (POST) → `user.create` ✗ (длина 16, совпало)
- prefix `/api/v1/users/enable` (POST) → `user.enable` ✓ (не совпало, т. к.
  путь `users/john/enable` не начинается с `users/enable`)

В результате `operator` (у которого нет `user.create`) получал 403, хотя
логически этот endpoint и не должен быть ему доступен, но по **другой**
причине. Хуже было с read-endpoints:

- `GET /api/v1/users/john/groups` → `user.list` ✗ (должно быть `user.getgroups`)
  — operator получал доступ (т. к. у него есть `user.list`), хотя не должен.
- `GET /api/v1/users/john/getpassword` → `user.list` ✗ (должно быть
  `user.getpassword`) — operator получал доступ к чтению чужих паролей!

### Решение

Полностью переписан resolver: теперь использует regex-паттерны, где
path-параметры записаны как `[^/]+`. Выбирается правило с самым длинным
**литеральным** префиксом (частью до первого `[^/]+`).

Все 267 endpoints из 28 роутеров теперь имеют корректные mapping-и — это
проверено скриптом `scripts/test_permissions_audit.py` (0 незамапленных,
0 невалидных ссылок).

### Дополнительно

- 92 новых разрешения для endpoints, которые раньше не были замаплены
  вообще (и поэтому были **public-by-accident** — любой аутентифицированный
  пользователь мог их вызвать, включая `operator` и `auditor`).
- 6 mapping-багов исправлено:
  - `auth-policies` → `auth/policies` и `auth/silos` (router prefix `/auth`)
  - FSMO `/transfer` `/seize`: POST → PUT (с backward-compat)
  - DRS `/bind`: POST → GET (с backward-compat)
  - GPO `/by-name/{name}`: `gpo.delete` → `gpo.deletebyname`
  - Schema `/attributes/{x}` `/classes/{x}`: `schema.list` → `schema.show`
  - Все path-param endpoints теперь мапятся на правильные разрешения.

## Установка

1. Распаковать `fix.zip` в корень проекта (поверх существующих файлов):

   ```bash
   unzip fix.zip -d /path/to/WEBADM/
   ```

   Файлы будут помещены как:
   - `/path/to/WEBADM/app/permissions.py`
   - `/path/to/WEBADM/docs/PERMISSIONS.md`
   - `/path/to/WEBADM/docs/CHANGELOG.md`
   - `/path/to/WEBADM/docs/README_FIX.md`

2. Перезапустить сервис:

   ```bash
   sudo systemctl restart webadc
   ```

3. Проверить, что новые разрешения видны в Management API:

   ```bash
   curl -H "X-API-Key: $KEY" http://localhost:8000/api/v1/mgmt/permissions | jq '.permissions | length'
   # должно вывести 252
   ```

4. (Опционально) Назначить новые разрешения существующим ролям:

   ```bash
   curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
     http://localhost:8000/api/v1/mgmt/permissions/assign \
     -d '{"role":"operator","permissions":["sdb.databases","sdb.query","report.generate"]}'
   ```

## Совместимость

- Все старые имена разрешений сохранены — старые токены продолжат работать.
- Роли `admin`/`operator`/`auditor` расширены, но не сужены.
- Пользовательские роли в БД не затронуты — новые разрешения нужно назначить
  вручную, если это требуется.
- API-endpoints не изменились (те же paths, те же методы).

## Тестирование

После установки запустите:

```bash
cd /path/to/WEBADM
python3 -c "
from app.permissions import resolve_permission, ALL_PERMISSIONS
print(f'Total permissions: {len(ALL_PERMISSIONS)}')
print('user.enable:', resolve_permission('POST', '/api/v1/users/john/enable'))
print('user.getpassword:', resolve_permission('GET', '/api/v1/users/john/getpassword'))
print('group.addmembers:', resolve_permission('POST', '/api/v1/groups/sales/members'))
print('shell.projet.run:', resolve_permission('POST', '/api/v1/shell/projet/42/run'))
print('dns.recordlist:', resolve_permission('GET', '/api/v1/dns/zones/example.com/records'))
"
```

Ожидаемый вывод:

```
Total permissions: 252
user.enable: user.enable
user.getpassword: user.getpassword
group.addmembers: group.addmembers
shell.projet.run: shell.projet.run
dns.recordlist: dns.recordlist
```
