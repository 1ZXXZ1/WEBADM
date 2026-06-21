#!/bin/bash
#
# WebADC — Auto-start script (pe-a-1.4)
# Запускает API сервер на 0.0.0.0:8099 (HTTP или HTTPS).
# Авто-иниализация SQLite БД при первом запуске.
#
# Usage:
#   ./run.sh                       # Start с INFO log level (default)
#   ./run.sh -d                    # Start с DEBUG log level
#   ./run.sh --debug               # То же что -d
#   ./run.sh --setup-db            # Принудительно пересоздать БД
#   ./run.sh --no-ssl              # Запуск без SSL (разовый)
#   ./run.sh --yes                 # Auto-confirm SSL cert generation
#
# Pe-a-1.4:
#   - Использует webadc wrapper если доступен
#   - DB_URL по умолчанию: sqlite:///DB/app.db (папка DB/)
#   - Auto-gen SSL сертификата если файлов нет
#   - Поддержка HTTP и HTTPS
#

set -e

# ── Parse args ─────────────────────────────────────────────────────────
DEBUG_MODE=false
SETUP_DB=false
NO_SSL=false
AUTO_YES=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        -d|--debug)
            DEBUG_MODE=true
            shift
            ;;
        --setup-db)
            SETUP_DB=true
            shift
            ;;
        --no-ssl)
            NO_SSL=true
            shift
            ;;
        --yes|-y)
            AUTO_YES=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [-d|--debug] [--setup-db] [--no-ssl] [--yes]"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [-d|--debug] [--setup-db] [--no-ssl] [--yes]"
            exit 1
            ;;
    esac
done

# ── Determine project root ─────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Force TMPDIR for samba-tool subprocesses ───────────────────────────
export TMPDIR="${TMPDIR:-/var/tmp}"
export TMP="${TMP:-/var/tmp}"
export TEMP="${TEMP:-/var/tmp}"

# ── Colors ─────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Log level ──────────────────────────────────────────────────────────
if [ "$DEBUG_MODE" = true ]; then
    export SAMBA_LOG_LEVEL=DEBUG
    UVICORN_LOG_LEVEL=debug
    echo -e "${CYAN}[DEBUG]${NC} Debug mode enabled"
else
    export SAMBA_LOG_LEVEL="${SAMBA_LOG_LEVEL:-INFO}"
    UVICORN_LOG_LEVEL=info
fi

echo -e "${GREEN}[OK]${NC} TMPDIR set to ${TMPDIR}"

# ── Banner ─────────────────────────────────────────────────────────────
HOST="${SAMBA_API_HOST:-0.0.0.0}"
PORT="${SAMBA_API_PORT:-8099}"

echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  WebADC — Samba AD API + Web Panel     ${NC}"
echo -e "${GREEN}  Version: pe-a-1.4                      ${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""

# ── Check Python ───────────────────────────────────────────────────────
PYTHON="${PYTHON:-}"
if [ -z "$PYTHON" ]; then
    for py in python3.14 python3.13 python3.12 python3 python; do
        if command -v "$py" &>/dev/null; then
            PYTHON="$py"
            break
        fi
    done
fi
if [ -z "$PYTHON" ]; then
    echo -e "${RED}[ERROR]${NC} Python 3 не найден!"
    exit 1
