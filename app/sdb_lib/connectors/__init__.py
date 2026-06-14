"""
Коннекторы для SDB — связь с ldbsearch и samba-tool.
"""

from sdb.connectors.ldb import LdbConnector
from sdb.connectors.sambatool import SambaToolConnector

__all__ = ["LdbConnector", "SambaToolConnector"]
