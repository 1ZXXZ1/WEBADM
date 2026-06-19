# Система прав и ролей

## Обзор

Samba AD Panel использует ролевую модель доступа (RBAC). Права назначаются через Python/FastAPI бэкенд и хранятся в PostgreSQL. Фронтенд получает права при авторизации и использует их для управления видимостью UI-элементов.

Бэкенд-проверка прав реализована в `app/permissions.py` и `app/mgmt_db.py::has_permission()`. Каждый HTTP-запрос сопоставляется с одним разрешением через `resolve_permission(method, path)`, после чего проверяется, есть ли это разрешение в роли пользователя.

> **v1.2.6_fix** — полностью переписан `resolve_permission()`. Старая логика longest-prefix-match не умела работать с path-параметрами (`{username}`, `{gpo_id}`, `{zone}`, `{projet_id}` и т. п.), из-за чего многие endpoints требовали **неправильное** разрешение и были недоступны для ролей `operator`/`auditor`. Новый resolver использует regex-паттерны, в которых path-параметры записаны как `[^/]+`, и выбирает правило с самым длинным **литеральным** префиксом. Это корректно различает, например:
>
> - `POST /api/v1/users/john/enable` → `user.enable` (раньше → `user.create`)
> - `GET  /api/v1/users/john/groups` → `user.getgroups` (раньше → `user.list`)
> - `POST /api/v1/groups/sales/members` → `group.addmembers` (раньше → `group.create`)
> - `POST /api/v1/shell/projet/42/run` → `shell.projet.run` (раньше → `shell.projet.create`)

## Роли

| Роль | Описание | Уровень доступа |
|------|----------|----------------|
| **admin** | Администратор | Полный доступ ко всем 252 разрешениям |
| **operator** | Оператор | 112 разрешений на чтение + выполнение shell/ETL |
| **auditor** | Аудитор | 110 разрешений на чтение + просмотр журналов аудита и конфигурации |
| (произвольная) | Пользовательская роль | Назначается через Management API |

> Роли `viewer` в бэкенде нет — это чисто UI-понятие. Реальные роли, проверяемые middleware: `admin`, `operator`, `auditor` + любые пользовательские, созданные через `/api/v1/mgmt/roles`.

## Как работает resolver

1. Запрос приходит в `PermissionMiddleware` (см. `app/main.py`).
2. Middleware извлекает роль из JWT или из API-key записи в БД.
3. Вызывается `has_permission(role, method, path)` →
   `resolve_permission(method, path)` возвращает требуемое разрешение (или `None` для public endpoints).
4. Если разрешение есть в роли пользователя — доступ разрешён.
5. Если роль `admin` — доступ разрешён всегда (даже если разрешение не назначено).
6. Иначе — `403 Forbidden` с подсказкой, какое разрешение требуется.

Public endpoints (не требуют разрешения): `/health`, `/docs`, `/openapi.json`, `/redoc`, `/web/api/health`, `/api/v1/auth/login`, `/api/v1/auth/refresh`, `/api/v1/auth/check`, `OPTIONS *`.

## Полный список разрешений (299, v2.3)

### Users (23)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `user.full` | GET | `/api/v1/users/full` | Быстрый ldbsearch-список всех пользователей |
| `user.list` | GET | `/api/v1/users` `/api/v1/users/` | Список пользователей |
| `user.create` | POST | `/api/v1/users` `/api/v1/users/` | Создание пользователя |
| `user.show` | GET | `/api/v1/users/{username}` | Карточка пользователя |
| `user.edit` | PUT | `/api/v1/users/{username}/edit` | Редактирование атрибутов через LDAP |
| `user.batch` | GET | `/api/v1/users/batch` | Пакетное получение нескольких пользователей |
| `user.delete` | DELETE | `/api/v1/users/{username}` | Удаление пользователя |
| `user.enable` | POST | `/api/v1/users/{username}/enable` | Включение учётной записи |
| `user.disable` | POST | `/api/v1/users/{username}/disable` | Отключение учётной записи |
| `user.unlock` | POST | `/api/v1/users/{username}/unlock` | Разблокировка учётной записи |
| `user.setpassword` | PUT | `/api/v1/users/{username}/password` | Сброс пароля |
| `user.getpassword` | GET | `/api/v1/users/{username}/getpassword` | Чтение пароля (требует прав) |
| `user.getgroups` | GET | `/api/v1/users/{username}/groups` | Группы пользователя |
| `user.setexpiry` | PUT | `/api/v1/users/{username}/setexpiry` | Срок действия аккаунта |
| `user.setprimarygroup` | PUT | `/api/v1/users/{username}/setprimarygroup` | Смена первичной группы |
| `user.addunixattrs` | POST | `/api/v1/users/{username}/addunixattrs` | Добавление Unix-атрибутов |
| `user.sensitive` | PUT | `/api/v1/users/{username}/sensitive` | Флаг "sensitive" |
| `user.move` | POST | `/api/v1/users/{username}/move` | Перемещение в другой OU |
| `user.rename` | POST | `/api/v1/users/{username}/rename` | Переименование |
| `user.getkerberosticket` | GET | `/api/v1/users/{username}/get-kerberos-ticket` | Получение Kerberos-билета |
| `user.search` | GET | `/api/v1/users/search` | Поиск пользователей |
| `user.import` | POST | `/api/v1/users/import` | Импорт из CSV |
| `user.export` | GET | `/api/v1/users/export` | Экспорт в CSV/JSON |

