#!/usr/bin/env python3
"""
build.py — Скрипт сборки WebADC в исполняемый файл (PyInstaller).

Результат:
  dist/webadc              — единый бинарник (onefile) или каталог (onedir)
  dist/.env                — шаблон конфигурации
  dist/webadc.service      — systemd unit
  dist/SKILL/              — AI Skills каталог             [если --no-static не задан]
  dist/out/                — WebADC SPA (Next.js export)   [если существует и --no-static не задан]
  dist/docs/               — документация                  [если --no-static не задан]

Особенности (актуально для pr-a.1.2):
  • Серверная версия: pr-a.1.2 (см. app/main.py → version=...)
  • CLI версия:        pe-a-0.1.3 (см. cli.py → VERSION)
  • Сервер обслуживает и REST API (/api/v1/*), и веб-панель (/) на одном порту.

  Режимы сборки:
    python3 build.py                            # onedir, со статикой и SKILL (по умолчанию)
    python3 build.py --onefile                  # один файл, со статикой
    python3 build.py --onefile --no-static      # один файл, БЕЗ out/, SKILL/, docs/ (минимум)
    python3 build.py --onefile --no-matplotlib  # один файл, БЕЗ matplotlib (~на 30 MB меньше)
    python3 build.py --clean                    # полная пересборка
    python3 build.py --debug                    # подробный лог PyInstaller

  Статика WebADC разыскивается в одном из мест (в порядке приоритета):
    1. _MEIPASS/webadc-python/static/  (внутри PyInstaller-бандла)
    2. <ROOT>/webadc-python/static/    (каталог рядом с cli.py)
    3. <ROOT>/out/                     (Next.js static export, по умолчанию)
  Мы пакуем оба варианта (если существуют) — runtime сам выберет доступный.

Требования к системе:
  • Python 3.10+ (проверяется автоматически)
  • PyInstaller >= 6.0
  • binutils (objdump, ldd) — для PyInstaller bootloader
  • Все зависимости из requirements.txt
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path
from string import Formatter

# ── Pre-flight dependency check ───────────────────────────────────────────

REQUIRED_COMMANDS = {
    "objdump": "binutils  (sudo apt-get install binutils  /  sudo dnf install binutils)",
    "ldd":     "libc/binutils (обычно уже установлен; иначе — sudo apt-get install libc-bin)",
}

REQUIRED_PY = (3, 10)


def _check_dependencies() -> None:
    """Проверить наличие системных утилит и версии Python, необходимых PyInstaller."""
    if sys.version_info < REQUIRED_PY:
        print(f"\n  ОШИБКА: Требуется Python >= {REQUIRED_PY[0]}.{REQUIRED_PY[1]}, "
              f"установлен {sys.version_info.major}.{sys.version_info.minor}")
        sys.exit(1)

    missing: list[tuple[str, str]] = []
    for cmd, hint in REQUIRED_COMMANDS.items():
        if shutil.which(cmd) is None:
            missing.append((cmd, hint))
    if missing:
        print("\n  ОШИБКА: Не найдены системные утилиты, необходимые PyInstaller:\n")
        for cmd, hint in missing:
            print(f"    {cmd} — установите: {hint}")
        print()
        sys.exit(1)

    # Проверяем PyInstaller
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        print("\n  ОШИБКА: PyInstaller не установлен. Установите:")
        print("    pip install pyinstaller>=6.0")
        sys.exit(1)


# ── Пути и константы ──────────────────────────────────────────────────────

ROOT = Path(__file__).parent.resolve()
DIST = ROOT / "dist"
BUILD = ROOT / "build"

APP_NAME = "webadc"
# Версия сборщика. Внимание: серверная версия (app/main.py) и CLI-версия (cli.py)
# могут отличаться — это нормально, CLI обязан поддерживать обратную совместимость.
BUILD_VERSION = "pr-a.1.2"


# ═══════════════════════════════════════════════════════════════════════════
#  PyInstaller spec template
# ═══════════════════════════════════════════════════════════════════════════
#
# ВАЖНО: используем НЕ `.format()`, а строковую замену `str.replace()`,
# потому что в spec-файле есть много легитимных `{...}` (множества, dict-литералы
# в hooksconfig={{}}, etc.). `.format()` ломает их.
#
# Заменяем только специально маркированные плейсхолдеры вида `@@KEY@@`.
#
# В этой версии (pr-a.1.2) убраны мёртвые зависимости:
#   ✗ textual / markdown_it / mdit_py_plugins / pygments / platformdirs
#       (использовались только в старой TUI-версии CLI, сейчас CLI на Click+rich)
#   ✗ reportlab (не используется — PDF-генерация отсутствует)
#   ✗ tabulate (не используется — sdb_lib имеет собственный форматтер)
#   ✗ pandas / scipy / numpy (matplotlib fallback работает и без них)
#   ✗ yaml (не используется — конфиг только через .env / pydantic-settings)
#   ✗ pyotp (TOTP реализован вручную в app/totp.py)
# Добавлено:
#   + SKILL/ каталог теперь пакуется обязательно (для AI agent) — если не --no-static
#   + out/ (или webadc-python/static/) пакуется для SPA — если не --no-static
#   + exclude gi/GTK hooks (тянули ~10 MB лишнего)
#   + exclude matplotlib.tests, urllib3.contrib.emscripten, pyodide
#


SPEC_TEMPLATE = """# -*- mode: python ; coding: utf-8 -*-
# Auto-generated by build.py v@@BUILD_VERSION@@
# Do not edit manually — regenerate with `python3 build.py`.

