#!/usr/bin/env python3
"""
webadc — CLI диспетчер для Samba AD API + Web Panel v2.0.0

Один сервис — один порт (8099):
  API на /api/v1/
  Web Panel на / (корень)
  Включается/выключается через WEB_ENABLED в .env

Команды webadc:
  webadc start           — Запустить сервер (API + Web на порту 8099)
  webadc start api       — То же что start (один сервер)
  webadc start web       — То же что start (один сервер)
  webadc run             — Быстрый запуск uvicorn напрямую (dev, без build/systemd)
  webadc run --reload    — То же с auto-reload (по умолчанию)
  webadc run --no-reload — Без auto-reload
  webadc stop            — Остановить сервер
  webadc restart         — Перезапустить сервер
  webadc status          — Статус сервера (systemd + health + логи)
  webadc show            — Alias для status
  webadc db              — Управление JSON-файловым хранилищем (app.db)
  webadc ban             — Управление банами пользователей и API-ключей (v1.2.7_ban)
  webadc ds              — DS Auth management (ds_auth.py)
  webadc sdb             — SDB CLI (интерактивный SQL-подобный клиент для Samba LDB)
  webadc edt             — Редактировать конфигурацию (.env)
  webadc auth            — Проверить аутентификацию DS
  webadc health          — Health check сервера
  webadc version         — Показать версию

Использование с systemctl:
  systemctl start webadc       — запустить сервер
  systemctl stop webadc        — остановить сервер
  systemctl restart webadc     — перезапустить
  webadc status               — статус + логи (journalctl)
"""

from __future__ import annotations

import argparse
import os
import socket
import subprocess
import sys
import json
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# ── Constants ──────────────────────────────────────────────────────────

VERSION = "pe-a-1.4"
APP_NAME = "webadc"
WEBADC_NAME = "webadc"
DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8099
DEFAULT_WEB_PORT = 8099  # Same as API — WebADC served at root / on same server

# Detect if running as PyInstaller bundle
_FROZEN = getattr(sys, "frozen", False)

# In PyInstaller bundle, __file__ points to a temp dir; use exe dir
if _FROZEN:
    BASE_DIR = Path(sys.executable).parent
    ENV_FILE = BASE_DIR / ".env"
    # Data files (app/, webadc-python/, etc.) are in _MEIPASS for onefile mode
    _DATA_DIR = Path(sys._MEIPASS)
else:
    BASE_DIR = Path(__file__).parent
    ENV_FILE = BASE_DIR / ".env"
    _DATA_DIR = BASE_DIR

# v2.0.1: Single binary — webadc = API + Web (no more separate apiadc)
_INVOKED_AS = APP_NAME

# Detect if running under systemd (INVOCATION_ID is set by systemd)
_RUNNING_UNDER_SYSTEMD = bool(os.environ.get("INVOCATION_ID", ""))

# ── Rich TUI (optional fallback to plain) ──────────────────────────────

try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.table import Table
    from rich.text import Text
    from rich import box
    _RICH = True
except ImportError:
    _RICH = False


def _console():
    if _RICH:
        return Console()
    return None


def _print_header(title: str):
    con = _console()
    _prog = APP_NAME  # v2.0.1: single binary — always webadc
    if con:
        con.print(Panel(
            f"[bold cyan]{_prog}[/bold cyan] [bold]{VERSION}[/bold] — {title}",
            box=box.DOUBLE,
            style="bold blue",
        ))
    else:
        print(f"\n{'='*60}")
        print(f"  {_prog} {VERSION} — {title}")
        print(f"{'='*60}\n")


def _print_ok(msg: str):
    con = _console()
    if con:
        con.print(f"[bold green]✓[/bold green] {msg}")
    else:
        print(f"  [OK] {msg}")


def _print_err(msg: str):
    con = _console()
    if con:
        con.print(f"[bold red]✗[/bold red] {msg}")
    else:
        print(f"  [ERR] {msg}")


def _print_warn(msg: str):
    con = _console()
    if con:
        con.print(f"[bold yellow]![/bold yellow] {msg}")
    else:
        print(f"  [WARN] {msg}")


def _print_info(msg: str):
    con = _console()
    if con:
        con.print(f"[dim]→[/dim] {msg}")
    else:
        print(f"  -> {msg}")


# ── Helpers ────────────────────────────────────────────────────────────

def _load_env():
    """Load .env file into os.environ if present."""
    env_path = _find_env_file()
    if env_path and env_path.is_file():
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, _, val = line.partition("=")
                    key = key.strip()
                    val = val.strip()
                    # Remove inline comments
                    if " #" in val:
                        val = val[:val.index(" #")].strip()
                    if key and key not in os.environ:
                        os.environ[key] = val


def _find_env_file() -> Path:
    """Find the active .env file.

    Search order (first existing wins):
      1. ``./.env`` (current working directory — dev mode)
      2. ``/etc/webadc/.env`` (production, ALT Linux)
      3. ``/etc/apiadc/.env`` (legacy compat)

    Returns the path if found, else the default ``./.env`` (for writing).
    """
    candidates = [
        Path.cwd() / ".env",
        Path("/etc/webadc/.env"),
        Path("/etc/apiadc/.env"),
    ]
    for c in candidates:
        if c.is_file():
            return c
    # Default for writing: prefer /etc/webadc/.env if running as root,
    # otherwise CWD/.env
    if os.geteuid() == 0 and Path("/etc/webadc").is_dir():
        return Path("/etc/webadc/.env")
    return Path.cwd() / ".env"


def _get_api_url():
    host = os.environ.get("SAMBA_API_HOST", DEFAULT_HOST)
    port = os.environ.get("SAMBA_API_PORT", str(DEFAULT_PORT))
    ssl_cert = os.environ.get("SAMBA_SSL_CERTFILE", "")
    ssl_key = os.environ.get("SAMBA_SSL_KEYFILE", "")
    scheme = "https" if (ssl_cert and ssl_key) else "http"
    # For internal requests, use 127.0.0.1 instead of 0.0.0.0
    if host == "0.0.0.0":
        host = "127.0.0.1"
    return f"{scheme}://{host}:{port}"


def _get_api_key():
    return os.environ.get("SAMBA_API_KEY", "")


def _api_request(method: str, path: str, timeout: int = 10):
    """Make API request, return (status_code, body_dict_or_str).

    For HTTPS with self-signed certificates, SSL verification is skipped
    on internal requests (health, stop, restart) since the server is local.
    """
    base_url = _get_api_url()
    api_key = _get_api_key()
    url = f"{base_url}{path}"
    headers = {"X-API-Key": api_key, "Accept": "application/json"}

    req = Request(url, headers=headers, method=method)

    # Build SSL context: skip verification for self-signed / internal certs
    ssl_ctx = None
    if base_url.startswith("https://"):
        import ssl as _ssl
        ssl_ctx = _ssl.create_default_context()
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = _ssl.CERT_NONE

    try:
        with urlopen(req, timeout=timeout, context=ssl_ctx) as resp:
            data = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(data)
            except json.JSONDecodeError:
                return resp.status, data
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(body)
        except json.JSONDecodeError:
            return e.code, body
    except URLError as e:
        return 0, str(e)
    except Exception as e:
        return -1, str(e)


def _unit_exists(unit_name: str = None):
    """Check if systemd unit exists (regardless of its state)."""
    name = unit_name or APP_NAME
    try:
        result = subprocess.run(
            ["systemctl", "cat", name],
            capture_output=True, text=True, timeout=5,
        )
        return result.returncode == 0
    except FileNotFoundError:
        return False
    except Exception:
        return False


def _systemctl_is_active(unit_name: str = None):
    """Check if systemd unit is active."""
    name = unit_name or APP_NAME
    try:
        result = subprocess.run(
            ["systemctl", "is-active", name],
            capture_output=True, text=True, timeout=5,
        )
        state = result.stdout.strip()
        if state in ("active", "inactive", "failed", "activating"):
            return state
        return "unknown"
    except FileNotFoundError:
        return "unknown"
    except Exception:
        return "unknown"


def _get_webadc_dir():
    """Get the webadc-python directory path.

    In frozen (PyInstaller) mode, data files are extracted to sys._MEIPASS.
    In source mode, they're next to cli.py.
    """
    # Static files are now in app/web/static/ (no separate webadc-python/ dir)
    return BASE_DIR / "app" / "web"


def _get_web_env():
    """Load web settings from .env (WEB_ENABLED etc.)."""
    # Web settings are now in the main .env file (WEB_ENABLED, WEB_STATIC_DIR)
    # No separate webadc-python/.env needed — _load_env() handles it
    _load_env()


# ── Script runner helper ───────────────────────────────────────────────

def _run_script(script_name: str, extra_args: list = None):
    """Run a Python script from the project directory.

    In frozen (PyInstaller) mode, scripts are bundled as data files
    in the temp dir. In source mode, they're in ``app/`` (pe-a-1.4:
    CLI scripts moved to app/).
    """
    _load_env()

    # v3.3.8 — pe-a-1.4: scripts live in app/ now
    if _FROZEN:
        # In PyInstaller bundle, scripts are in the temp _MEIPASS dir
        candidates = [
            Path(sys._MEIPASS) / script_name,
            BASE_DIR / script_name,
            BASE_DIR / "app" / script_name,
        ]
    else:
        candidates = [
            BASE_DIR / "app" / script_name,
            BASE_DIR / script_name,
        ]

    script_path = None
    for c in candidates:
        if c.is_file():
            script_path = c
            break

    if script_path is None:
        _print_err(f"Скрипт не найден: {script_name}")
        _print_info(f"Искал в:")
        for c in candidates:
            _print_info(f"  {c}")
        return 1

    # Build argv for the script
    script_argv = [str(script_path)]
    if extra_args:
        script_argv.extend(extra_args)

    # Save/restore sys.argv and run the script
    old_argv = sys.argv
    old_path0 = sys.path[0] if sys.path else None
    try:
        # Add script's directory to sys.path
        script_dir = str(script_path.parent)
        if script_dir not in sys.path:
            sys.path.insert(0, script_dir)

        sys.argv = script_argv

        # Read and compile the script
        code = script_path.read_text(encoding="utf-8")
        compiled = compile(code, str(script_path), "exec")

        # Set __name__ so the script's if __name__ == "__main__" block runs
        import types
        module = types.ModuleType("__main__")
        module.__file__ = str(script_path)
        module.__name__ = "__main__"
        sys.modules["__main__"] = module

        exec(compiled, module.__dict__)
        return 0
    except SystemExit as e:
        return e.code or 0
    except Exception as e:
        _print_err(f"Ошибка запуска {script_name}: {e}")
        return 1
    finally:
        sys.argv = old_argv
        if old_path0 is not None:
            sys.path[0] = old_path0


# ── Commands ──────────────────────────────────────────────────────────

# ── Start commands ────────────────────────────────────────────────────