### Groups (11)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `group.full` | GET | `/api/v1/groups/full` | Быстрый ldbsearch-список |
| `group.list` | GET | `/api/v1/groups` | Список групп |
| `group.create` | POST | `/api/v1/groups` | Создание группы |
| `group.show` | GET | `/api/v1/groups/{groupname}` | Карточка группы |
| `group.delete` | DELETE | `/api/v1/groups/{groupname}` | Удаление группы |
| `group.stats` | GET | `/api/v1/groups/stats` | Статистика по группам |
| `group.addmembers` | POST | `/api/v1/groups/{groupname}/members` | Добавление участников |
| `group.removemembers` | DELETE | `/api/v1/groups/{groupname}/members` | Удаление участников |
| `group.listmembers` | GET | `/api/v1/groups/{groupname}/members` | Список участников |
| `group.move` | POST | `/api/v1/groups/{groupname}/move` | Перемещение группы |
| `group.rename` | POST | `/api/v1/groups/{groupname}/rename` | Переименование (зарезервировано) |

### Computers (6)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `computer.full` | GET | `/api/v1/computers/full` | Быстрый ldbsearch-список |
| `computer.list` | GET | `/api/v1/computers` | Список компьютеров |
| `computer.create` | POST | `/api/v1/computers` | Создание учётной записи компьютера |
| `computer.show` | GET | `/api/v1/computers/{computername}` | Карточка компьютера |
| `computer.delete` | DELETE | `/api/v1/computers/{computername}` | Удаление |
| `computer.move` | POST | `/api/v1/computers/{computername}/move` | Перемещение |

### Contacts (8)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `contact.full` | GET | `/api/v1/contacts/full` | Быстрый ldbsearch-список |
| `contact.list` | GET | `/api/v1/contacts` | Список контактов |
| `contact.create` | POST | `/api/v1/contacts` | Создание контакта |
| `contact.show` | GET | `/api/v1/contacts/{contactname}` | Карточка контакта |
| `contact.delete` | DELETE | `/api/v1/contacts/{contactname}` | Удаление |
| `contact.move` | POST | `/api/v1/contacts/{contactname}/move` | Перемещение |
| `contact.rename` | POST | `/api/v1/contacts/{contactname}/rename` | Переименование |
| `contact.search` | GET | `/api/v1/contacts/search` | Поиск |

### OUs (10)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `ou.full` | GET | `/api/v1/ous/full` | Быстрый ldbsearch-список |
| `ou.list` | GET | `/api/v1/ous` | Список OU |
| `ou.create` | POST | `/api/v1/ous` | Создание OU |
| `ou.delete` | DELETE | `/api/v1/ous/{ouname}` | Удаление OU |
| `ou.move` | POST | `/api/v1/ous/{ouname}/move` | Перемещение OU |
| `ou.rename` | POST | `/api/v1/ous/{ouname}/rename` | Переименование OU |
| `ou.listobjects` | GET | `/api/v1/ous/{ouname}/objects` | Объекты внутри OU |
| `ou.tree` | GET | `/api/v1/ous/tree` `/api/v1/ous/{ou_dn}/tree` | Дерево OU |
| `ou.stats` | GET | `/api/v1/ous/{ou_dn}/stats` | Статистика по OU |
| `ou.search` | GET | `/api/v1/ous/search` | Поиск OU |

### DNS (12)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `dns.serverinfo` | GET | `/api/v1/dns/serverinfo` | Информация о DNS-сервере |
| `dns.zonelist` | GET | `/api/v1/dns/zones` | Список зон |
| `dns.zoneinfo` | GET | `/api/v1/dns/zones/{zone}` | Информация о зоне |
| `dns.zonecreate` | POST | `/api/v1/dns/zones` | Создание зоны |
| `dns.zonedelete` | DELETE | `/api/v1/dns/zones/{zone}` | Удаление зоны |
| `dns.recordlist` | GET | `/api/v1/dns/zones/{zone}/records` | Записи зоны |
| `dns.recordcreate` | POST | `/api/v1/dns/zones/{zone}/records` | Создание записи |
| `dns.recorddelete` | DELETE | `/api/v1/dns/zones/{zone}/records` | Удаление записи |
| `dns.recordupdate` | PUT | `/api/v1/dns/zones/{zone}/records` | Обновление записи |
| `dns.rorecords` | GET | `/api/v1/dns/zones/{zone}/rorecords` | Read-only запрос записей |
| `dns.zoneoptions` | PUT | `/api/v1/dns/zones/{zone}/options` | Опции зоны |
| `dns.cacheflush` | POST | `/api/v1/dns/cache/invalidate` | Сброс кэша DNS |

