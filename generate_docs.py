#!/usr/bin/env python3
"""
Генерация документации SDB v2.0 в формате PDF.
"""

import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.units import cm, mm
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, ListFlowable, ListItem, KeepTogether
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ─── Регистрация шрифтов ───────────────────────────────────────────────────
FONT_DIR = "/usr/share/fonts/truetype"
pdfmetrics.registerFont(TTFont('NotoSansSC', os.path.join(FONT_DIR, 'chinese/LiberationSans-Regular.ttf')))
pdfmetrics.registerFont(TTFont('NotoSerifSC', os.path.join(FONT_DIR, 'noto-serif-sc/NotoSerifSC-Regular.ttf')))
pdfmetrics.registerFont(TTFont('DejaVuSans', os.path.join(FONT_DIR, 'dejavu/DejaVuSans.ttf')))
pdfmetrics.registerFont(TTFont('DejaVuSansMono', os.path.join(FONT_DIR, 'dejavu/DejaVuSansMono.ttf')))

# ─── Цвета ─────────────────────────────────────────────────────────────────
COLOR_PRIMARY = HexColor("#1a237e")     # Тёмно-синий
COLOR_ACCENT = HexColor("#0d47a1")      # Акцентный синий
COLOR_BG = HexColor("#e8eaf6")          # Светло-синий фон
COLOR_CODE_BG = HexColor("#f5f5f5")     # Фон кода
COLOR_TABLE_HEADER = HexColor("#1a237e") # Заголовок таблицы
COLOR_TABLE_ALT = HexColor("#e8eaf6")   # Чередующийся ряд
COLOR_LINK = HexColor("#0d47a1")        # Цвет ссылок

# ─── Стили ─────────────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

# Основной стиль (с русским шрифтом)
body_style = ParagraphStyle(
    'BodyRU',
    parent=styles['Normal'],
    fontName='NotoSansSC',
    fontSize=10,
    leading=16,
    alignment=TA_JUSTIFY,
    firstLineIndent=24,
    spaceAfter=8,
)

body_no_indent = ParagraphStyle(
    'BodyNoIndent',
    parent=body_style,
    firstLineIndent=0,
)

# Заголовки
h1_style = ParagraphStyle(
    'H1RU',
    parent=styles['Heading1'],
    fontName='NotoSansSC',
    fontSize=18,
    leading=24,
    textColor=COLOR_PRIMARY,
    spaceAfter=12,
    spaceBefore=20,
)

h2_style = ParagraphStyle(
    'H2RU',
    parent=styles['Heading2'],
    fontName='NotoSansSC',
    fontSize=14,
    leading=20,
    textColor=COLOR_ACCENT,
    spaceAfter=8,
    spaceBefore=16,
)

h3_style = ParagraphStyle(
    'H3RU',
    parent=styles['Heading3'],
    fontName='NotoSansSC',
    fontSize=12,
    leading=16,
    textColor=COLOR_ACCENT,
    spaceAfter=6,
    spaceBefore=12,
)

# Код
code_style = ParagraphStyle(
    'CodeRU',
    parent=body_style,
    fontName='DejaVuSansMono',
    fontSize=8.5,
    leading=12,
    firstLineIndent=0,
    leftIndent=16,
    backColor=COLOR_CODE_BG,
    spaceAfter=4,
    spaceBefore=4,
)

# Предупреждение
note_style = ParagraphStyle(
    'NoteRU',
    parent=body_style,
    fontName='NotoSansSC',
    fontSize=9.5,
    leading=14,
    firstLineIndent=0,
    leftIndent=24,
    textColor=HexColor("#b71c1c"),
    backColor=HexColor("#ffebee"),
    borderPadding=6,
    spaceAfter=8,
)

# Стиль для ячеек таблиц
table_cell_style = ParagraphStyle(
    'TableCellRU',
    parent=body_style,
    fontName='NotoSansSC',
    fontSize=8.5,
    leading=11,
    firstLineIndent=0,
    alignment=TA_LEFT,
)

table_header_style = ParagraphStyle(
    'TableHeaderRU',
    parent=table_cell_style,
    fontName='NotoSansSC',
    fontSize=9,
    textColor=white,
    alignment=TA_CENTER,
)


