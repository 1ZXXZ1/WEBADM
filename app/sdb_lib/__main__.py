"""
Точка входа для запуска: python -m app.sdb_lib

Добавляем директорию пакета в sys.path,
чтобы работало и с sudo, и из любой директории.
"""

import sys
import os

# Добавляем проектный корень в sys.path,
# чтобы `from app.sdb_lib import ...` работал из любого места
_pkg_dir = os.path.dirname(os.path.abspath(__file__))    # app/sdb_lib/
_app_dir = os.path.dirname(_pkg_dir)                      # app/
_project_dir = os.path.dirname(_app_dir)                   # проектный корень
for p in [_project_dir, _app_dir, _pkg_dir]:
    if p not in sys.path:
        sys.path.insert(0, p)

# Также добавляем текущую рабочую директорию
_cwd = os.getcwd()
if _cwd not in sys.path:
    sys.path.insert(0, _cwd)

from app.sdb_lib.cli import main

if __name__ == "__main__":
    main()