def cmd_run(args):
    """Быстрый запуск uvicorn напрямую (dev-режим, без build/systemd).

    Удобно для разработки: не нужно делать build через PyInstaller.
    Просто запускает uvicorn с текущими исходниками, по умолчанию
    с --reload для автоматической перезагрузки при изменении файлов.

    Примеры:
      webadc run                  # uvicorn + reload на 0.0.0.0:8099
      webadc run --port 9000      # на другом порту
      webadc run --host 127.0.0.1 # на localhost
      webadc run --no-reload      # без auto-reload
      webadc run --debug          # DEBUG log level
      webadc run --workers 2      # 2 воркера (без reload)
    """
    _load_env()
    host = getattr(args, 'host', None) or os.environ.get("SAMBA_API_HOST", DEFAULT_HOST)
    port = getattr(args, 'port', None) or os.environ.get("SAMBA_API_PORT", str(DEFAULT_PORT))
    app_path = os.environ.get("SAMBA_APP_PATH", "app.main:create_app")

    _print_header(f"Запуск uvicorn (dev) — {app_path}")

    # SSL
    ssl_certfile = os.environ.get("SAMBA_SSL_CERTFILE", "")
    ssl_keyfile = os.environ.get("SAMBA_SSL_KEYFILE", "")
    ssl_enabled = bool(ssl_certfile and ssl_keyfile)
    protocol = "HTTPS" if ssl_enabled else "HTTP"

    # v3.3.5 — Pre-flight SSL check with auto-generation.
    # If cert files are configured but missing, offer to auto-generate
    # them in /etc/webadc/ssl/ instead of failing.
    if ssl_enabled:
        from pathlib import Path as _P
        cert_ok = _P(ssl_certfile).is_file()
        key_ok = _P(ssl_keyfile).is_file()
        if not (cert_ok and key_ok):
            # Try auto-generation (interactive, or non-interactive with --yes)
            auto_yes = getattr(args, 'auto_yes', False)
            if not _ssl_auto_generate_if_missing(auto_yes=auto_yes):
                # User declined or generation failed — show options
                _print_err("")
                _print_err("Альтернативы:")
                _print_err("  1. sudo webadc ssl generate  (затем sudo webadc run)")
                _print_err("  2. webadc ssl disable         (запуск на HTTP)")
                _print_err("  3. SAMBA_SSL_CERTFILE= SAMBA_SSL_KEYFILE= webadc run  (разовый запуск без SSL)")
                return 1
            # SSL is now ready — re-read env vars
            ssl_certfile = os.environ.get("SAMBA_SSL_CERTFILE", ssl_certfile)
            ssl_keyfile = os.environ.get("SAMBA_SSL_KEYFILE", ssl_keyfile)
        else:
            # v3.3.7 — Files exist, but do we have read access?
            # SSL key files typically have 0600 perms owned by root.
            # If we're running without sudo, uvicorn will fail with
            # cryptic PermissionError deep in ssl.create_ssl_context.
            if not os.access(ssl_certfile, os.R_OK):
                _print_err(f"✗ Нет прав на чтение сертификата: {ssl_certfile}")
                _print_err("  Файл существует, но недоступен для чтения.")
                _print_err("")
                _print_err("Решения:")
                _print_err(f"  1. Запустить с sudo: sudo webadc run")
                _print_err(f"  2. Сменить владельца: sudo chown $USER:$USER {ssl_certfile}")
                _print_err(f"  3. Или дать права на чтение: sudo chmod 644 {ssl_certfile}")
                return 1
            if not os.access(ssl_keyfile, os.R_OK):
                _print_err(f"✗ Нет прав на чтение SSL ключа: {ssl_keyfile}")
                _print_err("  Файл существует (права 0600), но вы не root и не владелец.")
                _print_err("  uvicorn не сможет загрузить сертификат → PermissionError.")
                _print_err("")
                _print_err("Решения (в порядке предпочтения):")
                _print_err(f"  1. Запустить с sudo: sudo webadc run")
                _print_err(f"  2. Сменить владельца ключа: sudo chown $USER:$USER {ssl_keyfile}")
                _print_err(f"  3. Дать права на чтение (НЕ рекомендуется для prod): sudo chmod 644 {ssl_keyfile}")
                _print_err("")
                _print_info("Подсказка: для production лучше запускать через systemd (sudo systemctl start webadc)")
                return 1

    # Reload: включён по умолчанию, если явно не выключен или не указаны workers
    use_reload = getattr(args, 'reload', True)
    no_reload = getattr(args, 'no_reload', False)
    workers = getattr(args, 'workers', None)

    if no_reload or (workers and workers > 1):
        use_reload = False

    # Log level
    debug = getattr(args, 'debug', False)
    log_level = "debug" if debug else "info"

    _print_info(f"Адрес:    {host}:{port} ({protocol})")
    _print_info(f"App:      {app_path}")
    _print_info(f"Reload:   {'ВКЛ' if use_reload else 'ВЫКЛ'}")
    _print_info(f"Log:      {log_level.upper()}")
    if workers:
        _print_info(f"Workers:  {workers}")

    # Force TMPDIR for samba-tool
    os.environ.setdefault("TMPDIR", "/var/tmp")
    os.environ.setdefault("TMP", "/var/tmp")
    os.environ.setdefault("TEMP", "/var/tmp")

    if _FROZEN:
        # Если запущен из PyInstaller-бинарника — запускаем uvicorn встроенным
        try:
            import uvicorn
        except ImportError:
            _print_err("uvicorn не найден. Установите: pip install uvicorn")
            return 1

        uvicorn_kwargs = dict(
            host=host,
            port=int(port),
            reload=use_reload,
            log_level=log_level,
            access_log=True,
        )
        if workers:
            uvicorn_kwargs["workers"] = workers
        if ssl_enabled:
            uvicorn_kwargs["ssl_certfile"] = ssl_certfile
            uvicorn_kwargs["ssl_keyfile"] = ssl_keyfile
        uvicorn.run(app_path, **uvicorn_kwargs)
    else:
        # Из исходников — запускаем uvicorn как subprocess (заменяем процесс)
        uvicorn_cmd = [
            sys.executable, "-m", "uvicorn",
            app_path,
            "--host", host,
            "--port", str(port),
            "--log-level", log_level,
            "--access-log",
        ]
        if use_reload:
            uvicorn_cmd.append("--reload")
        if workers:
            uvicorn_cmd.extend(["--workers", str(workers)])
        if ssl_enabled:
            uvicorn_cmd.extend(["--ssl-certfile", ssl_certfile])
            uvicorn_cmd.extend(["--ssl-keyfile", ssl_keyfile])

        _print_info(f"Команда:  {' '.join(uvicorn_cmd)}")
        print()  # пустая строка перед логами uvicorn

        try:
            os.execvp(sys.executable, uvicorn_cmd)
        except FileNotFoundError:
            _print_err("uvicorn не найден. Установите: pip install uvicorn")
            return 1

    return 0


def cmd_start_api(args):
    """Запустить API сервер через uvicorn."""
    _load_env()
    host = os.environ.get("SAMBA_API_HOST", DEFAULT_HOST)
    port = os.environ.get("SAMBA_API_PORT", str(DEFAULT_PORT))

    _print_header("Запуск API сервера")

    # Check if already running (skip when running under systemd ExecStart,
    # since the health check would fail anyway during startup)
    if not _RUNNING_UNDER_SYSTEMD:
        status, body = _api_request("GET", "/health")
        if status == 200:
            _print_warn(f"API сервер уже запущен на {host}:{port}")
            return 0

    app_path = os.environ.get("SAMBA_APP_PATH", "app.main:create_app")

    # ── SSL / HTTPS configuration (v1.9.3) ──────────────────────────────
    ssl_certfile = os.environ.get("SAMBA_SSL_CERTFILE", "")
    ssl_keyfile = os.environ.get("SAMBA_SSL_KEYFILE", "")
    ssl_keyfile_password = os.environ.get("SAMBA_SSL_KEYFILE_PASSWORD", "")
    ssl_ca_certs = os.environ.get("SAMBA_SSL_CA_CERTS", "")
    ssl_version = os.environ.get("SAMBA_SSL_VERSION", "")

    ssl_enabled = bool(ssl_certfile and ssl_keyfile)
    protocol = "HTTPS" if ssl_enabled else "HTTP"

    if ssl_enabled:
        _print_info(f"SSL: {protocol} режим (cert={ssl_certfile}, key={ssl_keyfile})")
        # v3.3.5 — Auto-generate if files missing
        from pathlib import Path as _P
        cert_ok = _P(ssl_certfile).is_file()
        key_ok = _P(ssl_keyfile).is_file()
        if not (cert_ok and key_ok):
            if not _ssl_auto_generate_if_missing():
                _print_err("")
                _print_err("Альтернативы:")
                _print_err("  1. sudo webadc ssl generate")
                _print_err("  2. webadc ssl disable")
                return 1
            ssl_certfile = os.environ.get("SAMBA_SSL_CERTFILE", ssl_certfile)
            ssl_keyfile = os.environ.get("SAMBA_SSL_KEYFILE", ssl_keyfile)
        else:
            # v3.3.7 — Check read access (key has 0600 perms)
            if not os.access(ssl_certfile, os.R_OK) or not os.access(ssl_keyfile, os.R_OK):
                _print_err("✗ Нет прав на чтение SSL сертификата/ключа.")
                _print_err(f"  cert: {ssl_certfile}")
                _print_err(f"  key:  {ssl_keyfile}")
                _print_err("")
                _print_err("Решения:")
                _print_err("  1. Запустить через systemd: sudo systemctl start webadc")
                _print_err("  2. Или с sudo: sudo webadc start")
                _print_err(f"  3. Или сменить владельца: sudo chown $USER:$USER {ssl_certfile} {ssl_keyfile}")
                return 1
    else:
        if ssl_certfile or ssl_keyfile:
            _print_warn("SSL: указан только один из SSL_CERTFILE/SSL_KEYFILE — HTTPS не активирован")
        _print_info(f"Запуск uvicorn {app_path} на {host}:{port} ({protocol})")

    if _FROZEN:
        try:
            import uvicorn
        except ImportError:
            _print_err("uvicorn не найден. Установите: pip install uvicorn")
            return 1

        workers = args.workers if hasattr(args, 'workers') and args.workers else None
        uvicorn_kwargs = dict(
            host=host,
            port=int(port),
            workers=workers,
            reload=getattr(args, 'reload', False),
            log_level="info",
            access_log=True,
        )
        if ssl_enabled:
            uvicorn_kwargs["ssl_certfile"] = ssl_certfile
            uvicorn_kwargs["ssl_keyfile"] = ssl_keyfile
            if ssl_keyfile_password:
                uvicorn_kwargs["ssl_keyfile_password"] = ssl_keyfile_password
            if ssl_ca_certs:
                uvicorn_kwargs["ssl_ca_certs"] = ssl_ca_certs
            if ssl_version:
                import ssl as _ssl
                version_map = {
                    "TLSv1_2": _ssl.PROTOCOL_TLSv1_2,
                    "TLSv1_3": _ssl.PROTOCOL_TLSv1_3,
                }
                if ssl_version in version_map:
                    uvicorn_kwargs["ssl_version"] = version_map[ssl_version]
                else:
                    _print_warn(f"SSL_VERSION '{ssl_version}' не поддерживается, используется системный default")
        uvicorn.run(app_path, **uvicorn_kwargs)
    else:
        uvicorn_args = [
            sys.executable, "-m", "uvicorn",
            app_path,
            "--host", host,
            "--port", port,
        ]
        if hasattr(args, 'workers') and args.workers:
            uvicorn_args.extend(["--workers", str(args.workers)])
        if getattr(args, 'reload', False):
            uvicorn_args.append("--reload")
        if ssl_enabled:
            uvicorn_args.extend(["--ssl-certfile", ssl_certfile])
            uvicorn_args.extend(["--ssl-keyfile", ssl_keyfile])
            if ssl_keyfile_password:
                uvicorn_args.extend(["--ssl-keyfile-password", ssl_keyfile_password])
            if ssl_ca_certs:
                uvicorn_args.extend(["--ssl-ca-certs", ssl_ca_certs])
        try:
            os.execvp(sys.executable, uvicorn_args)
        except FileNotFoundError:
            _print_err("uvicorn не найден. Установите: pip install uvicorn")
            return 1