### GPO (13)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `gpo.full` | GET | `/api/v1/gpo/full` | Быстрый ldbsearch-список |
| `gpo.list` | GET | `/api/v1/gpo` | Список GPO |
| `gpo.create` | POST | `/api/v1/gpo` | Создание GPO |
| `gpo.show` | GET | `/api/v1/gpo/{gpo_id}` | Карточка GPO |
| `gpo.delete` | DELETE | `/api/v1/gpo/{gpo_id}` | Удаление GPO |
| `gpo.deletebyname` | DELETE | `/api/v1/gpo/by-name/{displayname}` | Удаление GPO по имени |
| `gpo.link` | POST | `/api/v1/gpo/{gpo_id}/link` | Привязка GPO к OU |
| `gpo.unlink` | DELETE | `/api/v1/gpo/{gpo_id}/link` | Отвязка GPO |
| `gpo.getinherit` | GET | `/api/v1/gpo/{gpo_id}/inherit` | Чтение флагов наследования |
| `gpo.setinherit` | PUT | `/api/v1/gpo/{gpo_id}/inherit` | Установка флагов наследования |
| `gpo.backup` | POST | `/api/v1/gpo/{gpo_id}/backup` | Бэкап GPO |
| `gpo.restore` | POST | `/api/v1/gpo/{gpo_id}/restore` | Восстановление GPO |
| `gpo.fetch` | GET | `/api/v1/gpo/{gpo_id}/fetch` | Скачивание GPO |

### Domain (18)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `domain.full` | GET | `/api/v1/domain/full` | Быстрый ldbsearch |
| `domain.info` | GET | `/api/v1/domain/info` | Информация о домене |
| `domain.level` | GET/PUT | `/api/v1/domain/level` | Уровень функционала |
| `domain.passwordsettings` | GET/PUT | `/api/v1/domain/passwordsettings` | Политика паролей |
| `domain.schemas` | GET | `/api/v1/domain/schemas` | Схемы |
| `domain.provision` | POST | `/api/v1/domain/provision` | Provisioning |
| `domain.join` | POST | `/api/v1/domain/join` | Подключение к домену |
| `domain.leave` | POST | `/api/v1/domain/leave` | Покидание домена |
| `domain.demote` | POST | `/api/v1/domain/demote` | Понижение DC |
| `domain.rename` | POST | — | Переименование (зарезервировано) |
| `domain.trustlist` | GET | `/api/v1/domain/trust/list` | Список трастов |
| `domain.trustcreate` | POST | `/api/v1/domain/trust/create` | Создание траста |
| `domain.trustdelete` | DELETE | `/api/v1/domain/trust/delete` | Удаление траста |
| `domain.trustvalidate` | POST | `/api/v1/domain/trust/validate` | Валидация траста |
| `domain.backup` | POST | `/api/v1/domain/backup/online` `/api/v1/domain/backup/offline` | Бэкап домена |
| `domain.kdsrootkey` | GET/POST | `/api/v1/domain/kds/root-key/*` | KDS root keys |
| `domain.exportkeytab` | POST | `/api/v1/domain/exportkeytab` | Экспорт keytab |
| `domain.claim` | GET | `/api/v1/domain/claim/types` | Claim types |

### DRS (7)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `drs.showrepl` | GET | `/api/v1/drs/showrepl` | Статус репликации |
| `drs.bind` | GET/POST | `/api/v1/drs/bind` | DRSUAPI bind |
| `drs.unbind` | POST | `/api/v1/drs/unbind` | DRSUAPI unbind |
| `drs.options` | GET | `/api/v1/drs/options` | Опции DRS |
| `drs.kcc` | POST | `/api/v1/drs/kcc` | Запуск KCC |
| `drs.replicate` | POST | `/api/v1/drs/replicate` | Принудительная репликация |
| `drs.uptodateness` | GET | `/api/v1/drs/uptodateness` | Проверка актуальности |

### Sites (8)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `sites.list` | GET | `/api/v1/sites` | Список сайтов |
| `sites.create` | POST | `/api/v1/sites` | Создание сайта |
| `sites.show` | GET | `/api/v1/sites/{sitename}` | Карточка сайта |
| `sites.delete` | DELETE | `/api/v1/sites/{sitename}` | Удаление сайта |
| `sites.subnetlist` | GET | `/api/v1/sites/subnets` `/api/v1/sites/{sitename}/subnets` | Список подсетей |
| `sites.subnetcreate` | POST | `/api/v1/sites/{sitename}/subnets` | Создание подсети |
| `sites.subnetdelete` | DELETE | `/api/v1/sites/subnets` | Удаление подсети |
| `sites.subnetupdate` | PUT | `/api/v1/sites/subnets/site` | Привязка подсети к сайту |

### FSMO (5)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `fsmo.full` | GET | `/api/v1/fsmo/full` | Быстрый ldbsearch |
| `fsmo.show` | GET | `/api/v1/fsmo` | Список FSMO-ролей |
| `fsmo.seize` | PUT/POST | `/api/v1/fsmo/seize` | Захват роли |
| `fsmo.transfer` | PUT/POST | `/api/v1/fsmo/transfer` | Передача роли |
| `fsmo.roles` | GET | `/api/v1/fsmo/roles` | Список ролей (alias) |

### Schema (3)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `schema.list` | GET | `/api/v1/schema` | Список классов/атрибутов |
| `schema.show` | GET | `/api/v1/schema/attributes/{attribute}` `/api/v1/schema/classes/{classname}` | Карточка |
| `schema.query` | GET | `/api/v1/schema/query` | Произвольный запрос |

