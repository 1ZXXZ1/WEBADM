"""
Коннектор к samba-tool — выполнение команд управления Samba AD.

samba-tool — основной инструмент управления Samba AD.
Мы вызываем его через subprocess и парсим текстовый вывод.

Поддерживает запуск через sudo — многие команды samba-tool
требуют root-привилегий.

Поддерживаемые подкоманды:
  - user:    list, create, delete, disable, enable, setpassword, getpassword,
             getgroups, show, rename, move, setexpiry, passwordsettings
  - group:   list, addmembers, removemembers, listmembers, create, delete,
             show, rename, move, listmemberof
  - computer:list, create, delete, show, rename, move
  - dns:     query, add, delete, roothints, serverinfo, zoneinfo, zonelist, create
  - ou:      list, create, delete, rename, move, show
  - gpo:     list, listall, create, delete, show, getlink, setlink, dellink, fetch
  - domain:  info, level, provision, join, dcpromo, classicupgrade, demote,
             exportkeytab, passwordsettings, trust, sid
  - sites:   list, create, delete, rename, show, subnet
  - fsmo:    show, transfer, seize
  - drs:     bind, kcc, repl, showrepl
  - spn:     list, add, delete
  - delegation: add, remove, show
  - ntacl:   get, set, check, sysvolcheck, sysvolreset
  - rodc:    preload, create
  - schema:  query, modify, show
  - dbcheck: check (default), --fix
  - ldapcmp: compare
  - contact: create, delete, list, move, rename, show
  - visualize: ou, subgraph, crossdomain
  - testparm: check smb.conf
"""

import subprocess
import shlex
from typing import List, Optional, Dict, Any

from app.sdb_lib.config import SAMBA_TOOL_PATH, SAMBA_TOOL_SUBCOMMANDS


class SambaToolResult:
    """
    Результат выполнения samba-tool команды.

    Attributes:
        returncode: Код возврата
        stdout: Стандартный вывод
        stderr: Стандартный вывод ошибок
        success: Успешно ли выполнение
        lines: Строки вывода (без пустых)
    """

    def __init__(self, returncode: int, stdout: str, stderr: str):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr
        self.success = returncode == 0
        self.lines = [
            line.strip()
            for line in stdout.split("\n")
            if line.strip()
        ]

    def to_dict(self) -> Dict[str, Any]:
        """Преобразовать результат в словарь."""
        return {
            "success": self.success,
            "returncode": self.returncode,
            "output": self.stdout.strip(),
            "error": self.stderr.strip() if self.stderr else "",
            "lines": self.lines,
        }

    def __repr__(self) -> str:
        status = "OK" if self.success else "FAIL"
        return f"SambaToolResult({status}, rc={self.returncode}, {len(self.lines)} lines)"


