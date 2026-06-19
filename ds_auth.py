#!/usr/bin/env python3
"""
ds_auth — CLI утилита для управления аутентификацией Samba AD API.

Управление API-ключами, пользователями, ролями и правами доступа
через REST API сервера Samba AD DC Management API.

Поддерживает два режима аутентификации:
  1. JWT-токен (Authorization: Bearer) — через login + --save
  2. API-ключ (X-API-Key) — через --api-key или key create

ВНИМАНИЕ: JWT-токен и API-ключ — это РАЗНЫЕ вещи!
  - JWT-токен  → заголовок Authorization: Bearer <token>
  - API-ключ   → заголовок X-API-Key: <key>
  НЕЛЬЗЯ использовать JWT в X-API-Key!

Примеры::

    # Логин и получение JWT-токена
    python ds_auth.py login admin P@ssw0rd --save

    # Показать токен + примеры curl
    python ds_auth.py token show

    # Сгенерировать curl-команду с правильным заголовком
    python ds_auth.py token curl /api/v1/users/

    # Создать API-ключ (используя сохранённый токен)
    python ds_auth.py key create --user-id 1 --name "my-key" --role operator

    # Список API-ключей
    python ds_auth.py key list

    # Создать пользователя
    python ds_auth.py user create operator1 --password secret123 --role operator

    # Создать роль с правами
    python ds_auth.py role create dns-admin --permissions dns.zonecreate,dns.zonedelete,dns.recordcreate

    # Показать все доступные права
    python ds_auth.py perms list

    # Ротация API-ключа
    python ds_auth.py key rotate 5

    # Использование с curl (JWT):
    curl -H 'Authorization: Bearer <jwt_token>' http://localhost:8099/api/v1/users/

    # Использование с curl (API-ключ):
    curl -H 'X-API-Key: <api_key>' http://localhost:8099/api/v1/users/
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import click

# Максимальная ширина таблицы для вывода
MAX_COL_WIDTH = 50


# ═══════════════════════════════════════════════════════════════════════════
# Конфигурация и константы
# ═══════════════════════════════════════════════════════════════════════════

DEFAULT_SERVER = "http://127.0.0.1:8099"
TOKEN_FILE = Path.home() / ".ds_auth_token"
ENV_SERVER = "SAMBA_API_SERVER"
ENV_API_KEY = "SAMBA_API_KEY"


# ═══════════════════════════════════════════════════════════════════════════
# HTTP клиент
# ═══════════════════════════════════════════════════════════════════════════


class AuthClient:
    """HTTP-клиент для Management API Samba AD.

    Поддерживает аутентификацию через JWT-токен или API-ключ.
    Автоматически подставляет заголовки авторизации.
    """

    def __init__(self, base_url: str, token: Optional[str] = None, api_key: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self._token = token
        self._api_key = api_key

    @property
    def _headers(self) -> Dict[str, str]:
        """Заголовки для HTTP-запроса."""
        h = {"Content-Type": "application/json", "Accept": "application/json"}
        if self._token:
            h["Authorization"] = f"Bearer {self._token}"
        elif self._api_key:
            h["X-API-Key"] = self._api_key
        return h

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        """Выполнить HTTP-запрос и вернуть распарсенный JSON."""
        import requests as _requests

        url = f"{self.base_url}{path}"
        headers = self._headers

        # Очищаем None-значения из параметров
        params = kwargs.get("params")
        if params:
            kwargs["params"] = {k: v for k, v in params.items() if v is not None}

        try:
            resp = _requests.request(method, url, headers=headers, timeout=30, **kwargs)
        except _requests.ConnectionError:
            raise click.ClickException(f"Не удалось подключиться к серверу {self.base_url}. Проверьте, что API сервер запущен.")
        except _requests.Timeout:
            raise click.ClickException(f"Таймаут при подключении к {self.base_url}")

        try:
            data = resp.json()
        except ValueError:
            data = resp.text

        if not resp.ok:
            msg = _extract_error_msg(data)
            raise click.ClickException(f"API ошибка (HTTP {resp.status_code}): {msg}")

        return data

    def get(self, path: str, params: Optional[Dict] = None) -> Any:
        return self._request("GET", path, params=params)

    def post(self, path: str, json_body: Optional[Dict] = None, params: Optional[Dict] = None) -> Any:
        return self._request("POST", path, json=json_body, params=params)

    def put(self, path: str, json_body: Optional[Dict] = None, params: Optional[Dict] = None) -> Any:
        return self._request("PUT", path, json=json_body, params=params)

    def delete(self, path: str, params: Optional[Dict] = None) -> Any:
        return self._request("DELETE", path, params=params)


# ═══════════════════════════════════════════════════════════════════════════
# Вспомогательные функции
# ═══════════════════════════════════════════════════════════════════════════


def _load_token() -> Optional[str]:
    """Загрузить сохранённый JWT-токен из файла."""
    if TOKEN_FILE.is_file():
        try:
            data = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
            token = data.get("access_token")
            expires = data.get("expires_at")
            if token and expires:
                if datetime.fromisoformat(expires) > datetime.now():
                    return token
                click.secho("Токен истёк, необходим повторный логин", fg="yellow", err=True)
            elif token:
                return token
        except (json.JSONDecodeError, ValueError, OSError):
            pass
    return None


def _save_token(response: Dict[str, Any]) -> None:
    """Сохранить JWT-токен и метаданные в файл."""
    from datetime import timedelta

    access = response.get("access_token", "")
    refresh = response.get("refresh_token", "")
    expires_in = response.get("expires_in", 1800)
    role = response.get("role", "")
    permissions = response.get("permissions", [])

    data = {
        "access_token": access,
        "refresh_token": refresh,
        "expires_at": (datetime.now() + timedelta(seconds=expires_in)).isoformat(),
        "role": role,
        "permissions": permissions,
    }
    TOKEN_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.chmod(str(TOKEN_FILE), 0o600)
    click.secho(f"Токен сохранён в {TOKEN_FILE}", fg="green", err=True)


def _get_client(ctx: click.Context) -> AuthClient:
    """Получить AuthClient из контекста."""
    obj = ctx.obj
    if isinstance(obj, dict) and "client" in obj:
        return obj["client"]
    # Фолбэк: поиск по родительским контекстам
    parent = ctx.parent
    while parent is not None:
        if isinstance(parent.obj, dict) and "client" in parent.obj:
            return parent.obj["client"]
        parent = parent.parent
    raise click.ClickException("Ошибка: не удалось найти API-клиент. Запустите команду из корня ds_auth.")  # type: ignore


def _out_json(data: Any) -> None:
    """Вывести JSON с отступами."""
    click.echo(json.dumps(data, indent=2, sort_keys=True, default=str, ensure_ascii=False))


def _truncate(text: str, max_len: int = MAX_COL_WIDTH) -> str:
    """Обрезать длинный текст с добавлением '...'."""
    if len(text) <= max_len:
        return text
    return text[: max_len - 3] + "..."


def _print_table(headers: List[str], rows: List[List[str]], title: Optional[str] = None) -> None:
    """Вывести данные в виде таблицы с выравниванием."""
    if title:
        click.secho(f"\n  {title}", fg="cyan", bold=True)
        click.echo()

    if not rows:
        click.secho("  (нет данных)", fg="yellow")
        return

    # Вычисляем ширину колонок
    col_widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            if i < len(col_widths):
                col_widths[i] = max(col_widths[i], min(len(cell), MAX_COL_WIDTH))

    # Ограничиваем максимальную ширину
    col_widths = [min(w, MAX_COL_WIDTH) for w in col_widths]

    # Заголовок
    header_line = "  ".join(h.ljust(w) for h, w in zip(headers, col_widths))
    click.secho(f"  {header_line}", bold=True)
    click.echo(f"  {'-' * len(header_line)}")

    # Строки
    for row in rows:
        cells = []
        for i, cell in enumerate(row):
            if i < len(col_widths):
                cells.append(_truncate(cell).ljust(col_widths[i]))
        click.echo(f"  {'  '.join(cells)}")

    click.echo(f"  Всего: {len(rows)} записей")
    click.echo()


def _extract_error_msg(data: Any) -> str:
    """Извлечь понятное сообщение об ошибке из ответа API.
    
    FastAPI может возвращать detail как:
    - dict с ключом "detail" (который может быть dict, list или str)
    - list ошибок валидации
    - plain string
    """
    if isinstance(data, dict):
        detail = data.get("detail", data.get("message", data.get("error")))
        if detail is None:
            return json.dumps(data, ensure_ascii=False)
        if isinstance(detail, str):
            return detail
        if isinstance(detail, dict):
            return detail.get("message", detail.get("msg", json.dumps(detail, ensure_ascii=False)))
        if isinstance(detail, list):
            # FastAPI validation errors: [{"type":"...", "loc":[...], "msg":"..."}]
            parts = []
            for item in detail:
                if isinstance(item, dict):
                    loc = " → ".join(str(l) for l in item.get("loc", []))
                    msg = item.get("msg", str(item))
                    parts.append(f"{loc}: {msg}" if loc else msg)
                else:
                    parts.append(str(item))
            return "; ".join(parts) if parts else str(data)
        return str(detail)
    elif isinstance(data, list):
        parts = []
        for item in data:
            if isinstance(item, dict):
                loc = " → ".join(str(l) for l in item.get("loc", []))
                msg = item.get("msg", str(item))
                parts.append(f"{loc}: {msg}" if loc else msg)
            else:
                parts.append(str(item))
        return "; ".join(parts) if parts else str(data)
    return str(data)


# ═══════════════════════════════════════════════════════════════════════════
# Загрузка .env
# ═══════════════════════════════════════════════════════════════════════════


def _load_dotenv() -> None:
    """Загрузить переменные из .env файла."""
    env_path = Path(".env")
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv()


# ═══════════════════════════════════════════════════════════════════════════
# Корневая группа
# ═══════════════════════════════════════════════════════════════════════════


@click.group()
@click.option(
    "--server",
    default=DEFAULT_SERVER,
    envvar=ENV_SERVER,
    show_default=True,
    help="URL сервера Samba AD API.",
)
@click.option(
    "--api-key",
    required=False,
    envvar=ENV_API_KEY,
    help="API-ключ (альтернатива JWT-токену).",
)
@click.option(
    "--token",
    required=False,
    help="JWT-токен (перезаписывает сохранённый).",
)
@click.option(
    "--json-output",
    is_flag=True,
    default=False,
    help="Выводить только JSON без форматирования.",
)
@click.pass_context
def cli(ctx: click.Context, server: str, api_key: Optional[str], token: Optional[str], json_output: bool) -> None:
    """ds_auth — управление аутентификацией Samba AD API.

    Утилита для управления API-ключами, пользователями, ролями
    и правами доступа сервера Samba AD DC Management API.

    \b
    Способы аутентификации:
      1. JWT-токен: выполните 'login --save' для получения токена
      2. API-ключ: передайте через --api-key или SAMBA_API_KEY

    \b
    ВНИМАНИЕ: JWT ≠ API-ключ!
      JWT  → Authorization: Bearer <token> (из login)
      Ключ → X-API-Key: <key> (из key create)

    \b
    Рекомендуется: login --save + token show/curl
    """
    # Приоритет: --token > сохранённый > --api-key
    effective_token = token or _load_token()
    client = AuthClient(base_url=server, token=effective_token, api_key=api_key)
    # Храним всё в ctx.obj как dict, чтобы не терялось между подкомандами
    ctx.obj = {"client": client, "json_output": json_output}


def _is_json(ctx: click.Context) -> bool:
    obj = ctx.obj
    if isinstance(obj, dict):
        return obj.get("json_output", False)
    parent = ctx.parent
    while parent is not None:
        if isinstance(parent.obj, dict):
            return parent.obj.get("json_output", False)
        parent = parent.parent
    return False


# ═══════════════════════════════════════════════════════════════════════════
# LOGIN — аутентификация
# ═══════════════════════════════════════════════════════════════════════════


@cli.command("login", help="Аутентификация и получение JWT-токена.")
@click.argument("username")
@click.argument("password")
@click.option("--save", is_flag=True, default=False, help="Сохранить токен в файл (~/.ds_auth_token).")
@click.pass_context
def login_cmd(ctx: click.Context, username: str, password: str, save: bool) -> None:
    """Войти в систему по логину/паролю и получить JWT-токен."""
    client = _get_client(ctx)
    import requests as _requests

    try:
        resp, approach = _try_login_request(client.base_url, username, password)
    except _requests.ConnectionError:
        raise click.ClickException(f"Не удалось подключиться к серверу {client.base_url}. Проверьте, что API сервер запущен.")
    except _requests.Timeout:
        raise click.ClickException(f"Таймаут при подключении к {client.base_url}")

    if resp is None:
        raise click.ClickException(f"Не удалось подключиться к серверу {client.base_url}.")

    try:
        data = resp.json()
    except ValueError:
        raise click.ClickException(f"Неожиданный ответ сервера: {resp.text}")

    if not resp.ok:
        msg = _extract_error_msg(data)
        raise click.ClickException(f"Ошибка логина (HTTP {resp.status_code}): {msg}")

    # Выводим информацию о токене
    click.secho("\n  Аутентификация успешна!", fg="green", bold=True)
    click.echo(f"  Пользователь: {click.style(username, bold=True)}")
    click.echo(f"  Роль:          {click.style(data.get('role', '?'), bold=True)}")
    click.echo(f"  Expires в:     {data.get('expires_in', '?')} сек.")

    perms = data.get("permissions", [])
    if perms:
        click.echo(f"  Права:         {len(perms)} разрешений")
        if len(perms) <= 10:
            for p in perms:
                click.echo(f"    - {p}")
        else:
            for p in perms[:5]:
                click.echo(f"    - {p}")
            click.echo(f"    ... и ещё {len(perms) - 5}")

    click.echo(f"\n  Access token:  {data.get('access_token', '')[:50]}...")
    click.echo(f"  Refresh token: {data.get('refresh_token', '')[:50]}...")

    if save:
        _save_token(data)
        # Показываем как использовать JWT с curl
        access = data.get('access_token', '')
        click.echo()
        click.secho("  Использование JWT с curl:", fg="cyan")
        click.echo(f"    curl -H 'Authorization: Bearer {access[:30]}...' \\")
        click.echo(f"         http://localhost:8099/api/v1/users/")
        click.echo()
        click.secho("  Или получите API-ключ:", fg="cyan")
        click.echo(f"    ds_auth.py key create --user-id 1 -n mykey -r admin")
        click.echo()
    else:
        click.secho("\n  Совет: используйте --save для сохранения токена", fg="yellow")
        click.echo("  Использование JWT с curl:")
        access = data.get('access_token', '')
        click.echo(f"    curl -H 'Authorization: Bearer <token>' http://localhost:8099/api/v1/users/")
        click.echo(f"  ВНИМАНИЕ: JWT-токен ≠ API-ключ! JWT используется через Authorization: Bearer,")
        click.echo(f"  а API-ключ — через X-API-Key (создайте через 'key create').\n")

    if _is_json(ctx):
        _out_json(data)


@cli.command("refresh", help="Обновить JWT-токен.")
@click.pass_context
def refresh_cmd(ctx: click.Context) -> None:
    """Обновить access-токен с помощью refresh-токена."""
    client = _get_client(ctx)

    # Загружаем refresh-токен
    refresh_token = None
    if TOKEN_FILE.is_file():
        try:
            data = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
            refresh_token = data.get("refresh_token")
        except (json.JSONDecodeError, OSError):
            pass

    if not refresh_token:
        raise click.ClickException("Refresh-токен не найден. Выполните login --save сначала.")

    import requests as _requests

    try:
        resp = _requests.post(
            f"{client.base_url}/api/v1/auth/refresh",
            json={"refresh_token": refresh_token},
            headers={"Content-Type": "application/json"},
            timeout=30,
        )
    except _requests.ConnectionError:
        raise click.ClickException(f"Не удалось подключиться к серверу {client.base_url}. Проверьте, что API сервер запущен.")
    except _requests.Timeout:
        raise click.ClickException(f"Таймаут при подключении к {client.base_url}")

    try:
        data = resp.json()
    except ValueError:
        raise click.ClickException(f"Неожиданный ответ: {resp.text}")

    if not resp.ok:
        raise click.ClickException(f"Ошибка обновления токена (HTTP {resp.status_code}): {data}")

    _save_token(data)
    click.secho("Токен успешно обновлён!", fg="green")

    if _is_json(ctx):
        _out_json(data)


@cli.command("whoami", help="Показать информацию о текущем пользователе.")
@click.pass_context
def whoami_cmd(ctx: click.Context) -> None:
    """Показать информацию о текущем аутентифицированном пользователе."""
    client = _get_client(ctx)

    # Проверяем, есть ли сохранённый токен
    has_token = False
    auth_type = "не определён"
    if TOKEN_FILE.is_file():
        try:
            data = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
            click.secho("\n  Информация о токене:", fg="cyan", bold=True)
            click.echo(f"  Роль:          {data.get('role', '?')}")
            click.echo(f"  Истекает:      {data.get('expires_at', '?')}")
            perms = data.get("permissions", [])
            click.echo(f"  Права:         {len(perms)} разрешений")
            has_token = True
            auth_type = "JWT Bearer"
        except (json.JSONDecodeError, OSError):
            click.secho("  Не удалось прочитать файл токена", fg="red")

    if client._api_key and not has_token:
        auth_type = "API-ключ (X-API-Key)"

    # Пробуем запрос к API — используем /health (public) для проверки
    # доступности и /api/v1/mgmt/users для проверки авторизации
    import requests as _requests
    try:
        resp = _requests.get(f"{client.base_url}/health", timeout=5)
        if resp.ok:
            click.secho("\n  Сервер: доступен", fg="green")
        else:
            click.secho(f"\n  Сервер: ошибка (HTTP {resp.status_code})", fg="red")
    except (_requests.ConnectionError, _requests.Timeout):
        click.secho("\n  Сервер: НЕДОСТУПЕН", fg="red", bold=True)
        return

    # Проверяем авторизацию через mgmt API
    if client._token or client._api_key:
        try:
            client.get("/api/v1/mgmt/users", params={"limit": 1})
            click.secho(f"  Авторизация:  ОК ({auth_type})", fg="green")
        except click.ClickException as e:
            click.secho(f"  Авторизация:  ОШИБКА ({e})", fg="red")
    else:
        click.secho("  Авторизация:  не настроена (выполните login или укажите --api-key)", fg="yellow")


# ═══════════════════════════════════════════════════════════════════════════
# USER — управление пользователями
# ═══════════════════════════════════════════════════════════════════════════


@cli.group("user", help="Управление пользователями API.")
@click.pass_context
def user_grp(ctx: click.Context) -> None:
    """Управление пользователями Management API."""
    pass


@user_grp.command("list", help="Список пользователей.")
@click.option("--role", default=None, help="Фильтр по роли.")
@click.option("--active", type=bool, default=None, help="Фильтр по активности (true/false).")
@click.option("--search", "-s", default=None, help="Поиск по username/full_name/email.")
@click.option("--offset", default=0, help="Смещение пагинации.")
@click.option("--limit", default=100, help="Размер страницы.")
@click.pass_context
def user_list(ctx: click.Context, role: Optional[str], active: Optional[bool], search: Optional[str], offset: int, limit: int) -> None:
    """Показать список пользователей Management API."""
    client = _get_client(ctx)
    result = client.get("/api/v1/mgmt/users", params={"role": role, "is_active": active, "search": search, "offset": offset, "limit": limit})

    if _is_json(ctx):
        _out_json(result)
        return

    users = result.get("data", [])
    if isinstance(users, dict) and "users" in users:
        users = users["users"]
    elif isinstance(users, dict) and "items" in users:
        users = users["items"]

    rows = []
    for u in users:
        if isinstance(u, dict):
            rows.append([
                str(u.get("id", "")),
                str(u.get("username", "")),
                str(u.get("role", "")),
                str(u.get("full_name", "")),
                str(u.get("email", "")),
                "Да" if u.get("is_active", True) else "Нет",
                str(u.get("weight", 0)),
                str(u.get("last_login_at", "") or "")[:19],
            ])

    _print_table(
        ["ID", "Логин", "Роль", "Имя", "Email", "Активен", "Вес", "Посл. вход"],
        rows,
        title="Пользователи API",
    )


@user_grp.command("create", help="Создать пользователя.")
@click.argument("username")
@click.option("--password", "-p", required=True, help="Пароль.")
@click.option("--role", "-r", default="operator", show_default=True, help="Роль (admin, operator, auditor, кастомная).")
@click.option("--full-name", default=None, help="Полное имя.")
@click.option("--email", default=None, help="Email.")
@click.option("--weight", "-w", type=int, default=0, show_default=True, help="Вес/приоритет (выше = важнее).")
@click.pass_context
def user_create(ctx: click.Context, username: str, password: str, role: str, full_name: Optional[str], email: Optional[str], weight: int) -> None:
    """Создать нового пользователя Management API."""
    client = _get_client(ctx)
    body = {
        "username": username,
        "password": password,
        "role": role,
        "full_name": full_name or "",
        "email": email or "",
        "weight": weight,
    }
    result = client.post("/api/v1/mgmt/users", json_body=body)

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho(f"\n  Пользователь '{username}' создан!", fg="green", bold=True)
    data = result.get("data", {})
    if isinstance(data, dict):
        click.echo(f"  ID:   {data.get('id', '?')}")
        click.echo(f"  Роль: {data.get('role', role)}")
        click.echo(f"  Вес:  {data.get('weight', weight)}")


@user_grp.command("show", help="Показать пользователя.")
@click.argument("user_id", type=int)
@click.pass_context
def user_show(ctx: click.Context, user_id: int) -> None:
    """Показать информацию о пользователе по ID."""
    client = _get_client(ctx)
    result = client.get(f"/api/v1/mgmt/users/{user_id}")

    if _is_json(ctx):
        _out_json(result)
        return

    data = result.get("data", {})
    if isinstance(data, dict):
        click.secho(f"\n  Пользователь #{user_id}", fg="cyan", bold=True)
        for k, v in data.items():
            click.echo(f"  {k}: {v}")


@user_grp.command("edit", help="Редактировать пользователя.")
@click.argument("user_id", type=int)
@click.option("--username", default=None, help="Новый логин.")
@click.option("--password", default=None, help="Новый пароль.")
@click.option("--role", default=None, help="Новая роль.")
@click.option("--full-name", default=None, help="Новое полное имя.")
@click.option("--email", default=None, help="Новый email.")
@click.option("--active/--inactive", default=None, help="Активировать/деактивировать.")
@click.option("--weight", "-w", type=int, default=None, help="Новый вес/приоритет.")
@click.pass_context
def user_edit(ctx: click.Context, user_id: int, username: Optional[str], password: Optional[str], role: Optional[str], full_name: Optional[str], email: Optional[str], active: Optional[bool], weight: Optional[int]) -> None:
    """Редактировать атрибуты пользователя Management API."""
    client = _get_client(ctx)
    body: Dict[str, Any] = {}
    if username is not None:
        body["username"] = username
    if password is not None:
        body["password"] = password
    if role is not None:
        body["role"] = role
    if full_name is not None:
        body["full_name"] = full_name
    if email is not None:
        body["email"] = email
    if active is not None:
        body["is_active"] = active
    if weight is not None:
        body["weight"] = weight

    if not body:
        raise click.ClickException("Укажите хотя бы одно поле для обновления.")

    result = client.put(f"/api/v1/mgmt/users/{user_id}", json_body=body)

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho(f"\n  Пользователь #{user_id} обновлён!", fg="green", bold=True)


@user_grp.command("delete", help="Удалить пользователя (по умолчанию мягко).")
@click.argument("user_id", type=int)
@click.option("--hard", is_flag=True, help="Жёсткое удаление (безвозвратно).")
@click.option("--confirm", is_flag=True, help="Подтвердить удаление.")
@click.pass_context
def user_delete(ctx: click.Context, user_id: int, hard: bool, confirm: bool) -> None:
    """Удалить пользователя Management API.

    Без --hard: мягкое удаление (is_active=FALSE, ключи деактивируются).
    С --hard: безвозвратное удаление строки и всех его API-ключей (CASCADE).
    """
    action = "безвозвратно удалить" if hard else "деактивировать"
    if not confirm:
        click.confirm(f"{action.capitalize()} пользователя #{user_id}?", abort=True)

    client = _get_client(ctx)
    result = client.delete(f"/api/v1/mgmt/users/{user_id}", params={"hard": "true" if hard else "false"})

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho(f"\n  Пользователь #{user_id} {action}!", fg="green", bold=True)


@user_grp.command("enable", help="Включить пользователя (is_active=TRUE).")
@click.argument("user_id", type=int)
@click.pass_context
def user_enable(ctx: click.Context, user_id: int) -> None:
    """Активировать ранее отключённого пользователя."""
    client = _get_client(ctx)
    result = client.post(f"/api/v1/mgmt/users/{user_id}/enable")

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho(f"\n  Пользователь #{user_id} включён!", fg="green", bold=True)
    click.secho("  Примечание: API-ключи пользователя НЕ активируются автоматически.", fg="yellow")


@user_grp.command("disable", help="Отключить пользователя (мягко, с ключами).")
@click.argument("user_id", type=int)
@click.pass_context
def user_disable(ctx: click.Context, user_id: int) -> None:
    """Отключить пользователя и все его API-ключи (мягко)."""
    client = _get_client(ctx)
    result = client.post(f"/api/v1/mgmt/users/{user_id}/disable")

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho(f"\n  Пользователь #{user_id} отключён (включая все его API-ключи)!", fg="green", bold=True)


@user_grp.command("purge", help="Безвозвратно удалить пользователя.")
@click.argument("user_id", type=int)
@click.option("--confirm", is_flag=True, help="Подтвердить безвозвратное удаление.")
@click.pass_context
def user_purge(ctx: click.Context, user_id: int, confirm: bool) -> None:
    """Безвозвратно удалить пользователя и все его API-ключи (CASCADE)."""
    if not confirm:
        click.confirm(f"БЕЗВОЗВРАТНО удалить пользователя #{user_id} и все его API-ключи?", abort=True)

    client = _get_client(ctx)
    result = client.post(f"/api/v1/mgmt/users/{user_id}/purge")

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho(f"\n  Пользователь #{user_id} безвозвратно удалён!", fg="red", bold=True)


@user_grp.command("reset-password", help="Сбросить пароль пользователя.")
@click.argument("user_id", type=int)
@click.option("--password", "-p", default=None, help="Новый пароль. Если не указан — генерируется случайный.")
@click.pass_context
def user_reset_password(ctx: click.Context, user_id: int, password: Optional[str]) -> None:
    """Сбросить пароль пользователя.

    Если --password не указан, сервер сгенерирует случайный пароль и вернёт его.
    """
    client = _get_client(ctx)
    body = {"new_password": password} if password else {}
    result = client.post(f"/api/v1/mgmt/users/{user_id}/reset-password", json_body=body)

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho(f"\n  Пароль пользователя #{user_id} сброшен!", fg="green", bold=True)
    data = result.get("data") or {}
    new_pw = data.get("new_password") if isinstance(data, dict) else None
    if new_pw:
        click.secho(f"  Новый сгенерированный пароль: {new_pw}", fg="cyan", bold=True)
        click.secho("  ВНИМАНИЕ: пароль показывается только один раз!", fg="yellow", bold=True)


@user_grp.command("keys", help="Показать API-ключи пользователя.")
@click.argument("user_id", type=int)
@click.option("--include-inactive", is_flag=True, help="Включая отключённые ключи.")
@click.pass_context
def user_keys(ctx: click.Context, user_id: int, include_inactive: bool) -> None:
    """Показать все API-ключи указанного пользователя."""
    client = _get_client(ctx)
    result = client.get(
        f"/api/v1/mgmt/users/{user_id}/keys",
        params={"include_inactive": "true" if include_inactive else "false"},
    )

    if _is_json(ctx):
        _out_json(result)
        return

    keys = result.get("data", [])
    if isinstance(keys, dict) and "keys" in keys:
        keys = keys["keys"]

    rows = []
    for k in keys:
        if isinstance(k, dict):
            rows.append([
                str(k.get("id", "")),
                str(k.get("name", "")),
                str(k.get("role", "")),
                "Да" if k.get("is_active", True) else "Нет",
                str(k.get("weight", 0)),
                str(k.get("expires_at", "никогда"))[:19],
                str(k.get("created_at", ""))[:19],
            ])

    _print_table(
        ["ID", "Имя", "Роль", "Активен", "Вес", "Истекает", "Создан"],
        rows,
        title=f"API-ключи пользователя #{user_id}",
    )


# ═══════════════════════════════════════════════════════════════════════════
# KEY — управление API-ключами
# ═══════════════════════════════════════════════════════════════════════════


@cli.group("key", help="Управление API-ключами.")
@click.pass_context
def key_grp(ctx: click.Context) -> None:
    """Управление API-ключами."""
    pass


@key_grp.command("list", help="Список API-ключей.")
@click.option("--user-id", type=int, default=None, help="Фильтр по ID пользователя.")
@click.option("--active", type=bool, default=None, help="Фильтр по активности.")
@click.option("--search", "-s", default=None, help="Поиск по name/description.")
@click.option("--offset", default=0, help="Смещение пагинации.")
@click.option("--limit", default=100, help="Размер страницы.")
@click.pass_context
def key_list(ctx: click.Context, user_id: Optional[int], active: Optional[bool], search: Optional[str], offset: int, limit: int) -> None:
    """Показать список API-ключей."""
    client = _get_client(ctx)
    result = client.get("/api/v1/mgmt/keys", params={"user_id": user_id, "is_active": active, "search": search, "offset": offset, "limit": limit})

    if _is_json(ctx):
        _out_json(result)
        return

    keys = result.get("data", [])
    if isinstance(keys, dict) and "keys" in keys:
        keys = keys["keys"]
    elif isinstance(keys, dict) and "items" in keys:
        keys = keys["items"]

    rows = []
    for k in keys:
        if isinstance(k, dict):
            rows.append([
                str(k.get("id", "")),
                str(k.get("name", "")),
                str(k.get("user_id", "")),
                str(k.get("role", "")),
                "Да" if k.get("is_active", True) else "Нет",
                str(k.get("weight", 0)),
                str(k.get("expires_at", "никогда"))[:19],
                str(k.get("created_at", ""))[:19],
            ])

    _print_table(
        ["ID", "Имя", "User ID", "Роль", "Активен", "Вес", "Истекает", "Создан"],
        rows,
        title="API-ключи",
    )


@key_grp.command("create", help="Создать API-ключ.")
@click.option("--user-id", type=int, required=True, help="ID пользователя.")
@click.option("--name", "-n", required=True, help="Название/описание ключа.")
@click.option("--role", "-r", default="operator", show_default=True, help="Роль ключа.")
@click.option("--expires-days", type=int, default=None, help="Дней до истечения (без лимита если не указано).")
@click.option("--weight", "-w", type=int, default=0, show_default=True, help="Вес/приоритет ключа.")
@click.option("--description", "-d", default="", help="Длинное описание ключа.")
@click.pass_context
def key_create(ctx: click.Context, user_id: int, name: str, role: str, expires_days: Optional[int], weight: int, description: str) -> None:
    """Создать новый API-ключ. ПРИМЕЧАНИЕ: ключ показывается только один раз!"""
    client = _get_client(ctx)
    body = {
        "user_id": user_id,
        "name": name,
        "role": role,
        "weight": weight,
        "description": description,
    }
    if expires_days is not None:
        body["expires_days"] = expires_days
    result = client.post("/api/v1/mgmt/keys", json_body=body)

    if _is_json(ctx):
        _out_json(result)
        return

    data = result.get("data", {})
    raw_key = data.get("key", "") if isinstance(data, dict) else ""

    click.secho("\n  API-ключ создан!", fg="green", bold=True)
    click.secho(f"  ВНИМАНИЕ: ключ показывается только один раз!", fg="yellow", bold=True)
    click.echo()
    click.secho(f"  Ключ: {raw_key}", fg="cyan", bold=True)
    click.echo()
    click.echo(f"  Использование (API-ключ, НЕ JWT!):")
    click.echo(f"    curl -H 'X-API-Key: {raw_key}' http://localhost:8099/api/v1/users/")
    click.echo(f"    export SAMBA_API_KEY={raw_key}")
    click.echo()
    click.secho(f"  Разница:", fg="yellow")
    click.echo(f"    API-ключ   → X-API-Key: <key>               (этот ключ)")
    click.echo(f"    JWT-токен  → Authorization: Bearer <token>  (из login)")
    click.echo()


@key_grp.command("show", help="Показать детали API-ключа.")
@click.argument("key_id", type=int)
@click.pass_context
def key_show(ctx: click.Context, key_id: int) -> None:
    """Показать информацию об API-ключе по ID."""
    client = _get_client(ctx)
    result = client.get(f"/api/v1/mgmt/keys/{key_id}")

    if _is_json(ctx):
        _out_json(result)
        return

    data = result.get("data", {})
    if isinstance(data, dict):
        click.secho(f"\n  API-ключ #{key_id}", fg="cyan", bold=True)
        for k, v in data.items():
            click.echo(f"  {k}: {v}")


@key_grp.command("edit", help="Редактировать API-ключ.")
@click.argument("key_id", type=int)
@click.option("--name", default=None, help="Новое название.")
@click.option("--role", default=None, help="Новая роль.")
@click.option("--active/--inactive", default=None, help="Активировать/деактивировать.")
@click.option("--expires-days", type=int, default=None, help="Сбросить срок действия (дней от сейчас).")
@click.option("--weight", "-w", type=int, default=None, help="Новый вес/приоритет.")
@click.option("--description", "-d", default=None, help="Новое описание.")
@click.pass_context
def key_edit(ctx: click.Context, key_id: int, name: Optional[str], role: Optional[str], active: Optional[bool], expires_days: Optional[int], weight: Optional[int], description: Optional[str]) -> None:
    """Редактировать атрибуты API-ключа."""
    client = _get_client(ctx)
    body: Dict[str, Any] = {}
    if name is not None:
        body["name"] = name
    if role is not None:
        body["role"] = role
    if active is not None:
        body["is_active"] = active
    if expires_days is not None:
        body["expires_days"] = expires_days
    if weight is not None:
        body["weight"] = weight
    if description is not None:
        body["description"] = description

    if not body:
        raise click.ClickException("Укажите хотя бы одно поле для обновления.")

    result = client.put(f"/api/v1/mgmt/keys/{key_id}", json_body=body)

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho(f"\n  API-ключ #{key_id} обновлён!", fg="green", bold=True)


@key_grp.command("delete", help="Удалить API-ключ (по умолчанию мягко).")
@click.argument("key_id", type=int)
@click.option("--hard", is_flag=True, help="Жёсткое удаление (безвозвратно).")
@click.option("--confirm", is_flag=True, help="Подтвердить удаление.")
@click.pass_context
def key_delete(ctx: click.Context, key_id: int, hard: bool, confirm: bool) -> None:
    """Удалить API-ключ.

    Без --hard: мягкое удаление (is_active=FALSE).
    С --hard: безвозвратное удаление строки.
    """
    action = "безвозвратно удалить" if hard else "деактивировать"
    if not confirm:
        click.confirm(f"{action.capitalize()} API-ключ #{key_id}?", abort=True)

    client = _get_client(ctx)
    result = client.delete(f"/api/v1/mgmt/keys/{key_id}", params={"hard": "true" if hard else "false"})

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho(f"\n  API-ключ #{key_id} {action}!", fg="green", bold=True)


@key_grp.command("enable", help="Включить API-ключ.")
@click.argument("key_id", type=int)
@click.pass_context
def key_enable(ctx: click.Context, key_id: int) -> None:
    """Активировать ранее отключённый API-ключ.

    Пользователь-владелец должен быть активен.
    """
    client = _get_client(ctx)
    result = client.post(f"/api/v1/mgmt/keys/{key_id}/enable")

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho(f"\n  API-ключ #{key_id} включён!", fg="green", bold=True)


@key_grp.command("disable", help="Отключить API-ключ (мягко).")
@click.argument("key_id", type=int)
@click.pass_context
def key_disable(ctx: click.Context, key_id: int) -> None:
    """Деактивировать API-ключ (мягко)."""
    client = _get_client(ctx)
    result = client.post(f"/api/v1/mgmt/keys/{key_id}/disable")

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho(f"\n  API-ключ #{key_id} отключён!", fg="green", bold=True)


@key_grp.command("purge", help="Безвозвратно удалить API-ключ.")
@click.argument("key_id", type=int)
@click.option("--confirm", is_flag=True, help="Подтвердить безвозвратное удаление.")
@click.pass_context
def key_purge(ctx: click.Context, key_id: int, confirm: bool) -> None:
    """Безвозвратно удалить API-ключ."""
    if not confirm:
        click.confirm(f"БЕЗВОЗВРАТНО удалить API-ключ #{key_id}?", abort=True)

    client = _get_client(ctx)
    result = client.post(f"/api/v1/mgmt/keys/{key_id}/purge")

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho(f"\n  API-ключ #{key_id} безвозвратно удалён!", fg="red", bold=True)


@key_grp.command("rotate", help="Ротация API-ключа (старый деактивируется, новый создаётся).")
@click.argument("key_id", type=int)
@click.pass_context
def key_rotate(ctx: click.Context, key_id: int) -> None:
    """Ротация API-ключа: старый ключ деактивируется, создаётся новый с теми же настройками."""
    client = _get_client(ctx)
    result = client.post(f"/api/v1/mgmt/keys/{key_id}/rotate")

    if _is_json(ctx):
        _out_json(result)
        return

    data = result.get("data", {})
    raw_key = data.get("key", "") if isinstance(data, dict) else ""

    click.secho(f"\n  API-ключ #{key_id} ротирован!", fg="green", bold=True)
    click.secho("  ВНИМАНИЕ: новый ключ показывается только один раз!", fg="yellow", bold=True)
    click.echo()
    click.secho(f"  Новый ключ: {raw_key}", fg="cyan", bold=True)
    click.echo()


# ═══════════════════════════════════════════════════════════════════════════
# ROLE — управление ролями
# ═══════════════════════════════════════════════════════════════════════════


@cli.group("role", help="Управление ролями.")
@click.pass_context
def role_grp(ctx: click.Context) -> None:
    """Управление ролями и назначением прав."""
    pass


@role_grp.command("list", help="Список всех ролей.")
@click.option("--hide-disabled", is_flag=True, help="Скрыть отключённые роли.")
@click.pass_context
def role_list(ctx: click.Context, hide_disabled: bool) -> None:
    """Показать список всех ролей с их правами."""
    client = _get_client(ctx)
    result = client.get(
        "/api/v1/mgmt/roles",
        params={"include_disabled": "false" if hide_disabled else "true"},
    )

    if _is_json(ctx):
        _out_json(result)
        return

    roles = result.get("data", [])
    if isinstance(roles, dict) and "roles" in roles:
        roles = roles["roles"]
    elif isinstance(roles, dict) and "items" in roles:
        roles = roles["items"]

    rows = []
    for r in roles:
        if isinstance(r, dict):
            perms = r.get("permissions", [])
            perm_count = len(perms) if isinstance(perms, list) else 0
            builtin = "Да" if r.get("is_builtin", r.get("name") in ("admin", "operator", "auditor")) else "Нет"
            active = "Да" if r.get("is_active", 1) else "Нет"
            rows.append([
                str(r.get("name", "")),
                str(r.get("description", "")),
                str(perm_count),
                builtin,
                active,
                str(r.get("weight", 0)),
            ])

    _print_table(
        ["Роль", "Описание", "Кол-во прав", "Встроенная", "Активна", "Вес"],
        rows,
        title="Роли",
    )


@role_grp.command("show", help="Показать детали роли.")
@click.argument("role_name")
@click.pass_context
def role_show(ctx: click.Context, role_name: str) -> None:
    """Показать информацию о роли со списком всех прав."""
    client = _get_client(ctx)
    result = client.get(f"/api/v1/mgmt/roles/{role_name}")

    if _is_json(ctx):
        _out_json(result)
        return

    data = result.get("data", {})
    if isinstance(data, dict):
        click.secho(f"\n  Роль: {role_name}", fg="cyan", bold=True)
        click.echo(f"  Описание: {data.get('description', '')}")

        perms = data.get("permissions", [])
        if isinstance(perms, list):
            click.echo(f"  Права ({len(perms)}):")

            # Группируем по категории
            categories: Dict[str, List[str]] = {}
            for p in perms:
                cat = p.split(".")[0] if "." in p else "other"
                categories.setdefault(cat, []).append(p)

            for cat, cat_perms in sorted(categories.items()):
                click.secho(f"    [{cat}]", fg="yellow", bold=True)
                for p in cat_perms:
                    action = p.split(".", 1)[1] if "." in p else p
                    click.echo(f"      {action}")
        click.echo()


@role_grp.command("create", help="Создать роль.")
@click.argument("name")
@click.option("--description", "-d", default="", help="Описание роли.")
@click.option("--permissions", "-p", default=None, help="Права через запятую (например: user.create,user.delete,dns.zonecreate).")
@click.option("--permissions-file", default=None, help="Файл JSON со списком прав.")
@click.option("--weight", "-w", type=int, default=0, show_default=True, help="Вес/приоритет роли.")
@click.pass_context
def role_create(ctx: click.Context, name: str, description: str, permissions: Optional[str], permissions_file: Optional[str], weight: int) -> None:
    """Создать новую роль с указанными правами."""
    perm_list: List[str] = []

    if permissions:
        perm_list = [p.strip() for p in permissions.split(",") if p.strip()]
    elif permissions_file:
        try:
            with open(permissions_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    perm_list = data
                elif isinstance(data, dict) and "permissions" in data:
                    perm_list = data["permissions"]
        except (OSError, json.JSONDecodeError) as e:
            raise click.ClickException(f"Ошибка чтения файла прав: {e}")

    client = _get_client(ctx)
    result = client.post(
        "/api/v1/mgmt/roles",
        json_body={"name": name, "description": description, "permissions": perm_list, "weight": weight},
    )

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho(f"\n  Роль '{name}' создана!", fg="green", bold=True)
    click.echo(f"  Описание: {description}")
    click.echo(f"  Права:    {len(perm_list)} разрешений")
    click.echo(f"  Вес:      {weight}")


@role_grp.command("edit", help="Редактировать роль.")
@click.argument("role_name")
@click.option("--name", default=None, help="Новое имя роли (переименование).")
@click.option("--description", "-d", default=None, help="Новое описание.")
@click.option("--permissions", "-p", default=None, help="Полная замена прав (через запятую).")
@click.option("--add-permissions", default=None, help="Добавить права (через запятую).")
@click.option("--remove-permissions", default=None, help="Удалить права (через запятую).")
@click.option("--weight", "-w", type=int, default=None, help="Новый вес/приоритет.")
@click.pass_context
def role_edit(
    ctx: click.Context,
    role_name: str,
    name: Optional[str],
    description: Optional[str],
    permissions: Optional[str],
    add_permissions: Optional[str],
    remove_permissions: Optional[str],
    weight: Optional[int],
) -> None:
    """Редактировать роль: имя, описание, добавить/удалить права, вес."""
    client = _get_client(ctx)

    # Если нужно добавить/удалить права — сначала получаем текущие
    if add_permissions or remove_permissions:
        current = client.get(f"/api/v1/mgmt/roles/{role_name}")
        current_data = current.get("data", {})
        current_perms = set(current_data.get("permissions", [])) if isinstance(current_data, dict) else set()

        if add_permissions:
            new_perms = {p.strip() for p in add_permissions.split(",") if p.strip()}
            current_perms |= new_perms

        if remove_permissions:
            del_perms = {p.strip() for p in remove_permissions.split(",") if p.strip()}
            current_perms -= del_perms

        body: Dict[str, Any] = {"permissions": sorted(current_perms)}
        if name:
            body["name"] = name
        if description:
            body["description"] = description
        if weight is not None:
            body["weight"] = weight

        result = client.put(f"/api/v1/mgmt/roles/{role_name}", json_body=body)
    elif permissions:
        perm_list = [p.strip() for p in permissions.split(",") if p.strip()]
        body = {"permissions": perm_list}
        if name:
            body["name"] = name
        if description:
            body["description"] = description
        if weight is not None:
            body["weight"] = weight
        result = client.put(f"/api/v1/mgmt/roles/{role_name}", json_body=body)
    else:
        body = {}
        if name:
            body["name"] = name
        if description:
            body["description"] = description
        if weight is not None:
            body["weight"] = weight
        if not body:
            raise click.ClickException("Укажите хотя бы одно поле для обновления.")
        result = client.put(f"/api/v1/mgmt/roles/{role_name}", json_body=body)

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho(f"\n  Роль '{role_name}' обновлена!", fg="green", bold=True)


@role_grp.command("delete", help="Удалить роль (безвозвратно).")
@click.argument("role_name")
@click.option("--confirm", is_flag=True, help="Подтвердить удаление.")
@click.pass_context
def role_delete(ctx: click.Context, role_name: str, confirm: bool) -> None:
    """Удалить кастомную роль (встроенные роли удалить нельзя).

    Безвозвратное удаление. Если роль ещё назначена активным пользователям
    или API-ключам — сервер вернёт ошибку. Используйте `role disable`
    для мягкого отключения.
    """
    if role_name in ("admin", "operator", "auditor"):
        raise click.ClickException(f"Встроенную роль '{role_name}' нельзя удалить.")

    if not confirm:
        click.confirm(f"БЕЗВОЗВРАТНО удалить роль '{role_name}'?", abort=True)

    client = _get_client(ctx)
    result = client.delete(f"/api/v1/mgmt/roles/{role_name}")

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho(f"\n  Роль '{role_name}' удалена!", fg="green", bold=True)


@role_grp.command("enable", help="Включить роль.")
@click.argument("role_name")
@click.pass_context
def role_enable(ctx: click.Context, role_name: str) -> None:
    """Активировать ранее отключённую роль."""
    client = _get_client(ctx)
    result = client.post(f"/api/v1/mgmt/roles/{role_name}/enable")

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho(f"\n  Роль '{role_name}' включена!", fg="green", bold=True)


@role_grp.command("disable", help="Отключить роль (мягко).")
@click.argument("role_name")
@click.pass_context
def role_disable(ctx: click.Context, role_name: str) -> None:
    """Отключить роль без удаления.

    Все API-ключи с этой ролью будут отклоняться при валидации.
    Существующие JWT-сессии не затрагиваются (истекут естественным путём).
    """
    if role_name == "admin":
        raise click.ClickException("Роль 'admin' нельзя отключить (заблокирует всех пользователей).")

    client = _get_client(ctx)
    result = client.post(f"/api/v1/mgmt/roles/{role_name}/disable")

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho(f"\n  Роль '{role_name}' отключена!", fg="green", bold=True)
    click.secho("  Все API-ключи с этой ролью теперь отклоняются.", fg="yellow")


@role_grp.command("gen-key", help="Сгенерировать API-ключ для роли.")
@click.argument("role_name")
@click.option("--user-id", type=int, required=True, help="ID пользователя-владельца ключа.")
@click.option("--name", "-n", default=None, help="Название ключа (по умолчанию: 'key-for-<role>').")
@click.option("--expires-days", type=int, default=None, help="Дней до истечения.")
@click.option("--weight", "-w", type=int, default=0, show_default=True, help="Вес/приоритет ключа.")
@click.pass_context
def role_gen_key(ctx: click.Context, role_name: str, user_id: int, name: Optional[str], expires_days: Optional[int], weight: int) -> None:
    """Сгенерировать API-ключ с уже назначенной ролью.

    Удобно для быстрого создания ключа под конкретную роль без явного
    указания --role в key create.
    """
    client = _get_client(ctx)
    body: Dict[str, Any] = {
        "user_id": user_id,
        "weight": weight,
    }
    if name:
        body["name"] = name
    if expires_days is not None:
        body["expires_days"] = expires_days
    result = client.post(f"/api/v1/mgmt/roles/{role_name}/gen-key", json_body=body)

    if _is_json(ctx):
        _out_json(result)
        return

    data = result.get("data", {})
    raw_key = data.get("key", "") if isinstance(data, dict) else ""

    click.secho(f"\n  API-ключ для роли '{role_name}' создан!", fg="green", bold=True)
    click.secho("  ВНИМАНИЕ: ключ показывается только один раз!", fg="yellow", bold=True)
    click.echo()
    click.secho(f"  Ключ: {raw_key}", fg="cyan", bold=True)
    click.echo(f"  Роль: {role_name}")
    click.echo(f"  User: #{user_id}")
    click.echo()
    click.echo("  Использование:")
    click.echo(f"    export SAMBA_API_KEY={raw_key}")
    click.echo(f"    curl -H 'X-API-Key: {raw_key}' http://localhost:8099/api/v1/users/")
    click.echo()


@role_grp.command("users", help="Показать пользователей с указанной ролью.")
@click.argument("role_name")
@click.option("--include-inactive", is_flag=True, help="Включая неактивных пользователей.")
@click.pass_context
def role_users(ctx: click.Context, role_name: str, include_inactive: bool) -> None:
    """Список пользователей, которым назначена указанная роль."""
    client = _get_client(ctx)
    result = client.get(
        f"/api/v1/mgmt/roles/{role_name}/users",
        params={"include_inactive": "true" if include_inactive else "false"},
    )

    if _is_json(ctx):
        _out_json(result)
        return

    users = result.get("data", [])
    if isinstance(users, dict) and "users" in users:
        users = users["users"]

    rows = []
    for u in users:
        if isinstance(u, dict):
            rows.append([
                str(u.get("id", "")),
                str(u.get("username", "")),
                str(u.get("full_name", "")),
                str(u.get("email", "")),
                "Да" if u.get("is_active", 1) else "Нет",
                str(u.get("weight", 0)),
                str(u.get("last_login_at", "") or "")[:19],
            ])

    _print_table(
        ["ID", "Логин", "Имя", "Email", "Активен", "Вес", "Посл. вход"],
        rows,
        title=f"Пользователи с ролью '{role_name}'",
    )


@role_grp.command("keys", help="Показать API-ключи с указанной ролью.")
@click.argument("role_name")
@click.option("--include-inactive", is_flag=True, help="Включая неактивные ключи.")
@click.pass_context
def role_keys(ctx: click.Context, role_name: str, include_inactive: bool) -> None:
    """Список API-ключей, которым назначена указанная роль."""
    client = _get_client(ctx)
    result = client.get(
        f"/api/v1/mgmt/roles/{role_name}/keys",
        params={"include_inactive": "true" if include_inactive else "false"},
    )

    if _is_json(ctx):
        _out_json(result)
        return

    keys = result.get("data", [])
    if isinstance(keys, dict) and "keys" in keys:
        keys = keys["keys"]

    rows = []
    for k in keys:
        if isinstance(k, dict):
            rows.append([
                str(k.get("id", "")),
                str(k.get("name", "")),
                str(k.get("user_id", "")),
                "Да" if k.get("is_active", 1) else "Нет",
                str(k.get("weight", 0)),
                str(k.get("expires_at", "никогда"))[:19],
                str(k.get("created_at", ""))[:19],
            ])

    _print_table(
        ["ID", "Имя", "User ID", "Активен", "Вес", "Истекает", "Создан"],
        rows,
        title=f"API-ключи с ролью '{role_name}'",
    )


# ═══════════════════════════════════════════════════════════════════════════
# PERMS — управление правами
# ═══════════════════════════════════════════════════════════════════════════


@cli.group("perms", help="Просмотр и управление правами доступа.")
@click.pass_context
def perms_grp(ctx: click.Context) -> None:
    """Просмотр и назначение прав доступа."""
    pass


@perms_grp.command("list", help="Список всех доступных прав.")
@click.option("--category", "-c", default=None, help="Фильтр по категории (user, group, dns, gpo и т.д.).")
@click.option("--search", "-s", default=None, help="Поиск по названию права.")
@click.pass_context
def perms_list(ctx: click.Context, category: Optional[str], search: Optional[str]) -> None:
    """Показать все доступные права доступа (140+)."""
    client = _get_client(ctx)
    result = client.get("/api/v1/mgmt/permissions")

    if _is_json(ctx):
        _out_json(result)
        return

    categories = result.get("categories", {})
    total = result.get("total", 0)

    click.secho(f"\n  Всего прав: {total}", fg="cyan", bold=True)
    click.echo()

    for cat, perms in sorted(categories.items()):
        if category and cat != category:
            continue

        # Фильтрация по поиску
        if search:
            perms = [p for p in perms if search.lower() in p.lower()]

        if not perms:
            continue

        click.secho(f"  [{cat}] ({len(perms)})", fg="yellow", bold=True)
        for p in perms:
            action = p.split(".", 1)[1] if "." in p else p
            click.echo(f"    {action}")
        click.echo()


@perms_grp.command("assign", help="Назначить права роли.")
@click.option("--role", "-r", required=True, help="Имя роли.")
@click.option("--permissions", "-p", required=True, help="Права через запятую.")
@click.pass_context
def perms_assign(ctx: click.Context, role: str, permissions: str) -> None:
    """Добавить права к существующей роли."""
    client = _get_client(ctx)
    perm_list = [p.strip() for p in permissions.split(",") if p.strip()]

    result = client.post(
        "/api/v1/mgmt/permissions/assign",
        json_body={"role_name": role, "permissions": perm_list},
    )

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho(f"\n  Роли '{role}' добавлены права!", fg="green", bold=True)
    for p in perm_list:
        click.echo(f"    + {p}")


@perms_grp.command("revoke", help="Отозвать права у роли.")
@click.option("--role", "-r", required=True, help="Имя роли.")
@click.option("--permissions", "-p", required=True, help="Права через запятую.")
@click.pass_context
def perms_revoke(ctx: click.Context, role: str, permissions: str) -> None:
    """Удалить права у существующей роли."""
    client = _get_client(ctx)
    perm_list = [p.strip() for p in permissions.split(",") if p.strip()]

    result = client.post(
        "/api/v1/mgmt/permissions/revoke",
        json_body={"role_name": role, "permissions": perm_list},
    )

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho(f"\n  У роли '{role}' отозваны права!", fg="green", bold=True)
    for p in perm_list:
        click.echo(f"    - {p}")


@perms_grp.command("diff", help="Сравнить права двух ролей.")
@click.argument("role1")
@click.argument("role2")
@click.pass_context
def perms_diff(ctx: click.Context, role1: str, role2: str) -> None:
    """Показать разницу в правах между двумя ролями."""
    client = _get_client(ctx)

    r1 = client.get(f"/api/v1/mgmt/roles/{role1}")
    r2 = client.get(f"/api/v1/mgmt/roles/{role2}")

    p1 = set(r1.get("data", {}).get("permissions", [])) if isinstance(r1.get("data"), dict) else set()
    p2 = set(r2.get("data", {}).get("permissions", [])) if isinstance(r2.get("data"), dict) else set()

    only_r1 = sorted(p1 - p2)
    only_r2 = sorted(p2 - p1)
    common = sorted(p1 & p2)

    click.secho(f"\n  Сравнение: {role1} vs {role2}", fg="cyan", bold=True)
    click.echo()

    click.secho(f"  Общие ({len(common)}):", fg="white", bold=True)
    for p in common:
        click.echo(f"    {p}")

    click.echo()
    click.secho(f"  Только {role1} ({len(only_r1)}):", fg="green", bold=True)
    for p in only_r1:
        click.echo(f"    + {p}")

    click.echo()
    click.secho(f"  Только {role2} ({len(only_r2)}):", fg="red", bold=True)
    for p in only_r2:
        click.echo(f"    - {p}")


# ═══════════════════════════════════════════════════════════════════════════
# AUDIT — журнал аудита
# ═══════════════════════════════════════════════════════════════════════════


@cli.group("audit", help="Просмотр журнала аудита.")
@click.pass_context
def audit_grp(ctx: click.Context) -> None:
    """Просмотр журнала аудита действий."""
    pass


@audit_grp.command("list", help="Показать журнал аудита.")
@click.option("--user-id", type=int, default=None, help="Фильтр по ID пользователя.")
@click.option("--action", default=None, help="Фильтр по действию.")
@click.option("--endpoint", default=None, help="Фильтр по эндпоинту.")
@click.option("--offset", default=0, help="Смещение пагинации.")
@click.option("--limit", default=50, help="Размер страницы.")
@click.pass_context
def audit_list(ctx: click.Context, user_id: Optional[int], action: Optional[str], endpoint: Optional[str], offset: int, limit: int) -> None:
    """Показать записи журнала аудита."""
    client = _get_client(ctx)
    result = client.get(
        "/api/v1/mgmt/audit",
        params={"user_id": user_id, "action": action, "endpoint": endpoint, "offset": offset, "limit": limit},
    )

    if _is_json(ctx):
        _out_json(result)
        return

    entries = result.get("data", [])
    if isinstance(entries, dict) and "entries" in entries:
        entries = entries["entries"]
    elif isinstance(entries, dict) and "items" in entries:
        entries = entries["items"]

    rows = []
    for e in entries:
        if isinstance(e, dict):
            rows.append([
                str(e.get("id", "")),
                str(e.get("user_id", "")),
                str(e.get("action", "")),
                _truncate(str(e.get("endpoint", ""))),
                str(e.get("timestamp", ""))[:19],
            ])

    _print_table(
        ["ID", "User ID", "Действие", "Эндпоинт", "Время"],
        rows,
        title="Журнал аудита",
    )


# ═══════════════════════════════════════════════════════════════════════════
# STATS — сводная статистика по mgmt API (v2.2)
# ═══════════════════════════════════════════════════════════════════════════


@cli.command("stats", help="Сводная статистика Management API (пользователи, ключи, роли).")
@click.pass_context
def stats_cmd(ctx: click.Context) -> None:
    """Показать сводную статистику: количество пользователей, ключей, ролей,
    разбивку по ролям и т.д.
    """
    client = _get_client(ctx)
    result = client.get("/api/v1/mgmt/stats")

    if _is_json(ctx):
        _out_json(result)
        return

    data = result.get("data", {})
    if not isinstance(data, dict):
        click.echo("(нет данных)")
        return

    click.secho("\n  Сводка Management API", fg="cyan", bold=True)
    click.echo()
    u = data.get("users", {})
    k = data.get("api_keys", {})
    r = data.get("roles", {})
    a = data.get("audit_log", {})
    click.echo(f"  Пользователи:  {u.get('active', 0)} активных / {u.get('total', 0)} всего")
    click.echo(f"  API-ключи:     {k.get('active', 0)} активных / {k.get('total', 0)} всего")
    click.echo(f"  Роли:          {r.get('active', 0)} активных / {r.get('total', 0)} всего")
    click.echo(f"  Записей аудита: {a.get('total', 0)}")
    click.echo()

    breakdown = data.get("roles_breakdown", [])
    if breakdown:
        click.secho("  Разбивка по ролям:", fg="cyan", bold=True)
        rows = []
        for rb in breakdown:
            if isinstance(rb, dict):
                rows.append([
                    str(rb.get("name", "")),
                    "Да" if rb.get("is_active", 1) else "Нет",
                    str(rb.get("users", 0)),
                    str(rb.get("keys", 0)),
                ])
        _print_table(
            ["Роль", "Активна", "Польз.", "Ключей"],
            rows,
            title=None,
        )


# ═══════════════════════════════════════════════════════════════════════════
# BULK — массовые операции (v2.2)
# ═══════════════════════════════════════════════════════════════════════════


@cli.group("bulk", help="Массовые операции над пользователями и ключами.")
@click.pass_context
def bulk_grp(ctx: click.Context) -> None:
    """Массовые операции (enable/disable/purge для нескольких ID сразу)."""
    pass


@bulk_grp.command("users", help="Массовая операция над пользователями.")
@click.option("--ids", "-i", required=True, help="Список ID через запятую (например: 1,2,5).")
@click.option("--action", "-a", required=True, type=click.Choice(["enable", "disable", "purge"]),
              help="Действие: enable / disable / purge.")
@click.pass_context
def bulk_users(ctx: click.Context, ids: str, action: str) -> None:
    """Применить действие (enable/disable/purge) к нескольким пользователям."""
    client = _get_client(ctx)
    try:
        id_list = [int(x.strip()) for x in ids.split(",") if x.strip()]
    except ValueError:
        raise click.ClickException("--ids должен содержать числа через запятую")

    result = client.post("/api/v1/mgmt/users/bulk", json_body={"ids": id_list, "action": action})

    if _is_json(ctx):
        _out_json(result)
        return

    data = result.get("data", {})
    ok = data.get("ok", [])
    failed = data.get("failed", [])
    click.secho(f"\n  Успешно: {len(ok)} пользователей", fg="green", bold=True)
    for uid in ok:
        click.echo(f"    + #{uid}")
    if failed:
        click.secho(f"  Ошибки: {len(failed)}", fg="red", bold=True)
        for f in failed:
            click.echo(f"    - #{f.get('id')}: {f.get('error')}")


@bulk_grp.command("keys", help="Массовая операция над API-ключами.")
@click.option("--ids", "-i", required=True, help="Список ID через запятую.")
@click.option("--action", "-a", required=True, type=click.Choice(["enable", "disable", "purge"]),
              help="Действие: enable / disable / purge.")
@click.pass_context
def bulk_keys(ctx: click.Context, ids: str, action: str) -> None:
    """Применить действие (enable/disable/purge) к нескольким API-ключам."""
    client = _get_client(ctx)
    try:
        id_list = [int(x.strip()) for x in ids.split(",") if x.strip()]
    except ValueError:
        raise click.ClickException("--ids должен содержать числа через запятую")

    result = client.post("/api/v1/mgmt/keys/bulk", json_body={"ids": id_list, "action": action})

    if _is_json(ctx):
        _out_json(result)
        return

    data = result.get("data", {})
    ok = data.get("ok", [])
    failed = data.get("failed", [])
    click.secho(f"\n  Успешно: {len(ok)} ключей", fg="green", bold=True)
    for kid in ok:
        click.echo(f"    + #{kid}")
    if failed:
        click.secho(f"  Ошибки: {len(failed)}", fg="red", bold=True)
        for f in failed:
            click.echo(f"    - #{f.get('id')}: {f.get('error')}")


# ═══════════════════════════════════════════════════════════════════════════
# 2FA — управление TOTP двухфакторной аутентификацией (v2.3)
# ═══════════════════════════════════════════════════════════════════════════


@cli.group("2fa", help="Управление 2FA (TOTP) для текущего пользователя.")
@click.pass_context
def twofa_grp(ctx: click.Context) -> None:
    """Управление двухфакторной аутентификацией.

    \b
    Сценарий включения:
      1. ds_auth.py login admin PASSWORD --save
      2. ds_auth.py 2fa setup            # получить secret + otpauth:// URI
      3. (в Google Authenticator добавить entry по secret или QR из URI)
      4. ds_auth.py 2fa enable --secret <SECRET> --code <123456>
      5. ds_auth.py 2fa status           # проверить, что включено

    \b
    Логин с 2FA:
      1. ds_auth.py login admin PASSWORD --save
         → вернёт totp_required: true, temp_token
      2. ds_auth.py 2fa verify --temp-token <TOKEN> --code <123456>
         → вернёт access_token + refresh_token (сохраняются в ~/.ds_auth_token)
    """
    pass


@twofa_grp.command("setup", help="Сгенерировать TOTP-секрет (показать QR URI).")
@click.pass_context
def twofa_setup(ctx: click.Context) -> None:
    """Сгенерировать новый TOTP-секрет для текущего пользователя.

    Секрет НЕ сохраняется — вызовите `2fa enable` с кодом из приложения,
    чтобы подтвердить и сохранить.
    """
    client = _get_client(ctx)
    result = client.post("/api/v1/auth/2fa/setup")

    if _is_json(ctx):
        _out_json(result)
        return

    data = result.get("data", {})
    if not isinstance(data, dict):
        click.echo("(нет данных)")
        return

    click.secho("\n  TOTP secret сгенерирован!", fg="green", bold=True)
    click.echo()
    click.secho(f"  Secret:       {data.get('secret', '')}", fg="cyan", bold=True)
    click.echo()
    click.secho("  otpauth:// URI (для QR-кода):", fg="yellow")
    click.echo(f"  {data.get('otpauth_uri', '')}")
    click.echo()
    click.secho("  Как использовать:", fg="cyan")
    click.echo("  1. Откройте Google Authenticator (или Authy/1Password)")
    click.echo("  2. Добавьте новую запись вручную — введите secret выше")
    click.echo("     ИЛИ отсканируйте QR-код, сгенерированный из otpauth:// URI")
    click.echo("  3. Получите 6-значный код из приложения")
    click.echo(f"  4. Выполните: ds_auth.py 2fa enable --secret {data.get('secret', '<SECRET>')} --code <123456>")
    click.echo()


@twofa_grp.command("enable", help="Включить 2FA (требует код из приложения).")
@click.option("--secret", "-s", required=True, help="TOTP secret из `2fa setup`.")
@click.option("--code", "-c", required=True, help="6-значный код из приложения.")
@click.pass_context
def twofa_enable(ctx: click.Context, secret: str, code: str) -> None:
    """Подтвердить код и включить 2FA."""
    client = _get_client(ctx)
    result = client.post(
        "/api/v1/auth/2fa/enable",
        json_body={"secret": secret, "code": code},
    )

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho("\n  2FA включена!", fg="green", bold=True)
    click.secho("  Теперь при логине потребуется TOTP-код из приложения.", fg="yellow")


@twofa_grp.command("disable", help="Отключить 2FA (требует текущий пароль).")
@click.option("--password", "-p", required=True, help="Текущий пароль пользователя.")
@click.pass_context
def twofa_disable(ctx: click.Context, password: str) -> None:
    """Отключить 2FA для текущего пользователя."""
    client = _get_client(ctx)
    result = client.post(
        "/api/v1/auth/2fa/disable",
        json_body={"password": password},
    )

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho("\n  2FA отключена!", fg="green", bold=True)


@twofa_grp.command("status", help="Проверить, включена ли 2FA.")
@click.pass_context
def twofa_status(ctx: click.Context) -> None:
    """Показать статус 2FA для текущего пользователя."""
    client = _get_client(ctx)
    result = client.get("/api/v1/auth/2fa/status")

    if _is_json(ctx):
        _out_json(result)
        return

    data = result.get("data", {})
    if not isinstance(data, dict):
        click.echo("(нет данных)")
        return

    enabled = data.get("enabled", False)
    username = data.get("username", "?")
    if enabled:
        click.secho(f"\n  2FA ВКЛЮЧЕНА для пользователя '{username}'", fg="green", bold=True)
    else:
        click.secho(f"\n  2FA отключена для пользователя '{username}'", fg="yellow")
    click.echo()


@twofa_grp.command("verify", help="Завершить логин с 2FA (шаг 2).")
@click.option("--temp-token", "-t", required=True, help="temp_token из ответа /auth/login.")
@click.option("--code", "-c", required=True, help="6-значный код из приложения.")
@click.option("--save", is_flag=True, default=False, help="Сохранить полученный токен в ~/.ds_auth_token.")
@click.pass_context
def twofa_verify(ctx: click.Context, temp_token: str, code: str, save: bool) -> None:
    """Верифицировать TOTP-код и получить полноценные JWT-токены.

    После `login` (когда включена 2FA) сервер возвращает
    `{totp_required: true, temp_token: "..."}`. Передайте temp_token
    и код из приложения сюда, чтобы получить access_token + refresh_token.
    """
    client = _get_client(ctx)
    result = client.post(
        "/api/v1/auth/login/verify",
        json_body={"temp_token": temp_token, "totp_code": code},
    )

    if _is_json(ctx):
        _out_json(result)
        return

    data = result.get("data", {})
    if not isinstance(data, dict):
        click.secho("  Ошибка: неожиданный ответ сервера", fg="red")
        return

    access = data.get("access_token", "")
    refresh = data.get("refresh_token", "")
    role = data.get("role", "?")
    perms = data.get("permissions", [])

    click.secho("\n  2FA верификация успешна!", fg="green", bold=True)
    click.echo(f"  Пользователь: {data.get('username', '?')}")
    click.echo(f"  Роль:         {role}")
    click.echo(f"  Права:        {len(perms)} разрешений")
    click.echo(f"  Access token: {access[:50]}...")
    click.echo(f"  Refresh token: {refresh[:50]}...")

    if save:
        # Build a response shape that _save_token expects
        save_data = {
            "access_token": access,
            "refresh_token": refresh,
            "expires_in": data.get("expires_in", 1800),
            "role": role,
            "permissions": perms,
        }
        _save_token(save_data)
        click.secho("\n  Использование JWT с curl:", fg="cyan")
        click.echo(f"    curl -H 'Authorization: Bearer {access[:30]}...' \\")
        click.echo(f"         http://localhost:8099/api/v1/users/")
    click.echo()


# ── 2FA admin — управление 2FA других пользователей (v2.3.1) ────────────


@twofa_grp.group("admin", help="Администрирование 2FA других пользователей (только admin).")
@click.pass_context
def twofa_admin_grp(ctx: click.Context) -> None:
    """Управление 2FA других пользователей от имени admin.

    \b
    Требуется admin API-ключ или admin JWT.
    Использует X-API-Key заголовок (если --api-key задан) или
    Authorization: Bearer (если был login --save).

    \b
    Команды:
      status <user_id>           — проверить статус 2FA пользователя
      setup <user_id>            — сгенерировать секрет для пользователя
      enable <user_id>           — включить 2FA (требует --secret + --code,
                                    или --force для пропуска проверки кода)
      disable <user_id>          — отключить 2FA (секрет сохраняется)
      reset <user_id>            — полный сброс (секрет удаляется)
      list-enabled               — список пользователей с включённой 2FA
      list-disabled              — список пользователей с секретом, но 2FA выключена
    """
    pass


@twofa_admin_grp.command("status", help="Статус 2FA пользователя.")
@click.argument("user_id", type=int)
@click.pass_context
def twofa_admin_status(ctx: click.Context, user_id: int) -> None:
    """Показать, включена ли 2FA у пользователя."""
    client = _get_client(ctx)
    result = client.get(f"/api/v1/mgmt/users/{user_id}/2fa/status")

    if _is_json(ctx):
        _out_json(result)
        return

    data = result
    enabled = data.get("enabled", False)
    has_secret = data.get("has_secret", False)
    username = data.get("username", "?")
    click.secho(f"\n  Пользователь #{user_id} ({username})", fg="cyan", bold=True)
    click.echo(f"  2FA включена:  {'Да' if enabled else 'Нет'}")
    click.echo(f"  Секрет в БД:   {'Да' if has_secret else 'Нет'}")
    click.echo()


@twofa_admin_grp.command("setup", help="Сгенерировать TOTP-секрет для пользователя.")
@click.argument("user_id", type=int)
@click.pass_context
def twofa_admin_setup(ctx: click.Context, user_id: int) -> None:
    """Сгенерировать новый TOTP-секрет для пользователя (НЕ сохраняется)."""
    client = _get_client(ctx)
    result = client.post(f"/api/v1/mgmt/users/{user_id}/2fa/setup")

    if _is_json(ctx):
        _out_json(result)
        return

    secret = result.get("secret", "")
    uri = result.get("otpauth_uri", "")
    username = result.get("username", "?")
    click.secho(f"\n  TOTP секрет для пользователя #{user_id} ({username})", fg="green", bold=True)
    click.echo()
    click.secho(f"  Secret: {secret}", fg="cyan", bold=True)
    click.echo()
    click.secho("  otpauth:// URI (для QR):", fg="yellow")
    click.echo(f"  {uri}")
    click.echo()
    click.secho("  Далее:", fg="cyan")
    click.echo(f"  1. Передайте секрет пользователю через защищённый канал")
    click.echo(f"  2. Пользователь вводит секрет в Google Authenticator")
    click.echo(f"  3. Включите 2FA:")
    click.echo(f"     ds_auth.py 2fa admin enable {user_id} --secret {secret} --code <123456>")
    click.echo(f"  Или принудительно (без кода):")
    click.echo(f"     ds_auth.py 2fa admin enable {user_id} --secret {secret} --force")
    click.echo()


@twofa_admin_grp.command("enable", help="Включить 2FA для пользователя.")
@click.argument("user_id", type=int)
@click.option("--secret", "-s", required=True, help="TOTP secret из `admin setup`.")
@click.option("--code", "-c", default=None, help="6-значный код от пользователя (или --force).")
@click.option("--force", is_flag=True, help="Принудительно — без проверки кода (RECOVERY).")
@click.pass_context
def twofa_admin_enable(ctx: click.Context, user_id: int, secret: str, code: Optional[str], force: bool) -> None:
    """Включить 2FA для пользователя.

    Без --force: требует --code (код из приложения пользователя).
    С --force: сохраняет секрет без проверки — пользователь должен
    самостоятельно добавить секрет в приложение, иначе не сможет войти.
    """
    if not force and not code:
        raise click.ClickException("Требуется --code или --force")

    client = _get_client(ctx)
    body: Dict[str, Any] = {"secret": secret}
    if code:
        body["code"] = code
    params = {"force": "true"} if force else {}
    result = client.post(
        f"/api/v1/mgmt/users/{user_id}/2fa/enable",
        json_body=body,
        params=params,
    )

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho(f"\n  2FA включена для пользователя #{user_id}!", fg="green", bold=True)
    if force:
        click.secho("  ВНИМАНИЕ: включено без проверки кода (force)!", fg="yellow", bold=True)
        click.secho("  Пользователь ДОЛЖЕН добавить секрет в приложение, иначе не сможет войти!", fg="yellow")
    click.echo()


@twofa_admin_grp.command("disable", help="Отключить 2FA (секрет сохраняется).")
@click.argument("user_id", type=int)
@click.confirmation_option(prompt="Отключить 2FA у этого пользователя?")
@click.pass_context
def twofa_admin_disable(ctx: click.Context, user_id: int) -> None:
    """Отключить 2FA (admin override, без пароля).

    Секрет сохраняется в БД — можно включить обратно через `enable`.
    Для полного удаления используйте `reset`.
    """
    client = _get_client(ctx)
    result = client.post(f"/api/v1/mgmt/users/{user_id}/2fa/disable")

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho(f"\n  2FA отключена для пользователя #{user_id}!", fg="green", bold=True)
    click.secho("  Секрет сохранён — можно включить обратно.", fg="yellow")


@twofa_admin_grp.command("reset", help="Полный сброс 2FA (секрет удаляется).")
@click.argument("user_id", type=int)
@click.confirmation_option(prompt="ПОЛНОСТЬЮ сбросить 2FA (удалить секрет)?")
@click.pass_context
def twofa_admin_reset(ctx: click.Context, user_id: int) -> None:
    """Полный сброс 2FA — секрет удаляется из БД.

    Пользователь должен будет заново настроить 2FA через `admin setup`.
    """
    client = _get_client(ctx)
    result = client.post(f"/api/v1/mgmt/users/{user_id}/2fa/reset")

    if _is_json(ctx):
        _out_json(result)
        return

    click.secho(f"\n  2FA полностью сброшена для пользователя #{user_id}!", fg="red", bold=True)
    click.secho("  Пользователь должен заново настроить 2FA.", fg="yellow")


@twofa_admin_grp.command("list-enabled", help="Список пользователей с включённой 2FA.")
@click.pass_context
def twofa_admin_list_enabled(ctx: click.Context) -> None:
    """Показать всех пользователей с включённой 2FA."""
    client = _get_client(ctx)
    result = client.get("/api/v1/mgmt/2fa/enabled")

    if _is_json(ctx):
        _out_json(result)
        return

    users = result.get("data", [])
    rows = []
    for u in users:
        if isinstance(u, dict):
            rows.append([
                str(u.get("id", "")),
                str(u.get("username", "")),
                str(u.get("role", "")),
                "Да" if u.get("is_active", 1) else "Нет",
            ])
    _print_table(
        ["ID", "Логин", "Роль", "Активен"],
        rows,
        title=f"Пользователи с включённой 2FA ({len(rows)})",
    )


@twofa_admin_grp.command("list-disabled", help="Список пользователей с секретом, но 2FA выключена.")
@click.pass_context
def twofa_admin_list_disabled(ctx: click.Context) -> None:
    """Показать пользователей с сохранённым секретом, но 2FA выключена."""
    client = _get_client(ctx)
    result = client.get("/api/v1/mgmt/2fa/disabled")

    if _is_json(ctx):
        _out_json(result)
        return

    users = result.get("data", [])
    rows = []
    for u in users:
        if isinstance(u, dict):
            rows.append([
                str(u.get("id", "")),
                str(u.get("username", "")),
                str(u.get("role", "")),
                "Да" if u.get("is_active", 1) else "Нет",
            ])
    _print_table(
        ["ID", "Логин", "Роль", "Активен"],
        rows,
        title=f"Пользователи с секретом, 2FA выключена ({len(rows)})",
    )


# ═══════════════════════════════════════════════════════════════════════════
# TOKEN — управление JWT-токеном
# ═══════════════════════════════════════════════════════════════════════════


@cli.group("token", help="Управление JWT-токеном.")
@click.pass_context
def token_grp(ctx: click.Context) -> None:
    """Управление сохранённым JWT-токеном."""
    pass


@token_grp.command("show", help="Показать сохранённый JWT-токен.")
@click.option("--full", is_flag=True, default=False, help="Показать токен целиком (без обрезки).")
@click.pass_context
def token_show(ctx: click.Context, full: bool) -> None:
    """Показать сохранённый JWT-токен и примеры использования с curl."""
    if not TOKEN_FILE.is_file():
        raise click.ClickException("Токен не найден. Выполните login --save сначала.")

    try:
        data = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise click.ClickException(f"Не удалось прочитать файл токена: {exc}")

    access = data.get("access_token", "")
    refresh = data.get("refresh_token", "")
    role = data.get("role", "?")
    expires = data.get("expires_at", "?")
    perms = data.get("permissions", [])

    # Проверяем, не истёк ли токен
    is_expired = False
    if expires and expires != "?":
        try:
            if datetime.fromisoformat(expires) <= datetime.now():
                is_expired = True
        except ValueError:
            pass

    click.secho("\n  JWT-токен:", fg="cyan", bold=True)
    if full:
        click.echo(f"  Access token:  {access}")
        click.echo(f"  Refresh token: {refresh}")
    else:
        click.echo(f"  Access token:  {access[:50]}...")
        click.echo(f"  Refresh token: {refresh[:50]}...")
    click.echo(f"  Роль:          {role}")
    click.echo(f"  Истекает:      {expires}")
    click.echo(f"  Права:         {len(perms)} разрешений")
    click.echo(f"  Файл:          {TOKEN_FILE}")

    if is_expired:
        click.secho("\n  ВНИМАНИЕ: Токен истёк! Выполните refresh или login --save.", fg="red", bold=True)
    else:
        click.secho("\n  Статус: активен", fg="green")

    # Показываем примеры использования
    click.echo()
    click.secho("  Использование с curl (JWT Bearer):", fg="cyan", bold=True)
    click.echo(f"    curl -H 'Authorization: Bearer {access[:30]}...' \\")
    click.echo(f"         http://localhost:8099/api/v1/users/")
    click.echo()
    click.secho("  Использование с curl (полный токен):", fg="cyan")
    click.echo(f"    curl -H 'Authorization: Bearer <ACCESS_TOKEN>' \\")
    click.echo(f"         http://localhost:8099/api/v1/users/")
    click.echo()
    click.secho("  Разница между JWT и API-ключом:", fg="yellow", bold=True)
    click.echo("    JWT-токен  → Authorization: Bearer <token>  (из login)")
    click.echo("    API-ключ   → X-API-Key: <key>               (из key create)")
    click.echo("    НЕЛЬЗЯ использовать JWT в заголовке X-API-Key!")
    click.echo()


@token_grp.command("curl", help="Сгенерировать готовую curl-команду.")
@click.argument("endpoint", default="/api/v1/users/")
@click.option("--method", "-m", default="GET", help="HTTP-метод (GET, POST, PUT, DELETE).")
@click.pass_context
def token_curl(ctx: click.Context, endpoint: str, method: str) -> None:
    """Сгенерировать готовую curl-команду с правильным заголовком авторизации.

    Автоматически определяет тип аутентификации (JWT или API-ключ)
    и генерирует правильный заголовок.
    """
    client = _get_client(ctx)

    if not client._token and not client._api_key:
        raise click.ClickException("Нет аутентификации. Выполните login --save или укажите --api-key.")

    # Нормализуем endpoint
    if not endpoint.startswith("/"):
        endpoint = "/" + endpoint

    if client._token:
        # JWT — используем Authorization: Bearer
        auth_header = f"Authorization: Bearer {client._token}"
        auth_type = "JWT Bearer"
    else:
        # API-ключ — используем X-API-Key
        auth_header = f"X-API-Key: {client._api_key}"
        auth_type = "API-ключ"

    url = f"{client.base_url}{endpoint}"

    if method.upper() == "GET":
        cmd = f"curl -H '{auth_header}' '{url}'"
    else:
        cmd = f"curl -X {method.upper()} -H '{auth_header}' -H 'Content-Type: application/json' '{url}'"

    click.secho(f"\n  Тип авторизации: {auth_type}", fg="cyan")
    click.secho(f"  Сгенерированная команда:", fg="cyan", bold=True)
    click.echo(f"    {cmd}")
    click.echo()


# ═══════════════════════════════════════════════════════════════════════════
# QUICK — быстрые операции
# ═══════════════════════════════════════════════════════════════════════════


@cli.command("quickkey", help="Быстрое создание API-ключа (логин + создать ключ).")
@click.argument("username")
@click.argument("password")
@click.option("--key-name", default="quick-key", show_default=True, help="Название ключа.")
@click.option("--role", default="operator", show_default=True, help="Роль ключа.")
@click.option("--expires-days", type=int, default=None, help="Дней до истечения.")
@click.pass_context
def quickkey(ctx: click.Context, username: str, password: str, key_name: str, role: str, expires_days: Optional[int]) -> None:
    """Быстрая операция: логин → создать пользователя (если нужно) → создать API-ключ.

    Удобно для первого запуска или быстрого получения ключа.
    """
    import requests as _requests

    client = _get_client(ctx)

    # Логинимся
    click.echo("  Входим в систему...")
    try:
        resp, _ = _try_login_request(client.base_url, username, password)
    except _requests.ConnectionError:
        raise click.ClickException(f"Не удалось подключиться к серверу {client.base_url}. Проверьте, что API сервер запущен.")
    except _requests.Timeout:
        raise click.ClickException(f"Таймаут при подключении к {client.base_url}")

    if resp is None or not resp.ok:
        try:
            err_data = resp.json() if resp else {}
            msg = _extract_error_msg(err_data)
        except (ValueError, AttributeError):
            msg = "Не удалось подключиться"
        raise click.ClickException(f"Ошибка логина (HTTP {resp.status_code if resp else '?'}): {msg}")

    data = resp.json()
    access_token = data.get("access_token", "")
    click.secho("  Логин успешен!", fg="green")

    # Получаем список пользователей для нахождения user_id
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json", "Accept": "application/json"}

    user_id = 1  # По умолчанию первый пользователь
    try:
        users_resp = _requests.get(f"{client.base_url}/api/v1/mgmt/users", headers=headers, timeout=30)
        if users_resp.ok:
            users_data = users_resp.json().get("data", [])
            if isinstance(users_data, list) and users_data:
                for u in users_data:
                    if isinstance(u, dict) and u.get("username") == username:
                        user_id = u.get("id", 1)
                        break
    except (_requests.ConnectionError, _requests.Timeout):
        pass  # Используем user_id по умолчанию

    # Создаём API-ключ
    click.echo(f"  Создаём API-ключ для пользователя #{user_id}...")
    try:
        key_resp = _requests.post(
            f"{client.base_url}/api/v1/mgmt/keys",
            params={"user_id": user_id, "name": key_name, "role": role, "expires_days": expires_days},
            headers=headers,
            timeout=30,
        )
    except _requests.ConnectionError:
        raise click.ClickException(f"Не удалось подключиться к серверу при создании ключа.")
    except _requests.Timeout:
        raise click.ClickException(f"Таймаут при создании ключа.")

    if not key_resp.ok:
        raise click.ClickException(f"Ошибка создания ключа: {key_resp.status_code} {key_resp.text}")

    key_data = key_resp.json().get("data", {})
    raw_key = key_data.get("key", "") if isinstance(key_data, dict) else ""

    click.secho("\n  API-ключ создан!", fg="green", bold=True)
    click.secho("  ВНИМАНИЕ: ключ показывается только один раз!", fg="yellow", bold=True)
    click.echo()
    click.secho(f"  Ключ: {raw_key}", fg="cyan", bold=True)
    click.echo()
    click.echo("  Использование (API-ключ → X-API-Key):")
    click.echo(f"    export SAMBA_API_KEY={raw_key}")
    click.echo(f"    curl -H 'X-API-Key: {raw_key}' http://localhost:8099/api/v1/users/")
    click.echo()
    click.echo("  Или через JWT (Authorization: Bearer):")
    click.echo(f"    curl -H 'Authorization: Bearer <jwt>' http://localhost:8099/api/v1/users/")
    click.echo()


@cli.command("status", help="Проверить статус подключения к API.")
@click.pass_context
def status_cmd(ctx: click.Context) -> None:
    """Проверить доступность API-сервера и аутентификацию."""
    client = _get_client(ctx)
    import requests as _requests

    click.echo(f"  Сервер: {client.base_url}")

    # Проверяем доступность
    try:
        resp = _requests.get(f"{client.base_url}/health", timeout=5)
        if resp.ok:
            click.secho("  Статус: доступен", fg="green")
            try:
                health = resp.json()
                click.echo(f"  Health: {json.dumps(health, ensure_ascii=False)}")
            except ValueError:
                pass
        else:
            click.secho(f"  Статус: ошибка (HTTP {resp.status_code})", fg="red")
    except _requests.ConnectionError:
        click.secho("  Статус: НЕДОСТУПЕН (ошибка подключения)", fg="red", bold=True)
        return
    except _requests.Timeout:
        click.secho("  Статус: таймаут", fg="red")
        return

    # Проверяем авторизацию — пробуем запрос через mgmt API
    # (поддерживает как API-ключ, так и JWT Bearer)
    has_auth = bool(client._token or client._api_key)
    auth_type = "JWT Bearer" if client._token else ("API-ключ" if client._api_key else "нет")
    if has_auth:
        try:
            auth_resp = _requests.get(
                f"{client.base_url}/api/v1/mgmt/users",
                headers=client._headers,
                params={"limit": 1},
                timeout=5,
            )
            if auth_resp.ok:
                click.secho(f"  Авторизация: ОК ({auth_type})", fg="green")
            else:
                click.secho(f"  Авторизация: ОШИБКА (HTTP {auth_resp.status_code}, тип: {auth_type})", fg="red")
        except Exception:
            click.secho("  Авторизация: ошибка запроса", fg="red")
    else:
        click.secho("  Авторизация: не настроена (выполните login или укажите --api-key)", fg="yellow")


# ═══════════════════════════════════════════════════════════════════════════
# LOGIN HELPERS
# ═══════════════════════════════════════════════════════════════════════════


def _try_login_request(base_url: str, username: str, password: str) -> tuple:
    """Попробовать несколько форматов запроса для логина.
    
    Возвращает (response, approach_name) при первом успешном ответе.
    Если все варианты дают 422, возвращает последний ответ.
    Если 401 — сразу возвращаем (неверные креденшалы).
    """
    import requests as _requests

    approaches = [
        ("json_body", lambda: _requests.post(
            f"{base_url}/api/v1/auth/login",
            json={"username": username, "password": password},
            timeout=30,
        )),
        ("form_data", lambda: _requests.post(
            f"{base_url}/api/v1/auth/login",
            data={"username": username, "password": password},
            timeout=30,
        )),
        ("query_params", lambda: _requests.post(
            f"{base_url}/api/v1/auth/login",
            params={"username": username, "password": password},
            timeout=30,
        )),
        ("body_as_query_json", lambda: _requests.post(
            f"{base_url}/api/v1/auth/login",
            params={"body": json.dumps({"username": username, "password": password})},
            timeout=30,
        )),
    ]

    last_resp = None
    last_approach = ""
    
    for name, request_fn in approaches:
        try:
            resp = request_fn()
        except (_requests.ConnectionError, _requests.Timeout):
            continue
        
        # Успех — возвращаем
        if resp.ok:
            return resp, name
        
        # 401 — неверные креденшалы, нет смысла пробовать другие форматы
        if resp.status_code == 401:
            return resp, name
        
        # 422 — пробуем следующий формат
        last_resp = resp
        last_approach = name
    
    # Все варианты дали ошибку — возвращаем последний
    return last_resp, last_approach


def _do_api_login(base_url: str, username: str, password: str) -> Optional[Dict[str, Any]]:
    """Выполнить логин и вернуть данные токена или None."""
    import requests as _requests
    try:
        resp, _ = _try_login_request(base_url, username, password)
    except (_requests.ConnectionError, _requests.Timeout):
        return None
    if resp is None or not resp.ok:
        return None
    try:
        return resp.json()
    except ValueError:
        return None



# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    cli()
