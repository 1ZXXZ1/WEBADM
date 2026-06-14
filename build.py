#!/usr/bin/env python3
"""
build.py — Скрипт сборки webadc в исполняемый файл (PyInstaller).

Результат:
  dist/webadc          — единый бинарник
  dist/.env            — шаблон конфигурации
  dist/webadc.service  — systemd unit

Использование:
  python3 build.py
  python3 build.py --onefile     # один файл (медленнее, но портабельнее)
  python3 build.py --clean       # полная пересборка
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

# ── Pre-flight dependency check ───────────────────────────────────────────

REQUIRED_COMMANDS = {
    "objdump": "binutils  (sudo apt-get install binutils  /  sudo dnf install binutils)",
    "ldd":     "libc/binutils (обычно уже установлен; иначе — sudo apt-get install libc-bin)",
}


def _check_dependencies():
    """Проверить наличие системных утилит, необходимых PyInstaller."""
    missing = []
    for cmd, hint in REQUIRED_COMMANDS.items():
        if shutil.which(cmd) is None:
            missing.append((cmd, hint))
    if missing:
        print("\n  ОШИБКА: Не найдены системные утилиты, необходимые PyInstaller:\n")
        for cmd, hint in missing:
            print(f"    {cmd} — установите: {hint}")
        print()
        sys.exit(1)

ROOT = Path(__file__).parent
DIST = ROOT / "dist"
BUILD = ROOT / "build"

APP_NAME = "webadc"
VERSION = "per-a.0.2"

# ── PyInstaller spec ──────────────────────────────────────────────────
#
# Ключевой момент: используем collect_submodules / collect_all
# для автоматического сбора ВСЕХ подмодулей пакетов.
# Это решает проблему "No module named 'fastapi.middleware.cors'" и подобные.
#

SPEC_TEMPLATE = """# -*- mode: python ; coding: utf-8 -*-

import sys
import os
from PyInstaller.utils.hooks import collect_submodules, copy_metadata

block_cipher = None

# ── NumPy X86_V2 guard ────────────────────────────────────────────────
# На ALT Linux NumPy может быть собран с X86_V2 оптимизацией, которую
# процессор не поддерживает. Блокируем numpy ДО любого другого импорта,
# иначе collect_submodules падает при импорте openpyxl/openai/etc.
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

# uvicorn — нужен полностью (подмодули протоколов, lifespan и т.д.)
for _pkg in ['uvicorn']:
    try:
        _hidden += collect_submodules(_pkg)
    except Exception:
        _hidden.append(_pkg)

# pydantic v2 + pydantic_settings
for _pkg in ['pydantic', 'pydantic_core', 'pydantic_settings']:
    try:
        _hidden += collect_submodules(_pkg)
    except Exception:
        _hidden.append(_pkg)

# Остальные пакеты с lazy-импортами
_extra_packages = [
    'bcrypt',
    'cachetools',
    'cryptography',
    'httpx',
    'jose',
    'passlib',
    'psutil',
    'psycopg2',
    'python_multipart',
    'rich',
    'anyio',
    'sniffio',
    'h11',
    'httptools',
    'websockets',
    'click',
    'multipart',
    'yaml',
    'typing_extensions',
    'annotated_types',
    # v1.9.1-2: добавлены недостающие пакеты
    'openpyxl',          # xlsx-экспорт (report, sdb, xlsx_fmt)
    'openai',            # AI-сервис (ai_service, ai_polza_provider)
    'tabulate',          # табличный формат вывода (sdb_lib)
    'dns',               # dnspython — DNS-резолвер (routers/domain)
    'et_xmlfile',        # зависимость openpyxl
    'reportlab',         # PDF-генерация (generate_docs) — v1.9.1-4: установлен
]
for _pkg in _extra_packages:
    try:
        _subs = collect_submodules(_pkg)
        if _subs:
            _hidden += _subs
        else:
            _hidden.append(_pkg)
    except Exception:
        _hidden.append(_pkg)

