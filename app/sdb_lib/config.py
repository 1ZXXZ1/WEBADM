"""
Конфигурация SDB - пути к LDB файлам, настройки samba-tool, параметры по умолчанию.
"""

import os
import shutil

# ─── Пути к LDB базам Samba по умолчанию ─────────────────────────────────────

SAMBA_PRIVATE_DIR = "/var/lib/samba/private"
SAMBA_STATE_DIR = "/var/lib/samba"

# Карта "короткое имя" → "путь к .ldb файлу"
LDB_DATABASES = {
    "sam":       os.path.join(SAMBA_PRIVATE_DIR, "sam.ldb"),
    "privilege": os.path.join(SAMBA_PRIVATE_DIR, "privilege.ldb"),
    "idmap":     os.path.join(SAMBA_PRIVATE_DIR, "idmap.ldb"),
    "hklm":      os.path.join(SAMBA_PRIVATE_DIR, "hklm.ldb"),
    "secrets":   os.path.join(SAMBA_PRIVATE_DIR, "secrets.ldb"),
    "share":     os.path.join(SAMBA_PRIVATE_DIR, "share.ldb"),
    "dns":       os.path.join(SAMBA_PRIVATE_DIR, "dns", "sam.ldb"),
}

# Описание баз данных для справки
LDB_DESCRIPTIONS = {
    "sam":       "Основная база AD (пользователи, группы, компьютеры, GPO)",
    "privilege": "Привилегии (SeBackupPrivilege, SeDebugPrivilege, и т.д.)",
    "idmap":     "Маппинг SID → UID/GID",
    "hklm":      "Реестр HKEY_LOCAL_MACHINE",
    "secrets":   "Секреты домена (Kerberos, пароли, ключи)",
    "share":     "Конфигурация файловых шар",
    "dns":       "DNS записи (отдельная база dns/sam.ldb)",
}

# ─── Команды samba-tool ──────────────────────────────────────────────────────

SAMBA_TOOL_PATH = shutil.which("samba-tool") or "samba-tool"
LDBSEARCH_PATH = shutil.which("ldbsearch") or "ldbsearch"

# Подкоманды samba-tool, которые мы поддерживаем
SAMBA_TOOL_SUBCOMMANDS = [
    "user", "group", "computer", "ou", "contact",
    "dns", "gpo", "sites", "domain", "forest",
    "fsmo", "dbcheck", "drs", "ldapcmp",
    "spn", "delegation", "ntacl", "rodc",
    "schema", "visualize", "testparm",
]

