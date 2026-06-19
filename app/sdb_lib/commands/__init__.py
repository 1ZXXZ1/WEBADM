"""
Команды SDB — операции для разных баз данных Samba.
"""

from app.sdb_lib.commands.query import QueryCommands
from app.sdb_lib.commands.user import UserCommands
from app.sdb_lib.commands.group import GroupCommands
from app.sdb_lib.commands.computer import ComputerCommands
from app.sdb_lib.commands.dns_cmd import DnsCommands
from app.sdb_lib.commands.share import ShareCommands
from app.sdb_lib.commands.privilege import PrivilegeCommands
from app.sdb_lib.commands.registry import RegistryCommands
from app.sdb_lib.commands.idmap import IdmapCommands

__all__ = [
    "QueryCommands", "UserCommands", "GroupCommands", "ComputerCommands",
    "DnsCommands", "ShareCommands", "PrivilegeCommands",
    "RegistryCommands", "IdmapCommands",
]
