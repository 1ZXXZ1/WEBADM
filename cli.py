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
  webadc stop            — Остановить сервер
  webadc restart         — Перезапустить сервер
  webadc status          — Статус сервера (systemd + health + логи)
  webadc show            — Alias для status
  webadc ds              — DS Auth management (ds_auth.py)
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
import subprocess
import sys
import json
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# ── Constants ──────────────────────────────────────────────────────────

VERSION = "2.0.1"
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
    env_path = ENV_FILE
    if not env_path.is_file():
        # Try /etc/webadc/.env first, then /etc/apiadc/.env (legacy compat)
        env_path = Path("/etc/webadc/.env")
        if not env_path.is_file():
            env_path = Path("/etc/apiadc/.env")
    if env_path.is_file():
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
    in the temp dir. In source mode, they're next to cli.py.
    """
    _load_env()

    if _FROZEN:
        # In PyInstaller bundle, scripts are in the temp _MEIPASS dir
        script_path = Path(sys._MEIPASS) / script_name
        if not script_path.is_file():
            # Try as package data
            script_path = BASE_DIR / script_name
    else:
        script_path = BASE_DIR / script_name

    if not script_path.is_file():
        _print_err(f"Скрипт не найден: {script_name}")
        _print_info(f"Путь: {script_path}")
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
        # Verify certificate and key files exist
        from pathlib import Path as _P
        if not _P(ssl_certfile).is_file():
            _print_err(f"SSL сертификат не найден: {ssl_certfile}")
            return 1
        if not _P(ssl_keyfile).is_file():
            _print_err(f"SSL ключ не найден: {ssl_keyfile}")
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

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(0)

    rc = args.func(args)
    sys.exit(rc or 0)


if __name__ == "__main__":
    main()