class SambaToolConnector:
    """
    Коннектор к samba-tool для управления Samba AD.

    Поддерживает запуск через sudo (use_sudo=True), что необходимо
    для большинства команд samba-tool.

    Примеры использования:
        connector = SambaToolConnector(use_sudo=True)
        result = connector.run(["user", "list"])
        result = connector.run(["group", "addmembers", "Domain Admins", "username"])
        result = connector.run(["dns", "query", "kcrb.local", "@", "ALL"])
        result = connector.run(["user", "create", "john", "P@ssw0rd",
                                "--given-name=John", "--surname=Doe"])
    """

    def __init__(self, samba_tool_path: Optional[str] = None, use_sudo: bool = True):
        """
        Инициализация коннектора.

        Args:
            samba_tool_path: Путь к samba-tool (None = автопоиск)
            use_sudo: Использовать sudo (по умолчанию True)
        """
        self.samba_tool_path = samba_tool_path or SAMBA_TOOL_PATH
        self.use_sudo = use_sudo

    def run(self, args: List[str], extra_args: Optional[List[str]] = None) -> SambaToolResult:
        """
        Выполнить samba-tool команду.

        Любая команда samba-tool может быть выполнена через этот метод.
        Все аргументы передаются напрямую в samba-tool.

        Примеры:
            run(["user", "list"])
            run(["user", "create", "john", "P@ss", "--given-name=John"])
            run(["dns", "query", "kcrb.local", "@", "ALL"])
            run(["fsmo", "transfer", "--role=rid"])
            run(["dbcheck", "--fix"])
            run(["drs", "showrepl"])

        Args:
            args: Аргументы команды (например: ["user", "list"])
            extra_args: Дополнительные аргументы (для совместимости)

        Returns:
            SambaToolResult с результатами

        Raises:
            RuntimeError: Если samba-tool не найден
        """
        cmd = []
        if self.use_sudo:
            cmd.append("sudo")
        cmd.append(self.samba_tool_path)
        cmd.extend(args)
        if extra_args:
            cmd.extend(extra_args)

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,
            )
        except FileNotFoundError:
            # Если с sudo не нашлось — пробуем без
            if self.use_sudo:
                raise RuntimeError(
                    f"sudo или samba-tool не найдены. "
                    f"Установите sudo и samba-tools."
                )
            raise RuntimeError(
                f"samba-tool не найден по пути '{self.samba_tool_path}'. "
                f"Установите samba-tools."
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError("samba-tool: таймаут команды (120 сек)")

        return SambaToolResult(
            returncode=result.returncode,
            stdout=result.stdout,
            stderr=result.stderr,
        )

    # ─── Удобные методы для частых команд ──────────────────────────────────

    # ──── User ──────────────────────────────────────────────────────────────

    def user_list(self) -> SambaToolResult:
        """Список пользователей."""
        return self.run(["user", "list"])

    def user_create(self, username: str, password: str, extra_args: Optional[List[str]] = None) -> SambaToolResult:
        """
        Создать пользователя.

        Дополнительные опции:
          --given-name=Имя
          --surname=Фамилия
          --mail-address=email
          --department=Отдел
          --company=Компания
          --job-title=Должность
          --must-change-at-next-login
          --use-username-as-cn
        """
        return self.run(["user", "create", username, password], extra_args=extra_args)

    def user_delete(self, username: str) -> SambaToolResult:
        """Удалить пользователя."""
        return self.run(["user", "delete", username])

    def user_disable(self, username: str) -> SambaToolResult:
        """Отключить пользователя."""
        return self.run(["user", "disable", username])

    def user_enable(self, username: str) -> SambaToolResult:
        """Включить пользователя."""
        return self.run(["user", "enable", username])

    def user_setpassword(self, username: str, password: str, extra_args: Optional[List[str]] = None) -> SambaToolResult:
        """
        Установить пароль пользователя.

        Дополнительные опции:
          --must-change-at-next-login
          --no-expiry
        """
        return self.run(["user", "setpassword", username, "--newpassword", password], extra_args=extra_args)

    def user_getpassword(self, username: str) -> SambaToolResult:
        """Получить пароль пользователя (требует привилегий)."""
        return self.run(["user", "getpassword", username])

    def user_getgroups(self, username: str, extra_args: Optional[List[str]] = None) -> SambaToolResult:
        """
        Получить группы пользователя.

        Дополнительные опции:
          --recursive  — включая вложенные группы
        """
        return self.run(["user", "getgroups", username], extra_args=extra_args)

    def user_show(self, username: str) -> SambaToolResult:
        """Подробности пользователя."""
        return self.run(["user", "show", username])

    def user_rename(self, old_name: str, new_name: str) -> SambaToolResult:
        """Переименовать пользователя."""
        return self.run(["user", "rename", old_name, "--newname", new_name])

    def user_move(self, username: str, new_ou: str) -> SambaToolResult:
        """Переместить пользователя в другой OU."""
        return self.run(["user", "move", username, new_ou])

    def user_setexpiry(self, username: str, days: Optional[int] = None, no_expiry: bool = False) -> SambaToolResult:
        """
        Установить срок действия пароля.

        Args:
            username: Имя пользователя
            days: Количество дней до истечения (None = отключить)
            no_expiry: Пароль никогда не истекает
        """
        args = ["user", "setexpiry", username]
        if no_expiry:
            args.append("--noexpiry")
        elif days is not None:
            args.extend(["--days", str(days)])
        return self.run(args)

    # ──── Group ─────────────────────────────────────────────────────────────

    def group_list(self, extra_args: Optional[List[str]] = None) -> SambaToolResult:
        """
        Список групп.

        Дополнительные опции:
          --verbose    — подробный вывод
          --hide-builtin — скрыть встроенные группы
        """
        return self.run(["group", "list"], extra_args=extra_args)

    def group_listmembers(self, groupname: str, extra_args: Optional[List[str]] = None) -> SambaToolResult:
        """
        Список членов группы.

        Дополнительные опции:
          --recursive  — включая вложенные группы
        """
        return self.run(["group", "listmembers", groupname], extra_args=extra_args)

    def group_addmembers(self, groupname: str, members: List[str]) -> SambaToolResult:
        """Добавить членов в группу."""
        return self.run(["group", "addmembers", groupname] + members)

    def group_removemembers(self, groupname: str, members: List[str]) -> SambaToolResult:
        """Удалить членов из группы."""
        return self.run(["group", "removemembers", groupname] + members)

    def group_create(self, groupname: str, extra_args: Optional[List[str]] = None) -> SambaToolResult:
        """
        Создать группу.

        Дополнительные опции:
          --group-scope=DomainLocal|Global|Universal
          --group-type=Security|Distribution
          --description=описание
          --mail-address=email
        """
        return self.run(["group", "create", groupname], extra_args=extra_args)

    def group_delete(self, groupname: str) -> SambaToolResult:
        """Удалить группу."""
        return self.run(["group", "delete", groupname])

    def group_show(self, groupname: str) -> SambaToolResult:
        """Подробности группы."""
        return self.run(["group", "show", groupname])

    def group_rename(self, old_name: str, new_name: str) -> SambaToolResult:
        """Переименовать группу."""
        return self.run(["group", "rename", old_name, "--newname", new_name])

    def group_move(self, groupname: str, new_ou: str) -> SambaToolResult:
        """Переместить группу в другой OU."""
        return self.run(["group", "move", groupname, new_ou])

    def group_listmemberof(self, objectname: str) -> SambaToolResult:
        """Группы, в которых состоит объект."""
        return self.run(["group", "listmemberof", objectname])

    # ──── Computer ──────────────────────────────────────────────────────────

    def computer_list(self) -> SambaToolResult:
        """Список компьютеров."""
        return self.run(["computer", "list"])

    def computer_create(self, computername: str, extra_args: Optional[List[str]] = None) -> SambaToolResult:
        """
        Создать учётную запись компьютера.

        Примечание: samba-tool computer create НЕ требует пароль.
        Это отличие от user create.

        Дополнительные опции:
          --computerou=OU           — альтернативный контейнер (например 'OU=Computers')
          --description=описание
          --ip-address=IP           — IPv4/IPv6 адрес
          --service-principal-name=SPN  — SPN компьютера
          --prepare-oldjoin          — подготовить для oldjoin
        """
        return self.run(["computer", "create", computername], extra_args=extra_args)

    def computer_add(self, computername: str, extra_args: Optional[List[str]] = None) -> SambaToolResult:
        """
        Добавить учётную запись компьютера (синоним computer create).

        Дополнительные опции — те же, что и для computer_create.
        """
        return self.run(["computer", "add", computername], extra_args=extra_args)

    def computer_delete(self, computername: str) -> SambaToolResult:
        """Удалить учётную запись компьютера."""
        return self.run(["computer", "delete", computername])

    def computer_show(self, computername: str) -> SambaToolResult:
        """Подробности компьютера."""
        return self.run(["computer", "show", computername])

    def computer_rename(self, old_name: str, new_name: str) -> SambaToolResult:
        """Переименовать компьютер."""
        return self.run(["computer", "rename", old_name, "--newname", new_name])

    def computer_move(self, computername: str, new_ou: str) -> SambaToolResult:
        """Переместить компьютер в другой OU."""
        return self.run(["computer", "move", computername, new_ou])

    # ──── DNS ───────────────────────────────────────────────────────────────

    def dns_query(self, server: str, zone: str, name: str = "@", record_type: str = "ALL") -> SambaToolResult:
        """
        Запрос DNS записей.

        Args:
            server: DNS сервер (обычно имя домена или IP контроллера)
            zone: Зона DNS
            name: Имя записи (@ = корень зоны)
            record_type: Тип записи (ALL, A, AAAA, CNAME, MX, NS, SOA, SRV, TXT, PTR)
        """
        return self.run(["dns", "query", server, zone, name, record_type])

    def dns_add(self, server: str, zone: str, name: str, record_type: str, data: str) -> SambaToolResult:
        """
        Добавить DNS запись.

        Примеры:
            dns_add("kcrb.local", "kcrb.local", "server1", "A", "192.168.1.100")
            dns_add("kcrb.local", "kcrb.local", "alias", "CNAME", "server1.kcrb.local")
        """
        return self.run(["dns", "add", server, zone, name, record_type, data])

    def dns_delete(self, server: str, zone: str, name: str, record_type: str, data: str) -> SambaToolResult:
        """Удалить DNS запись."""
        return self.run(["dns", "delete", server, zone, name, record_type, data])

    def dns_roothints(self, server: str) -> SambaToolResult:
        """Корневые подсказки DNS."""
        return self.run(["dns", "roothints", server])

    def dns_serverinfo(self, server: str) -> SambaToolResult:
        """Информация о DNS сервере."""
        return self.run(["dns", "serverinfo", server])

    def dns_zoneinfo(self, server: str, zone: str) -> SambaToolResult:
        """Информация о DNS зоне."""
        return self.run(["dns", "zoneinfo", server, zone])

    def dns_zonelist(self, server: str) -> SambaToolResult:
        """Список DNS зон."""
        return self.run(["dns", "zonelist", server])

    def dns_zonecreate(self, server: str, zone: str, extra_args: Optional[List[str]] = None) -> SambaToolResult:
        """
        Создать DNS зону.

        Дополнительные опции:
          --reverse    — создать обратную зону
        """
        return self.run(["dns", "zonecreate", server, zone], extra_args=extra_args)

    def dns_zonedelete(self, server: str, zone: str, extra_args: Optional[List[str]] = None) -> SambaToolResult:
        """
        Удалить DNS зону.
        """
        return self.run(["dns", "zonedelete", server, zone], extra_args=extra_args)

    def dns_update(self, server: str, zone: str, name: str, record_type: str, old_data: str, new_data: str) -> SambaToolResult:
        """
        Обновить DNS запись.
        """
        return self.run(["dns", "update", server, zone, name, record_type, old_data, new_data])

    # ──── OU ────────────────────────────────────────────────────────────────

    def ou_list(self) -> SambaToolResult:
        """Список организационных подразделений."""
        return self.run(["ou", "list"])

    def ou_create(self, ou_dn: str, extra_args: Optional[List[str]] = None) -> SambaToolResult:
        """
        Создать OU.

        Аргумент ou_dn — полный DN подразделения, например:
          "OU=Staff,DC=kcrb,DC=local"
          "OU=Computers,OU=Staff,DC=kcrb,DC=local"

        samba-tool ou create НЕ поддерживает --base-dn как опцию.
        Базовый DN указывается прямо в DN: OU=Name,DC=domain,DC=local

        Дополнительные опции:
          --description=описание
        """
        args = ["ou", "create", ou_dn]
        return self.run(args, extra_args=extra_args)

    def ou_delete(self, dn: str) -> SambaToolResult:
        """Удалить OU."""
        return self.run(["ou", "delete", dn])

    def ou_show(self, dn: str) -> SambaToolResult:
        """Подробности OU."""
        return self.run(["ou", "show", dn])

    def ou_rename(self, old_name: str, new_name: str) -> SambaToolResult:
        """Переименовать OU."""
        return self.run(["ou", "rename", old_name, "--newname", new_name])

    def ou_move(self, ou_dn: str, new_parent: str) -> SambaToolResult:
        """Переместить OU."""
        return self.run(["ou", "move", ou_dn, new_parent])

    # ──── GPO ───────────────────────────────────────────────────────────────

    def gpo_list(self, container_dn: str) -> SambaToolResult:
        """Список GPO для контейнера."""
        return self.run(["gpo", "list", container_dn])

    def gpo_listall(self) -> SambaToolResult:
        """Список всех GPO."""
        return self.run(["gpo", "listall"])

    def gpo_create(self, display_name: str, extra_args: Optional[List[str]] = None) -> SambaToolResult:
        """Создать GPO."""
        return self.run(["gpo", "create", display_name], extra_args=extra_args)

    def gpo_delete(self, gpo_dn: str) -> SambaToolResult:
        """Удалить GPO."""
        return self.run(["gpo", "delete", gpo_dn])

    def gpo_show(self, gpo_dn: str) -> SambaToolResult:
        """Подробности GPO."""
        return self.run(["gpo", "show", gpo_dn])

    def gpo_getlink(self, container_dn: str) -> SambaToolResult:
        """Ссылки GPO."""
        return self.run(["gpo", "getlink", container_dn])

    def gpo_setlink(self, container_dn: str, gpo_dn: str) -> SambaToolResult:
        """Установить ссылку GPO."""
        return self.run(["gpo", "setlink", container_dn, gpo_dn])

    def gpo_dellink(self, container_dn: str, gpo_guid: str) -> SambaToolResult:
        """Удалить ссылку GPO."""
        return self.run(["gpo", "dellink", container_dn, gpo_guid])

    def gpo_fetch(self, gpo_dn: str, dest_dir: str) -> SambaToolResult:
        """Скачать GPO."""
        return self.run(["gpo", "fetch", gpo_dn, dest_dir])

    # ──── Domain ────────────────────────────────────────────────────────────

    def domain_info(self, server: Optional[str] = None) -> SambaToolResult:
        """
        Информация о домене.

        Args:
            server: IP или имя контроллера (опционально)
        """
        args = ["domain", "info"]
        if server:
            args.append(server)
        return self.run(args)

    def domain_level_show(self) -> SambaToolResult:
        """Показать уровень работы домена."""
        return self.run(["domain", "level", "show"])

    def domain_level_raise(self, level: Optional[str] = None) -> SambaToolResult:
        """Повысить уровень работы домена."""
        args = ["domain", "level", "raise"]
        if level:
            args.append(level)
        return self.run(args)

    def domain_exportkeytab(self, filepath: str, extra_args: Optional[List[str]] = None) -> SambaToolResult:
        """
        Экспорт keytab файла.

        Дополнительные опции:
          --principal=principal
        """
        return self.run(["domain", "exportkeytab", filepath], extra_args=extra_args)

    def domain_passwordsettings(self, extra_args: Optional[List[str]] = None) -> SambaToolResult:
        """
        Настройки пароля домена.

        Дополнительные опции:
          --complexity=on|off
          --history-length=N
          --min-pwd-age=N
          --max-pwd-age=N
          --min-pwd-length=N
          --store-plaintext=on|off
        """
        return self.run(["domain", "passwordsettings"], extra_args=extra_args)

    def domain_trust_list(self) -> SambaToolResult:
        """Список доверенных отношений."""
        return self.run(["domain", "trust", "list"])

    # ──── Sites ─────────────────────────────────────────────────────────────

    def sites_list(self) -> SambaToolResult:
        """Список сайтов."""
        return self.run(["sites", "list"])

    def sites_create(self, name: str) -> SambaToolResult:
        """Создать сайт."""
        return self.run(["sites", "create", name])

    def sites_delete(self, name: str) -> SambaToolResult:
        """Удалить сайт."""
        return self.run(["sites", "delete", name])

    def sites_show(self, name: str) -> SambaToolResult:
        """Подробности сайта."""
        return self.run(["sites", "show", name])

    # ──── FSMO ──────────────────────────────────────────────────────────────

    def fsmo_show(self) -> SambaToolResult:
        """Показать роли FSMO."""
        return self.run(["fsmo", "show"])

    def fsmo_transfer(self, role: str) -> SambaToolResult:
        """
        Передать роль FSMO.

        Доступные роли: rid, pdc, infrastructure, naming, schema
        """
        return self.run(["fsmo", "transfer", f"--role={role}"])

    def fsmo_seize(self, role: str) -> SambaToolResult:
        """
        Захватить роль FSMO.

        Доступные роли: rid, pdc, infrastructure, naming, schema
        ВНИМАНИЕ: Использовать только если текущий владелец недоступен!
        """
        return self.run(["fsmo", "seize", f"--role={role}"])

    # ──── DRS (репликация) ──────────────────────────────────────────────────

    def drs_showrepl(self) -> SambaToolResult:
        """Показать статус репликации."""
        return self.run(["drs", "showrepl"])

    def drs_kcc(self, extra_args: Optional[List[str]] = None) -> SambaToolResult:
        """Запустить KCC (Knowledge Consistency Checker)."""
        return self.run(["drs", "kcc"], extra_args=extra_args)

    def drs_repl(self, target: str = "--all") -> SambaToolResult:
        """Запустить репликацию."""
        return self.run(["drs", "repl", target])

    # ──── SPN ───────────────────────────────────────────────────────────────

    def spn_list(self, account: str) -> SambaToolResult:
        """Список SPN учётной записи."""
        return self.run(["spn", "list", account])

    def spn_add(self, spn: str, account: str) -> SambaToolResult:
        """Добавить SPN."""
        return self.run(["spn", "add", spn, account])

    def spn_delete(self, spn: str, account: str) -> SambaToolResult:
        """Удалить SPN."""
        return self.run(["spn", "delete", spn, account])

    # ──── Delegation ────────────────────────────────────────────────────────

    def delegation_add(self, account: str) -> SambaToolResult:
        """Добавить делегирование Kerberos."""
        return self.run(["delegation", "add", account])

    def delegation_remove(self, account: str) -> SambaToolResult:
        """Удалить делегирование Kerberos."""
        return self.run(["delegation", "remove", account])

    def delegation_show(self, account: str) -> SambaToolResult:
        """Показать делегирование Kerberos."""
        return self.run(["delegation", "show", account])

    # ──── NTACL ─────────────────────────────────────────────────────────────

    def ntacl_sysvolcheck(self) -> SambaToolResult:
        """Проверить ACL sysvol."""
        return self.run(["ntacl", "sysvolcheck"])

    def ntacl_sysvolreset(self) -> SambaToolResult:
        """Сбросить ACL sysvol."""
        return self.run(["ntacl", "sysvolreset"])

    def ntacl_get(self, filepath: str, extra_args: Optional[List[str]] = None) -> SambaToolResult:
        """Получить NT ACL файла."""
        return self.run(["ntacl", "get", filepath], extra_args=extra_args)

    def ntacl_set(self, acl: str, filepath: str, extra_args: Optional[List[str]] = None) -> SambaToolResult:
        """Установить NT ACL файла."""
        return self.run(["ntacl", "set", acl, filepath], extra_args=extra_args)

    # ──── Schema ────────────────────────────────────────────────────────────

    def schema_query(self, extra_args: Optional[List[str]] = None) -> SambaToolResult:
        """Запрос схемы AD."""
        return self.run(["schema", "query"], extra_args=extra_args)

    def schema_show(self, attribute: str) -> SambaToolResult:
        """Показать атрибут/класс схемы."""
        return self.run(["schema", "show", attribute])

    # ──── RODC ──────────────────────────────────────────────────────────────

    def rodc_preload(self, account: str) -> SambaToolResult:
        """Предзагрузка паролей на RODC."""
        return self.run(["rodc", "preload", account])

    # ──── dbcheck ───────────────────────────────────────────────────────────

    def dbcheck(self, extra_args: Optional[List[str]] = None) -> SambaToolResult:
        """
        Проверка базы данных.

        Дополнительные опции:
          --fix       — исправить ошибки
          --yes       — отвечать да на все вопросы
          --cross-ncs — проверять кросс-NC ссылки
        """
        return self.run(["dbcheck"], extra_args=extra_args)

    # ──── ldapcmp ───────────────────────────────────────────────────────────

    def ldapcmp(self, server1: str, server2: str, extra_args: Optional[List[str]] = None) -> SambaToolResult:
        """
        Сравнение двух LDAP серверов.

        Пример: ldapcmp("kcrb.local", "kcrb.local", ["--filter=objectClass=user"])
        """
        return self.run(["ldapcmp", server1, server2], extra_args=extra_args)

    # ──── Contact ───────────────────────────────────────────────────────────

    def contact_list(self) -> SambaToolResult:
        """Список контактов."""
        return self.run(["contact", "list"])

    def contact_create(self, name: str, extra_args: Optional[List[str]] = None) -> SambaToolResult:
        """Создать контакт."""
        return self.run(["contact", "create", name], extra_args=extra_args)

    def contact_delete(self, dn: str) -> SambaToolResult:
        """Удалить контакт."""
        return self.run(["contact", "delete", dn])

    # ──── testparm ──────────────────────────────────────────────────────────

    def testparm(self, extra_args: Optional[List[str]] = None) -> SambaToolResult:
        """
        Проверка конфигурации smb.conf.

        Дополнительные опции:
          --verbose
          --show-all-parameters
          --parameter-name=name
          --section-name=section
        """
        return self.run(["testparm"], extra_args=extra_args)

    def __repr__(self) -> str:
        sudo_str = "sudo " if self.use_sudo else ""
        return f"SambaToolConnector({sudo_str}path={self.samba_tool_path!r})"