### Delegation (3)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `delegation.list` | GET | `/api/v1/delegation/for-account` | Чтение делегаций аккаунта |
| `delegation.set` | POST | `/api/v1/delegation/add` | Добавление делегации |
| `delegation.delete` | DELETE | `/api/v1/delegation/remove` | Удаление делегации |

### Service accounts (5)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `serviceaccount.list` | GET | `/api/v1/service-accounts` | Список |
| `serviceaccount.create` | POST | `/api/v1/service-accounts` | Создание |
| `serviceaccount.show` | GET | `/api/v1/service-accounts/{accountname}` | Карточка |
| `serviceaccount.delete` | DELETE | `/api/v1/service-accounts/{accountname}` | Удаление |
| `serviceaccount.gmsamembers` | GET/POST/DELETE | `/api/v1/service-accounts/{accountname}/gmsa-members*` | Управление gMSA-members |

### Auth policies & silos (10)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `authpolicy.list` | GET | `/api/v1/auth/policies` | Список политик |
| `authpolicy.show` | GET | `/api/v1/auth/policies/{policyname}` | Карточка политики |
| `authpolicy.create` | POST | `/api/v1/auth/policies` | Создание политики |
| `authpolicy.delete` | DELETE | `/api/v1/auth/policies/{policyname}` | Удаление политики |
| `authpolicy.update` | PUT | `/api/v1/auth/policies/{policyname}` | Обновление политики |
| `authpolicy.silolist` | GET | `/api/v1/auth/silos` | Список silo |
| `authpolicy.siloshow` | GET | `/api/v1/auth/silos/{siloname}` | Карточка silo |
| `authpolicy.silocreate` | POST | `/api/v1/auth/silos` | Создание silo |
| `authpolicy.silodelete` | DELETE | `/api/v1/auth/silos/{siloname}` | Удаление silo |
| `authpolicy.silomembers` | POST/DELETE | `/api/v1/auth/silos/{siloname}/members` | Управление участниками silo |

### Shell (4)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `shell.list` | GET | `/api/v1/shell` | Список доступных оболочек |
| `shell.execute` | POST | `/api/v1/shell/exec` | Выполнение команды |
| `shell.script` | POST | `/api/v1/shell/script` `/api/v1/shell/script/file` | Выполнение скрипта |
| `shell.sudo` | POST | `/api/v1/shell/sudo` | Выполнение с sudo |

### Shell Projects (17)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `shell.projet.create` | POST | `/api/v1/shell/projet` | Создание проекта |
| `shell.projet.run` | POST | `/api/v1/shell/projet/{projet_id}/run` | Запуск проекта |
| `shell.projet.show` | GET | `/api/v1/shell/projet/{projet_id}` `/api/v1/shell/projet/show/{projet_id}` | Просмотр проекта |
| `shell.projet.list` | GET | `/api/v1/shell/projet/list` | Список проектов |
| `shell.projet.delete` | DELETE | `/api/v1/shell/projet/{projet_id}` | Удаление проекта |
| `shell.projet.upload` | POST | `/api/v1/shell/projet/{projet_id}/upload` | Загрузка файла |
| `shell.projet.uploadmulti` | POST | `/api/v1/shell/projet/{projet_id}/upload-multi` | Загрузка нескольких файлов |
| `shell.projet.abort` | POST | `/api/v1/shell/projet/{projet_id}/abort` | Прерывание выполнения |
| `shell.projet.health` | GET | `/api/v1/shell/projet/health` | Health-check |
| `shell.projet.download` | GET | `/api/v1/shell/projet/{projet_id}/download` | Скачивание артефакта |
| `shell.projet.owner` | PATCH | `/api/v1/shell/projet/{projet_id}/owner` | Смена владельца |
| `shell.projet.tags` | PATCH | `/api/v1/shell/projet/{projet_id}/tags` | Обновление тегов |
| `shell.projet.schedule` | POST/GET/DELETE | `/api/v1/shell/projet/{projet_id}/schedule*` | Расписание |
| `shell.projet.template` | POST/GET/DELETE | `/api/v1/shell/projet/template*` `/api/v1/shell/projet/templates` `/api/v1/shell/projet/from-template/{template_id}` | Шаблоны проектов |
| `shell.projet.snapshot` | POST | `/api/v1/shell/projet/{projet_id}/snapshot` `/api/v1/shell/projet/{projet_id}/rollback/{snapshot_id}` | Снапшоты и rollback |
| `shell.projet.audit` | GET | `/api/v1/shell/projet/audit` `/api/v1/shell/projet/{projet_id}/audit` | Журнал аудита проектов |
| `shell.projet.batch` | POST | `/api/v1/shell/projet/batch` | Пакетная операция над проектами |

### Batch (2)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `batch.execute` | POST | `/api/v1/batch` | Запуск batch-операции |
| `batch.status` | GET | `/api/v1/batch/{task_id}` | Статус batch-задачи |

### Management (37, v2.2)

