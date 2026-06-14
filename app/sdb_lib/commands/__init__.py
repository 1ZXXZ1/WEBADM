"""
Команды SDB — операции для разных баз данных Samba.
"""

from sdb.commands.query import QueryCommands
from sdb.commands.user import UserCommands
from sdb.commands.group import GroupCommands
from sdb.commands.computer import ComputerCommands
from sdb.commands.dns_cmd import DnsCommands
from sdb.commands.share import ShareCommands
from sdb.commands.privilege import PrivilegeCommands
from sdb.commands.registry import RegistryCommands
from sdb.commands.idmap import IdmapCommands

__all__ = [
    "QueryCommands", "UserCommands", "GroupCommands", "ComputerCommands",
    "DnsCommands", "ShareCommands", "PrivilegeCommands",
    "RegistryCommands", "IdmapCommands",
]
