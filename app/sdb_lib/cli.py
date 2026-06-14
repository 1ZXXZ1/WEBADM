#!/usr/bin/env python3
"""
sdb-cli - CLI интерфейс для SDB (Samba Database Query Tool).

Запуск:
    sdb                                          # Интерактивный режим (sudo по умолчанию)
    sdb --no-sudo                                # Без sudo
    sdb -f script.sdb                            # Выполнить скрипт
    sdb -e "USE sam; SELECT * FROM * WHERE objectClass=user;"
    sdb --databases                              # Показать базы данных
    sdb --parse-ldif file.ldif                   # Разобрать LDIF файл
    sdb --parse-ldif file.ldif --format json     # Экспорт LDIF в JSON

Примечание: LDB файлы Samba обычно доступны только root,
поэтому sudo включён по умолчанию. Если запускаете от root -
можно использовать --no-sudo.

Установка системно (для sudo):
    sudo bash install.sh
"""

import sys
import argparse
import os
import re

# Добавляем текущую и родительскую директорию в путь,
# чтобы работало и с sudo, и из любой директории
_cli_dir = os.path.dirname(os.path.abspath(__file__))
_parent_dir = os.path.dirname(_cli_dir)
_cwd = os.getcwd()
for p in [_cli_dir, _parent_dir, _cwd]:
    if p not in sys.path:
        sys.path.insert(0, p)

from sdb.client import SdbClient
from sdb.parser.ldif import parse_ldif_file
from sdb.completer import SdbCompleter, setup_readline

# ─── Команды, которые можно выполнить без ; ────────────────────────────────
_SINGLE_WORD_COMMANDS = {
    "dataframe", "quit", "exit", "help", "?",
}

_COMPLETE_COMMAND_PATTERNS = [
    r'^USE\s+\S+',
    r'^FORMAT\s+\S+',
    r'^OUTPUT\s+\S+',
    r'^FIELDS\s+\S+',
    r'^LIMIT\s+\d+',
    r'^SEARCH\s+\S+',
    r'^SET\s+\S+\s*=',
    r'^IMPORT\s+\S+',
    r'^TOOL\s+\S+\s+\S+',
    r'^TOOL\s+(LIST|HELP)\s*$',
    r'^ENABLE\s+\S+',
    r'^DISABLE\s+\S+',
    r'^DELETE\s+\S+\s+\S+',
    r'^LIST\s+\S+',
    # SHOW - 2 или 3 слова
    r'^SHOW\s+(DATABASES|DBS|HELP)\s*$',
    r'^SHOW\s+(USER|GROUP|COMPUTER|OU|GPO|CONTACT)\s+\S+',
    r'^SHOW\s+DNS\s*$',
    # CREATE с аргументами
    r'^CREATE\s+(USER|USERS|GROUP|COMPUTER|OU)\s+\S+',
    # SYNTHESIS
    r'^SYNTHESIS(\s+(SCHEMA|ENTITY|RELATION|ASSOCIATION|NORMALIZE))?\s*$',
    # SQL-like SELECT
    r'^SELECT\s+.*\s+FROM\s+\S+',
]

_COMPLETE_PATTERNS_COMPILED = [re.compile(p, re.IGNORECASE) for p in _COMPLETE_COMMAND_PATTERNS]


def _is_complete_command(line: str) -> bool:
    """Проверить, является ли строка завершённой командой (без необходимости ;)."""
    stripped = line.strip()
    if not stripped:
        return False

    if ';' in stripped:
        return True

    upper = stripped.upper()

    if upper in _SINGLE_WORD_COMMANDS:
        return True

    # SELECT без FROM → НЕ завершена
    if upper.startswith("SELECT") and " FROM " not in upper:
        return False

    for pattern in _COMPLETE_PATTERNS_COMPILED:
        if pattern.match(stripped):
            return True

    return False