> v2.2 расширил набор правами на enable/disable/purge/resetpw/keys/bulk/genkey/users/stats.

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `mgmt.users.list` | GET | `/api/v1/mgmt/users` | Список mgmt-пользователей (поддержка `search`, `weight`) |
| `mgmt.users.create` | POST | `/api/v1/mgmt/users` | Создание mgmt-пользователя (с `weight`) |
| `mgmt.users.show` | GET | `/api/v1/mgmt/users/{user_id}` | Карточка mgmt-пользователя |
| `mgmt.users.update` | PUT | `/api/v1/mgmt/users/{user_id}` | Обновление (включая `weight`) |
| `mgmt.users.delete` | DELETE | `/api/v1/mgmt/users/{user_id}` | Удаление (`?hard=true` для безвозвратного) |
| `mgmt.users.enable` | POST | `/api/v1/mgmt/users/{user_id}/enable` | **(v2.2)** Включить пользователя |
| `mgmt.users.disable` | POST | `/api/v1/mgmt/users/{user_id}/disable` | **(v2.2)** Отключить + все его API-ключи |
| `mgmt.users.purge` | POST | `/api/v1/mgmt/users/{user_id}/purge` | **(v2.2)** Безвозвратно удалить (CASCADE) |
| `mgmt.users.resetpw` | POST | `/api/v1/mgmt/users/{user_id}/reset-password` | **(v2.2)** Сброс пароля |
| `mgmt.users.keys` | GET | `/api/v1/mgmt/users/{user_id}/keys` | **(v2.2)** Ключи пользователя |
| `mgmt.users.bulk` | POST | `/api/v1/mgmt/users/bulk` | **(v2.2)** Массовые операции |
| `mgmt.keys.list` | GET | `/api/v1/mgmt/keys` | Список API-ключей (с `search`, `weight`) |
| `mgmt.keys.create` | POST | `/api/v1/mgmt/keys` | Создание API-ключа (с `weight`, `description`) |
| `mgmt.keys.show` | GET | `/api/v1/mgmt/keys/{key_id}` | Карточка API-ключа |
| `mgmt.keys.update` | PUT | `/api/v1/mgmt/keys/{key_id}` | Обновление (включая `weight`) |
| `mgmt.keys.delete` | DELETE | `/api/v1/mgmt/keys/{key_id}` | Удаление (`?hard=true` для безвозвратного) |
| `mgmt.keys.rotate` | POST | `/api/v1/mgmt/keys/{key_id}/rotate` | Ротация ключа |
| `mgmt.keys.enable` | POST | `/api/v1/mgmt/keys/{key_id}/enable` | **(v2.2)** Включить ключ |
| `mgmt.keys.disable` | POST | `/api/v1/mgmt/keys/{key_id}/disable` | **(v2.2)** Отключить ключ |
| `mgmt.keys.purge` | POST | `/api/v1/mgmt/keys/{key_id}/purge` | **(v2.2)** Безвозвратно удалить |
| `mgmt.keys.bulk` | POST | `/api/v1/mgmt/keys/bulk` | **(v2.2)** Массовые операции |
| `mgmt.audit.view` | GET | `/api/v1/mgmt/audit` | Просмотр журнала аудита |
| `mgmt.roles.list` | GET | `/api/v1/mgmt/roles` | Список ролей (с `is_active`, `weight`) |
| `mgmt.roles.show` | GET | `/api/v1/mgmt/roles/{role_name}` | **(v2.2)** Карточка роли |
| `mgmt.roles.create` | POST | `/api/v1/mgmt/roles` | Создание роли (с `weight`) |
| `mgmt.roles.update` | PUT | `/api/v1/mgmt/roles/{role_name}` | Обновление (включая `weight`, `is_active`) |
| `mgmt.roles.delete` | DELETE | `/api/v1/mgmt/roles/{role_name}` | Удаление (блокируется, если есть активные привязки) |
| `mgmt.roles.enable` | POST | `/api/v1/mgmt/roles/{role_name}/enable` | **(v2.2)** Включить роль |
| `mgmt.roles.disable` | POST | `/api/v1/mgmt/roles/{role_name}/disable` | **(v2.2)** Отключить роль (отклоняет все ключи) |
| `mgmt.roles.genkey` | POST | `/api/v1/mgmt/roles/{role_name}/gen-key` | **(v2.2)** Сгенерировать ключ под роль |
| `mgmt.roles.users` | GET | `/api/v1/mgmt/roles/{role_name}/users` | **(v2.2)** Пользователи с ролью |
| `mgmt.roles.keys` | GET | `/api/v1/mgmt/roles/{role_name}/keys` | **(v2.2)** API-ключи с ролью |
| `mgmt.perms.list` | GET | `/api/v1/mgmt/permissions` | Список всех разрешений |
| `mgmt.perms.assign` | POST | `/api/v1/mgmt/permissions/assign` | Назначение разрешений роли |
| `mgmt.perms.revoke` | POST | `/api/v1/mgmt/permissions/revoke` | Отзыв разрешений у роли |
| `mgmt.stats` | GET | `/api/v1/mgmt/stats` | **(v2.2)** Сводная статистика mgmt API |