def make_table(headers, rows, col_widths=None):
    """Создать таблицу с чередующимися цветами строк."""
    header_paras = [Paragraph(h, table_header_style) for h in headers]
    data = [header_paras]

    for row in rows:
        row_paras = [Paragraph(str(cell), table_cell_style) for cell in row]
        data.append(row_paras)

    if col_widths is None:
        col_widths = [None] * len(headers)

    table = Table(data, colWidths=col_widths, repeatRows=1)

    style_commands = [
        ('BACKGROUND', (0, 0), (-1, 0), COLOR_TABLE_HEADER),
        ('TEXTCOLOR', (0, 0), (-1, 0), white),
        ('FONTNAME', (0, 0), (-1, 0), 'NotoSansSC'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('GRID', (0, 0), (-1, -1), 0.5, HexColor("#bdbdbd")),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]

    # Чередующиеся цвета
    for i in range(1, len(data)):
        if i % 2 == 0:
            style_commands.append(('BACKGROUND', (0, i), (-1, i), COLOR_TABLE_ALT))

    table.setStyle(TableStyle(style_commands))
    return table


def build_pdf():
    """Собрать PDF документацию."""
    output_path = "/home/z/my-project/download/sdb/SDB_Documentation_v2.0.pdf"

    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        topMargin=2*cm,
        bottomMargin=2*cm,
        leftMargin=2*cm,
        rightMargin=2*cm,
        title="SDB — Документация v2.0",
        author="SDB Tool",
    )

    elements = []

    # ═══════════════════════════════════════════════════════════════════
    # ТИТУЛЬНАЯ СТРАНИЦА
    # ═══════════════════════════════════════════════════════════════════
    title_style = ParagraphStyle(
        'TitleRU',
        fontName='NotoSansSC',
        fontSize=28,
        leading=36,
        alignment=TA_CENTER,
        textColor=COLOR_PRIMARY,
        spaceAfter=20,
    )
    subtitle_style = ParagraphStyle(
        'SubtitleRU',
        fontName='NotoSansSC',
        fontSize=14,
        leading=20,
        alignment=TA_CENTER,
        textColor=COLOR_ACCENT,
        spaceAfter=12,
    )
    meta_style = ParagraphStyle(
        'MetaRU',
        fontName='NotoSansSC',
        fontSize=10,
        leading=16,
        alignment=TA_CENTER,
        textColor=HexColor("#616161"),
    )

    elements.append(Spacer(1, 4*cm))
    elements.append(Paragraph("SDB", title_style))
    elements.append(Paragraph("Samba Database Query Tool", subtitle_style))
    elements.append(Spacer(1, 1*cm))
    elements.append(Paragraph("Полная документация", ParagraphStyle(
        'SubSub', parent=subtitle_style, fontSize=16, leading=22)))
    elements.append(Spacer(1, 1*cm))
    elements.append(Paragraph("Версия 2.0.0", meta_style))
    elements.append(Paragraph("Инструмент для работы с базами LDB Samba", meta_style))
    elements.append(Paragraph("и управления Active Directory через samba-tool", meta_style))
    elements.append(Spacer(1, 2*cm))
    elements.append(Paragraph("Поддерживает: ldbsearch, samba-tool, скриптовый язык DSL,", meta_style))
    elements.append(Paragraph("экспорт в JSON/CSV/TSV/Table/LDIF, pandas DataFrame", meta_style))
    elements.append(PageBreak())

    # ═══════════════════════════════════════════════════════════════════
    # СОДЕРЖАНИЕ
    # ═══════════════════════════════════════════════════════════════════
    elements.append(Paragraph("Содержание", h1_style))
    toc_items = [
        "1. Введение и обзор",
        "2. Установка и настройка",
        "3. Режимы работы",
        "4. Скриптовый язык SDB (DSL)",
        "5. Команды базы данных (USE, SELECT, WHERE, SEARCH)",
        "6. Форматирование и экспорт (FORMAT, OUTPUT, DATAFRAME)",
        "7. Команды samba-tool (TOOL)",
        "8. Справочник подкоманд samba-tool",
        "9. Примеры скриптов",
        "10. Python API (SdbClient)",
        "11. Решение проблем",
    ]
    for item in toc_items:
        elements.append(Paragraph(item, ParagraphStyle(
            'TOCItem', parent=body_style, fontSize=11, leading=18, firstLineIndent=0)))
    elements.append(PageBreak())

    # ═══════════════════════════════════════════════════════════════════
    # 1. ВВЕДЕНИЕ
    # ═══════════════════════════════════════════════════════════════════
    elements.append(Paragraph("1. Введение и обзор", h1_style))
    elements.append(Paragraph(
        "SDB (Samba Database Query Tool) — это инструмент командной строки для удобной работы "
        "с базами данных Samba LDB и управления Active Directory через samba-tool. "
        "Он предоставляет простой скриптовый язык (DSL) для запросов к LDB базам, "
        "поддерживает множество форматов вывода и позволяет выполнять любые команды samba-tool "
        "без необходимости запоминать сложный синтаксис ldbsearch.",
        body_style))
    elements.append(Spacer(1, 6))

    elements.append(Paragraph("Основные возможности", h2_style))
    features = [
        "<b>Запросы к LDB базам</b> — поиск, фильтрация, выборка атрибутов через простой SQL-подобный синтаксис",
        "<b>Управление AD</b> — пользователи, группы, компьютеры, DNS, GPO, FSMO, репликация и многое другое через samba-tool",
        "<b>Скриптовый язык</b> — автоматизация задач через .sdb файлы скриптов",
        "<b>Много форматов</b> — JSON, CSV, TSV, таблица, LDIF, pandas DataFrame",
        "<b>Sudo поддержка</b> — автоматическое использование sudo для доступа к LDB файлам",
        "<b>Регистронезависимые имена баз</b> — USE SAM, USE Sam, USE sam — все работают",
        "<b>Многострочные команды</b> — поддержка многострочного ввода в интерактивном режиме",
    ]
    for feat in features:
        elements.append(Paragraph(feat, ParagraphStyle(
            'FeatureItem', parent=body_style, firstLineIndent=0, leftIndent=16, bulletIndent=0)))
    elements.append(Spacer(1, 8))

    elements.append(Paragraph("Архитектура", h2_style))
    elements.append(Paragraph(
        "SDB состоит из нескольких ключевых компонентов: парсер скриптового языка (ScriptParser), "
        "движок выполнения (ScriptEngine), коннекторы к ldbsearch и samba-tool, "
        "и набор форматеров для вывода данных. Все компоненты связаны через центральный "
        "класс SdbClient, который предоставляет высокоуровневый API для работы с базами Samba. "
        "Коннектор ldbsearch выполняет LDAP-запросы через утилиту ldbsearch и парсит LDIF вывод. "
        "Коннектор samba-tool выполняет команды управления AD и возвращает структурированный результат.",
        body_style))

    elements.append(PageBreak())

    # ═══════════════════════════════════════════════════════════════════
    # 2. УСТАНОВКА
    # ═══════════════════════════════════════════════════════════════════
    elements.append(Paragraph("2. Установка и настройка", h1_style))

    elements.append(Paragraph("Системная установка (рекомендуется)", h2_style))
    elements.append(Paragraph(
        "Для системной установки, при которой команда sdb доступна всем пользователям "
        "и работает как с sudo, так и без, выполните:",
        body_style))
    elements.append(Paragraph("sudo bash install.sh", code_style))
    elements.append(Paragraph(
        "Скрипт скопирует файлы в /opt/sdb/ и создаст wrapper-скрипт в /usr/local/bin/sdb. "
        "Wrapper использует Python с вшитым путём к пакету, поэтому работает и с sudo, и без. "
        "После установки можно проверить:",
        body_style))
    elements.append(Paragraph("sdb --databases", code_style))
    elements.append(Paragraph("sudo sdb --databases", code_style))

    elements.append(Paragraph("Установка через pip", h2_style))
    elements.append(Paragraph(
        "Альтернативный способ установки — через pip. Это устанавливает пакет в site-packages Python:",
        body_style))
    elements.append(Paragraph("sudo pip3 install .", code_style))
    elements.append(Paragraph(
        "ВНИМАНИЕ: при установке через pip в пользовательский site-packages, команда sudo sdb может "
        "не работать, т.к. sudo использует системный Python, который не видит пользовательские пакеты. "
        "Рекомендуется использовать install.sh для системной установки.",
        note_style))

    elements.append(Paragraph("Удаление", h2_style))
    elements.append(Paragraph("sudo bash /opt/sdb/install.sh --uninstall", code_style))

    elements.append(Paragraph("Зависимости", h2_style))
    elements.append(Paragraph(
        "SDB требует Python 3.7+ и установленный samba-tool (часть пакета samba-dc). "
        "Опционально: pandas для поддержки DataFrame (pip3 install pandas).",
        body_style))

    elements.append(PageBreak())

    # ═══════════════════════════════════════════════════════════════════
    # 3. РЕЖИМЫ РАБОТЫ
    # ═══════════════════════════════════════════════════════════════════
    elements.append(Paragraph("3. Режимы работы", h1_style))

    elements.append(Paragraph("Интерактивный режим", h2_style))
    elements.append(Paragraph(
        "Запустите sdb без аргументов для входа в интерактивный режим. "
        "В этом режиме вы можете вводить команды по одной или несколько на строке через точку с запятой. "
        "Поддерживаются многострочные команды — если строка не заканчивается точкой с запятой, "
        "появится приглашение ..> для продолжения ввода.",
        body_style))
    elements.append(Paragraph("""sdb
sdb> USE sam;
sdb> SELECT dn, cn, sAMAccountName
  ..> FROM *
  ..> WHERE objectClass=user;""", code_style))

    elements.append(Paragraph("Однострочное выполнение (-e)", h2_style))
    elements.append(Paragraph(
        "Для быстрого выполнения одной или нескольких команд используйте флаг -e. "
        "Команды разделяются точкой с запятой:",
        body_style))
    elements.append(Paragraph(
        'sdb -e "USE sam; SELECT dn, cn FROM * WHERE objectClass=user;"', code_style))

    elements.append(Paragraph("Выполнение скрипта (-f)", h2_style))
    elements.append(Paragraph(
        "Для выполнения скрипта из файла используйте флаг -f:",
        body_style))
    elements.append(Paragraph("sdb -f script.sdb", code_style))

    elements.append(Paragraph("Показать базы данных", h2_style))
    elements.append(Paragraph("sdb --databases", code_style))

    elements.append(Paragraph("Парсинг LDIF файла", h2_style))
    elements.append(Paragraph(
        "sdb --parse-ldif dump.ldif --format json --output result.json", code_style))

    elements.append(Paragraph("Аргументы командной строки", h2_style))
    cli_rows = [
        ["-f, --file FILE", "Выполнить скрипт из файла"],
        ["-e, --execute CMD", "Выполнить команду (несколько через ;)"],
        ["--databases", "Показать доступные базы данных"],
        ["--parse-ldif FILE", "Разобрать LDIF файл"],
        ["--format FMT", "Формат вывода: json, csv, tsv, table, ldif"],
        ["-o, --output FILE", "Файл для записи результата"],
        ["-d, --database DB", "База данных по умолчанию (sam)"],
        ["--no-sudo", "Не использовать sudo"],
    ]
    elements.append(make_table(
        ["Аргумент", "Описание"],
        cli_rows,
        col_widths=[5.5*cm, 11*cm]
    ))

    elements.append(PageBreak())

    # ═══════════════════════════════════════════════════════════════════
    # 4. СКРИПТОВЫЙ ЯЗЫК
    # ═══════════════════════════════════════════════════════════════════
    elements.append(Paragraph("4. Скриптовый язык SDB (DSL)", h1_style))
    elements.append(Paragraph(
        "SDB использует простой скриптовый язык для удобной работы с базами Samba. "
        "Не нужно запоминать длинные команды ldbsearch — достаточно простых инструкций. "
        "Скрипты сохраняются в файлы с расширением .sdb и выполняются через sdb -f.",
        body_style))

    elements.append(Paragraph("Синтаксис", h2_style))
    syntax_rows = [
        ["USE <database>;", "Выбрать базу данных (sam, privilege, idmap, hklm, secrets, share). Регистр не важен."],
        ["SELECT <fields> FROM * [WHERE <filter>];", "Запросить записи с указанными полями и фильтром"],
        ["WHERE <filter>;", "Фильтр для предыдущих записей"],
        ["SEARCH <term>;", "Поиск по подстроке (cn, sAMAccountName, description)"],
        ["FORMAT <fmt>;", "Установить формат: json, csv, tsv, table, ldif, dataframe"],
        ["OUTPUT <file>;", "Записать последний результат в файл"],
        ["FIELDS <field_list>;", "Установить список полей (через запятую)"],
        ["LIMIT <n>;", "Ограничить количество записей"],
        ["DATAFRAME;", "Показать результат как pandas DataFrame"],
        ["TOOL <args...>;", "Выполнить samba-tool команду"],
        ["SHOW DATABASES;", "Показать доступные базы"],
        ["SET <name> = <value>;", "Установить переменную ($name)"],
        ["# Комментарий", "Комментарий (строка, начинающаяся с #)"],
    ]
    elements.append(make_table(
        ["Команда", "Описание"],
        syntax_rows,
        col_widths=[7*cm, 9.5*cm]
    ))
    elements.append(Spacer(1, 8))

    elements.append(Paragraph("Фильтры WHERE", h2_style))
    elements.append(Paragraph(
        "Фильтр WHERE поддерживает простой синтаксис key=value, который автоматически "
        "преобразуется в LDAP фильтр. Также поддерживается прямой LDAP синтаксис:",
        body_style))
    filter_rows = [
        ["objectClass=user", "(objectClass=user)", "Простой фильтр по атрибуту"],
        ["sAMAccountName=admin", "(sAMAccountName=admin)", "Фильтр по имени"],
        ["(&(objectClass=user)(cn=Admin))", "Без изменений", "Прямой LDAP фильтр"],
        ["user", "(objectClass=user)", "Только значение — подразумевается objectClass"],
    ]
    elements.append(make_table(
        ["Ввод", "LDAP фильтр", "Описание"],
        filter_rows,
        col_widths=[5*cm, 5.5*cm, 6*cm]
    ))

    elements.append(Paragraph("Переменные", h2_style))
    elements.append(Paragraph(
        "Скрипты поддерживают переменные через команду SET. Переменные подставляются "
        "везде, где используется символ $: в фильтрах, путях файлов, аргументах TOOL.",
        body_style))
    elements.append(Paragraph("""SET domain = "DC=kcrb,DC=local";
SET outdir = "/tmp/samba_export";
SELECT dn FROM * WHERE dn LIKE $domain;
OUTPUT $outdir/result.json;""", code_style))

    elements.append(Paragraph("Комментарии", h2_style))
    elements.append(Paragraph(
        "Строки, начинающиеся с #, считаются комментариями и игнорируются при выполнении. "
        "Комментарии полезны для документирования скриптов:",
        body_style))
    elements.append(Paragraph("""# Экспорт пользователей в JSON
USE sam;
FORMAT json;
SELECT dn, cn, sAMAccountName FROM * WHERE objectClass=user;
OUTPUT /tmp/users.json;""", code_style))

    elements.append(PageBreak())

    # ═══════════════════════════════════════════════════════════════════
    # 5. КОМАНДЫ БАЗЫ ДАННЫХ
    # ═══════════════════════════════════════════════════════════════════
    elements.append(Paragraph("5. Команды базы данных", h1_style))

    elements.append(Paragraph("USE — выбор базы данных", h2_style))
    elements.append(Paragraph(
        "Команда USE переключает текущую базу данных. Имена баз данных регистронезависимые — "
        "вы можете написать USE SAM, USE Sam или USE sam. Также поддерживается указание "
        "полного пути к .ldb файлу.",
        body_style))
    db_rows = [
        ["sam", "/var/lib/samba/private/sam.ldb", "Основная база AD (пользователи, группы, компьютеры, GPO)"],
        ["privilege", "/var/lib/samba/private/privilege.ldb", "Привилегии (SeBackupPrivilege, SeDebugPrivilege)"],
        ["idmap", "/var/lib/samba/private/idmap.ldb", "Маппинг SID к UID/GID"],
        ["hklm", "/var/lib/samba/private/hklm.ldb", "Реестр HKEY_LOCAL_MACHINE"],
        ["secrets", "/var/lib/samba/private/secrets.ldb", "Секреты домена (Kerberos, пароли)"],
        ["share", "/var/lib/samba/private/share.ldb", "Конфигурация файловых шар"],
    ]
    elements.append(make_table(
        ["Имя", "Путь", "Описание"],
        db_rows,
        col_widths=[2.5*cm, 6.5*cm, 7.5*cm]
    ))
    elements.append(Spacer(1, 4))
    elements.append(Paragraph("""USE sam;            # Основная база AD
USE privilege;      # Привилегии
USE SAM;            # Регистр не важен
USE /path/to/custom.ldb;  # Полный путь""", code_style))

    elements.append(Paragraph("SELECT — запрос записей", h2_style))
    elements.append(Paragraph(
        "Команда SELECT выполняет запрос к текущей базе данных. Поддерживается выбор полей, "
        "фильтрация через WHERE и ограничение через LIMIT. Если поля не указаны, "
        "возвращаются все атрибуты записей. Поля указываются через запятую после SELECT.",
        body_style))
    elements.append(Paragraph("""# Все записи со всеми атрибутами
SELECT * FROM *;

# Только указанные атрибуты
SELECT dn, cn, sAMAccountName FROM * WHERE objectClass=user;

# С ограничением количества
SELECT dn, cn FROM * WHERE objectClass=group LIMIT 10;

# Запрос конкретной записи по DN
SELECT * FROM "CN=Admin,CN=Users,DC=kcrb,DC=local";""", code_style))

    elements.append(Paragraph("SEARCH — поиск по подстроке", h2_style))
    elements.append(Paragraph(
        "Команда SEARCH ищет записи по подстроке в атрибутах cn, sAMAccountName и description. "
        "Если поиск по cn не дал результатов, автоматически пробуется sAMAccountName, "
        "затем description. Это удобный способ быстрого поиска без написания LDAP фильтров.",
        body_style))
    elements.append(Paragraph("""SEARCH administrator;
SEARCH "Domain Admins";""", code_style))

    elements.append(Paragraph("WHERE — пост-фильтрация", h2_style))
    elements.append(Paragraph(
        "Команда WHERE фильтрует уже полученные записи (из последнего SELECT или SEARCH). "
        "Это позволяет выполнить грубый запрос, а затем уточнить результаты без повторного "
        "обращения к базе данных. Формат: field=value.",
        body_style))
    elements.append(Paragraph("""SELECT * FROM * WHERE objectClass=user;
WHERE sAMAccountName=admin;""", code_style))

    elements.append(PageBreak())

    # ═══════════════════════════════════════════════════════════════════
    # 6. ФОРМАТИРОВАНИЕ И ЭКСПОРТ
    # ═══════════════════════════════════════════════════════════════════
    elements.append(Paragraph("6. Форматирование и экспорт", h1_style))

    elements.append(Paragraph("FORMAT — установка формата вывода", h2_style))
    fmt_rows = [
        ["table", "Красивая таблица с колонками и нумерацией строк (по умолчанию)"],
        ["json", "JSON формат с отступами, поддержка кириллицы"],
        ["csv", "CSV формат (запятая как разделитель)"],
        ["tsv", "TSV формат (табуляция как разделитель)"],
        ["ldif", "LDIF формат (обратный экспорт в формат ldbsearch)"],
        ["dataframe", "pandas DataFrame (требует установки pandas)"],
    ]
    elements.append(make_table(
        ["Формат", "Описание"],
        fmt_rows,
        col_widths=[3*cm, 13.5*cm]
    ))

    elements.append(Paragraph("OUTPUT — запись в файл", h2_style))
    elements.append(Paragraph(
        "Команда OUTPUT записывает последний результат в файл. Формат файла определяется "
        "текущей настройкой FORMAT. Для DataFrame формат может быть определён расширением файла: "
        ".csv, .tsv, .xlsx, .json, .pkl. После записи файл вывода сбрасывается — следующий "
        "SELECT будет выводить в stdout. Чтобы снова писать в файл, вызовите OUTPUT ещё раз.",
        body_style))
    elements.append(Paragraph("""FORMAT json;
SELECT * FROM * WHERE objectClass=user;
OUTPUT /tmp/users.json;

FORMAT csv;
SELECT * FROM * WHERE objectClass=group;
OUTPUT /tmp/groups.csv;""", code_style))

    elements.append(Paragraph("DATAFRAME — pandas DataFrame", h2_style))
    elements.append(Paragraph(
        "Команда DATAFRAME показывает последний результат как pandas DataFrame. "
        "Требует установки pandas (pip3 install pandas). DataFrame поддерживает "
        "все операции pandas — фильтрацию, группировку, агрегацию, экспорт в Excel.",
        body_style))
    elements.append(Paragraph("""SELECT dn, cn, sAMAccountName FROM * WHERE objectClass=user;
DATAFRAME;""", code_style))

    elements.append(PageBreak())

    # ═══════════════════════════════════════════════════════════════════
    # 7. КОМАНДЫ SAMBA-TOOL
    # ═══════════════════════════════════════════════════════════════════
    elements.append(Paragraph("7. Команды samba-tool (TOOL)", h1_style))
    elements.append(Paragraph(
        "Команда TOOL позволяет выполнять любые команды samba-tool прямо из SDB. "
        "Все аргументы передаются напрямую в samba-tool, поэтому поддерживается полный "
        "синтаксис samba-tool, включая флаги и опции. Если команда завершается с ошибкой, "
        "SDB показывает полный текст ошибки для диагностики.",
        body_style))

    elements.append(Paragraph("Специальные команды TOOL", h2_style))
    elements.append(Paragraph(
        "<b>TOOL LIST</b> — показывает все доступные подкоманды samba-tool с краткими описаниями. "
        "Это удобный способ узнать, какие команды доступны, без выхода из SDB.",
        body_no_indent))
    elements.append(Paragraph(
        "<b>TOOL HELP &lt;subcommand&gt;</b> — показывает справку по конкретной подкоманде samba-tool. "
        "Запускает samba-tool &lt;subcommand&gt; --help и выводит результат.",
        body_no_indent))

    elements.append(Paragraph("Общий синтаксис", h2_style))
    elements.append(Paragraph("TOOL &lt;подкоманда&gt; &lt;действие&gt; [аргументы...] [опции...];", code_style))
    elements.append(Spacer(1, 4))
    elements.append(Paragraph(
        "Аргументы с пробелами или специальными символами заключаются в кавычки. "
        "Опции samba-tool передаются как есть: --flag=value, --flag value. "
        "Ниже приведены примеры для каждой подкоманды.",
        body_style))

    elements.append(PageBreak())

    # ═══════════════════════════════════════════════════════════════════
    # 8. СПРАВОЧНИК ПОДКОМАНД SAMBA-TOOL
    # ═══════════════════════════════════════════════════════════════════
    elements.append(Paragraph("8. Справочник подкоманд samba-tool", h1_style))

    # User
    elements.append(Paragraph("user — Управление пользователями", h2_style))
    user_rows = [
        ["TOOL user list;", "Список пользователей"],
        ["TOOL user create john P@ss;", "Создать пользователя"],
        ["TOOL user create john P@ss --given-name=Иван --surname=Иванов;", "Создать с ФИО"],
        ["TOOL user delete john;", "Удалить пользователя"],
        ["TOOL user disable john;", "Отключить учётную запись"],
        ["TOOL user enable john;", "Включить учётную запись"],
        ["TOOL user setpassword john --newpassword=NewP@ss;", "Установить пароль"],
        ["TOOL user setpassword john --newpassword=P@ss --must-change-at-next-login;", "Пароль + смена при входе"],
        ["TOOL user getpassword john;", "Получить пароль (требует прав)"],
        ["TOOL user getgroups john;", "Группы пользователя"],
        ["TOOL user getgroups john --recursive;", "Включая вложенные группы"],
        ["TOOL user show john;", "Подробности пользователя"],
        ["TOOL user rename oldname --newname=newname;", "Переименовать"],
        ["TOOL user move john \"OU=NewOU,DC=kcrb,DC=local\";", "Переместить в OU"],
        ["TOOL user setexpiry john --days=90;", "Срок действия пароля 90 дней"],
        ["TOOL user setexpiry john --noexpiry;", "Пароль без срока действия"],
    ]
    elements.append(make_table(["Команда", "Описание"], user_rows, col_widths=[10*cm, 6.5*cm]))

    # Group
    elements.append(Spacer(1, 8))
    elements.append(Paragraph("group — Управление группами", h2_style))
    group_rows = [
        ["TOOL group list;", "Список групп"],
        ["TOOL group list --hide-builtin;", "Скрыть встроенные группы"],
        ["TOOL group listmembers \"Domain Admins\";", "Члены группы"],
        ["TOOL group listmembers \"Domain Admins\" --recursive;", "Включая вложенные"],
        ["TOOL group addmembers \"Domain Admins\" john;", "Добавить члена"],
        ["TOOL group removemembers \"Domain Admins\" john;", "Удалить члена"],
        ["TOOL group create \"NewGroup\" --description=\"Описание\";", "Создать группу"],
        ["TOOL group create \"NewGroup\" --group-scope=Global --group-type=Security;", "С указанием типа"],
        ["TOOL group delete \"NewGroup\";", "Удалить группу"],
        ["TOOL group show \"Domain Users\";", "Подробности группы"],
        ["TOOL group rename \"Old\" --newname=\"New\";", "Переименовать"],
        ["TOOL group move \"Group\" \"OU=New,DC=kcrb,DC=local\";", "Переместить"],
        ["TOOL group listmemberof john;", "Группы объекта"],
    ]
    elements.append(make_table(["Команда", "Описание"], group_rows, col_widths=[10*cm, 6.5*cm]))

    # Computer
    elements.append(Spacer(1, 8))
    elements.append(Paragraph("computer — Управление компьютерами", h2_style))
    comp_rows = [
        ["TOOL computer list;", "Список компьютеров"],
        ["TOOL computer create PC01 P@ssw0rd;", "Создать учётную запись"],
        ["TOOL computer delete PC01;", "Удалить"],
        ["TOOL computer show WIN10;", "Подробности"],
        ["TOOL computer rename OLD --newname=NEW;", "Переименовать"],
        ["TOOL computer move WIN10 \"OU=PC,DC=kcrb,DC=local\";", "Переместить"],
    ]
    elements.append(make_table(["Команда", "Описание"], comp_rows, col_widths=[10*cm, 6.5*cm]))

    # DNS
    elements.append(Spacer(1, 8))
    elements.append(Paragraph("dns — Управление DNS", h2_style))
    dns_rows = [
        ["TOOL dns query kcrb.local @ ALL;", "Все записи корня зоны"],
        ["TOOL dns query kcrb.local @ A;", "Только A-записи"],
        ["TOOL dns query kcrb.local @ SRV;", "SRV-записи"],
        ["TOOL dns query kcrb.local server1 A;", "A-запись для server1"],
        ["TOOL dns add kcrb.local kcrb.local test A 192.168.1.100;", "Добавить A-запись"],
        ["TOOL dns add kcrb.local kcrb.local alias CNAME server1.kcrb.local;", "Добавить CNAME"],
        ["TOOL dns delete kcrb.local kcrb.local test A 192.168.1.100;", "Удалить запись"],
        ["TOOL dns zonelist kcrb.local;", "Список зон"],
        ["TOOL dns zoneinfo kcrb.local kcrb.local;", "Информация о зоне"],
        ["TOOL dns serverinfo kcrb.local;", "Информация о сервере"],
        ["TOOL dns roothints kcrb.local;", "Корневые подсказки"],
        ["TOOL dns create kcrb.local newzone.local;", "Создать зону"],
    ]
    elements.append(make_table(["Команда", "Описание"], dns_rows, col_widths=[10*cm, 6.5*cm]))

    elements.append(PageBreak())

    # OU
    elements.append(Paragraph("ou — Организационные подразделения", h2_style))
    ou_rows = [
        ["TOOL ou list;", "Список OU"],
        ["TOOL ou create \"NewOU\" --base-dn=\"DC=kcrb,DC=local\";", "Создать OU"],
        ["TOOL ou delete \"OU=NewOU,DC=kcrb,DC=local\";", "Удалить OU"],
        ["TOOL ou show \"OU=NewOU,DC=kcrb,DC=local\";", "Подробности OU"],
        ["TOOL ou rename \"OldOU\" --newname=\"NewOU\";", "Переименовать"],
    ]
    elements.append(make_table(["Команда", "Описание"], ou_rows, col_widths=[10*cm, 6.5*cm]))

    # GPO
    elements.append(Spacer(1, 8))
    elements.append(Paragraph("gpo — Групповые политики", h2_style))
    gpo_rows = [
        ["TOOL gpo listall;", "Список всех GPO"],
        ["TOOL gpo list \"DC=kcrb,DC=local\";", "GPO для контейнера"],
        ["TOOL gpo create \"Новая политика\";", "Создать GPO"],
        ["TOOL gpo delete <gpo-dn>;", "Удалить GPO"],
        ["TOOL gpo show <gpo-dn>;", "Подробности GPO"],
        ["TOOL gpo getlink \"DC=kcrb,DC=local\";", "Ссылки GPO"],
        ["TOOL gpo setlink \"DC=kcrb,DC=local\" <gpo-dn>;", "Привязать GPO"],
        ["TOOL gpo dellink \"DC=kcrb,DC=local\" <gpo-guid>;", "Удалить ссылку"],
    ]
    elements.append(make_table(["Команда", "Описание"], gpo_rows, col_widths=[10*cm, 6.5*cm]))

    # Domain
    elements.append(Spacer(1, 8))
    elements.append(Paragraph("domain — Управление доменом", h2_style))
    domain_rows = [
        ["TOOL domain info;", "Информация о домене"],
        ["TOOL domain level show;", "Уровень работы домена"],
        ["TOOL domain level raise 2008_R2;", "Повысить уровень"],
        ["TOOL domain passwordsettings show;", "Настройки пароля"],
        ["TOOL domain exportkeytab /tmp/krb5.keytab;", "Экспорт keytab"],
        ["TOOL domain trust list;", "Доверенные отношения"],
    ]
    elements.append(make_table(["Команда", "Описание"], domain_rows, col_widths=[10*cm, 6.5*cm]))

    # FSMO
    elements.append(Spacer(1, 8))
    elements.append(Paragraph("fsmo — Роли FSMO", h2_style))
    fsmo_rows = [
        ["TOOL fsmo show;", "Показать текущие роли FSMO"],
        ["TOOL fsmo transfer --role=rid;", "Передать роль RID Master"],
        ["TOOL fsmo transfer --role=pdc;", "Передать роль PDC Emulator"],
        ["TOOL fsmo seize --role=infrastructure;", "Захватить роль (при аварии)"],
    ]
    elements.append(make_table(["Команда", "Описание"], fsmo_rows, col_widths=[10*cm, 6.5*cm]))

    # DRS
    elements.append(Spacer(1, 8))
    elements.append(Paragraph("drs — Репликация", h2_style))
    drs_rows = [
        ["TOOL drs showrepl;", "Статус репликации"],
        ["TOOL drs kcc;", "Запустить KCC"],
        ["TOOL drs repl --all;", "Репликация со всеми партнерами"],
        ["TOOL drs bind <dc>;", "Связаться с DC"],
    ]
    elements.append(make_table(["Команда", "Описание"], drs_rows, col_widths=[10*cm, 6.5*cm]))

    # SPN
    elements.append(Spacer(1, 8))
    elements.append(Paragraph("spn — Service Principal Names", h2_style))
    spn_rows = [
        ["TOOL spn list Administrator;", "Список SPN учётной записи"],
        ["TOOL spn add HTTP/server.kcrb.local Administrator;", "Добавить SPN"],
        ["TOOL spn delete HTTP/server.kcrb.local Administrator;", "Удалить SPN"],
    ]
    elements.append(make_table(["Команда", "Описание"], spn_rows, col_widths=[10*cm, 6.5*cm]))

    # Delegation
    elements.append(Spacer(1, 8))
    elements.append(Paragraph("delegation — Делегирование Kerberos", h2_style))
    deleg_rows = [
        ["TOOL delegation add john;", "Разрешить делегирование"],
        ["TOOL delegation remove john;", "Запретить делегирование"],
        ["TOOL delegation show john;", "Показать делегирование"],
    ]
    elements.append(make_table(["Команда", "Описание"], deleg_rows, col_widths=[10*cm, 6.5*cm]))

    # NTACL
    elements.append(Spacer(1, 8))
    elements.append(Paragraph("ntacl — NT ACL", h2_style))
    ntacl_rows = [
        ["TOOL ntacl sysvolcheck;", "Проверить ACL sysvol"],
        ["TOOL ntacl sysvolreset;", "Сбросить ACL sysvol"],
        ["TOOL ntacl get /path/to/file;", "Получить ACL файла"],
        ["TOOL ntacl set <acl> /path/to/file;", "Установить ACL файла"],
    ]
    elements.append(make_table(["Команда", "Описание"], ntacl_rows, col_widths=[10*cm, 6.5*cm]))

    # Schema
    elements.append(Spacer(1, 8))
    elements.append(Paragraph("schema — Схема AD", h2_style))
    schema_rows = [
        ["TOOL schema query;", "Запрос схемы"],
        ["TOOL schema show <attribute>;", "Показать атрибут/класс"],
    ]
    elements.append(make_table(["Команда", "Описание"], schema_rows, col_widths=[10*cm, 6.5*cm]))

    # dbcheck
    elements.append(Spacer(1, 8))
    elements.append(Paragraph("dbcheck — Проверка базы данных", h2_style))
    dbcheck_rows = [
        ["TOOL dbcheck;", "Проверить целостность базы"],
        ["TOOL dbcheck --fix --yes;", "Исправить ошибки автоматически"],
        ["TOOL dbcheck --cross-ncs;", "Проверять кросс-NC ссылки"],
    ]
    elements.append(make_table(["Команда", "Описание"], dbcheck_rows, col_widths=[10*cm, 6.5*cm]))

    # Other
    elements.append(Spacer(1, 8))
    elements.append(Paragraph("Прочие подкоманды", h2_style))
    other_rows = [
        ["TOOL sites list;", "Список сайтов AD"],
        ["TOOL sites create \"Site1\";", "Создать сайт"],
        ["TOOL rodc preload john;", "Предзагрузка паролей RODC"],
        ["TOOL ldapcmp server1 server2 --filter=objectClass=user;", "Сравнение LDAP серверов"],
        ["TOOL contact list;", "Список контактов"],
        ["TOOL contact create \"Иван Иванов\" --mail=ivan@kcrb.local;", "Создать контакт"],
        ["TOOL testparm;", "Проверка smb.conf"],
    ]
    elements.append(make_table(["Команда", "Описание"], other_rows, col_widths=[10*cm, 6.5*cm]))

    elements.append(PageBreak())

    # ═══════════════════════════════════════════════════════════════════
    # 9. ПРИМЕРЫ СКРИПТОВ
    # ═══════════════════════════════════════════════════════════════════
    elements.append(Paragraph("9. Примеры скриптов", h1_style))

    elements.append(Paragraph("Экспорт пользователей и групп", h2_style))
    elements.append(Paragraph("""# Выбираем базу AD
USE sam;

# Пользователи в формате таблицы
SELECT dn, sAMAccountName, cn FROM * WHERE objectClass=user;

# Группы в формате JSON
FORMAT json;
SELECT dn, cn, sAMAccountName FROM * WHERE objectClass=group;
OUTPUT /tmp/groups.json;

# Список через samba-tool
TOOL user list;
TOOL group list;""", code_style))

    elements.append(Paragraph("Полный экспорт всех баз", h2_style))
    elements.append(Paragraph("""SET outdir = "/tmp/samba_export";

# SAM
USE sam;
FORMAT json;
SELECT * FROM * WHERE objectClass=user;
OUTPUT /tmp/samba_export/users.json;

SELECT * FROM * WHERE objectClass=group;
OUTPUT /tmp/samba_export/groups.json;

SELECT * FROM * WHERE objectClass=computer;
OUTPUT /tmp/samba_export/computers.json;

# Привилегии
USE privilege;
FORMAT json;
SELECT * FROM *;
OUTPUT /tmp/samba_export/privileges.json;

# ID маппинг (CSV)
USE idmap;
FORMAT csv;
FIELDS cn, objectSid, xidNumber, type;
SELECT * FROM *;
OUTPUT /tmp/samba_export/idmap.csv;""", code_style))

    elements.append(Paragraph("Управление пользователями", h2_style))
    elements.append(Paragraph("""# Создать пользователя с ФИО
TOOL user create ivan P@ssw0rd --given-name=Иван --surname=Иванов;

# Добавить в группу
TOOL group addmembers "Domain Admins" ivan;

# Установить пароль
TOOL user setpassword ivan --newpassword=NewP@ss --must-change-at-next-login;

# Проверить группы
TOOL user getgroups ivan;

# Просмотр подробностей
USE sam;
SELECT * FROM * WHERE sAMAccountName=ivan;""", code_style))

    elements.append(Paragraph("Аудит привилегий", h2_style))
    elements.append(Paragraph("""# Показать все привилегии
USE privilege;
FORMAT table;
SELECT * FROM *;

# Кто имеет SeBackupPrivilege?
SELECT dn, privilege FROM * WHERE privilege=SeBackupPrivilege;

# Экспорт в JSON
FORMAT json;
OUTPUT /tmp/privileges_audit.json;""", code_style))

    elements.append(PageBreak())

    # ═══════════════════════════════════════════════════════════════════
    # 10. PYTHON API
    # ═══════════════════════════════════════════════════════════════════
    elements.append(Paragraph("10. Python API (SdbClient)", h1_style))
    elements.append(Paragraph(
        "SDB можно использовать как библиотеку Python. Класс SdbClient предоставляет "
        "высокоуровневый API для запросов к LDB базам, выполнения samba-tool команд "
        "и экспорта данных в различных форматах.",
        body_style))

    elements.append(Paragraph("Инициализация", h2_style))
    elements.append(Paragraph("""from sdb import SdbClient

# С sudo (по умолчанию)
client = SdbClient()

# Без sudo
client = SdbClient(use_sudo=False)

# С другой базой по умолчанию
client = SdbClient(default_database="privilege")""", code_style))

    elements.append(Paragraph("Запросы к LDB", h2_style))
    elements.append(Paragraph("""# Все пользователи
users = client.query("sam", "(objectClass=user)", attrs=["sAMAccountName", "cn"])

# Поиск по подстроке
results = client.search("administrator", database="sam")

# Форматирование
print(client.format_output(users, fmt="json"))

# Запись в файл
client.write_output(users, "/tmp/users.json", fmt="json")

# pandas DataFrame
df = client.to_dataframe(users, fields=["dn", "cn", "sAMAccountName"])
print(df.head())""", code_style))

    elements.append(Paragraph("samba-tool через Python API", h2_style))
    elements.append(Paragraph("""# Список пользователей
result = client.samba_tool.user_list()
print(result.lines)  # Список строк вывода

# Создать пользователя
result = client.samba_tool.user_create("john", "P@ssw0rd",
    extra_args=["--given-name=John", "--surname=Doe"])

# DNS запрос
result = client.samba_tool.dns_query("kcrb.local", "kcrb.local", "@", "ALL")

# Произвольная команда
result = client.samba_tool.run(["drs", "showrepl"])
if result.success:
    print(result.stdout)
else:
    print(f"Ошибка: {result.stderr}")""", code_style))

    elements.append(Paragraph("Выполнение скриптов", h2_style))
    elements.append(Paragraph("""# Из строки
client.run_script('USE sam; SELECT dn, cn FROM * WHERE objectClass=user;')

# Из файла
client.run_script_file("script.sdb")""", code_style))

    elements.append(PageBreak())

    # ═══════════════════════════════════════════════════════════════════
    # 11. РЕШЕНИЕ ПРОБЛЕМ
    # ═══════════════════════════════════════════════════════════════════
    elements.append(Paragraph("11. Решение проблем", h1_style))

    trouble_rows = [
        ["sudo sdb: ModuleNotFoundError",
         "Переустановите через: sudo bash install.sh. Не используйте pip install для sudo."],
        ["Отказано в доступе к базе",
         "LDB файлы доступны только root. Запустите без --no-sudo или через sudo."],
        ["Пустые записи в результате",
         "LDAP-рефералы автоматически отфильтровываются. Если видите пустые строки — обновите SDB до v2.0."],
        ["TOOL dns query: Ошибка",
         "DNS запросы требуют указания сервера. Используйте: TOOL dns query <IP_DC> <zone> @ ALL"],
        ["TOOL domain info: Ошибка",
         "Укажите IP контроллера: TOOL domain info <IP_DC>"],
        ["TOOL gpo listall: Ошибка DC",
         "Убедитесь, что DC доступен и DNS работает: ping <имя_домена>"],
        ["pandas не установлен",
         "Установите: pip3 install pandas или sudo pip3 install pandas"],
        ["Нет записей после SELECT",
         "Проверьте текущую базу: USE sam. Убедитесь, что фильтр корректен."],
        ["Кириллица отображается некорректно",
         "Убедитесь, что терминал поддерживает UTF-8: export LANG=ru_RU.UTF-8"],
        ["Многострочные команды не работают",
         "Обновите SDB до v2.0. Вводите ; в конце команды для выполнения."],
    ]
    elements.append(make_table(
        ["Проблема", "Решение"],
        trouble_rows,
        col_widths=[5.5*cm, 11*cm]
    ))

    # ─── Генерация PDF ─────────────────────────────────────────────────
    doc.build(elements)
    print(f"Документация создана: {output_path}")
    return output_path


if __name__ == "__main__":
    build_pdf()