import sys
import os
from PyInstaller.utils.hooks import collect_submodules, collect_data_files, copy_metadata

block_cipher = None

# ── NumPy X86_V2 guard ────────────────────────────────────────────────
# На ALT Linux NumPy может быть собран с X86_V2 оптимизацией, которую
# процессор не поддерживает. Блокируем numpy ДО любого другого импорта,
# иначе collect_submodules падает при импорте openpyxl/openai/matplotlib.
try:
    import numpy as _np_check  # noqa: F401
except RuntimeError:
    sys.modules['numpy'] = None  # блокируем все будущие импорты
except Exception:
    pass

# ── Собираем все подмодули ключевых пакетов ────────────────────────────
_hidden = []

# fastapi + starlette — основная проблема: PyInstaller не видит
# lazy-импорты типа fastapi.middleware.cors, starlette.routing и т.д.
for _pkg in ['fastapi', 'starlette']:
    try:
        _hidden += collect_submodules(_pkg)
    except Exception:
        _hidden.append(_pkg)

# uvicorn — нужен полностью (подмодули протоколов, lifespan, ssl и т.д.)
for _pkg in ['uvicorn']:
    try:
        _hidden += collect_submodules(_pkg)
    except Exception:
        _hidden.append(_pkg)

# pydantic v2 + pydantic_settings + pydantic_core
for _pkg in ['pydantic', 'pydantic_core', 'pydantic_settings']:
    try:
        _hidden += collect_submodules(_pkg)
    except Exception:
        _hidden.append(_pkg)

# Остальные пакеты с lazy-импортами (только реально используемые в pr-a.1.2)
_extra_packages = [
    # Аутентификация и криптография
    'bcrypt',
    'cryptography',
    'jose',                  # python-jose — JWT
    'passlib',
    # HTTP / WebSocket клиенты
    'httpx',
    'requests',
    'urllib3',
    'charset_normalizer',
    'certifi',
    'idna',
    'websockets',
    'anyio',
    'sniffio',
    'h11',
    'httptools',
    # CLI / TTY
    'click',
    'rich',
    # multipart/form-data
    'python_multipart',
    'multipart',
    # Кэш и системная информация
    'cachetools',
    'psutil',
    # PostgreSQL драйвер
    'psycopg2',
    # AI / ML
    'openai',
    # Excel-экспорт (report.router, sdb.export, audit_export)
    'openpyxl',
    'et_xmlfile',
    # dnspython — DNS-резолвер (routers/domain.py)
    'dns',
    # typing helpers
    'typing_extensions',
    'annotated_types',
]
@@MATPLOTLIB_BLOCK@@
for _pkg in _extra_packages:
    try:
        _subs = collect_submodules(_pkg)
        if _subs:
            _hidden += _subs
        else:
            _hidden.append(_pkg)
    except Exception:
        _hidden.append(_pkg)