### Webhooks (6, v2.3)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `webhook.list` | GET | `/api/v1/webhooks` | Список webhook'ов |
| `webhook.create` | POST | `/api/v1/webhooks` | Регистрация webhook |
| `webhook.show` | GET | `/api/v1/webhooks/{id}` | Детали webhook |
| `webhook.update` | PUT | `/api/v1/webhooks/{id}` | Обновление webhook |
| `webhook.delete` | DELETE | `/api/v1/webhooks/{id}` | Удаление webhook |
| `webhook.test` | POST | `/api/v1/webhooks/{id}/test` | Отправить тестовое событие |

### Backup & Restore (5, v2.3)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `backup.create` | POST | `/api/v1/backup` | Создать backup (sam.ldb + mgmt.sql) |
| `backup.list` | GET | `/api/v1/backup` | Список backups |
| `backup.download` | GET | `/api/v1/backup/{filename}` | Скачать backup |
| `backup.delete` | DELETE | `/api/v1/backup/{filename}` | Удалить backup |
| `backup.restore` | POST | `/api/v1/backup/restore` | Восстановить из backup |

### Bulk user ops (1, v2.3)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `user.bulk` | POST | `/api/v1/users/bulk` | Массовое создание/удаление/enable/disable AD-пользователей |

### Audit export (1, v2.3)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `audit.export` | GET | `/api/v1/mgmt/audit/export` | Экспорт аудита в CSV/XLSX/JSON |

### 2FA / TOTP (5, v2.3)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `auth.2fa.setup` | POST | `/api/v1/auth/2fa/setup` | Сгенерировать TOTP-секрет |
| `auth.2fa.enable` | POST | `/api/v1/auth/2fa/enable` | Включить 2FA (требует код) |
| `auth.2fa.disable` | POST | `/api/v1/auth/2fa/disable` | Отключить 2FA (требует пароль) |
| `auth.2fa.status` | GET | `/api/v1/auth/2fa/status` | Проверить статус 2FA |
| `auth.2fa.verify` | POST | `/api/v1/auth/login/verify` | Шаг 2 логина: проверить TOTP-код |

### Dashboard charts (1, v2.3)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `dashboard.charts` | GET | `/api/v1/dashboard/charts/*` | Aggregated data для графиков (login-activity, top-groups, os-distribution, users-by-ou, recent-events, mgmt-summary) |

### Live updates (1, v2.3)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `live.events` | GET | `/api/v1/live/events` | SSE-стрим live-событий |

### Shell project files (4, v2.3)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `shell.projet.files.list` | GET | `/api/v1/shell/projet/{id}/files` | Список файлов в workspace |
| `shell.projet.files.read` | GET | `/api/v1/shell/projet/{id}/files/{path}` | Скачать файл |
| `shell.projet.files.write` | PUT | `/api/v1/shell/projet/{id}/files/{path}` | Загрузить/перезаписать файл |
| `shell.projet.files.delete` | DELETE | `/api/v1/shell/projet/{id}/files/{path}` | Удалить файл/директорию |

### Env encryption (1, v2.3)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `cfg.encrypt` | — | — | Логическое право: разрешить операции шифрования sensitive env-значений |

### Dashboard (2)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `dashboard.full` | GET | `/api/v1/dashboard/full` | Полный обзор AD (ldbsearch) |
| `dashboard.overview` | GET | `/api/v1/dashboard/overview` | Обзор + метрики системы |

### System (4)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `system.health` | GET | `/health/detailed` | Расширенный health-check |
| `system.stats` | GET | `/api/v1/system/stats` | Статистика системы |
| `system.metrics` | GET | `/metrics` | Prometheus-метрики |
| `system.tasks` | GET | `/api/v1/tasks` | (зарезервировано, используется `tasks.list`) |

### Tasks (2)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `tasks.list` | GET | `/api/v1/tasks` | Список фоновых задач |
| `tasks.view` | GET | `/api/v1/tasks/{task_id}` | Статус конкретной задачи |

### Misc (8)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `misc.time` | GET | `/api/v1/misc/time` | Время сервера |
| `misc.processes` | GET | `/api/v1/misc/processes` | Процессы Samba |
| `misc.testparm` | GET | `/api/v1/misc/testparm` | Проверка конфигурации |
| `misc.dbcheck` | GET | `/api/v1/misc/dbcheck` | Проверка БД |
| `misc.dbcheckfix` | POST | `/api/v1/misc/dbcheck/fix` | Исправление ошибок БД |
| `misc.ntacl` | GET | `/api/v1/misc/ntacl` | Чтение NT ACL |
| `misc.ntaclset` | POST | `/api/v1/misc/ntacl/set` `/api/v1/misc/ntacl/sysvolreset` | Установка / сброс NT ACL |
| `misc.spn` | GET/POST/DELETE | `/api/v1/misc/spn/*` | Управление SPN |

### Auth (2)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `auth.me` | GET | `/api/v1/auth/me` | Кто я (роль + разрешения) |
| `auth.check` | POST | `/api/v1/auth/check` | Проверка кред (public) |

