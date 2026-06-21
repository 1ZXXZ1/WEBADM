#!/usr/bin/env bash
# ==============================================================================
# Скрипт автоматической сборки Python 3.14.6 на ALT Server 11.1
# с поддержкой sqlite3, ssl, zlib и других модулей.
#
# Запуск:
#   chmod +x build_python314_alt.sh
#   ./build_python314_alt.sh
#
# После работы:
#   Python 3.14 установлен в /usr/local/bin/python3.14
#   pip доступен через python3.14 -m pip
# ==============================================================================

set -euo pipefail

PYTHON_VERSION="3.14.6"
PYTHON_ARCHIVE="Python-${PYTHON_VERSION}.tar.xz"
PYTHON_URL="https://www.python.org/ftp/python/${PYTHON_VERSION}/${PYTHON_ARCHIVE}"
PYTHON_DIR="Python-${PYTHON_VERSION}"
PREFIX="/usr/local"

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# Проверяем, что мы на ALT Linux (есть apt-get)
if ! command -v apt-get &> /dev/null; then
    error "Этот скрипт предназначен для ALT Server. apt-get не найден."
fi

# Проверка прав root (для установки пакетов и make install)
if [[ $EUID -ne 0 ]]; then
    error "Скрипт нужно запускать с правами root (sudo ./build_python314_alt.sh)"
fi

# --------------------------------------------------
# 1. Установка системных зависимостей
# --------------------------------------------------
info "Установка необходимых dev-пакетов..."

# Список dev-пакетов ALT Server для полной сборки Python
PACKAGES=(
    gcc
    make
    glibc-devel
    libstdc++-devel
    binutils
    libsqlite3-devel
    zlib-devel
    libssl-devel
    bzlib-devel
    liblzma-devel
    libffi-devel
    readline-devel
)

# Дополнительно может быть tk-devel, но он не критичен — пробуем поставить, но не падаем
PACKAGES_OPTIONAL=(
    tk-devel
)

for pkg in "${PACKAGES[@]}"; do
    if apt-get install -y "$pkg" 2>/dev/null; then
        info "Установлен: $pkg"
    else
        warn "Не удалось установить $pkg (будет пропущен)"
    fi
done

for pkg in "${PACKAGES_OPTIONAL[@]}"; do
    if apt-get install -y "$pkg" 2>/dev/null; then
        info "Установлен опциональный: $pkg"
    else
        warn "Опциональный пакет $pkg не найден — это нормально"
    fi
done

# --------------------------------------------------
# 2. Скачивание исходников Python
# --------------------------------------------------
if [[ ! -f "$PYTHON_ARCHIVE" ]]; then
    info "Скачивание ${PYTHON_URL} ..."
    if ! wget "$PYTHON_URL"; then
        error "Не удалось скачать $PYTHON_URL"
    fi
else
    info "Архив $PYTHON_ARCHIVE уже существует, пропускаем загрузку."
fi

# --------------------------------------------------
# 3. Распаковка
# --------------------------------------------------
if [[ ! -d "$PYTHON_DIR" ]]; then
    info "Распаковка ${PYTHON_ARCHIVE} ..."
    tar xf "$PYTHON_ARCHIVE"
fi

cd "$PYTHON_DIR"

# --------------------------------------------------
# 4. Очистка предыдущей сборки
# --------------------------------------------------
if [[ -f "Makefile" ]]; then
    info "Очистка предыдущей сборки (make distclean)..."
    make distclean 2>/dev/null || true
fi

# --------------------------------------------------
# 5. Конфигурация
# --------------------------------------------------
info "Конфигурирование Python..."
./configure \
    --enable-loadable-sqlite-extensions \
    --enable-optimizations \
    --prefix="$PREFIX"

# --------------------------------------------------
# 6. Сборка
# --------------------------------------------------
NPROC=$(nproc)
info "Запуск сборки в $NPROC потоков..."
make -j"$NPROC"

# --------------------------------------------------
# 7. Установка (altinstall — не трогает системный python3)
# --------------------------------------------------
info "Установка Python в ${PREFIX}..."
make altinstall

# --------------------------------------------------
# 8. Проверка
# --------------------------------------------------
cd ..
info "Проверка установленного Python..."

PYTHON_BIN="${PREFIX}/bin/python3.14"

if [[ ! -x "$PYTHON_BIN" ]]; then
    error "Python 3.14 не установлен в $PYTHON_BIN"
fi

# Проверка ключевых модулей
MODULES=("sqlite3" "ssl" "zlib" "hashlib" "bz2" "lzma")
ALL_OK=true

for mod in "${MODULES[@]}"; do
    if "$PYTHON_BIN" -c "import $mod" 2>/dev/null; then
        info "Модуль $mod: OK"
    else
        warn "Модуль $mod: ОТСУТСТВУЕТ"
        ALL_OK=false
    fi
done

# Версии
SQLITE_VER=$("$PYTHON_BIN" -c "import sqlite3; print(sqlite3.sqlite_version)" 2>/dev/null || echo "—")
PY_VER=$("$PYTHON_BIN" --version)
PIP_VER=$("$PYTHON_BIN" -m pip --version 2>/dev/null || echo "не установлен")

echo ""
info "============================================="
info " Python:   ${PY_VER}"
info " sqlite3:  ${SQLITE_VER}"
info " pip:      ${PIP_VER}"
info " Исполняемый файл: ${PYTHON_BIN}"
info "============================================="

if $ALL_OK; then
    info "Все ключевые модули установлены. Сборка успешна!"
else
    warn "Некоторые модули отсутствуют, но Python работает."
fi

info "Готово! Используйте 'python3.14' для запуска."