# Полная карта подкоманд с описанием (для TOOL LIST и справки)
SAMBA_TOOL_HELP = {
    "user": {
        "desc": "Управление пользователями",
        "subcmds": {
            "list":       "Список пользователей",
            "create":     "Создать пользователя: TOOL user create <user> <password> [опции]",
            "delete":     "Удалить пользователя: TOOL user delete <user>",
            "disable":    "Отключить учётную запись: TOOL user disable <user>",
            "enable":     "Включить учётную запись: TOOL user enable <user>",
            "setpassword":  "Установить пароль: TOOL user setpassword <user> --newpassword=<pass>",
            "getpassword":  "Получить пароль (требует прав): TOOL user getpassword <user>",
            "getgroups":  "Группы пользователя: TOOL user getgroups <user>",
            "show":       "Подробности пользователя: TOOL user show <user>",
            "rename":     "Переименовать: TOOL user rename <old> <new>",
            "move":       "Переместить: TOOL user move <user> <new_ou>",
            "setexpiry":  "Установить срок действия: TOOL user setexpiry <user> [опции]",
            "passwordsettings": "Настройки пароля",
        },
    },
    "group": {
        "desc": "Управление группами",
        "subcmds": {
            "list":          "Список групп",
            "listmembers":   "Члены группы: TOOL group listmembers <group>",
            "addmembers":    "Добавить членов: TOOL group addmembers <group> <member1> [member2...]",
            "removemembers": "Удалить членов: TOOL group removemembers <group> <member1> [member2...]",
            "create":        "Создать группу: TOOL group create <group> [опции]",
            "delete":        "Удалить группу: TOOL group delete <group>",
            "show":          "Подробности группы: TOOL group show <group>",
            "rename":        "Переименовать: TOOL group rename <old> <new>",
            "move":          "Переместить: TOOL group move <group> <new_ou>",
            "listmemberof":  "Группы, в которых состоит: TOOL group listmemberof <object>",
        },
    },
    "computer": {
        "desc": "Управление компьютерами",
        "subcmds": {
            "list":    "Список компьютеров",
            "create":  "Создать: TOOL computer create <name> [опции]",
            "add":     "Добавить: TOOL computer add <name> [опции] (синоним create)",
            "delete":  "Удалить: TOOL computer delete <name>",
            "show":    "Подробности: TOOL computer show <name>",
            "edit":    "Редактировать: TOOL computer edit <name>",
            "rename":  "Переименовать: TOOL computer rename <old> --newname=<new>",
            "move":    "Переместить: TOOL computer move <name> <new_parent_dn>",
        },
    },
    "dns": {
        "desc": "Управление DNS",
        "subcmds": {
            "query":      "Запрос записей: TOOL dns query <server> <zone> <name> <type>",
            "add":        "Добавить запись: TOOL dns add <server> <zone> <name> <type> <data>",
            "delete":     "Удалить запись: TOOL dns delete <server> <zone> <name> <type> <data>",
            "update":     "Обновить запись: TOOL dns update <server> <zone> <name> <type> <olddata> <newdata>",
            "roothints":  "Корневые подсказки: TOOL dns roothints <server>",
            "serverinfo": "Информация о сервере: TOOL dns serverinfo <server>",
            "zoneinfo":   "Информация о зоне: TOOL dns zoneinfo <server> <zone>",
            "zonelist":   "Список зон: TOOL dns zonelist <server>",
            "zonecreate": "Создать зону: TOOL dns zonecreate <server> <zone>",
            "zonedelete": "Удалить зону: TOOL dns zonedelete <server> <zone>",
        },
    },
    "ou": {
        "desc": "Управление организационными подразделениями (OU)",
        "subcmds": {
            "list":    "Список OU",
            "create":  "Создать: TOOL ou create <ou_dn> [опции]  (DN: OU=Name,DC=domain,DC=local)",
            "delete":  "Удалить: TOOL ou delete <dn>",
            "rename":  "Переименовать: TOOL ou rename <old> <new>",
            "move":    "Переместить: TOOL ou move <ou> <new_parent>",
            "show":    "Подробности: TOOL ou show <dn>",
        },
    },
    "gpo": {
        "desc": "Управление групповыми политиками (GPO)",
        "subcmds": {
            "list":     "Список GPO для контейнера: TOOL gpo list <container-dn>",
            "listall":  "Список всех GPO: TOOL gpo listall",
            "create":   "Создать GPO: TOOL gpo create <display-name>",
            "delete":   "Удалить GPO: TOOL gpo delete <gpo-dn>",
            "show":     "Подробности: TOOL gpo show <gpo-dn>",
            "getlink":  "Ссылки: TOOL gpo getlink <container-dn>",
            "setlink":  "Установить ссылку: TOOL gpo setlink <container-dn> <gpo-dn>",
            "dellink":  "Удалить ссылку: TOOL gpo dellink <container-dn> <gpo-guid>",
            "fetch":    "Скачать GPO: TOOL gpo fetch <gpo-dn> <dest-dir>",
        },
    },
    "domain": {
        "desc": "Управление доменом",
        "subcmds": {
            "info":            "Информация о домене",
            "level":           "Уровень работы домена: TOOL domain level show|raise",
            "provision":       "Подготовка нового домена",
            "join":            "Присоединение к домену",
            "dcpromo":         "Повышение до DC",
            "classicupgrade":  "Обновление с классического Samba",
            "demote":          "Понижение DC",
            "exportkeytab":    "Экспорт keytab: TOOL domain exportkeytab <file>",
            "passwordsettings": "Настройки пароля домена",
            "trust":           "Управление доверенными отношениями",
            "samba3sid":       "SID Samba3",
            "sid":             "SID домена",
            "get-kerberos":    "Получить Kerberos билет",
        },
    },
    "sites": {
        "desc": "Управление сайтами AD",
        "subcmds": {
            "list":    "Список сайтов",
            "create":  "Создать сайт",
            "delete":  "Удалить сайт",
            "rename":  "Переименовать сайт",
            "show":    "Подробности сайта",
            "subnet":  "Управление подсетями",
        },
    },
    "fsmo": {
        "desc": "Управление ролями FSMO (Flexible Single Master Operations)",
        "subcmds": {
            "show":      "Показать текущие роли FSMO",
            "transfer":  "Передать роль: TOOL fsmo transfer --role=<role>",
            "seize":     "Захватить роль: TOOL fsmo seize --role=<role>",
        },
    },
    "drs": {
        "desc": "Управление репликацией (Directory Replication Service)",
        "subcmds": {
            "bind":       "Связаться с DC",
            "kcc":        "Запустить KCC",
            "repl":       "Запустить репликацию: TOOL drs repl --all|<dc>",
            "showrepl":   "Показать статус репликации",
        },
    },
    "spn": {
        "desc": "Управление SPN (Service Principal Names)",
        "subcmds": {
            "list":    "Список SPN: TOOL spn list <account>",
            "add":     "Добавить SPN: TOOL spn add <spn> <account>",
            "delete":  "Удалить SPN: TOOL spn delete <spn> <account>",
        },
    },
    "delegation": {
        "desc": "Управление делегированием Kerberos",
        "subcmds": {
            "add":     "Добавить делегирование: TOOL delegation add <account>",
            "remove":  "Удалить делегирование: TOOL delegation remove <account>",
            "show":    "Показать делегирование: TOOL delegation show <account>",
            "for-any-service":  "Делегирование для любой службы",
            "for-any-protocol": "Делегирование для любого протокола",
        },
    },
    "ntacl": {
        "desc": "Управление NT ACL",
        "subcmds": {
            "get":           "Получить ACL: TOOL ntacl get <file>",
            "set":           "Установить ACL: TOOL ntacl set <acl> <file>",
            "check":         "Проверить ACL",
            "sysvolcheck":   "Проверить ACL sysvol",
            "sysvolreset":   "Сбросить ACL sysvol",
        },
    },
    "rodc": {
        "desc": "Управление RODC (Read-Only Domain Controller)",
        "subcmds": {
            "preload":  "Предзагрузка паролей",
            "create":   "Создать RODC",
        },
    },
    "schema": {
        "desc": "Управление схемой AD",
        "subcmds": {
            "query":   "Запрос схемы: TOOL schema query [опции]",
            "modify":  "Изменить схему",
            "show":    "Показать атрибут/класс",
        },
    },
    "ldapcmp": {
        "desc": "Сравнение двух LDAP серверов",
        "subcmds": {
            "compare":  "Сравнить: TOOL ldapcmp <server1> <server2> [опции]",
        },
    },
    "dbcheck": {
        "desc": "Проверка целостности базы данных",
        "subcmds": {
            "check":    "Проверить базу (по умолчанию): TOOL dbcheck",
            "fix":      "Исправить ошибки: TOOL dbcheck --fix",
        },
    },
    "visualize": {
        "desc": "Визуализация структуры AD",
        "subcmds": {
            "ou":          "Визуализация OU",
            "subgraph":    "Подграф",
            "crossdomain": "Междоменная визуализация",
        },
    },
    "testparm": {
        "desc": "Проверка конфигурации smb.conf",
        "subcmds": {},
    },
    "contact": {
        "desc": "Управление контактами",
        "subcmds": {
            "create":  "Создать контакт",
            "delete":  "Удалить контакт",
            "list":    "Список контактов",
            "move":    "Переместить контакт",
            "rename":  "Переименовать контакт",
            "show":    "Подробности контакта",
        },
    },
}