### AI Chat (9)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `ai.chat.create` | POST | `/api/v1/ai/chat` | Создание чата |
| `ai.chat.list` | GET | `/api/v1/ai/chat/list` | Список чатов пользователя |
| `ai.chat.show` | GET | `/api/v1/ai/chat/{chat_id}` | Карточка чата |
| `ai.chat.delete` | DELETE | `/api/v1/ai/chat/{chat_id}` | Удаление чата |
| `ai.chat.send` | POST | `/api/v1/ai/chat/{chat_id}/send` | Отправка сообщения |
| `ai.chat.stream` | POST | `/api/v1/ai/chat/{chat_id}/stream` | SSE-стрим ответа |
| `ai.chat.history` | GET | `/api/v1/ai/chat/{chat_id}/history` | История сообщений |
| `ai.chat.info` | GET | `/api/v1/ai/chat/{chat_id}/info` `/api/v1/ai/info` | Информация о чате / AI-сервисе |
| `ai.chat.admin` | PUT | `/api/v1/ai/chat/{chat_id}` | Управление чужими чатами (admin-only) |

### AI Assistant (12)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `ai.assistant` | POST | `/api/v1/ai/assistant` | Task Builder AI |
| `ai.agent` | POST | `/api/v1/ai/agent` | Agent AI (tool calling) |
| `ai.sdb` | POST | `/api/v1/ai/sdb` | AI-помощник по SDB |
| `ai.schema` | GET | `/api/v1/ai/schema` | Сжатая OpenAPI-схема |
| `ai.config` | GET | `/api/v1/ai/config` | Конфигурация AI |
| `ai.balance` | GET | `/api/v1/ai/balance` | Баланс AI-провайдера |
| `ai.test` | GET | `/api/v1/ai/test` | Тест подключения к AI |
| `ai.system` | GET/PUT | `/api/v1/ai/system` | Системный промпт |
| `ai.datavchema` | GET | `/api/v1/ai/data-schema` | Data-schema для контекста AI |
| `ai.pipeline` | GET/POST | `/api/v1/ai/pipeline/templates` `/api/v1/ai/pipeline/execute` | Шаблоны и запуск pipeline |
| `ai.exports` | GET | `/api/v1/ai/exports` `/api/v1/ai/exports/{filename}` | Список и скачивание экспортов |
| `ai.info` | GET | `/api/v1/ai/info` | Краткая информация об AI-сервисе |

### Samba Shares (5)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `share.list` | GET | `/api/v1/shares` | Список шар |
| `share.create` | POST | `/api/v1/shares` | Создание шары |
| `share.edit` | PUT | `/api/v1/shares/{name}` | Редактирование шары |
| `share.delete` | DELETE | `/api/v1/shares/{name}` | Удаление шары |
| `share.config` | GET/PUT | `/api/v1/shares/config` | Глобальная конфигурация smb.conf |

### SDB (11)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `sdb.databases` | GET | `/api/v1/sdb/databases` | Список доступных LDB-баз |
| `sdb.full` | GET | `/api/v1/sdb/full/{entity}` | Полный дамп сущности |
| `sdb.info` | GET | `/api/v1/sdb/info/{entity}` | Информация о сущности |
| `sdb.query` | POST | `/api/v1/sdb/query` | Произвольный LDB-запрос |
| `sdb.select` | POST | `/api/v1/sdb/select` | SQL-like SELECT |
| `sdb.show` | POST | `/api/v1/sdb/show` | Показать запись |
| `sdb.script` | POST | `/api/v1/sdb/script` | Выполнение скрипта |
| `sdb.synthesis` | GET | `/api/v1/sdb/synthesis` | Синтез схемы |
| `sdb.export` | POST | `/api/v1/sdb/export` | Экспорт в XLSX |
| `sdb.exportdownload` | GET | `/api/v1/sdb/export-download` | Скачивание готового экспорта |
| `sdb.exports` | GET | `/api/v1/sdb/exports` `/api/v1/sdb/exports/{filename}` | Список и скачивание экспортов |

### Report (2)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `report.generate` | POST/GET | `/api/v1/report/generate` | Генерация XLSX-отчёта по AD |
| `report.download` | GET | `/api/v1/report/exports/{filename}` | Скачивание готового отчёта |

### CFG — Runtime .env (11)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `cfg.list` | GET | `/api/v1/cfg` | Список env-ключей (значения замаскированы) |
| `cfg.show` | GET | `/api/v1/cfg/{key}` | Значение конкретного ключа |
| `cfg.schema` | GET | `/api/v1/cfg/schema` | Schema настроек (описания, дефолты) |
| `cfg.raw` | GET | `/api/v1/cfg/raw` | Скачивание raw `.env` |
| `cfg.update` | PUT/POST | `/api/v1/cfg/{key}` | Обновление ключа (hot-reload) |
| `cfg.bulk` | POST | `/api/v1/cfg/bulk` | Пакетное обновление |
| `cfg.delete` | DELETE | `/api/v1/cfg/{key}` | Удаление ключа |
| `cfg.disable` | POST | `/api/v1/cfg/{key}/disable` | Отключение ключа |
| `cfg.enable` | POST | `/api/v1/cfg/{key}/enable` | Включение ключа |
| `cfg.reload` | POST | `/api/v1/cfg/reload` | Принудительный reload из `.env` |
| `cfg.persist` | POST | `/api/v1/cfg/persist` | Запись текущего in-memory env в `.env` |