# ── Метаданные (нужны для importlib.metadata / pkg_resources) ──────────
_datas = []
_binaries = []
for _meta_pkg in [
    'fastapi', 'starlette', 'pydantic', 'pydantic-core',
    'pydantic-settings', 'python-jose', 'cryptography',
    'python-multipart', 'httpx', 'anyio', 'sniffio',
    'rich', 'openpyxl', 'openai', 'dnspython',
    'bcrypt', 'passlib', 'psutil', 'cachetools',
    'uvicorn', 'websockets', 'httptools', 'h11',
    'certifi', 'idna', 'urllib3', 'charset_normalizer',
    'click', 'et-xmlfile',@@MATPLOTLIB_META@@
]:
    try:
        _d, _b, _h = copy_metadata(_meta_pkg)
        _datas += _d
        _binaries += _b
        _hidden += _h
    except Exception:
        pass

@@MATPLOTLIB_DATA@@
# ── Убираем дубликаты ──────────────────────────────────────────────────
_hidden = list(dict.fromkeys(_hidden))

# ── Исключаем мусор (тесты, неиспользуемые тяжёлые пакеты) ─────────────
_excludes = [
    # Тестовые модули (collect_submodules их затягивает)
    'passlib.tests',
    'passlib.tests.__main__',
    'passlib.tests._test_bad_register',
    'passlib.tests.backports',
    'passlib.tests.test_apache',
    'passlib.tests.test_apps',
    'passlib.tests.test_context',
    'passlib.tests.test_context_deprecated',
    'passlib.tests.test_crypto_builtin_md4',
    'passlib.tests.test_crypto_des',
    'passlib.tests.test_crypto_digest',
    'passlib.tests.test_crypto_scrypt',
    'passlib.tests.test_ext_django',
    'passlib.tests.test_ext_django_source',
    'passlib.tests.test_handlers_argon2',
    'passlib.tests.test_handlers_bcrypt',
    'passlib.tests.test_handlers_cisco',
    'passlib.tests.test_handlers_django',
    'passlib.tests.test_handlers_pbkdf2',
    'passlib.tests.test_handlers_scrypt',
    'passlib.tests.test_hosts',
    'passlib.tests.test_pwd',
    'passlib.tests.test_registry',
    'passlib.tests.test_totp',
    'passlib.tests.test_utils',
    'passlib.tests.test_utils_md4',
    'passlib.tests.test_utils_pbkdf2',
    'passlib.tests.test_win32',
    'passlib.tests.tox_support',
    'click.testing',
    'annotated_types.test_cases',
    'anyio.pytest_plugin',
    # Тяжёлые пакеты, не нужные приложению
    'numpy',
    'numpy.testing',
    'numpy._core',
    'numpy._core._multiarray_umath',
    'PIL',
    'PIL.Image',
    'PIL.ImageFilter',
    'PIL.SpiderImagePlugin',
    'pytest',
    '_pytest',
    'tkinter',
    'tkinter.filedialog',
    'scipy',
    'pandas',
    # Windows-only DLLs (предупреждения на Linux)
    'mx.DateTime',           # опциональная зависимость psycopg2
    # Старые TUI-зависимости (не используются в pr-a.1.2)
    'textual',
    'textual.widgets',
    'markdown_it',
    'mdit_py_plugins',
    'mdurl',
    'linkify_it',
    'uc_micro',
    'pygments',
    'platformdirs',
    # Прочее
    'reportlab',
    'tabulate',
    'yaml',
    'pyotp',                 # TOTP реализован вручную в app/totp.py
    # v2 — GTK/GObject introspection (PyInstaller hooks тянут их автоматически,
    # но они не нужны приложению). Это убирает ~10 MB и кучу warnings.
    'gi',
    'gi.repository',
    'pyodide',               # нужен только для urllib3.contrib.emscripten
    'matplotlib.tests',      # тестовые изображения matplotlib
    'matplotlib.tests.*',
    'urllib3.contrib.emscripten',
    'urllib3.contrib._safari',
    # GUI фреймворки (на всякий случай)
    'PyQt5',
    'PyQt6',
    'PySide2',
    'PySide6',
    'IPython',
    'jupyter',
    'notebook',
]