# ── Textual (TUI framework) + зависимости ─────────────────────────────
_textual_packages = [
    'textual',
    'textual.widgets',
    'textual.containers',
    'textual.css',
    'textual.dom',
    'textual.geometry',
    'textual.layout',
    'textual.messages',
    'textual.reactive',
    'textual.render',
    'textual.screen',
    'textual.strip',
    'textual.theme',
    # v1.9.1-3: textual.timers и textual.autocomplete убраны —
    # этих модулей нет в текущей версии textual
    'markdown_it',
    'mdit_py_plugins',
    'mdurl',
    'linkify_it',
    'uc_micro',
    'pygments',
    'platformdirs',
]
for _pkg in _textual_packages:
    try:
        _subs = collect_submodules(_pkg)
        if _subs:
            _hidden += _subs
        else:
            _hidden.append(_pkg)
    except Exception:
        _hidden.append(_pkg)

# ── requests (нужен для ds_auth.py, debug-скриптов) ───────────────────
for _pkg in ['requests', 'urllib3', 'charset_normalizer', 'certifi', 'idna']:
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
for _meta_pkg in ['fastapi', 'starlette', 'pydantic', 'uvicorn', 'pydantic-core',
                   'pydantic-settings', 'python-jose', 'cryptography',
                   'python-multipart', 'httpx', 'anyio', 'sniffio',
                   'textual', 'markdown-it-py', 'rich', 'pygments',
                   'platformdirs', 'mdit-py-plugins', 'linkify-it-py',
                   # v1.9.1-2: метаданные для новых пакетов
                   'openpyxl', 'openai', 'tabulate', 'dnspython', 'reportlab']:
    try:
        _d, _b, _h = copy_metadata(_meta_pkg)
        _datas += _d
        _binaries += _b
        _hidden += _h
    except Exception:
        pass

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
    # Не используется приложением, но затягивается транзитивно
    'numpy',
    'numpy.testing',
    'PIL',
    'PIL.Image',
    'PIL.ImageFilter',
    'PIL.SpiderImagePlugin',
    'pytest',
    '_pytest',
    'tkinter',
    'tkinter.filedialog',
    'matplotlib',
    'matplotlib.pyplot',
    'matplotlib.font_manager',
    # Тяжёлые и несовместимые (X86_V2)
    'numpy._core',
    'numpy._core._multiarray_umath',
    'scipy',
    'pandas',
    # v1.9.1-3: Windows-only DLLs (предупреждения на Linux)
    'mx.DateTime',           # опциональная зависимость psycopg2
    # Textual dev/test stuff
    'textual._tests',
    'textual._doc',
    'textual._tools',
]

# Убираем из hidden всё, что в excludes
_hidden = [h for h in _hidden if h not in _excludes and not any(h.startswith(e + '.') for e in _excludes)]

# ── Основные данные (app/, скрипты, .env) ──────────────────────
# Только файлы/каталоги, которые реально существуют в корне проекта.
_candidate_datas = [
    ('app', 'app'),
    ('ai_chat_cli.py', '.'),
    ('debug_ai.py', '.'),
    ('ds_auth.py', '.'),
    ('generate_docs.py', '.'),
    ('debug', 'debug'),
    ('docs', 'docs'),
    ('.env', '.'),
]

# Фильтруем — оставляем только существующие файлы/каталоги
_spec_root = r'{pathex}'
_datas += [(src, dst) for src, dst in _candidate_datas
           if os.path.isdir(os.path.join(_spec_root, src)) or os.path.isfile(os.path.join(_spec_root, src))]