def main():
    parser = argparse.ArgumentParser(
        description="SDB - Samba Database Query Tool. "
                    "Удобная работа с базами LDB и samba-tool.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Примеры:
  sdb -f query.sdb                                  Выполнить скрипт (sudo по умолчанию)
  sdb --no-sudo -f query.sdb                        Без sudo
  sdb -e "USE sam; FORMAT json; SELECT dn, cn FROM * WHERE objectClass=group;"
  sdb --databases                                   Показать базы данных
  sdb --parse-ldif sam.ldif                         Разобрать LDIF файл
  sdb --parse-ldif sam.ldif --format json --output result.json

Установка:
  sudo bash install.sh                               Системная установка (чтобы работало с sudo)
        """,
    )

    parser.add_argument("-f", "--file", help="Путь к файлу скрипта SDB", default=None)
    parser.add_argument("-e", "--execute", help="Выполнить команду SDB (несколько команд через ;)", default=None)
    parser.add_argument("--databases", action="store_true", help="Показать доступные базы данных")
    parser.add_argument("--parse-ldif", metavar="FILE", help="Разобрать LDIF файл", default=None)
    parser.add_argument("--format", choices=["json", "csv", "tsv", "table", "ldif", "xlsx"], default="table", help="Формат вывода (по умолчанию: table)")
    parser.add_argument("-o", "--output", help="Файл для записи результата", default=None)
    parser.add_argument("-d", "--database", default="sam", help="База данных по умолчанию (sam, privilege, idmap, hklm, secrets, share, dns)")
    parser.add_argument("--sudo", action="store_true", default=True, help="Использовать sudo (ПО УМОЛЧАНИЮ)")
    parser.add_argument("--no-sudo", action="store_true", help="НЕ использовать sudo")

    args = parser.parse_args()
    use_sudo = not args.no_sudo

    client = SdbClient(default_database=args.database, use_sudo=use_sudo)

    if use_sudo:
        print(f"[sdb] Режим: sudo включён (ldbsearch и samba-tool через sudo)")
    else:
        print(f"[sdb] Режим: без sudo")

    # ─── Показать базы данных ──────────────────────────────────────────────
    if args.databases:
        dbs = client.show_databases()
        print("\nДоступные базы данных Samba LDB:")
        print("=" * 60)
        for name, info in dbs.items():
            exists = "+" if info["exists"] else "-"
            print(f"  [{exists}] {name:12s} - {info['description']}")
            print(f"      {info['path']}")
        print()
        return

    # ─── Разобрать LDIF файл ───────────────────────────────────────────────
    if args.parse_ldif:
        filepath = args.parse_ldif
        if not os.path.isfile(filepath):
            print(f"Ошибка: файл не найден: {filepath}", file=sys.stderr)
            sys.exit(1)

        records = parse_ldif_file(filepath)
        print(f"Найдено записей: {len(records)}")

        if args.output:
            client.write_output(records, args.output, fmt=args.format)
            print(f"Записано в: {args.output}")
        else:
            output = client.format_output(records, fmt=args.format)
            print(output)
        return

    # ─── Выполнить скрипт из файла ─────────────────────────────────────────
    if args.file:
        if not os.path.isfile(args.file):
            print(f"Ошибка: файл не найден: {args.file}", file=sys.stderr)
            sys.exit(1)
        client.run_script_file(args.file)
        return

    # ─── Выполнить команду ─────────────────────────────────────────────────
    if args.execute:
        client.run_script(args.execute)
        return

    # ─── Интерактивный режим ───────────────────────────────────────────────
    sudo_info = "sudo" if use_sudo else "без sudo"
    print(f"SDB - Samba Database Query Tool v1.2.3-5 ({sudo_info})")
    print("Введите команду или 'help' для справки, 'quit' для выхода")
    print("Команды можно вводить без ; (авто-выполнение по Enter)")
    print("TAB - автодополнение команд, баз данных, имён из БД")
    print()

    # Настройка TAB-автодополнения
    completer = SdbCompleter(engine=client._engine, client=client)
    setup_readline(completer)

    buffer = ""
    while True:
        try:
            # Контекстный prompt
            if not buffer:
                prompt = "sdb> "
            else:
                # Определяем контекст для ..> промпта
                prompt = "  ..> "
                # Передаём контекст буфера комплитеру
                completer.set_buffer_context(buffer)

        except (EOFError, KeyboardInterrupt):
            print("\nВыход.")
            break

        try:
            line = input(prompt)
        except (EOFError, KeyboardInterrupt):
            print("\nВыход.")
            break

        if not line.strip() and not buffer:
            continue

        if not buffer:
            stripped = line.strip()
            if stripped.lower() in ("quit", "exit", "q"):
                print("Выход.")
                break
            if stripped.lower() in ("help", "?"):
                _print_help(use_sudo)
                continue

        if buffer:
            buffer += " " + line.strip()
        else:
            buffer = line.strip()

        # Сбросить контекст буфера
        completer.set_buffer_context("")

        if _has_complete_statement(buffer):
            statements = _split_statements(buffer)
            for stmt in statements:
                stmt = stmt.strip()
                if stmt:
                    try:
                        client.run_script(stmt + ";")
                    except Exception as e:
                        print(f"Ошибка: {e}")
            buffer = ""
        elif _is_complete_command(buffer):
            try:
                client.run_script(buffer + ";")
            except Exception as e:
                print(f"Ошибка: {e}")
            buffer = ""


def _has_complete_statement(buffer: str) -> bool:
    """Проверить, содержит ли буфер завершённую команду (с ; вне кавычек)."""
    in_quotes = False
    for ch in buffer:
        if ch == '"':
            in_quotes = not in_quotes
        elif ch == ';' and not in_quotes:
            return True
    return False


def _split_statements(buffer: str):
    """Разделить буфер на отдельные команды по ; с учётом кавычек."""
    statements = []
    current = ""
    in_quotes = False

    for ch in buffer:
        if ch == '"':
            in_quotes = not in_quotes
            current += ch
        elif ch == ';' and not in_quotes:
            if current.strip():
                statements.append(current.strip())
            current = ""
        else:
            current += ch

    if current.strip():
        statements.append(current.strip())

    return statements


def _print_help(use_sudo=True):
    """Напечатать справку по командам SDB."""
    sudo_note = """
ВНИМАНИЕ: sudo включён по умолчанию, т.к. LDB файлы Samba доступны
только root. Команды ldbsearch и samba-tool запускаются через sudo.
Для отключения: --no-sudo
""" if use_sudo else ""

    help_text = f"""
Команды SDB (регистронезависимые, ; не обязателен):

  USE <database>            Выбрать базу данных (sam, privilege, idmap, hklm, secrets, share, dns)
                            Регистр не важен: USE SAM, USE Sam, USE sam

  SELECT <fields> FROM *    Запросить записи
    [WHERE <filter>]        Фильтр: objectClass=user, sAMAccountName=admin, и т.д.
    [LIMIT <n>]             Ограничить количество

  ── SQL-like запросы ───────────────────────────────────────────────

  SELECT <fields> FROM USERS;       Пользователи из БД
  SELECT <fields> FROM GROUPS;      Группы из БД
  SELECT <fields> FROM COMPUTERS;   Компьютеры из БД
  SELECT <fields> FROM OUS;         OU из БД
  SELECT <fields> FROM GPOS;        GPO из БД
  SELECT <fields> FROM CONTACTS;    Контакты из БД
  SELECT <fields> FROM DNS_RECORDS; DNS записи из БД
  SELECT * FROM USERS WHERE cn=*admin*  С фильтром

  SEARCH <term>             Поиск подстроки (cn, sAMAccountName, description)

  WHERE <filter>            Фильтр для предыдущих записей

  FORMAT <fmt>              Установить формат вывода:
                            json, csv, tsv, table, table_presto, table_grid,
                            table_simple, table_rounded, table_double, ldif, dataframe,
                            xlsx

  OUTPUT <file>             Записать последний результат в файл
                            (авто-определение формата по расширению: .xlsx, .json, .csv, .tsv)

  FIELDS <field_list>       Установить список полей (через запятую)

  LIMIT <number>            Ограничить количество записей

  DATAFRAME                 Показать результат как pandas DataFrame

  ── Сокращённые команды (без TOOL) ──────────────────────────────────

  SHOW DATABASES            Показать доступные базы данных
  SHOW HELP                 Справка по SHOW командам
  SHOW USER <name>          Подробности пользователя (из БД через ldbsearch)
  SHOW USER                 Список всех пользователей (из БД)
  SHOW GROUP <name>         Подробности группы (многословное: SHOW GROUP Domain Admins)
  SHOW GROUP                Список всех групп (из БД)
  SHOW COMPUTER <name>      Подробности компьютера (из БД)
  SHOW COMPUTER             Список всех компьютеров (из БД)
  SHOW OU <name>            Подробности OU (многословное: SHOW OU Domain Controllers)
  SHOW OU                   Список всех OU (из БД)
  SHOW GPO [<name>]         GPO из БД (многословное: SHOW GPO "Default Domain Policy")
  SHOW DNS                  DNS записи из БД (через ldbsearch, не samba-tool!)
  SHOW CONTACT [<name>]     Контакты из БД (через ldbsearch)

  LIST USERS                Список пользователей (= TOOL user list)
  LIST GROUPS               Список групп (= TOOL group list)
  LIST COMPUTERS             Список компьютеров (= TOOL computer list)
  LIST OUS                  Список OU (= TOOL ou list)

  ENABLE <username>         Включить учётную запись (= TOOL user enable)
  ENABLE USER <username>    То же самое
  DISABLE <username>        Отключить учётную запись (= TOOL user disable)
  DISABLE USER <username>   То же самое

  DELETE USER <name>        Удалить пользователя (= TOOL user delete)
  DELETE GROUP <name>       Удалить группу (= TOOL group delete)
  DELETE COMPUTER <name>    Удалить компьютер (= TOOL computer delete)

  ── SYNTHESIS - анализ схемы БД ──────────────────────────────────────

  SYNTHESIS                 Полный анализ схемы БД
  SYNTHESIS SCHEMA          То же самое
  SYNTHESIS ENTITY          Сущность → Отношение (Таблица)
  SYNTHESIS RELATION        Связь 1:M → Внешний ключ (Foreign Key)
  SYNTHESIS ASSOCIATION     Связь M:M → Ассоциативная таблица
  SYNTHESIS NORMALIZE       Промежуточный итог схемы (до нормализации)

  ── TOOL - прямой доступ к samba-tool ───────────────────────────────

  TOOL <args...>            Выполнить samba-tool команду
    Примеры:
      TOOL user list
      TOOL user create username P@ssw0rd
      TOOL user delete username
      TOOL group listmembers "Domain Admins"
      TOOL computer list
      TOOL dns query 127.0.0.1 kcrb.local @ ALL
      TOOL gpo listall
      TOOL domain info
      TOOL fsmo show

  TOOL HELP <subcommand>    Справка по samba-tool подкоманде
  TOOL LIST                 Все доступные подкоманды samba-tool

  ─── Импорт и массовое создание ──────────────────────────────────────

  IMPORT <file>             Импорт данных из CSV/JSON файла
  CREATE USER <name> <pass> [опции]   Создать пользователя
  CREATE USERS FROM <file>            Массовое создание из CSV/JSON
  CREATE GROUP <name> [опции]         Создать группу
  CREATE COMPUTER <name> [опции]      Создать компьютер
  CREATE OU <name> [--base-dn=DN]     Создать OU

  SET <name> = <value>      Установить переменную ($name)

Примеры:
  USE sam
  SELECT sAMAccountName, cn, mail FROM USERS
  SELECT * FROM GROUPS WHERE cn=*Admin*
  FORMAT table_grid
  OUTPUT /tmp/users.xlsx
  SHOW USER admin
  SHOW GROUP "Domain Admins"
  SHOW GROUP Domain Admins
  SHOW GPO "Default Domain Policy"
  SHOW OU "Domain Controllers"
  SHOW DNS
  SHOW HELP
  SYNTHESIS

  # TAB - автодополнение (3 уровня):
  #   USE <TAB>           → sam, privilege, idmap, ...
  #   TOOL <TAB>          → user, group, computer, dns, ...
  #   TOOL user <TAB>     → list, create, delete, ...
  #   SHOW <TAB>          → DATABASES, USER, GROUP, COMPUTER, OU, GPO, DNS, ...
  #   SHOW USER <TAB>     → admin, guest, ... (из БД!)
  #   SHOW GROUP <TAB>    → Domain Admins, Domain Users, ... (из БД!)
  #   SELECT ... FROM <TAB> → USERS, GROUPS, COMPUTERS, ...
  #   DELETE USER <TAB>   → имена пользователей из БД
  #   FORMAT <TAB>        → json, csv, table, xlsx, ...
{sudo_note}"""
    print(help_text)


if __name__ == "__main__":
    main()