# Убираем из hidden всё, что в excludes
_hidden = [h for h in _hidden if h not in _excludes
           and not any(h.startswith(e + '.') for e in _excludes)]

# ── Основные данные (app/, скрипты, .env, SKILL/, out/) ────────────────
# Только файлы/каталоги, которые реально существуют в корне проекта.
_spec_root = r'@@PATH_EX@@'

# Обязательные данные — пакуются ВСЕГДА (независимо от --no-static)
_required_datas = [
    ('app', 'app'),                          # FastAPI-приложение (41 роутер, сервисы, models)
    ('cli.py', '.'),                         # CLI entrypoint (Click)
    ('ai_chat_cli.py', '.'),                 # AI chat CLI
    ('ds_auth.py', '.'),                     # Samba auth helper
    ('run.sh', '.'),                         # Bash-стартер (для dev-режима)
    ('webadc.service', '.'),                 # systemd unit
    ('requirements.txt', '.'),               # Python-зависимости
    ('.env', '.'),                           # Шаблон конфигурации
]

# Опциональные данные — пакуются только если НЕ задан --no-static
@@OPTIONAL_DATAS_BLOCK@@

for src, dst in _required_datas:
    src_full = os.path.join(_spec_root, src)
    if os.path.isdir(src_full) or os.path.isfile(src_full):
        _datas.append((src, dst))