a = Analysis(
    ['cli.py'],
    pathex=['{pathex}'],
    binaries=_binaries,
    datas=_datas,
    hiddenimports=_hidden,
    hookspath=[],
    hooksconfig={{}},
    runtime_hooks=[],
    excludes=_excludes,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='{app_name}',
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


def run(cmd, **kw):
    print(f"  > {cmd}")
    return subprocess.run(cmd, shell=True, **kw)


def main():
    import argparse
    parser = argparse.ArgumentParser(description=f"Build {APP_NAME} v{VERSION}")
    parser.add_argument("--onefile", action="store_true", help="Собрать в один файл")
    parser.add_argument("--clean", action="store_true", help="Полная пересборка")
    args = parser.parse_args()

    # Pre-flight: check system dependencies (objdump, ldd, …)
    _check_dependencies()

    print(f"\n{'='*60}")
    print(f"  Сборка {APP_NAME} v{VERSION}")
    print(f"{'='*60}\n")

    # Clean
    if args.clean:
        print("[1/4] Очистка...")
        if BUILD.exists():
            shutil.rmtree(BUILD)
        if DIST.exists():
            shutil.rmtree(DIST)

    # Ensure dist dir
    DIST.mkdir(exist_ok=True)

    # Write spec file
    print("[2/4] Генерация spec-файла...")
    spec_content = SPEC_TEMPLATE.format(
        pathex=str(ROOT),
        app_name=APP_NAME,
    )
    spec_path = ROOT / f"{APP_NAME}.spec"
    spec_path.write_text(spec_content, encoding="utf-8")

    # Run PyInstaller
    print("[3/4] Запуск PyInstaller...")
    pi_args = [sys.executable, "-m", "PyInstaller", str(spec_path)]
    if args.clean:
        pi_args.append("--clean")
    if args.onefile:
        pi_args.append("--onefile")
    pi_args.extend(["--distpath", str(DIST)])
    pi_args.extend(["--workpath", str(BUILD / "work")])

    result = subprocess.run(pi_args)
    if result.returncode != 0:
        print(f"\n  ОШИБКА: PyInstaller завершился с кодом {result.returncode}")
        sys.exit(1)

    # Copy .env template
    print("[4/4] Копирование файлов дистрибутива...")
    env_src = ROOT / ".env"
    if env_src.exists():
        shutil.copy2(env_src, DIST / ".env")
        print(f"  -> {DIST / '.env'}")

    # Copy systemd unit
    service_src = ROOT / f"{APP_NAME}.service"
    if service_src.exists():
        shutil.copy2(service_src, DIST / f"{APP_NAME}.service")
        print(f"  -> {DIST / f'{APP_NAME}.service'}")

    # Verify
    exe_path = DIST / APP_NAME
    if exe_path.exists():
        print(f"\n{'='*60}")
        print(f"  Сборка завершена!")
        print(f"  Исполняемый файл: {exe_path}")
        print(f"  .env:             {DIST / '.env'}")
        print(f"  {APP_NAME}.service: {DIST / f'{APP_NAME}.service'}")
        print(f"{'='*60}\n")
        print(f"Установка:")
        print(f"  sudo cp {exe_path} /usr/local/bin/{APP_NAME}")
        print(f"  sudo mkdir -p /etc/webadc")
        print(f"  sudo cp {DIST / '.env'} /etc/webadc/.env")
        print(f"  sudo cp {DIST / f'{APP_NAME}.service'} /etc/systemd/system/")
        print(f"  sudo systemctl daemon-reload")
        print(f"  sudo systemctl restart {APP_NAME}")
        print(f"")
        print(f"  Управление:")
        print(f"  sudo webadc start       # запустить (API + Web)")
        print(f"  sudo webadc stop        # остановить")
        print(f"  sudo webadc restart     # перезапустить")
        print(f"  sudo webadc status      # статус")
        print(f"  sudo webadc health      # проверка здоровья")
        print(f"  sudo webadc version     # версия")
    else:
        print(f"\n  ВНИМАНИЕ: {exe_path} не найден после сборки")


if __name__ == "__main__":
    main()