def cmd_start_web(args):
    """Запустить WebADC сервер (API + WebADC на одном порту 8099).

    В v1.9.3 WebADC монтируется на / (корень) внутри API сервера.
    Поэтому start web = start api — запускается один сервер на порту 8099.
    """
    _load_env()
    _get_web_env()
    _print_header("Запуск WebADC сервера")

    # Check if already running
    if not _RUNNING_UNDER_SYSTEMD:
        status, body = _api_request("GET", "/health")
        if status == 200:
            host = os.environ.get("SAMBA_API_HOST", DEFAULT_HOST)
            port = os.environ.get("SAMBA_API_PORT", str(DEFAULT_PORT))
            _print_warn(f"Сервер уже запущен (API + WebADC на {host}:{port})")
            # Verify WebADC is accessible
            web_status, web_body = _api_request("GET", "/web/api/health")
            if web_status == 200:
                _print_ok("WebADC доступен на /")
            else:
                _print_warn("WebADC на / не отвечает — возможно требуется перезапуск")
            return 0

    # WebADC is served by the API server at root / — start API (which includes WebADC)
    _print_info("WebADC монтируется на / (корень) внутри API сервера")
    _print_info("Запуск API сервера (включая WebADC)...")
    return cmd_start_api(args)


def cmd_start(args):
    """Запустить серверы.

    Подкоманды:
      start        — запустить API + WebADC (оба на порту 8099, WebADC на /)
      start api    — запустить API сервер (включая WebADC на /)
      start web    — запустить WebADC (то же что start api — один сервер)
    """
    svc = getattr(args, 'service', None)
    if svc == 'api':
        return cmd_start_api(args)
    elif svc == 'web':
        return cmd_start_web(args)
    else:
        # No subcommand → start both (API includes WebADC на /)
        return cmd_start_all(args)


