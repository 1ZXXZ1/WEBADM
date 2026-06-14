"""
Tochka vhoda dlya zapuska: python -m sdb

Dobavlyaem direktoriyu paketa v sys.path,
chtoby rabotalo i s sudo, i iz lyuboj direktorii.

Dlya sistemnoj ustanovki (rekomenduetsya):
    sudo pip3 install .
    # ili
    cd /path/to/sdb/ && sudo python3 setup.py install

Posle ustanovki sdb dostupen kak komanda:
    sdb -e "USE sam; SELECT * FROM *;"
"""

import sys
import os

# Dobavlyaem roditel'skuyu direktoriyu sdb/ v sys.path,
# chtoby `from sdb import ...` rabotal iz lyubogo mesta
_pkg_dir = os.path.dirname(os.path.abspath(__file__))
_parent_dir = os.path.dirname(_pkg_dir)
if _parent_dir not in sys.path:
    sys.path.insert(0, _parent_dir)

# Takzhe dobavlyaem tekushchuyu rabochuyu direktoriyu,
# na sluchaj esli sdb zapuskaetsya iz svoej direktorii
_cwd = os.getcwd()
if _cwd not in sys.path:
    sys.path.insert(0, _cwd)

from sdb.cli import main

if __name__ == "__main__":
    main()