> Все CFG-разрешения, кроме `cfg.list/show/schema/raw/reload`, **admin-only** по умолчанию.

### Bans — Ban/Unban пользователей и API-ключей (5)

| Право | Метод | Path | Описание |
|-------|-------|------|----------|
| `ban.create` | POST | `/api/v1/ban` | Создать бан (user или key) |
| `ban.unban` | POST | `/api/v1/unban` `/api/v1/ban/unban` | Снять бан (по id или target_type+target_name) |
| `ban.list` | GET | `/api/v1/ban` | Список банов (фильтры: `active`, `target_type`, `target_name`) |
| `ban.show` | GET | `/api/v1/ban/{id}` `/api/v1/ban/check/{type}/{name}` | Показать бан / проверить статус |
| `ban.delete` | DELETE | `/api/v1/ban/{id}` | Hard-delete записи (история) |

> Все ban-разрешения **admin-only** по умолчанию. Даже `ban.list` не выдаётся `operator`/`auditor`, т.к. список банов раскрывает, кто и за что был заблокирован. Endpoints `/api/v1/ban/check/{type}/{name}` технически требуют `ban.show`, но их можно вызвать без него — для этого исключения нет, и блокировка делается стандартным middleware.

**Как это работает:**
- При аутентификации (как JWT, так и API-key) middleware в `app/main.py` проверяет `ban_db.is_user_banned()` и `ban_db.is_key_banned()`.
- Если цель забанена — возвращается `403 Forbidden` с причиной и сроком окончания бана.
- Бан можно наложить на **mgmt-пользователя** (по `username`) или на **API-ключ** (по `key_prefix` — первые 8 символов).
- Бан может быть **постоянным** (`duration_minutes` = 0 или null) или **временным** (например, 60 минут).
- Баны автоматически истекают (lazy expiry — при следующей проверке `is_banned()` или при вызове `expire_due_bans()`).
- Снятие бана (`POST /api/v1/unban`) сохраняет историю: запись остаётся в БД с `is_active=FALSE` и `lifted_at`/`lifted_by`/`lifted_reason`.
- Hard-delete (`DELETE /api/v1/ban/{id}`) удаляет запись полностью — использовать только для очистки старых данных.

**CLI:** `webadc ban {list|add|unban|show|check|delete|purge}` — см. `webadc ban --help`.

## Навигация и права (фронтенд)

Элементы навигации связаны с правами. Если у пользователя нет нужного права, раздел отображается с иконкой замка и уменьшенной прозрачностью:

| Раздел | Необходимое право |
|--------|-------------------|
| Dashboard | `dashboard.overview` (или `dashboard.full`) |
| Users | `user.list` |
| Groups | `group.list` |
| Computers | `computer.list` |
| Contacts | `contact.list` |
| OU | `ou.list` |
| DNS | `dns.zonelist` |
| GPO | `gpo.list` |
| Domain | `domain.info` |
| Shell | `shell.execute` |
| Shell Projects | `shell.projet.list` |
| Tasks (ETL) | `batch.execute` |
| SDB | `sdb.databases` |
| Reports | `report.generate` |
| AI Chat | `ai.chat.list` |
| Audit | `mgmt.audit.view` |
| Management | `mgmt.users.list` |
| CFG (.env) | `cfg.list` |
| Bans | `ban.list` |

## Компонент RequirePermission

Компонент `RequirePermission` оборачивает контент и блокирует его при отсутствии прав:

```tsx
<RequirePermission permission="user.create">
  <Button onClick={handleCreate}>Создать пользователя</Button>
</RequirePermission>
```

Если у пользователя нет права `user.create`, кнопка будет заблокирована (заблюрена и неактивна).

## Проверка прав в коде

```typescript
// В Zustand store
const hasPermission = useAuthStore(state => state.hasPermission);
const isAdmin = useAuthStore(state => state.isAdmin);

// Проверка конкретного права
if (hasPermission('user.create')) {
  // Показать кнопку создания
}

// Проверка роли администратора
if (isAdmin()) {
  // Показать административные функции
}
```

```python
# В бэкенде (FastAPI dependency)
from app.auth import require_permission

@router.post("/", dependencies=[Depends(require_permission("user.create"))])
async def create_user(...):
    ...
```

> **Важно:** Права проверяются **дважды** — на фронтенде (для управления UI) и на бэкенде (middleware в `app/main.py` через `has_permission()`). Фронтендная проверка не заменяет серверную!

## Диагностика

Если нужный endpoint возвращает `403 Forbidden`:

1. Проверьте **роль** пользователя (`GET /api/v1/auth/me` → `role`).
2. Проверьте **список разрешений** роли (`GET /api/v1/mgmt/roles/{role_name}`).
3. Посмотрите в теле ответа 403 — там указано, какое разрешение требуется: `Role 'operator' does not have permission for POST /api/v1/users/john/enable (requires: user.enable)`.
4. Если требуется — назначьте разрешение роли через `POST /api/v1/mgmt/permissions/assign` с телом `{"role": "operator", "permissions": ["user.enable"]}`.
5. Если `requires:` пусто, значит endpoint **не замаплен** в `_PATH_PERM_RULES` — сообщите разработчику добавить правило в `app/permissions.py`.