# ─── Форматы вывода ──────────────────────────────────────────────────────────

OUTPUT_FORMATS = ["json", "csv", "tsv", "table", "table_presto", "table_grid", "table_simple", "table_rounded", "table_double", "ldif", "vertical", "dataframe", "xlsx", "raw"]

# Формат по умолчанию
DEFAULT_FORMAT = "table"

# ─── Настройки таблиц ────────────────────────────────────────────────────────

TABLE_MAX_COL_WIDTH = 60
TABLE_TRUNCATE = True

# ─── Кодировка ───────────────────────────────────────────────────────────────

DEFAULT_ENCODING = "utf-8"

# ─── SQL-like таблицы (для SELECT из СУБД) ──────────────────────────────────

SQL_TABLES = {
    "USERS": {
        "filter": "(&(objectClass=user)(sAMAccountType=805306368))",
        "attrs": ["sAMAccountName", "cn", "displayName", "mail", "department", "title", "description", "dn"],
        "name_attr": "sAMAccountName",
        "desc": "Пользователи AD",
    },
    "GROUPS": {
        "filter": "(objectClass=group)",
        "attrs": ["sAMAccountName", "cn", "description", "member", "dn"],
        "name_attr": "sAMAccountName",
        "desc": "Группы AD",
    },
    "COMPUTERS": {
        "filter": "(objectClass=computer)",
        "attrs": ["sAMAccountName", "cn", "description", "operatingSystem", "dn"],
        "name_attr": "sAMAccountName",
        "desc": "Компьютеры AD",
    },
    "OUS": {
        "filter": "(objectClass=organizationalUnit)",
        "attrs": ["ou", "description", "dn"],
        "name_attr": "ou",
        "desc": "Организационные подразделения",
    },
    "GPOS": {
        "filter": "(objectClass=groupPolicyContainer)",
        "attrs": ["cn", "displayName", "gPCFileSysPath", "dn"],
        "name_attr": "displayName",
        "desc": "Групповые политики",
    },
    "CONTACTS": {
        "filter": "(objectClass=contact)",
        "attrs": ["cn", "mail", "telephoneNumber", "dn"],
        "name_attr": "cn",
        "desc": "Контакты",
    },
    "DNS_RECORDS": {
        "filter": "(objectClass=dnsNode)",
        "attrs": ["dc", "dnsRecord", "dn"],
        "name_attr": "dc",
        "desc": "DNS записи",
    },
}