def cmd_start_all(args):
    """Запустить API + WebADC (оба на порту 8099, WebADC на /).

    В v1.9.3 API сервер монтирует WebADC SPA на корень /,
    поэтому отдельный webadc.service на порту 443 больше не нужен.
    Достаточно запустить webadc.service — WebADC будет доступен на /.
    """
    _load_env()
    _get_web_env()

    # ── When running under systemd ExecStart, start uvicorn directly ──
    # Calling systemctl start from within a systemd service creates
    # a circular dependency and causes the process to exit immediately,
    # which makes systemd mark the service as "inactive (dead)".
    if _RUNNING_UNDER_SYSTEMD:
        _print_header("Запуск API + WebADC (systemd)")
        _print_info("Запуск uvicorn напрямую (запущен через systemd)")
        return cmd_start_api(args)

    _print_header("Запуск API + WebADC")

    api_host = os.environ.get("SAMBA_API_HOST", DEFAULT_HOST)
    api_port = os.environ.get("SAMBA_API_PORT", str(DEFAULT_PORT))

    api_started = False

    # ── Start API via systemd (includes WebADC at /) ──────────────
    if _unit_exists(APP_NAME):
        state = _systemctl_is_active(APP_NAME)
        if state == "active":
            _print_ok(f"API + WebADC уже запущены ({APP_NAME}.service)")
            api_started = True
        else:
            _print_info(f"Запуск API + WebADC через systemctl...")
            subprocess.run(["systemctl", "reset-failed", APP_NAME], timeout=10,
                           capture_output=True)
            r = subprocess.run(["systemctl", "start", APP_NAME],
                               capture_output=True, text=True, timeout=30)
            if r.returncode == 0:
                _print_ok(f"{APP_NAME}.service запущен (API + WebADC)")
                api_started = True
            else:
                _print_err(f"Не удалось запустить API: {r.stderr.strip()}")
    else:
        _print_info(f"systemd unit {APP_NAME}.service не найден, запуск API вручную...")
        # Start API in background
        app_path = os.environ.get("SAMBA_APP_PATH", "app.main:create_app")
        ssl_certfile = os.environ.get("SAMBA_SSL_CERTFILE", "")
        ssl_keyfile = os.environ.get("SAMBA_SSL_KEYFILE", "")
        ssl_enabled = bool(ssl_certfile and ssl_keyfile)

        uvicorn_cmd = [
            sys.executable, "-m", "uvicorn", app_path,
            "--host", api_host, "--port", api_port,
            "--log-level", "info", "--access-log",
        ]
        if ssl_enabled:
            uvicorn_cmd.extend(["--ssl-certfile", ssl_certfile])
            uvicorn_cmd.extend(["--ssl-keyfile", ssl_keyfile])

        try:
            api_proc = subprocess.Popen(
                uvicorn_cmd,
                cwd=str(BASE_DIR),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            _print_ok(f"API + WebADC запущены (PID {api_proc.pid}, {api_host}:{api_port})")
            api_started = True
        except Exception as e:
            _print_err(f"Не удалось запустить API: {e}")

    # ── Summary ──────────────────────────────────────────────────────
    con = _console()
    if con:
        table = Table(title="Статус запуска", box=box.SIMPLE)
        table.add_column("Сервис", style="cyan")
        table.add_column("Статус", style="green")
        table.add_column("Адрес", style="yellow")
        table.add_row("API", "✓ запущен" if api_started else "✗ ошибка",
                      f"{api_host}:{api_port}")
        table.add_row("WebADC", "✓ на /" if api_started else "✗ ошибка",
                      f"{api_host}:{api_port}/")
        con.print(table)
    else:
        print(f"  API:    {'OK' if api_started else 'FAIL'} ({api_host}:{api_port})")
        print(f"  WebADC: {'OK (на /)' if api_started else 'FAIL'} ({api_host}:{api_port}/)")

    return 0 if api_started else 1


# ── Stop commands ─────────────────────────────────────────────────────

def _stop_service(unit_name: str, port_env: str, default_port: int, label: str):
    """Общая логика остановки сервиса (systemd + процесс по порту)."""
    _load_env()
    stopped = False

    if _unit_exists(unit_name):
        state = _systemctl_is_active(unit_name)
        if state == "active":
            # When running under systemd ExecStop, skip systemctl stop
            # (we're already inside it — calling systemctl stop would deadlock)
            if not _RUNNING_UNDER_SYSTEMD:
                _print_info(f"Остановка {unit_name}.service через systemctl...")
                stop_result = subprocess.run(
                    ["systemctl", "stop", unit_name],
                    capture_output=True, text=True, timeout=30,
                )
                if stop_result.returncode == 0:
                    _print_ok(f"{unit_name}.service остановлен")
                    stopped = True
                else:
                    _print_err(f"Не удалось остановить: {stop_result.stderr.strip()}")
            else:
                _print_info(f"Остановка {unit_name} (systemd)")
                stopped = True
        elif state == "failed":
            _print_info(f"{unit_name}.service в состоянии failed, сбрасываю...")
            subprocess.run(["systemctl", "reset-failed", unit_name], timeout=10)
            _print_ok("Сброс failed-состояния выполнен")
            stopped = True
        else:
            _print_info(f"systemd unit {unit_name}.service не активен (state={state})")
            stopped = True

    port = os.environ.get(port_env, str(default_port))
    _print_info(f"Поиск процесса {label} на порту {port}...")
    try:
        result = subprocess.run(
            ["lsof", "-ti", f":{port}"],
            capture_output=True, text=True, timeout=10,
        )
        pids = result.stdout.strip().split()
        if pids and pids[0]:
            for pid in pids:
                _print_info(f"Завершение процесса PID {pid}...")
                try:
                    os.kill(int(pid), 15)
                except ProcessLookupError:
                    pass
                except PermissionError:
                    _print_err(f"Нет прав для завершения PID {pid}. Запустите с sudo.")
                    return False
            _print_ok(f"Процесс(ы) {label} на порту {port} завершён(ы)")
            stopped = True
    except FileNotFoundError:
        try:
            result = subprocess.run(
                ["fuser", f"{port}/tcp"],
                capture_output=True, text=True, timeout=10,
            )
            if result.stdout.strip():
                _print_info(f"Завершение через fuser {port}/tcp...")
                subprocess.run(["fuser", "-k", f"{port}/tcp"], timeout=10)
                _print_ok(f"Процесс {label} на порту {port} завершён")
                stopped = True
        except FileNotFoundError:
            pass
    except Exception as e:
        _print_err(f"Ошибка при поиске процесса: {e}")
        return False

    if not stopped:
        _print_warn(f"{label} не найден — возможно, уже остановлен")
    return True


def cmd_stop(args):
    """Остановить серверы.

    В v1.9.3 API и WebADC работают на одном порту (8099),
    поэтому stop web = stop api — останавливается один сервер.
    """
    svc = getattr(args, 'service', None)
    if svc == 'web':
        # WebADC is served by API server — stop the API server
        _print_header("Остановка WebADC (API + WebADC сервер)")
        return 0 if _stop_service(APP_NAME, "SAMBA_API_PORT", DEFAULT_PORT, "API + WebADC") else 1
    elif svc == 'api':
        _print_header("Остановка API сервера")
        return 0 if _stop_service(APP_NAME, "SAMBA_API_PORT", DEFAULT_PORT, "API") else 1
    else:
        # Stop all — same server
        _print_header("Остановка API + WebADC сервера")
        return 0 if _stop_service(APP_NAME, "SAMBA_API_PORT", DEFAULT_PORT, "API + WebADC") else 1


# ── Restart commands ─────────────────────────────────────────────────

def _restart_service(unit_name: str, label: str):
    """Перезапустить сервис через systemctl или stop+start."""
    if _unit_exists(unit_name):
        _print_info(f"Перезапуск {unit_name}.service через systemctl...")
        subprocess.run(["systemctl", "reset-failed", unit_name], timeout=10,
                       capture_output=True)
        restart_result = subprocess.run(
            ["systemctl", "restart", unit_name],
            capture_output=True, text=True, timeout=30,
        )
        if restart_result.returncode == 0:
            _print_ok(f"{unit_name}.service перезапущен")
            return True
        else:
            _print_err(f"Не удалось перезапустить {label}: {restart_result.stderr.strip()}")
            return False
    else:
        _print_info(f"systemd unit {unit_name}.service не найден")
        return False


def cmd_restart(args):
    """Перезапустить серверы.

    В v1.9.3 API и WebADC работают на одном порту (8099),
    поэтому restart web = restart api — перезапускается один сервер.
    """
    svc = getattr(args, 'service', None)
    if svc == 'web':
        # WebADC is served by API server — restart the API server
        _print_header("Перезапуск WebADC (API + WebADC сервер)")
        if _restart_service(APP_NAME, "API + WebADC"):
            import time
            time.sleep(2)
            status, body = _api_request("GET", "/health")
            if status == 200:
                _print_ok("Health check: сервер отвечает")
            else:
                _print_warn("Health check: сервер ещё поднимается...")
            return 0
        return 1
    elif svc == 'api':
        _print_header("Перезапуск API сервера")
        if _restart_service(APP_NAME, "API"):
            import time
            time.sleep(2)
            status, body = _api_request("GET", "/health")
            if status == 200:
                _print_ok("Health check: API сервер отвечает")
            else:
                _print_warn("Health check: API сервер ещё поднимается...")
            return 0
        return 1
    else:
        # Restart all — same server
        _print_header("Перезапуск API + WebADC сервера")
        if _restart_service(APP_NAME, "API + WebADC"):
            import time
            time.sleep(2)
            status, body = _api_request("GET", "/health")
            if status == 200:
                _print_ok("Health check: сервер отвечает")
            else:
                _print_warn("Health check: сервер ещё поднимается...")
            return 0
        return 1


def cmd_status(args):
    """Показать статус серверов (systemd + health + логи).

    В v1.9.3 API и WebADC работают на одном порту (8099),
    WebADC монтируется на / (корень) внутри API сервера.
    """
    _load_env()
    _get_web_env()
    _print_header("Статус серверов")

    api_port = os.environ.get("SAMBA_API_PORT", str(DEFAULT_PORT))

    # ── Summary table ────────────────────────────────────────────────
    con = _console()
    api_state = _systemctl_is_active(APP_NAME)

    # API health check
    api_health = "недоступен"
    api_status_code, api_body = _api_request("GET", "/health")
    if api_status_code == 200:
        api_health = "OK"
    elif api_status_code == 0:
        api_health = f"нет связи ({api_body})"

    # WebADC health check — same server, /web/api/health
    web_health = "недоступен"
    web_status_code, web_body = _api_request("GET", "/web/api/health")
    if web_status_code == 200:
        web_health = "OK"
    elif api_status_code == 200:
        web_health = f"не смонтирован (/ не отвечает)"

    if con:
        table = Table(title="Обзор сервисов", box=box.SIMPLE)
        table.add_column("Сервис", style="cyan")
        table.add_column("systemd", style="yellow")
        table.add_column("Health", style="green")
        table.add_column("Порт", style="magenta")
        table.add_row("API + WebADC", api_state, api_health, api_port)
        table.add_row("  └ WebADC", "на /", web_health, f"{api_port}/")
        con.print(table)
    else:
        print(f"  API + WebADC:  systemd={api_state}  health={api_health}  port={api_port}")
        print(f"    WebADC:      health={web_health}  url=/")

    # ── API systemd status ────────────────────────────────────────────
    _print_info(f"[{APP_NAME}.service]")
    try:
        result = subprocess.run(
            ["systemctl", "status", APP_NAME, "--no-pager", "-l"],
            capture_output=True, text=True, timeout=5,
        )
        output = result.stdout + result.stderr
        if "not be found" in output or "not-found" in output or "Could not find unit" in output:
            _print_warn(f"systemd unit {APP_NAME}.service не установлен")
            _print_info("Установите: sudo cp webadc.service /etc/systemd/system/")
        else:
            if con:
                con.print(Panel(result.stdout or result.stderr,
                               title=f"[{APP_NAME}.service]", box=box.SIMPLE))
            else:
                if result.stdout:
                    print(result.stdout)
    except FileNotFoundError:
        _print_warn("systemctl не доступен")
    except Exception as e:
        _print_warn(f"systemctl: {e}")

    # API detailed health
    if api_status_code == 200 and isinstance(api_body, dict):
        _print_ok("API сервер отвечает")
        det_status, det_body = _api_request("GET", "/health/detailed")
        if det_status == 200 and isinstance(det_body, dict):
            if con:
                dtable = Table(title="API Health Detailed", box=box.SIMPLE)
                dtable.add_column("Key", style="cyan")
                dtable.add_column("Value", style="green")
                for k, v in det_body.items():
                    dtable.add_row(str(k), str(v))
                con.print(dtable)
            else:
                for k, v in det_body.items():
                    print(f"  {k}: {v}")

    # Recent logs (single service — webadc)
    _print_info(f"Логи {APP_NAME} (journalctl):")
    try:
        result = subprocess.run(
            ["journalctl", "-u", APP_NAME, "-n", "20", "--no-pager"],
            capture_output=True, text=True, timeout=5,
        )
        if result.stdout:
            print(result.stdout)
    except Exception:
        pass

    return 0


cmd_show = cmd_status


def cmd_ds(args):
    """Запустить DS Auth management (ds_auth.py)."""
    _load_env()
    _print_header("DS Auth Management")

    extra = args.ds_args or []
    return _run_script("ds_auth.py", extra)


def cmd_edt(args):
    """Редактировать конфигурацию (.env) в $EDITOR."""
    _load_env()
    _print_header("Редактирование конфигурации")

    # Determine which .env to edit
    env_path = ENV_FILE
    if not env_path.is_file():
        env_path = Path("/etc/webadc/.env")
    if not env_path.is_file():
        env_path = Path("/etc/apiadc/.env")
    if not env_path.is_file():
        # Create a new .env in BASE_DIR
        env_path = BASE_DIR / ".env"
        _print_info(f"Файл не найден, создаю: {env_path}")
        env_path.write_text("# Samba AD API Server configuration\n", encoding="utf-8")

    _print_info(f"Файл: {env_path}")

    # Pick editor
    editor = os.environ.get("EDITOR", "") or os.environ.get("VISUAL", "")
    if not editor:
        # Try nano, then vim, then vi
        for candidate in ("nano", "vim", "vi"):
            try:
                result = subprocess.run(
                    ["which", candidate],
                    capture_output=True, text=True, timeout=5,
                )
                if result.returncode == 0:
                    editor = candidate
                    break
            except Exception:
                continue
    if not editor:
        editor = "vi"

    _print_info(f"Редактор: {editor}")
    try:
        os.system(f"{editor} {env_path}")
    except Exception as e:
        _print_err(f"Не удалось запустить редактор: {e}")
        return 1

    return 0


def cmd_auth(args):
    """Проверить аутентификацию DS (Domain Services)."""
    _load_env()
    _print_header("Проверка аутентификации DS")

    server = os.environ.get("SAMBA_SERVER", "")
    realm = os.environ.get("SAMBA_REALM", "")
    dc_hostname = os.environ.get("SAMBA_DC_HOSTNAME", "")
    use_krb = os.environ.get("SAMBA_USE_KERBEROS", "false").lower() == "true"

    con = _console()
    if con:
        table = Table(title="DS Authentication Config", box=box.SIMPLE)
        table.add_column("Parameter", style="cyan")
        table.add_column("Value", style="green")
        table.add_row("SAMBA_SERVER", server or "(не задан)")
        table.add_row("SAMBA_REALM", realm or "(авто)")
        table.add_row("SAMBA_DC_HOSTNAME", dc_hostname or "(авто)")
        table.add_row("SAMBA_USE_KERBEROS", str(use_krb))
        table.add_row("API URL", _get_api_url())
        con.print(table)
    else:
        print(f"  SAMBA_SERVER       = {server or '(не задан)'}")
        print(f"  SAMBA_REALM        = {realm or '(авто)'}")
        print(f"  SAMBA_DC_HOSTNAME  = {dc_hostname or '(авто)'}")
        print(f"  SAMBA_USE_KERBEROS = {use_krb}")
        print(f"  API URL            = {_get_api_url()}")

    status, body = _api_request("GET", "/health")
    if status == 200:
        _print_ok(f"API сервер доступен ({_get_api_url()})")
        if isinstance(body, dict):
            _print_info(f"server_role: {body.get('server_role', '?')}")
    else:
        _print_err(f"API сервер недоступен ({_get_api_url()}): {body}")

    try:
        result = subprocess.run(
            ["samba-tool", "domain", "level", "show"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            _print_ok("samba-tool domain level show — OK")
        else:
            _print_warn(f"samba-tool: {result.stderr[:200]}")
    except FileNotFoundError:
        _print_warn("samba-tool не найден в PATH")
    except Exception as e:
        _print_warn(f"samba-tool: {e}")

    return 0



def cmd_health(args):
    """Проверить здоровье сервера."""
    _load_env()
    _print_header("Health Check")

    status, body = _api_request("GET", "/health")
    if status == 200:
        _print_ok(f"Сервер работает ({_get_api_url()})")
        if isinstance(body, dict):
            _print_info(f"status: {body.get('status')}")
            _print_info(f"server_role: {body.get('server_role')}")
            _print_info(f"version: {body.get('version')}")
    else:
        _print_err(f"Сервер недоступен: HTTP {status} — {body}")

    return 0


def cmd_version(args):
    """Показать версию."""
    con = _console()
    mode = "binary" if _FROZEN else "source"
    if con:
        con.print(Panel(
            f"[bold]{APP_NAME}[/bold] version [bold cyan]{VERSION}[/bold cyan]  ({mode})",
            box=box.DOUBLE,
        ))
    else:
        print(f"{APP_NAME} version {VERSION} ({mode})")
    return 0


def cmd_sdb(args):
    """SDB CLI — интерактивный SQL-подобный клиент для Samba LDB.

    Запускает sdb_lib CLI с переданными аргументами.
    Поддерживает интерактивный режим, выполнение команд (-e),
    скриптовые файлы (-f), показ баз данных (--databases).
    """
    _load_env()
    _print_header("SDB — Samba Database Query Tool")

    # Добавляем BASE_DIR/app в sys.path, чтобы from app.sdb_lib... работал
    app_dir = str(BASE_DIR / "app")
    if app_dir not in sys.path:
        sys.path.insert(0, app_dir)
    base_dir_str = str(BASE_DIR)
    if base_dir_str not in sys.path:
        sys.path.insert(0, base_dir_str)

    # Собираем аргументы для sdb_lib CLI
    sdb_argv = []

    if getattr(args, 'execute', None):
        sdb_argv.extend(["-e", args.execute])

    if getattr(args, 'databases', False):
        sdb_argv.append("--databases")

    if getattr(args, 'file', None):
        sdb_argv.extend(["-f", args.file])

    if getattr(args, 'parse_ldif', None):
        sdb_argv.extend(["--parse-ldif", args.parse_ldif])

    if getattr(args, 'format', None) and args.format != 'table':
        sdb_argv.extend(["--format", args.format])

    if getattr(args, 'output', None):
        sdb_argv.extend(["-o", args.output])

    if getattr(args, 'database', None) and args.database != 'sam':
        sdb_argv.extend(["-d", args.database])

    if getattr(args, 'no_sudo', False):
        sdb_argv.append("--no-sudo")

    # Если никаких аргументов не передано — интерактивный режим
    # (sdb_argv будет пустым → sdb_lib запустит интерактивный REPL)

    # Подменяем sys.argv и запускаем sdb_lib CLI
    old_argv = sys.argv
    try:
        sys.argv = ["sdb"] + sdb_argv
        from app.sdb_lib.cli import main as sdb_main
        sdb_main()
        return 0
    except SystemExit as e:
        return e.code or 0
    except Exception as e:
        _print_err(f"Ошибка SDB: {e}")
        return 1
    finally:
        sys.argv = old_argv


# ── SSL Command (v3.3.4) — manage HTTPS certificates ─────────────────

def cmd_ssl(args):
    """Управление SSL сертификатами для HTTPS.

    Подкоманды:
      ssl generate [--host NAME] [--out DIR]   сгенерировать self-signed
      ssl check                                  проверить текущую конфигурацию
      ssl disable                                отключить HTTPS (заккоментировать в .env)
      ssl enable <cert> <key>                    включить HTTPS с указанными файлами
    """
    subcmd = args.ssl_cmd

    if subcmd == "generate":
        return _ssl_generate(args)
    if subcmd == "check":
        return _ssl_check(args)
    if subcmd == "disable":
        return _ssl_disable(args)
    if subcmd == "enable":
        return _ssl_enable(args)
    _print_err(f"Неизвестная подкоманда ssl: {subcmd}")
    return 1


def _ssl_generate(args):
    """Generate a self-signed SSL certificate (RSA 2048, 365 days).

    v3.3.5 — Default output dir is /etc/webadc/ssl/ (matches the
    production deployment layout). Override via --out.
    """
    import subprocess

    host = args.host or os.environ.get("SAMBA_SERVER", "") or socket.gethostname()
    # v3.3.5 — Default to /etc/webadc/ssl/ (production layout)
    out_dir = args.out or "/etc/webadc/ssl"
    cert_path = os.path.join(out_dir, "apiadc.crt")
    key_path = os.path.join(out_dir, "apiadc.key")

    # Ensure directory exists (with parents)
    os.makedirs(out_dir, exist_ok=True)

    # If files exist, ask before overwriting (unless --force)
    if (os.path.exists(cert_path) or os.path.exists(key_path)) and not getattr(args, 'force', False):
        _print_warn(f"Файлы уже существуют:")
        if os.path.exists(cert_path):
            _print_warn(f"  {cert_path}")
        if os.path.exists(key_path):
            _print_warn(f"  {key_path}")
        _print_info("Используйте --force для перезаписи")
        return 1

    # Build openssl command
    cmd = [
        "openssl", "req", "-x509", "-newkey", "rsa:2048",
        "-keyout", key_path,
        "-out", cert_path,
        "-days", "365",
        "-nodes",
        "-subj", f"/CN={host}",
        "-addext", f"subjectAltName=DNS:{host},DNS:localhost,IP:127.0.0.1",
    ]
    _print_info(f"Генерация self-signed сертификата для {host}...")
    _print_info(f"  cert: {cert_path}")
    _print_info(f"  key:  {key_path}")
    _print_info(f"  Команда: {' '.join(cmd)}")
    print()

    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            _print_err(f"openssl failed (rc={result.returncode}):")
            _print_err(result.stderr)
            return 1
        # Set restrictive permissions on key
        os.chmod(key_path, 0o600)
        _print_ok(f"Сертификат создан:")
        _print_ok(f"  {cert_path}")
        _print_ok(f"  {key_path}")
        print()

        # v3.3.5 — Auto-enable in .env if SSL is not yet configured
        try:
            env_path = _find_env_file()
            if env_path.is_file():
                with open(env_path) as f:
                    env_content = f.read()
                # Check if SSL_CERTFILE is missing or commented
                import re
                cert_match = re.search(r"^SAMBA_SSL_CERTFILE=\S", env_content, re.MULTILINE)
                if not cert_match:
                    _print_info(f"Авто-включение HTTPS в {env_path}...")
                    # Use _ssl_enable logic
                    class _Args:
                        pass
                    a = _Args()
                    a.cert = cert_path
                    a.key = key_path
                    _ssl_enable(a)
        except Exception as exc:
            _print_warn(f"Не удалось авто-включить HTTPS в .env: {exc}")
            _print_info(f"Вручную добавьте в .env:")
            _print_info(f"  SAMBA_SSL_CERTFILE={cert_path}")
            _print_info(f"  SAMBA_SSL_KEYFILE={key_path}")

        print()
        _print_info("Запустите сервер:")
        _print_info("  webadc run")
        return 0
    except FileNotFoundError:
        _print_err("openssl не найден. Установите: apt-get install openssl")
        return 1


def _ssl_auto_generate_if_missing(auto_yes: bool = False) -> bool:
    """Auto-generate SSL cert if .env has SSL_ paths but files don't exist.

    v3.3.5 — Called from cmd_run before launching uvicorn. If SSL is
    enabled in .env but cert/key files are missing, this function:
      1. Asks the user for confirmation (or proceeds if auto_yes=True)
      2. Generates self-signed cert at /etc/webadc/ssl/
      3. Updates .env to point to the new files

    Returns True if SSL is now ready (or was already), False if user
    declined or generation failed.
    """
    ssl_certfile = os.environ.get("SAMBA_SSL_CERTFILE", "")
    ssl_keyfile = os.environ.get("SAMBA_SSL_KEYFILE", "")
    if not (ssl_certfile and ssl_keyfile):
        return True  # SSL not enabled, nothing to do

    from pathlib import Path
    cert_exists = Path(ssl_certfile).is_file()
    key_exists = Path(ssl_keyfile).is_file()
    if cert_exists and key_exists:
        return True  # All good

    # Files missing — offer to auto-generate
    _print_warn("SSL сертификат/ключ прописаны в .env, но файлов нет:")
    if not cert_exists:
        _print_warn(f"  ✗ {ssl_certfile}")
    if not key_exists:
        _print_warn(f"  ✗ {ssl_keyfile}")
    print()

    # Default location for new cert
    default_dir = "/etc/webadc/ssl"
    default_cert = os.path.join(default_dir, "apiadc.crt")
    default_key = os.path.join(default_dir, "apiadc.key")

    # If running as root, ask; if not, we can't write to /etc
    if os.geteuid() != 0:
        _print_err("Нужны права root для генерации сертификата в /etc/webadc/ssl/")
        _print_err("Запустите: sudo webadc run")
        return False

    # Interactive prompt (skip if --yes)
    if not auto_yes:
        try:
            ans = input(f"Сгенерировать self-signed сертификат в {default_dir}/? [Y/n] ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            ans = "n"
        if ans in ("n", "no"):
            _print_err("Отменено пользователем. SSL не настроен — сервер не запустится.")
            _print_err("Альтернативы:")
            _print_err("  1. sudo webadc ssl generate  (затем webadc run)")
            _print_err("  2. webadc ssl disable         (запуск на HTTP)")
            return False
    else:
        _print_info(f"--yes → авто-генерация в {default_dir}/ без подтверждения")

    # Generate
    _print_info(f"Генерация self-signed сертификата в {default_dir}/...")
    import subprocess
    host = os.environ.get("SAMBA_SERVER", "") or socket.gethostname()

    os.makedirs(default_dir, exist_ok=True)

    cmd = [
        "openssl", "req", "-x509", "-newkey", "rsa:2048",
        "-keyout", default_key,
        "-out", default_cert,
        "-days", "365",
        "-nodes",
        "-subj", f"/CN={host}",
        "-addext", f"subjectAltName=DNS:{host},DNS:localhost,IP:127.0.0.1",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            _print_err(f"openssl failed: {result.stderr}")
            return False
        os.chmod(default_key, 0o600)
    except FileNotFoundError:
        _print_err("openssl не найден. Установите: apt-get install openssl")
        return False

    _print_ok(f"Сертификат создан: {default_cert}")
    _print_ok(f"Ключ создан: {default_key}")

    # Update .env to point to the new files
    env_path = _find_env_file()
    if env_path.is_file():
        try:
            with open(env_path) as f:
                content = f.read()
            import re
            new_cert_line = f"SAMBA_SSL_CERTFILE={default_cert}"
            new_key_line = f"SAMBA_SSL_KEYFILE={default_key}"
            content = re.sub(r"^#?\s*SAMBA_SSL_CERTFILE=.*$", new_cert_line, content, flags=re.MULTILINE)
            content = re.sub(r"^#?\s*SAMBA_SSL_KEYFILE=.*$", new_key_line, content, flags=re.MULTILINE)
            with open(env_path, "w") as f:
                f.write(content)
            _print_ok(f".env обновлён: {env_path}")
            # Update env vars in current process
            os.environ["SAMBA_SSL_CERTFILE"] = default_cert
            os.environ["SAMBA_SSL_KEYFILE"] = default_key
        except Exception as exc:
            _print_warn(f"Не удалось обновить .env: {exc}")
            _print_info(f"Вручную установите:")
            _print_info(f"  SAMBA_SSL_CERTFILE={default_cert}")
            _print_info(f"  SAMBA_SSL_KEYFILE={default_key}")

    print()
    _print_ok("SSL готов — продолжаем запуск сервера...")
    return True


def _ssl_check(args):
    """Check current SSL configuration."""
    _load_env()
    cert = os.environ.get("SAMBA_SSL_CERTFILE", "")
    key = os.environ.get("SAMBA_SSL_KEYFILE", "")
    print("SSL Configuration:")
    print(f"  SAMBA_SSL_CERTFILE = {cert or '(не задан)'}")
    print(f"  SAMBA_SSL_KEYFILE  = {key or '(не задан)'}")
    print()

    if not cert and not key:
        _print_info("HTTPS отключен (SSL_CERTFILE/SSL_KEYFILE не заданы)")
        return 0

    if cert and not key:
        _print_warn("Указан только SSL_CERTFILE — HTTPS не активирован (нужен и KEYFILE)")
        return 1
    if key and not cert:
        _print_warn("Указан только SSL_KEYFILE — HTTPS не активирован (нужен и CERTFILE)")
        return 1

    # Both set — check files exist
    from pathlib import Path
    issues = 0
    if not Path(cert).is_file():
        _print_err(f"✗ Сертификат не найден: {cert}")
        issues += 1
    else:
        _print_ok(f"✓ Сертификат найден: {cert}")
        # Check it's a valid cert via openssl
        try:
            import subprocess
            r = subprocess.run(
                ["openssl", "x509", "-in", cert, "-noout", "-subject", "-dates"],
                capture_output=True, text=True,
            )
            if r.returncode == 0:
                for line in r.stdout.strip().split("\n"):
                    _print_info(f"    {line}")
        except FileNotFoundError:
            pass

    if not Path(key).is_file():
        _print_err(f"✗ Ключ не найден: {key}")
        issues += 1
    else:
        _print_ok(f"✓ Ключ найден: {key}")
        # Check permissions (should be 600)
        import stat
        mode = stat.S_IMODE(Path(key).stat().st_mode)
        if mode & 0o077:
            _print_warn(f"  ⚠ Права на ключ {oct(mode)} — рекомендуется chmod 600")
        else:
            _print_ok(f"  ✓ Права на ключ {oct(mode)}")
        # v3.3.7 — Check read access for current user
        if os.access(key, os.R_OK):
            _print_ok(f"  ✓ Доступен для чтения текущим пользователем")
        else:
            _print_warn(f"  ⚠ НЕ доступен для чтения текущим пользователем")
            _print_warn(f"    Если сервер не запускается с PermissionError — запустите через sudo")
            _print_warn(f"    Или смените владельца: sudo chown $USER:$USER {key}")

    # v3.3.7 — Also check cert readability
    if Path(cert).is_file() and not os.access(cert, os.R_OK):
        _print_warn(f"  ⚠ Сертификат НЕ доступен для чтения: {cert}")
        _print_warn(f"    Решение: sudo chmod 644 {cert}")

    if issues:
        print()
        _print_err("SSL конфигурация НЕ валидна — сервер не запустится с HTTPS.")
        _print_info("Сгенерировать self-signed: sudo webadc ssl generate")
        _print_info("Отключить HTTPS:           webadc ssl disable")
        return 1

    print()
    _print_ok("SSL конфигурация валидна — сервер запустится с HTTPS.")
    return 0


def _ssl_disable(args):
    """Disable HTTPS by commenting out SSL_ lines in .env."""
    env_path = _find_env_file()
    if not env_path.is_file():
        _print_err(f".env не найден: {env_path}")
        _print_err("Поиск выполнялся в:")
        _print_err("  1. ./.env (текущая директория)")
        _print_err("  2. /etc/webadc/.env")
        _print_err("  3. /etc/apiadc/.env (legacy)")
        return 1

    _print_info(f"Используется .env: {env_path}")
    with open(env_path) as f:
        lines = f.readlines()

    changed = 0
    new_lines = []
    for line in lines:
        stripped = line.lstrip()
        # Skip already-commented lines
        if stripped.startswith("#"):
            new_lines.append(line)
            continue
        # Comment out SSL_CERTFILE / SSL_KEYFILE / SSL_KEYFILE_PASSWORD / SSL_CA_CERTS
        if any(stripped.startswith(prefix) for prefix in
               ("SAMBA_SSL_CERTFILE", "SAMBA_SSL_KEYFILE",
                "SAMBA_SSL_KEYFILE_PASSWORD", "SAMBA_SSL_CA_CERTS")):
            new_lines.append("# " + line)
            changed += 1
            _print_info(f"  закомментировано: {line.rstrip()}")
        else:
            new_lines.append(line)

    if changed == 0:
        _print_info("SSL строки не найдены в .env — HTTPS уже отключен")
        return 0

    with open(env_path, "w") as f:
        f.writelines(new_lines)
    _print_ok(f"HTTPS отключен — закомментировано {changed} строк в {env_path}")
    _print_info("Теперь сервер запустится на HTTP. Перезапустите: webadc run")
    return 0


def _ssl_enable(args):
    """Enable HTTPS by setting SSL_CERTFILE/SSL_KEYFILE in .env."""
    if not args.cert or not args.key:
        _print_err("Требуется --cert и --key:")
        _print_err('  webadc ssl enable --cert /path/cert.crt --key /path/cert.key')
        return 1

    from pathlib import Path
    if not Path(args.cert).is_file():
        _print_err(f"Сертификат не найден: {args.cert}")
        return 1
    if not Path(args.key).is_file():
        _print_err(f"Ключ не найден: {args.key}")
        return 1

    env_path = _find_env_file()
    _print_info(f"Используется .env: {env_path}")

    with open(env_path) as f:
        content = f.read()

    # Replace existing SSL_CERTFILE / SSL_KEYFILE lines, or append
    import re
    new_cert_line = f"SAMBA_SSL_CERTFILE={args.cert}\n"
    new_key_line = f"SAMBA_SSL_KEYFILE={args.key}\n"

    # Try to replace existing lines (commented or not)
    content = re.sub(
        r"^#?\s*SAMBA_SSL_CERTFILE=.*$",
        new_cert_line.rstrip(),
        content, flags=re.MULTILINE,
    )
    content = re.sub(
        r"^#?\s*SAMBA_SSL_KEYFILE=.*$",
        new_key_line.rstrip(),
        content, flags=re.MULTILINE,
    )

    # If not found, append
    if "SAMBA_SSL_CERTFILE=" not in content:
        content += "\n# v3.3.5 — HTTPS enabled\n" + new_cert_line + new_key_line
    elif "SAMBA_SSL_KEYFILE=" not in content:
        content += new_key_line

    with open(env_path, "w") as f:
        f.write(content)

    _print_ok(f"HTTPS включен в {env_path}:")
    _print_ok(f"  SAMBA_SSL_CERTFILE={args.cert}")
    _print_ok(f"  SAMBA_SSL_KEYFILE={args.key}")
    _print_info("Перезапустите сервер: webadc run")
    return 0


# ── SQLDB Command (delegates to app/cli_sqldb.py, pe-a-1.4) ───────────

def cmd_sqldb(args):
    """Делегирует в app/cli_sqldb.py (pe-a-1.4 — rich UI, interactive conflicts).

    Все sqldb-команды реализованы в отдельном модуле app/cli_sqldb.py для
    лучшей maintainability. Этот handler просто транслирует argparse-args
    в вызов cli_sqldb.main().
    """
    import sys
    try:
        # v3.3.8 — pe-a-1.4: cli_sqldb moved to app/
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "app"))
        # Try app/cli_sqldb first, fall back to root for back-compat
        try:
            from app.cli_sqldb import main as _sqldb_main
        except ImportError:
            import cli_sqldb
            _sqldb_main = cli_sqldb.main
    except ImportError as exc:
        _print_err(f'app/cli_sqldb.py не найден: {exc}')
        return 1

    # Build argv from argparse Namespace
    argv = [args.sqldb_cmd]
    if args.revision_id:
        argv.append(args.revision_id)
    if args.sql:
        argv.append(args.sql)
    if args.revision_msg:
        argv.extend(['-m', args.revision_msg])
    if args.dump_out:
        argv.extend(['--out', args.dump_out])
    if args.restore_in:
        argv.extend(['--in', args.restore_in])
    # --on-conflict takes precedence over --mode (back-compat)
    on_conflict = args.on_conflict or args.restore_mode
    if on_conflict:
        argv.extend(['--on-conflict', on_conflict])
    if args.dry_run:
        argv.append('--dry-run')
    if args.transfer_from:
        argv.extend(['--from', args.transfer_from])
    if args.transfer_to:
        argv.extend(['--to', args.transfer_to])
    if args.tables_filter:
        argv.extend(['--tables', args.tables_filter])
    # v3.3.6 — for audit/show/purge commands
    if getattr(args, 'limit', None) and args.sqldb_cmd == 'audit':
        argv.extend(['--limit', str(args.limit)])
    if getattr(args, 'auto_yes', False) and args.sqldb_cmd == 'purge':
        argv.append('--yes')

    return _sqldb_main(argv)


# ── Ban management (v1.2.7_ban) ────────────────────────────────────────

def _ban_api_request(method: str, path: str, body: dict = None, timeout: int = 15):
    """Make an authenticated API request to /api/v1/ban/* endpoints.

    Returns (status_code, body_dict_or_str). Uses the same X-API-Key
    header as _api_request but allows a JSON body for POST requests.
    """
    base_url = _get_api_url()
    api_key = _get_api_key()
    url = f"{base_url}{path}"
    headers = {"X-API-Key": api_key, "Accept": "application/json"}

    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")

    req = Request(url, headers=headers, method=method, data=data)

    ssl_ctx = None
    if base_url.startswith("https://"):
        import ssl as _ssl
        ssl_ctx = _ssl.create_default_context()
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = _ssl.CERT_NONE

    try:
        with urlopen(req, timeout=timeout, context=ssl_ctx) as resp:
            raw = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, raw
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(body)
        except json.JSONDecodeError:
            return e.code, body
    except URLError as e:
        return 0, str(e)
    except Exception as e:
        return -1, str(e)


def _ban_format_record(rec: dict, con=None) -> str:
    """Format a single ban record for human-readable display."""
    if not rec:
        return "(нет данных)"

    bid = rec.get("id", "?")
    tt = rec.get("target_type", "?")
    tn = rec.get("target_name", "?")
    reason = rec.get("reason", "") or ""
    active = rec.get("is_active", False)
    created = (rec.get("created_at") or "")[:19].replace("T", " ")
    expires = rec.get("expires_at")
    if expires:
        expires_str = expires[:19].replace("T", " ")
    else:
        expires_str = "permanent" if active else "—"
    lifted_at = rec.get("lifted_at")
    lifted_by = rec.get("lifted_by") or ""
    lifted_reason = rec.get("lifted_reason") or ""
    banned_by = rec.get("banned_by") or ""

    status_str = "ACTIVE" if active else "LIFTED"
    lines = [
        f"  ID:        {bid}",
        f"  Target:    {tt} = {tn}",
        f"  Status:    {status_str}",
        f"  Reason:    {reason!r}",
        f"  Banned by: {banned_by}",
        f"  Created:   {created}",
        f"  Expires:   {expires_str}",
    ]
    if not active:
        lines.append(f"  Lifted at: {(lifted_at or '')[:19].replace('T', ' ')}")
        lines.append(f"  Lifted by: {lifted_by}")
        if lifted_reason:
            lines.append(f"  Lift reason: {lifted_reason!r}")
    return "\n".join(lines)


def _ban_table(records: list, con=None):
    """Render a list of ban records as a Rich table (or plain text)."""
    if not records:
        _print_info("Баны не найдены")
        return
    if con:
        tbl = Table(title="Bans", box=box.ROUNDED)
        tbl.add_column("ID", justify="right", style="cyan")
        tbl.add_column("Type")
        tbl.add_column("Name")
        tbl.add_column("Status")
        tbl.add_column("Reason")
        tbl.add_column("Banned by")
        tbl.add_column("Created")
        tbl.add_column("Expires")
        for r in records:
            active = r.get("is_active", False)
            status_str = "[red]ACTIVE[/red]" if active else "[dim]lifted[/dim]"
            expires = r.get("expires_at")
            if expires:
                exp_str = expires[:19].replace("T", " ")
            else:
                exp_str = "permanent" if active else "—"
            tbl.add_row(
                str(r.get("id", "")),
                r.get("target_type", ""),
                r.get("target_name", ""),
                status_str,
                (r.get("reason") or "")[:40],
                r.get("banned_by") or "",
                (r.get("created_at") or "")[:19].replace("T", " "),
                exp_str,
            )
        con.print(tbl)
    else:
        print(f"{'ID':>5}  {'TYPE':5}  {'NAME':20}  {'STATUS':6}  {'REASON':40}  {'BANNED_BY':15}  {'EXPIRES'}")
        print("-" * 110)
        for r in records:
            active = r.get("is_active", False)
            status_str = "ACTIVE" if active else "lifted"
            expires = r.get("expires_at")
            if expires:
                exp_str = expires[:19].replace("T", " ")
            else:
                exp_str = "permanent" if active else "-"
            print(f"{r.get('id', '')!s:>5}  "
                  f"{r.get('target_type', ''):5}  "
                  f"{r.get('target_name', '')[:20]:20}  "
                  f"{status_str:6}  "
                  f"{(r.get('reason') or '')[:40]:40}  "
                  f"{r.get('banned_by', '')[:15]:15}  "
                  f"{exp_str}")


def cmd_ban(args):
    """Управление банами пользователей и API-ключей (v1.2.7_ban).

    Подкоманды:
      list     — список банов (с фильтрами --active, --type, --name)
      add      — создать бан (обязательны --type и --name, опционально --reason, --duration)
      unban    — снять бан (по --id или по --type + --name)
      show     — показать бан по id
      check    — проверить, забанена ли цель (user/key)
      delete   — hard-delete записи бана (история)
      purge    — удалить старые снятые баны (по умолчанию старше 90 дней)
    """
    _load_env()
    _print_header("Ban Management (v1.2.7_ban)")

    con = _console()
    subcmd = getattr(args, "ban_cmd", None)
    if not subcmd:
        _print_err("Не указана подкоманда. Используйте: webadc ban {list|add|unban|show|check|delete|purge}")
        return 1

    # ── list ─────────────────────────────────────────────────────────
    if subcmd == "list":
        path = "/api/v1/ban?limit={}".format(args.limit)
        if args.active:
            path += "&active=true"
        if args.ban_type:
            path += "&target_type=" + args.ban_type
        if args.ban_name:
            path += "&target_name=" + args.ban_name
        status, body = _ban_api_request("GET", path)
        if status != 200:
            _print_err(f"Не удалось получить список банов (HTTP {status}): {body}")
            return 1
        if isinstance(body, dict):
            bans = body.get("bans", [])
            total = body.get("total", 0)
            active = body.get("active", 0)
            _print_info(f"Всего: {total}, активных: {active}")
            _ban_table(bans, con)
        else:
            print(body)
        return 0

    # ── add ──────────────────────────────────────────────────────────
    if subcmd == "add":
        if not args.ban_type or not args.ban_name:
            _print_err("Для 'add' обязательно --type {user|key} и --name NAME")
            return 1
        body = {
            "target_type": args.ban_type,
            "target_name": args.ban_name,
            "reason": args.ban_reason or "",
        }
        if args.ban_duration is not None:
            body["duration_minutes"] = args.ban_duration
        status, resp = _ban_api_request("POST", "/api/v1/ban", body=body)
        if status != 201:
            _print_err(f"Ошибка создания бана (HTTP {status}): {resp}")
            return 1
        _print_ok(f"Бан создан для {args.ban_type}={args.ban_name}")
        if con:
            con.print(_ban_format_record(resp, con))
        else:
            print(_ban_format_record(resp))
        return 0

    # ── unban ────────────────────────────────────────────────────────
    if subcmd == "unban":
        body = {"lifted_reason": args.ban_reason or ""}
        if args.ban_id:
            body["ban_id"] = int(args.ban_id)
        elif args.ban_type and args.ban_name:
            body["target_type"] = args.ban_type
            body["target_name"] = args.ban_name
        else:
            _print_err("Для 'unban' нужно либо --id ID, либо --type T --name N")
            return 1
        status, resp = _ban_api_request("POST", "/api/v1/unban", body=body)
        if status == 404:
            _print_warn(f"Активный бан не найден: {body}")
            return 1
        if status != 200:
            _print_err(f"Ошибка снятия бана (HTTP {status}): {resp}")
            return 1
        _print_ok("Бан снят")
        if con:
            con.print(_ban_format_record(resp, con))
        else:
            print(_ban_format_record(resp))
        return 0

    # ── show ─────────────────────────────────────────────────────────
    if subcmd == "show":
        if not args.ban_id:
            _print_err("Для 'show' нужно ID бана")
            return 1
        status, resp = _ban_api_request("GET", f"/api/v1/ban/{args.ban_id}")
        if status == 404:
            _print_warn(f"Бан {args.ban_id} не найден")
            return 1
        if status != 200:
            _print_err(f"Ошибка (HTTP {status}): {resp}")
            return 1
        if con:
            con.print(_ban_format_record(resp, con))
        else:
            print(_ban_format_record(resp))
        return 0

    # ── check ────────────────────────────────────────────────────────
    if subcmd == "check":
        if not args.ban_type or not args.ban_name:
            _print_err("Для 'check' нужно --type {user|key} и --name NAME")
            return 1
        status, resp = _ban_api_request("GET",
                                        f"/api/v1/ban/check/{args.ban_type}/{args.ban_name}")
        if status != 200:
            _print_err(f"Ошибка (HTTP {status}): {resp}")
            return 1
        if isinstance(resp, dict) and resp.get("banned"):
            _print_warn(f"{args.ban_type}={args.ban_name} ЗАБАНЕН")
            if con:
                con.print(_ban_format_record(resp.get("ban"), con))
            else:
                print(_ban_format_record(resp.get("ban")))
            return 0
        else:
            _print_ok(f"{args.ban_type}={args.ban_name} НЕ забанен")
            return 0

    # ── delete ───────────────────────────────────────────────────────
    if subcmd == "delete":
        if not args.ban_id:
            _print_err("Для 'delete' нужно ID бана")
            return 1
        status, resp = _ban_api_request("DELETE", f"/api/v1/ban/{args.ban_id}")
        if status == 404:
            _print_warn(f"Бан {args.ban_id} не найден")
            return 1
        if status != 200:
            _print_err(f"Ошибка (HTTP {status}): {resp}")
            return 1
        _print_ok(f"Бан {args.ban_id} удалён (hard-delete)")
        return 0

    # ── purge ────────────────────────────────────────────────────────
    if subcmd == "purge":
        # purge does not have a REST endpoint — call ban_db directly.
        _print_info(f"Удаление старых снятых банов старше {args.purge_days} дней...")
        app_dir = str(BASE_DIR / "app")
        if app_dir not in sys.path:
            sys.path.insert(0, app_dir)
        base_dir_str = str(BASE_DIR)
        if base_dir_str not in sys.path:
            sys.path.insert(0, base_dir_str)
        try:
            from app.ban_db import purge_history
        except ImportError as e:
            _print_err(f"Не удалось импортировать app.ban_db: {e}")
            return 1
        try:
            n = purge_history(older_than_days=args.purge_days)
        except Exception as e:
            _print_err(f"Ошибка purge: {e}")
            return 1
        _print_ok(f"Удалено {n} старых банов")
        return 0

    _print_err(f"Неизвестная подкоманда ban: {subcmd}")
    return 1


# ── Main ───────────────────────────────────────────────────────────────

def main():
    # v2.0.1: Single binary — webadc = API + Web (no more dual mode)
    _prog = APP_NAME
    _desc = f"WebADC — Samba AD API + Web Panel CLI — v{VERSION}"
    parser = argparse.ArgumentParser(
        prog=_prog,
        description=_desc,
    )
    sub = parser.add_subparsers(dest="command", help="Доступные команды")

    # start (with subcommands: api, web, or none = both)
    p_start = sub.add_parser("start",
                             help="Запустить API + Web серверы",
                             formatter_class=argparse.RawDescriptionHelpFormatter,
                             epilog="""
Примеры:
  webadc start              # запустить API + WebADC
  webadc start api          # запустить только API сервер
  webadc start web          # запустить только WebADC сервер
  webadc start api --reload # API в режиме разработки
  webadc start api --workers 4  # API с 4 воркерами
""")
    p_start_sub = p_start.add_subparsers(dest="service", help="Сервис для запуска")
    # start api
    p_start_api = p_start_sub.add_parser("api", help="Запустить только API сервер (uvicorn)")
    p_start_api.add_argument("--workers", type=int, default=0, help="Количество воркеров uvicorn")
    p_start_api.add_argument("--reload", action="store_true", help="Включить auto-reload (dev)")
    p_start_api.set_defaults(func=cmd_start)
    # start web
    p_start_web = p_start_sub.add_parser("web", help="Запустить только WebADC сервер")
    p_start_web.set_defaults(func=cmd_start)
    # start (no subcommand = both)
    p_start.set_defaults(func=cmd_start)

    # stop (with subcommands: api, web, or none = both)
    p_stop = sub.add_parser("stop",
                            help="Остановить API + Web серверы",
                            formatter_class=argparse.RawDescriptionHelpFormatter,
                            epilog="""
Примеры:
  webadc stop               # остановить API + WebADC
  webadc stop api           # остановить только API сервер
  webadc stop web           # остановить только WebADC сервер
""")
    p_stop_sub = p_stop.add_subparsers(dest="service", help="Сервис для остановки")
    p_stop_api = p_stop_sub.add_parser("api", help="Остановить только API сервер")
    p_stop_api.set_defaults(func=cmd_stop)
    p_stop_web = p_stop_sub.add_parser("web", help="Остановить только WebADC сервер")
    p_stop_web.set_defaults(func=cmd_stop)
    p_stop.set_defaults(func=cmd_stop)

    # restart (with subcommands: api, web, or none = both)
    p_restart = sub.add_parser("restart",
                               help="Перезапустить API + Web серверы",
                               formatter_class=argparse.RawDescriptionHelpFormatter,
                               epilog="""
Примеры:
  webadc restart            # перезапустить API + WebADC
  webadc restart api        # перезапустить только API сервер
  webadc restart web        # перезапустить только WebADC сервер
""")
    p_restart_sub = p_restart.add_subparsers(dest="service", help="Сервис для перезапуска")
    p_restart_api = p_restart_sub.add_parser("api", help="Перезапустить только API сервер")
    p_restart_api.set_defaults(func=cmd_restart)
    p_restart_web = p_restart_sub.add_parser("web", help="Перезапустить только WebADC сервер")
    p_restart_web.set_defaults(func=cmd_restart)
    p_restart.set_defaults(func=cmd_restart)

    # status
    p_status = sub.add_parser("status", help="Статус серверов (systemd + health + логи)")
    p_status.set_defaults(func=cmd_status)

    # show (alias for status)
    p_show = sub.add_parser("show", help="Статус сервера (alias для status)")
    p_show.set_defaults(func=cmd_show)

    # ds — DS Auth management (ds_auth.py)
    p_ds = sub.add_parser("ds", help="DS Auth management (ds_auth.py)",
                          formatter_class=argparse.RawDescriptionHelpFormatter,
                          epilog="""
Примеры:
  webadc ds login admin P@ssw0rd --save    # логин + сохранить JWT
  webadc ds key list                         # список API-ключей
  webadc ds key create --user-id 1 -n mykey -r admin  # создать ключ
  webadc ds user list                        # список пользователей
  webadc ds role list                        # список ролей
  webadc ds perms list                       # список прав
  webadc ds token show                       # показать JWT-токен
  webadc ds token curl /api/v1/users/        # сгенерировать curl
""")
    p_ds.add_argument("ds_args", nargs="*", help="Аргументы для ds_auth.py")
    p_ds.set_defaults(func=cmd_ds)

    # edt
    p_edt = sub.add_parser("edt", help="Редактировать конфигурацию (.env)")
    p_edt.set_defaults(func=cmd_edt)

    # auth
    p_auth = sub.add_parser("auth", help="Проверить аутентификацию DS")
    p_auth.set_defaults(func=cmd_auth)

    # health
    p_health = sub.add_parser("health", help="Health check сервера")
    p_health.set_defaults(func=cmd_health)

    # version
    p_ver = sub.add_parser("version", help="Показать версию")
    p_ver.set_defaults(func=cmd_version)

    # run — быстрый запуск uvicorn напрямую (dev, без build/systemd)
    p_run = sub.add_parser("run",
                          help="Быстрый запуск uvicorn (dev-режим, без build/systemd)",
                          formatter_class=argparse.RawDescriptionHelpFormatter,
                          epilog="""\
Примеры:
  webadc run                  # uvicorn + reload на 0.0.0.0:8099
  webadc run --port 9000      # на другом порту
  webadc run --host 127.0.0.1 # на localhost
  webadc run --no-reload      # без auto-reload
  webadc run --debug          # DEBUG log level
  webadc run --workers 2      # 2 воркера (без reload)

Команда 'run' запускает uvicorn напрямую из исходников, без PyInstaller
build и без systemd. Идеально для разработки — по умолчанию включён
--reload для автоматической перезагрузки при изменении файлов.
""")
    p_run.add_argument("--host", default=None, help=f"Хост (по умолчанию: {DEFAULT_HOST})")
    p_run.add_argument("--port", default=None, help=f"Порт (по умолчанию: {DEFAULT_PORT})")
    p_run.add_argument("--reload", dest="reload", action="store_true", default=True,
                       help="Включить auto-reload (по умолчанию ВКЛ)")
    p_run.add_argument("--no-reload", dest="reload", action="store_false",
                       help="Выключить auto-reload")
    p_run.add_argument("--debug", action="store_true", help="DEBUG log level")
    p_run.add_argument("--workers", type=int, default=None, help="Количество воркеров (отключает reload)")
    p_run.add_argument("--yes", "-y", action="store_true", dest="auto_yes",
                       help="Auto-confirm SSL certificate generation (non-interactive)")
    p_run.set_defaults(func=cmd_run)

    # sdb — SDB CLI (SQL-подобный клиент для Samba LDB)
    p_sdb = sub.add_parser("sdb",
                          help="SDB CLI — интерактивный SQL-подобный клиент для Samba LDB",
                          formatter_class=argparse.RawDescriptionHelpFormatter,
                          epilog="""\
Примеры:
  webadc sdb                                                # Интерактивный режим
  webadc sdb -e "USE sam; SELECT * FROM * WHERE objectClass=user;"
  webadc sdb --databases                                    # Показать базы данных
  webadc sdb -f script.sdb                                  # Выполнить скрипт
  webadc sdb -d privilege -e "SELECT * FROM *"              # Выбрать БД и запрос
  webadc sdb --no-sudo -e "SHOW DATABASES"                  # Без sudo
  webadc sdb --parse-ldif sam.ldif --format json            # Разобрать LDIF
""")
    p_sdb.add_argument("-e", "--execute", default=None,
                       help="Выполнить команду SDB (несколько команд через ;)")
    p_sdb.add_argument("-f", "--file", default=None,
                       help="Путь к файлу скрипта SDB")
    p_sdb.add_argument("--databases", action="store_true",
                       help="Показать доступные базы данных")
    p_sdb.add_argument("--parse-ldif", metavar="FILE", default=None,
                       help="Разобрать LDIF файл")
    p_sdb.add_argument("--format", choices=["json", "csv", "tsv", "table", "ldif", "xlsx"],
                       default="table", help="Формат вывода (по умолчанию: table)")
    p_sdb.add_argument("-o", "--output", default=None,
                       help="Файл для записи результата")
    p_sdb.add_argument("-d", "--database", default="sam",
                       help="База данных по умолчанию (sam, privilege, idmap, hklm, secrets, share, dns)")
    p_sdb.add_argument("--no-sudo", action="store_true",
                       help="НЕ использовать sudo")
    p_sdb.set_defaults(func=cmd_sdb)

    # ban — Ban / Unban management (v1.2.7_ban)
    p_ban = sub.add_parser("ban",
                           help="Управление банами пользователей и API-ключей (v1.2.7_ban)",
                           formatter_class=argparse.RawDescriptionHelpFormatter,
                           epilog="""\
Подкоманды:
  webadc ban list [--active] [--type user|key] [--name NAME]
                                                    Список банов
  webadc ban add --type user --name john \\
                 --reason "compromised" \\
                 [--duration 60]                  Забанить (60 мин; без --duration = permanent)
  webadc ban unban --id 42                         Снять бан по id
  webadc ban unban --type user --name john         Снять бан по target
  webadc ban show 42                               Показать бан по id
  webadc ban check user john                       Проверить, забанен ли user/key
  webadc ban check key abc12345                    Проверить API-key по prefix
  webadc ban delete 42                             Hard-delete записи (история)
  webadc ban purge [--older-than-days 90]          Удалить старые снятые баны

Примеры:
  webadc ban add --type user --name alice --reason "audit violation" --duration 1440
  webadc ban add --type key  --name ab12cd34 --reason "leaked"
  webadc ban unban --type user --name alice --reason "investigation complete"
  webadc ban list --active
""")
    p_ban.add_argument("ban_cmd", choices=[
        "list", "add", "unban", "show", "check", "delete", "purge",
    ], help="Подкоманда ban")
    p_ban.add_argument("ban_id", nargs="?", default=None,
                       help="ID бана (для show/delete/unban)")
    p_ban.add_argument("--type", dest="ban_type", default=None,
                       choices=["user", "key"],
                       help="Тип цели: user или key")
    p_ban.add_argument("--name", dest="ban_name", default=None,
                       help="Имя цели (username для user, key_prefix для key)")
    p_ban.add_argument("--reason", dest="ban_reason", default="",
                       help="Причина бана/снятия")
    p_ban.add_argument("--duration", dest="ban_duration", type=int, default=None,
                       help="Длительность бана в минутах (0 или отсутствие = permanent)")
    p_ban.add_argument("--active", action="store_true",
                       help="Только активные баны")
    p_ban.add_argument("--limit", type=int, default=200,
                       help="Лимит записей для list (по умолчанию: 200)")
    p_ban.add_argument("--older-than-days", dest="purge_days", type=int, default=90,
                       help="Удалить баны старше N дней (для purge, по умолчанию: 90)")
    p_ban.set_defaults(func=cmd_ban)

    # ssl — SSL/HTTPS сертификаты (pe-a-1.4)
    p_ssl = sub.add_parser(
        "ssl",
        help="Управление SSL сертификатами для HTTPS (pe-a-1.4)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
Подкоманды:
  ssl generate [--host NAME] [--out DIR] [--force]
                                          Сгенерировать self-signed сертификат
                                          (default: /etc/webadc/ssl/)
  ssl check                                Проверить текущую SSL конфигурацию
  ssl disable                              Отключить HTTPS (закомментировать в .env)
  ssl enable --cert FILE --key FILE        Включить HTTPS с указанными файлами

Поиск .env: ./  →  /etc/webadc/.env  →  /etc/apiadc/.env (legacy)

Примеры:
  sudo webadc ssl generate                                       # self-signed в /etc/webadc/ssl/
  sudo webadc ssl generate --host ad.example.com                 # для конкретного hostname
  sudo webadc ssl generate --out /etc/ssl                        # в другую директорию
  webadc ssl check                                               # проверить конфигурацию
  webadc ssl disable                                             # отключить HTTPS
  webadc ssl enable --cert /path/c.crt --key /path/c.key         # включить с готовым cert

Auto-mode в webadc run:
  Если SSL_CERTFILE/SSL_KEYFILE прописаны в .env, но файлов нет —
  webadc run предложит сгенерировать self-signed автоматически.
""",
    )
    p_ssl.add_argument("ssl_cmd", choices=["generate", "check", "disable", "enable"],
                       help="Подкоманда ssl")
    p_ssl.add_argument("--host", default=None,
                       help="Hostname для сертификата (default: текущий hostname)")
    p_ssl.add_argument("--out", default=None,
                       help="Директория вывода (default: /etc/webadc/ssl)")
    p_ssl.add_argument("--cert", default=None,
                       help="Путь к сертификату (для enable)")
    p_ssl.add_argument("--key", default=None,
                       help="Путь к ключу (для enable)")
    p_ssl.add_argument("--force", action="store_true",
                       help="Перезаписать существующие файлы (для generate)")
    p_ssl.set_defaults(func=cmd_ssl)

    # sqldb — Единый DB-слой (SQLAlchemy + Alembic + DuckDB)
    p_sqldb = sub.add_parser(
        "sqldb",
        help="Единый DB-слой: SQLite/PostgreSQL через DB_URL (pe-a-1.4)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
Подкоманды (pe-a-1.4 — SQLAlchemy + Alembic + DuckDB):
  webadc sqldb init                       создать схему + seed admin/admin
  webadc sqldb upgrade                    alembic upgrade head (auto-stamp если init уже создал таблицы)
  webadc sqldb downgrade <rev>            alembic downgrade <rev>
  webadc sqldb stamp [rev]                пометить миграцию применённой без SQL (по умолч. head)
  webadc sqldb revision -m "msg"          alembic revision -m "msg" --autogenerate
  webadc sqldb current                    текущая применённая миграция
  webadc sqldb history                    история миграций
  webadc sqldb shell                       Python REPL с engine, Session, Base, models
  webadc sqldb info                        показать DB_URL, engine, список таблиц
  webadc sqldb stats                       количество строк в каждой таблице (DuckDB если доступен)
  webadc sqldb status                      обзор БД (DB_URL, размер, миграции, top-10 таблиц)
  webadc sqldb query "SELECT ..."          read-only SQL через DuckDB
  webadc sqldb show <table> <id>          показать запись по PK
  webadc sqldb purge <table>              очистить таблицу (с подтверждением)
  webadc sqldb keys                        список API-ключей
  webadc sqldb audit [--limit N]          последние записи аудита

Подкоманды pe-a-1.4 — Сериализация (dump/restore/transfer):
  webadc sqldb dump [--out F] [--tables t1,t2]   Дамп текущей БД в JSONL
  webadc sqldb dump-info --in F                  Инфо о JSONL-дампе (без БД)
  webadc sqldb list-dumps                        Список доступных *.jsonl в текущей директории
  webadc sqldb restore --in F [--on-conflict MODE] [--dry-run]
                                                   Восстановить из JSONL
  webadc sqldb transfer --from URL --to URL [--on-conflict MODE] [--tables t1,t2] [--dry-run]
                                                   Прямое копирование между БД
  webadc sqldb test-url "URL"                    Проверить подключение к БД (без записи)

--on-conflict MODE (для transfer/restore):
  ask          спросить интерактивно (по умолчанию)
  skip         пропустить source-строку
  overwrite    удалить target-строку, вставить source
  upsert       UPDATE target-строки значениями из source
  fail         прервать при первом конфликте

Форматы URL SQLAlchemy:
  SQLite (отн.)  : sqlite:///app.db
  SQLite (абс.)  : sqlite:////var/lib/webadc/app.db          ← 4 слеша!
  PostgreSQL     : postgresql+psycopg2://USER:PASSWORD@HOST:PORT/DBNAME
  MySQL          : mysql+pymysql://USER:PASSWORD@HOST:PORT/DBNAME
  DuckDB         : duckdb:///app.duckdb

  ВАЖНО: для PostgreSQL драйвер +psycopg2 ОБЯЗАТЕЛЕН в URL.
  Спецсимволы в пароле требуют URL-encoding: p@ss → p%40ss

Примеры:
  webadc sqldb init                       # первый запуск — создаёт app.db + admin/admin
  webadc sqldb upgrade                    # применить миграции
  webadc sqldb shell                      # python REPL с engine/Session
  webadc sqldb query "SELECT COUNT(*) FROM app.mgmt_users"

  # Проверить подключение к PostgreSQL:
  webadc sqldb test-url "postgresql+psycopg2://samba_api:12345@localhost:5432/samba_api"

  # Backup текущей SQLite в JSONL:
  webadc sqldb dump --out backup.jsonl
  webadc sqldb list-dumps                  # какие дампы есть
  webadc sqldb dump-info --in backup.jsonl

  # Перенос PostgreSQL → SQLite (сначала test-url, потом transfer):
  webadc sqldb test-url "postgresql+psycopg2://samba_api:12345@localhost:5432/samba_api"
  webadc sqldb transfer \\
    --from "postgresql+psycopg2://samba_api:12345@localhost:5432/samba_api" \\
    --to "sqlite:///app.db"

  # Перенос SQLite → PostgreSQL:
  webadc sqldb transfer \\
    --from "sqlite:///app.db" \\
    --to "postgresql+psycopg2://samba_api:12345@localhost:5432/samba_api"

  # Восстановить из дампа:
  webadc sqldb restore --in backup.jsonl --mode skip       # не трогать существующие
  webadc sqldb restore --in backup.jsonl --mode overwrite  # перезаписать
  webadc sqldb restore --in backup.jsonl --dry-run         # только проверить

  # Только определённые таблицы:
  webadc sqldb dump --out partial.jsonl --tables mgmt_users,mgmt_roles
  webadc sqldb transfer --from "sqlite:///app.db" --to "sqlite:///copy.db" --tables mgmt_users
""",
    )
    p_sqldb.add_argument(
        "sqldb_cmd",
        choices=["init", "upgrade", "downgrade", "revision", "stamp",
                 "current", "history", "shell", "info", "stats", "status", "query",
                 "show", "purge", "keys", "audit",
                 "dump", "restore", "transfer", "dump-info",
                 "test-url", "list-dumps"],
        help="Подкоманда sqldb",
    )
    p_sqldb.add_argument("revision_id", nargs="?", default=None,
                         help="Revision id для downgrade/stamp")
    p_sqldb.add_argument("-m", "--message", dest="revision_msg", default=None,
                         help="Сообщение для новой миграции (revision)")
    p_sqldb.add_argument("sql", nargs="?", default=None,
                         help="SQL для query (в кавычках)")
    # dump / restore / transfer options
    p_sqldb.add_argument("--out", dest="dump_out", default=None,
                         help="Путь выходного файла для dump (по умолчанию app_db_dump_<ts>.jsonl)")
    p_sqldb.add_argument("--in", dest="restore_in", default=None,
                         help="Путь JSONL-файла для restore")
    p_sqldb.add_argument("--mode", dest="restore_mode", default=None,
                         choices=["skip", "overwrite", "upsert", "fail"],
                         help="Алиас для --on-conflict (back-compat)")
    p_sqldb.add_argument("--on-conflict", dest="on_conflict", default=None,
                         choices=["ask", "skip", "overwrite", "upsert", "fail"],
                         help="Поведение при PK-конфликте: ask|skip|overwrite|upsert|fail (pe-a-1.4)")
    p_sqldb.add_argument("--dry-run", dest="dry_run", action="store_true",
                         help="Только проверить, без записи (для restore/transfer)")
    p_sqldb.add_argument("--from", dest="transfer_from", default=None,
                         help="Source URL для transfer (например postgresql+psycopg2://...)")
    p_sqldb.add_argument("--to", dest="transfer_to", default=None,
                         help="Target URL для transfer")
    p_sqldb.add_argument("--tables", dest="tables_filter", default=None,
                         help="Фильтр таблиц через запятую (для dump/transfer)")
    p_sqldb.add_argument("--limit", type=int, default=20,
                         help="Лимит записей для audit (по умолчанию: 20)")
    p_sqldb.add_argument("--yes", "-y", action="store_true", dest="auto_yes",
                         help="Auto-confirm destructive actions (purge)")
    p_sqldb.set_defaults(func=cmd_sqldb)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(0)

    rc = args.func(args)
    sys.exit(rc or 0)


if __name__ == "__main__":
    main()