fi
PY_VERSION=$($PYTHON -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo -e "${GREEN}[OK]${NC} Python $PY_VERSION ($PYTHON)"

# ── Check samba-tool ───────────────────────────────────────────────────
if command -v samba-tool &>/dev/null; then
    echo -e "${GREEN}[OK]${NC} samba-tool: $(command -v samba-tool)"
else
    echo -e "${YELLOW}[WARN]${NC} samba-tool не найден"
fi

# ── Cache sudo password once (для samba-tool + SSL key access) ─────────
echo -e "${CYAN}[SETUP]${NC} Проверка sudo доступа..."
sudo -v || { echo -e "${RED}[ERROR]${NC} sudo required"; exit 1; }

# Keep sudo alive
(
    while sudo -n true 2>/dev/null; do
        sleep 30
    done
) &
SUDO_KEEPALIVE_PID=$!
trap "kill $SUDO_KEEPALIVE_PID 2>/dev/null; exit 0" EXIT INT TERM

# ── DB initialization (SQLite, pe-a-1.4) ──────────────────────────────
# Default DB_URL = sqlite:///DB/app.db
DB_URL="${DB_URL:-sqlite:///DB/app.db}"
export DB_URL

# Extract DB file path from URL
DB_FILE=""
case "$DB_URL" in
    sqlite:///*)
        DB_TAIL="${DB_URL#sqlite:///}"
        if [[ "$DB_TAIL" = /* ]]; then
            DB_FILE="$DB_TAIL"
        else
            DB_FILE="$SCRIPT_DIR/$DB_TAIL"
        fi
        ;;
esac

if [ -n "$DB_FILE" ]; then
    # Create DB directory if needed
    DB_DIR="$(dirname "$DB_FILE")"
    mkdir -p "$DB_DIR"
    echo -e "${GREEN}[OK]${NC} DB dir: $DB_DIR"
    echo -e "${GREEN}[OK]${NC} DB file: $DB_FILE"

    if [ "$SETUP_DB" = true ]; then
        echo -e "${YELLOW}[WARN]${NC} --setup-db: пересоздаю БД..."
        rm -f "$DB_FILE" "$DB_FILE-wal" "$DB_FILE-shm"
        sudo $PYTHON cli.py sqldb init
        sudo $PYTHON cli.py sqldb upgrade
        echo -e "${GREEN}[OK]${NC} БД инициализирована"
    elif [ ! -f "$DB_FILE" ]; then
        echo -e "${CYAN}[SETUP]${NC} Первый запуск — инициализирую БД..."
        sudo $PYTHON cli.py sqldb init
        sudo $PYTHON cli.py sqldb upgrade
        echo -e "${GREEN}[OK]${NC} БД создана"
    else
        echo -e "${GREEN}[OK]${NC} БД уже существует"
        # Run migrations to make sure schema is up-to-date
        sudo $PYTHON cli.py sqldb upgrade 2>/dev/null || true
    fi
else
    echo -e "${CYAN}[INFO]${NC} DB_URL=$DB_URL (не SQLite — пропуск авто-init)"
fi

# ── SSL setup (pe-a-1.4) ───────────────────────────────────────────────
SSL_CERT="${SAMBA_SSL_CERTFILE:-}"
SSL_KEY="${SAMBA_SSL_KEYFILE:-}"

if [ "$NO_SSL" = true ]; then
    echo -e "${YELLOW}[WARN]${NC} --no-ssl: запуск без SSL"
    SSL_CERT=""
    SSL_KEY=""
    export SAMBA_SSL_CERTFILE=""
    export SAMBA_SSL_KEYFILE=""
elif [ -n "$SSL_CERT" ] && [ -n "$SSL_KEY" ]; then
    # Both paths set — check if files exist
    if [ ! -f "$SSL_CERT" ] || [ ! -f "$SSL_KEY" ]; then
        echo -e "${YELLOW}[WARN]${NC} SSL файлы не найдены — авто-генерация..."
        if [ "$AUTO_YES" = true ]; then
            sudo $PYTHON cli.py ssl generate --force
        else
            sudo $PYTHON cli.py ssl generate
        fi
        # Re-read paths (ssl generate may have updated .env)
        SSL_CERT="${SAMBA_SSL_CERTFILE:-/etc/webadc/ssl/apiadc.crt}"
        SSL_KEY="${SAMBA_SSL_KEYFILE:-/etc/webadc/ssl/apiadc.key}"
    fi
    PROTOCOL="HTTPS"
    echo -e "${GREEN}[OK]${NC} SSL: $PROTOCOL (cert=$SSL_CERT, key=$SSL_KEY)"
else
    PROTOCOL="HTTP"
    echo -e "${YELLOW}[INFO]${NC} SSL не настроен — запуск на HTTP"
fi

# ── Start server ───────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  Запуск сервера на ${HOST}:${PORT} (${PROTOCOL})${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "Protocol:  ${PROTOCOL}"
echo -e "API docs:  ${PROTOCOL,,}://${HOST}:${PORT}/docs"
echo -e "Health:    ${PROTOCOL,,}://${HOST}:${PORT}/health"
echo -e "Log level: ${SAMBA_LOG_LEVEL} (uvicorn: ${UVICORN_LOG_LEVEL})"
echo -e "Press Ctrl+C to stop"
echo ""

# Build uvicorn command
UVICORN_CMD=($PYTHON -m uvicorn app.main:app
    --host "$HOST"
    --port "$PORT"
    --log-level "$UVICORN_LOG_LEVEL"
    --access-log)

if [ -n "$SSL_CERT" ] && [ -n "$SSL_KEY" ]; then
    UVICORN_CMD+=(--ssl-certfile "$SSL_CERT" --ssl-keyfile "$SSL_KEY")
    if [ -n "${SAMBA_SSL_CA_CERTS:-}" ]; then
        UVICORN_CMD+=(--ssl-ca-certs "$SAMBA_SSL_CA_CERTS")
    fi
fi

# Run as root (needed for SSL key access at /etc/webadc/ssl/)
exec sudo -E "${UVICORN_CMD[@]}"