def get_ldb_path(name: str) -> str:
    """
    Получить полный путь к LDB файлу по короткому имени.

    Если передан полный путь (содержит '/' и заканчивается на '.ldb'),
    возвращает его как есть.

    Поддерживает регистронезависимый поиск: SAM, Sam, sam - все работают.

    Args:
        name: Короткое имя ('sam', 'privilege', ...) или полный путь

    Returns:
        Полный путь к LDB файлу

    Raises:
        ValueError: Если имя неизвестно
    """
    if os.path.sep in name or name.endswith(".ldb"):
        return os.path.abspath(name)

    # Регистронезависимый поиск
    name_lower = name.lower()
    for key, path in LDB_DATABASES.items():
        if key.lower() == name_lower:
            return path

    raise ValueError(
        f"Неизвестная база данных '{name}'. "
        f"Доступные: {', '.join(LDB_DATABASES.keys())} "
        f"или укажите полный путь к .ldb файлу"
    )


def list_databases() -> dict:
    """
    Возвращает словарь всех известных баз данных с описаниями и статусом существования.

    Returns:
        dict: {name: {"path": str, "description": str, "exists": bool}}
    """
    result = {}
    for name, path in LDB_DATABASES.items():
        result[name] = {
            "path": path,
            "description": LDB_DESCRIPTIONS.get(name, ""),
            "exists": os.path.isfile(path),
        }
    return result