# ── Analysis ──────────────────────────────────────────────────────────
a = Analysis(
    ['cli.py'],
    pathex=['@@PATH_EX@@'],
    binaries=_binaries,
    datas=_datas,
    hiddenimports=_hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=_excludes,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

@@EXE_BLOCK@@
"""


# ── EXE-блоки для onedir / onefile ────────────────────────────────────────

EXE_BLOCK_ONEDIR = """exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='@@APP_NAME@@',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='@@APP_NAME@@',
)
"""

EXE_BLOCK_ONEFILE = """exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='@@APP_NAME@@',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
"""


# ── Helpers ──────────────────────────────────────────────────────────────

def _render_template(template: str, **replacements: str) -> str:
    """Замена плейсхолдеров вида @@KEY@@ на значения.

    Используем str.replace, а НЕ str.format, потому что в spec-файле
    есть легитимные фигурные скобки (dict-литералы, hooksconfig={{}}),
    которые .format() бы сломал.

    Замена идёт в 2 прохода:
      1. Сначала заменяем EXE_BLOCK (который сам содержит @@APP_NAME@@).
      2. Потом заменяем все остальные плейсхолдеры (включая @@APP_NAME@@
         как в основном шаблоне, так и внутри EXE_BLOCK).
    """
    import re as _re

    out = template

    # Проход 1: заменяем все плейсхолдеры КРОМЕ APP_NAME.
    # Это позволяет EXE_BLOCK (который содержит @@APP_NAME@@) быть
    # подставленным как сырая строка, а потом @@APP_NAME@@ заменится везде.
    keys_except_app_name = [k for k in replacements if k != "APP_NAME"]
    for key in keys_except_app_name:
        value = replacements[key]
        placeholder = f"@@{key}@@"
        out = out.replace(placeholder, value)

    # Проход 2: заменяем @@APP_NAME@@ (теперь оно встречается и в основном
    # шаблоне, и в уже подставленном EXE_BLOCK).
    if "APP_NAME" in replacements:
        out = out.replace("@@APP_NAME@@", replacements["APP_NAME"])

    # Проверка, что не осталось незаменённых плейсхолдеров
    leftover = _re.findall(r"@@[A-Z_]+@@", out)
    if leftover:
        raise ValueError(f"Unreplaced placeholders in spec: {set(leftover)}")
    return out


def _build_optional_datas_block(no_static: bool) -> str:
    """Сгенерировать Python-код, добавляющий опциональные директории.

    Если no_static=True — возвращает пустой список (ничего не пакуем).
    Иначе пакуем: SKILL/, docs/, out/, webadc-python/ (если существуют).
    """
    if no_static:
        return (
            "# --no-static: опциональные данные НЕ пакуются (минимальный размер)\n"
            "_optional_datas = []"
        )

    # Список кандидатов: (src, dst, обязательна ли проверка существования)
    candidates: list[tuple[str, str]] = [
        ("SKILL", "SKILL"),                  # AI Skills (для ai_skill_execute)
        ("docs", "docs"),                    # Документация
    ]
    # out/ и webadc-python/ добавляем только если они существуют
    if (ROOT / "out").is_dir():
        candidates.append(("out", "out"))
    if (ROOT / "webadc-python").is_dir():
        candidates.append(("webadc-python", "webadc-python"))

    lines = ["# Опциональные данные (--no-static отключает их)"]
    lines.append("_optional_datas = [")
    for src, dst in candidates:
        lines.append(f"    ('{src}', '{dst}'),")
    lines.append("]")
    lines.append("_datas += [(src, dst) for src, dst in _optional_datas")
    lines.append("           if os.path.isdir(os.path.join(_spec_root, src))")
    lines.append("           or os.path.isfile(os.path.join(_spec_root, src))]")
    return "\n".join(lines)


def _build_matplotlib_block(no_matplotlib: bool) -> tuple[str, str, str]:
    """Вернуть (matplotlib_block, matplotlib_meta, matplotlib_data) для подстановки.

    Если no_matplotlib=True — matplotlib полностью исключается.
    Иначе — добавляется в _extra_packages, метаданные и collect_data_files.
    """
    if no_matplotlib:
        return (
            "# --no-matplotlib: matplotlib исключён (диаграммы AI будут возвращать ошибку)\n"
            "# matplotlib убран из _extra_packages",
            "",   # не добавляем в метаданные
            "",   # не собираем данные
        )
    return (
        # matplotlib в _extra_packages
        "_extra_packages.append('matplotlib')",
        # в метаданные
        " 'matplotlib',",
        # collect_data_files для шрифтов и стилей
        "try:\n"
        "    _datas += collect_data_files('matplotlib')\n"
        "except Exception:\n"
        "    pass",
    )


def _print_step(n: int, total: int, msg: str) -> None:
    print(f"[{n}/{total}] {msg}")


# ── Main ─────────────────────────────────────────────────────────────────

def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(
        description=f"Build {APP_NAME} (build v{BUILD_VERSION})",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Примеры:
  python3 build.py                              # onedir (по умолчанию, быстро)
  python3 build.py --onefile                    # один файл (портабельно, но медленнее стартует)
  python3 build.py --clean --onefile            # полная пересборка в один файл
  python3 build.py --onefile --no-static        # один файл, БЕЗ out/, SKILL/, docs/ (минимум)
  python3 build.py --onefile --no-matplotlib    # один файл, БЕЗ matplotlib (~30 MB меньше)
  python3 build.py --onefile --no-static --no-matplotlib   # самый минимальный бинарь
  python3 build.py --debug                      # подробный лог PyInstaller

Размеры (ориентировочно):
  --onefile                          ~80-90 MB  (со статикой и matplotlib)
  --onefile --no-static              ~75-80 MB  (без out/, SKILL/, docs/)
  --onefile --no-matplotlib          ~50-55 MB  (без matplotlib)
  --onefile --no-static --no-matplotlib  ~45-50 MB (минимум)
        """.strip(),
    )
    parser.add_argument("--onefile", action="store_true",
                        help="Собрать в один файл (медленнее стартует, но портабельнее)")
    parser.add_argument("--clean", action="store_true",
                        help="Полная пересборка (удалить dist/ и build/)")
    parser.add_argument("--no-static", action="store_true",
                        help="Не паковать out/, webadc-python/, SKILL/, docs/ (только API)")
    parser.add_argument("--no-matplotlib", action="store_true",
                        help="Исключить matplotlib (~30 MB меньше, но AI charts не работают)")
    parser.add_argument("--debug", action="store_true",
                        help="Запустить PyInstaller с --log-level DEBUG")
    args = parser.parse_args()

    # Pre-flight: check system dependencies
    _check_dependencies()

    # Вычисляем размеры опций для вывода
    features = []
    if not args.no_static:
        features.append("static+SKILL+docs")
    if not args.no_matplotlib:
        features.append("matplotlib")

    print(f"\n{'=' * 60}")
    print(f"  Сборка {APP_NAME} (build v{BUILD_VERSION})")
    print(f"  Режим: {'onefile' if args.onefile else 'onedir'}"
          f"  | Features: {', '.join(features) if features else 'none (minimal)'}"
          f"  | Clean: {'yes' if args.clean else 'no'}")
    print(f"{'=' * 60}\n")

    total_steps = 5

    # ── Step 1: Clean ──────────────────────────────────────────────────
    if args.clean:
        _print_step(1, total_steps, "Очистка dist/ и build/...")
        if BUILD.exists():
            shutil.rmtree(BUILD)
        if DIST.exists():
            shutil.rmtree(DIST)
    else:
        _print_step(1, total_steps, "Пропускаю очистку (--clean не задан)")

    # ── Step 2: Ensure dirs ────────────────────────────────────────────
    _print_step(2, total_steps, "Подготовка каталогов...")
    DIST.mkdir(exist_ok=True)
    (BUILD / "work").mkdir(parents=True, exist_ok=True)

    # ── Step 3: Write spec file ────────────────────────────────────────
    _print_step(3, total_steps, "Генерация spec-файла...")

    mpl_block, mpl_meta, mpl_data = _build_matplotlib_block(no_matplotlib=args.no_matplotlib)

    # Выбираем EXE-блок
    exe_block_raw = EXE_BLOCK_ONEFILE if args.onefile else EXE_BLOCK_ONEDIR

    # Рендерим spec через @-плейсхолдеры (не .format!)
    spec_content = _render_template(
        SPEC_TEMPLATE,
        BUILD_VERSION=BUILD_VERSION,
        PATH_EX=str(ROOT),
        APP_NAME=APP_NAME,
        OPTIONAL_DATAS_BLOCK=_build_optional_datas_block(no_static=args.no_static),
        MATPLOTLIB_BLOCK=mpl_block,
        MATPLOTLIB_META=mpl_meta,
        MATPLOTLIB_DATA=mpl_data,
        EXE_BLOCK=exe_block_raw,  # уже содержит @@APP_NAME@@ — заменится вместе с остальным
    )

    spec_path = ROOT / f"{APP_NAME}.spec"
    spec_path.write_text(spec_content, encoding="utf-8")
    print(f"  -> {spec_path}")

    # ── Step 4: Run PyInstaller ────────────────────────────────────────
    _print_step(4, total_steps, "Запуск PyInstaller...")
    pi_args: list[str] = [sys.executable, "-m", "PyInstaller", str(spec_path)]
    if args.clean:
        pi_args.append("--clean")
    if args.debug:
        pi_args.extend(["--log-level", "DEBUG"])
    pi_args.extend(["--distpath", str(DIST)])
    pi_args.extend(["--workpath", str(BUILD / "work")])
    pi_args.append("--noconfirm")

    print(f"  > {' '.join(pi_args)}")
    result = subprocess.run(pi_args)
    if result.returncode != 0:
        print(f"\n  ОШИБКА: PyInstaller завершился с кодом {result.returncode}")
        print(f"  Спек: {spec_path}")
        sys.exit(1)

    # ── Step 5: Copy distribution files ────────────────────────────────
    _print_step(5, total_steps, "Копирование файлов дистрибутива...")

    # В режиме onedir двоичник лежит в dist/webadc/webadc, в onefile — в dist/webadc
    if args.onefile:
        exe_path = DIST / APP_NAME
        bundle_dir = DIST
    else:
        exe_path = DIST / APP_NAME / APP_NAME
        bundle_dir = DIST / APP_NAME

    # .env template (всегда копируем в корень dist/)
    env_src = ROOT / ".env"
    if env_src.exists():
        shutil.copy2(env_src, DIST / ".env")
        print(f"  -> {DIST / '.env'}")

    # systemd unit
    service_src = ROOT / f"{APP_NAME}.service"
    if service_src.exists():
        shutil.copy2(service_src, DIST / f"{APP_NAME}.service")
        print(f"  -> {DIST / f'{APP_NAME}.service'}")

    # requirements.txt (для документации)
    req_src = ROOT / "requirements.txt"
    if req_src.exists():
        shutil.copy2(req_src, DIST / "requirements.txt")
        print(f"  -> {DIST / 'requirements.txt'}")

    # run.sh (для dev-режима)
    run_sh_src = ROOT / "run.sh"
    if run_sh_src.exists():
        shutil.copy2(run_sh_src, DIST / "run.sh")
        os.chmod(DIST / "run.sh", 0o755)
        print(f"  -> {DIST / 'run.sh'}")

    # Если onedir — копируем .env и service ещё и внутрь bundle_dir
    if not args.onefile:
        if env_src.exists():
            shutil.copy2(env_src, bundle_dir / ".env")
        if service_src.exists():
            shutil.copy2(service_src, bundle_dir / f"{APP_NAME}.service")

    # ── Финальная проверка ─────────────────────────────────────────────
    if exe_path.exists():
        # Считаем размер
        if args.onefile:
            size_mb = exe_path.stat().st_size / (1024 * 1024)
        else:
            total_size = sum(f.stat().st_size for f in bundle_dir.rglob("*") if f.is_file())
            size_mb = total_size / (1024 * 1024)

        print(f"\n{'=' * 60}")
        print(f"  ✅ Сборка завершена!")
        print(f"{'=' * 60}")
        print(f"  Бинарь:       {exe_path}")
        print(f"  Размер:       {size_mb:.1f} MB")
        print(f"  .env:         {DIST / '.env'}")
        print(f"  systemd:      {DIST / f'{APP_NAME}.service'}")
        print(f"  Spec-файл:    {spec_path}")
        if not args.no_static:
            print(f"  SKILL/:       упакован в бинарь")
            print(f"  docs/:        упакован в бинарь")
            if (ROOT / "out").is_dir():
                print(f"  out/:         упакован в бинарь (Next.js SPA)")
        else:
            print(f"  SKILL/, docs/, out/: НЕ упакованы (--no-static)")
        if args.no_matplotlib:
            print(f"  matplotlib:   исключён (--no-matplotlib)")
        print(f"{'=' * 60}")
        print()
        print("Установка (systemd):")
        print(f"  sudo cp {exe_path} /usr/local/bin/{APP_NAME}")
        print(f"  sudo chmod +x /usr/local/bin/{APP_NAME}")
        print(f"  sudo mkdir -p /etc/webadc")
        print(f"  sudo cp {DIST / '.env'} /etc/webadc/.env")
        print(f"  sudo cp {DIST / f'{APP_NAME}.service'} /etc/systemd/system/")
        print(f"  sudo systemctl daemon-reload")
        print(f"  sudo systemctl enable --now {APP_NAME}")
        print()
        print("Управление:")
        print(f"  sudo webadc start       # запустить (API + Web на :8099)")
        print(f"  sudo webadc stop        # остановить")
        print(f"  sudo webadc restart     # перезапустить")
        print(f"  sudo webadc status      # статус")
        print(f"  sudo webadc health      # проверка здоровья")
        print(f"  sudo webadc version     # версия")
        print()
        print("Проверка после установки:")
        print(f"  curl -k https://127.0.0.1:8099/health")
        print(f"  curl -k https://127.0.0.1:8099/docs  # Swagger UI")
    else:
        print(f"\n  ⚠️  ВНИМАНИЕ: {exe_path} не найден после сборки")
        print(f"  Проверьте лог PyInstaller выше.")
        sys.exit(1)


if __name__ == "__main__":
    main()
