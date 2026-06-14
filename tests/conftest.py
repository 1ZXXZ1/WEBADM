"""
Общие фикстуры и утилиты для тестов SDB.

Предоставляет:
  - Мок-данные LDIF (пользователи, группы, компьютеры)
  - Фикстуры для LdifRecord
  - Моки для subprocess (ldbsearch, samba-tool)
  - Вспомогательные функции для сравнения записей
"""

import pytest
import sys
import os

# Добавляем путь к пакету sdb
_sdb_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
if _sdb_dir not in sys.path:
    sys.path.insert(0, _sdb_dir)

from sdb.parser.ldif import LdifRecord, LdifParser


# ═══════════════════════════════════════════════════════════════
# Фикстуры LDIF данных
# ═══════════════════════════════════════════════════════════════

SAMPLE_LDIF_SAM_USERS = """# record 1
dn: CN=Administrator,CN=Users,DC=kcrb,DC=local
objectClass: user
objectClass: person
objectClass: organizationalPerson
cn: Administrator
sAMAccountName: Administrator
sAMAccountType: 805306368
userAccountControl: 512
whenCreated: 20240101120000.0Z

# record 2
dn: CN=ivan,CN=Users,DC=kcrb,DC=local
objectClass: user
objectClass: person
cn: ivan
sAMAccountName: ivan
sAMAccountType: 805306368
userAccountControl: 512
givenName: Иван
sn: Иванов
mail: ivan@kcrb.local

# record 3
dn: CN=maria,CN=Users,DC=kcrb,DC=local
objectClass: user
objectClass: person
cn: maria
sAMAccountName: maria
sAMAccountType: 805306368
userAccountControl: 66048
givenName: Мария
sn: Петрова

# record 4
dn: CN=disabled_user,CN=Users,DC=kcrb,DC=local
objectClass: user
objectClass: person
cn: disabled_user
sAMAccountName: disabled_user
sAMAccountType: 805306368
userAccountControl: 514

# record 5
dn: CN=Domain Admins,CN=Users,DC=kcrb,DC=local
objectClass: group
cn: Domain Admins
sAMAccountName: Domain Admins
sAMAccountType: 268435456
member: CN=Administrator,CN=Users,DC=kcrb,DC=local

# record 6
dn: CN=Domain Users,CN=Users,DC=kcrb,DC=local
objectClass: group
cn: Domain Users
sAMAccountName: Domain Users
sAMAccountType: 268435456
member: CN=Administrator,CN=Users,DC=kcrb,DC=local
member: CN=ivan,CN=Users,DC=kcrb,DC=local
member: CN=maria,CN=Users,DC=kcrb,DC=local

# record 7
dn: CN=DC01,CN=Computers,DC=kcrb,DC=local
objectClass: computer
cn: DC01
sAMAccountName: DC01$
sAMAccountType: 805306369
objectSid:: AQAAAAAAAUgAAAAIAAAAAAAAAA=

# record 8
dn: CN=_kerberos._tcp.dc,CN=MicrosoftDNS,CN=System,DC=kcrb,DC=local
objectClass: dnsNode
dc: _kerberos._tcp.dc
dnsRecord:: BQAAAAAAAADwDQAAABAAAABXAAYAXwAAAAAOAAEAAQAAAB4AdABjAAcARABjADAxAAQAYwB1cnQ=
ref: ldap://kcrb.local/CN=MicrosoftDNS,DC=DomainDnsZones,DC=kcrb,DC=local

# returned 8 records
# 7 entries
# 1 referrals
"""

SAMPLE_LDIF_PRIVILEGE = """# record 1
dn: S-1-5-32-544
objectClass: privilege
objectSid: S-1-5-32-544
comment: Administrators
privilege: SeBackupPrivilege
privilege: SeDebugPrivilege
privilege: SeRemoteShutdownPrivilege
privilege: SeTakeOwnershipPrivilege
privilege: SeRestorePrivilege

# record 2
dn: S-1-5-32-545
objectClass: privilege
objectSid: S-1-5-32-545
comment: Users
privilege: SeChangeNotifyPrivilege

# returned 2 records
"""

SAMPLE_LDIF_IDMAP = """# record 1
dn: CN=S-1-5-21-1234567890-1234567890-1234567890-500
objectClass: sidMap
cn: S-1-5-21-1234567890-1234567890-1234567890-500
objectSid: S-1-5-21-1234567890-1234567890-1234567890-500
xidNumber: 3000000
type: ID_TYPE_UID

# record 2
dn: CN=S-1-5-21-1234567890-1234567890-1234567890-513
objectClass: sidMap
cn: S-1-5-21-1234567890-1234567890-1234567890-513
objectSid: S-1-5-21-1234567890-1234567890-1234567890-513
xidNumber: 3000001
type: ID_TYPE_GID

# record 3
dn: CN=CONFIG
objectClass: sidMap
cn: CONFIG
xidNumber: 3000100
type: ID_TYPE_BOTH

# returned 3 records
"""

SAMPLE_LDIF_EMPTY = ""

SAMPLE_LDIF_BASE64 = """# record 1
dn: CN=TestUser,CN=Users,DC=kcrb,DC=local
objectClass: user
cn: TestUser
sAMAccountName: TestUser
objectSid:: AQAABwAAACUAAAAAAAAA0gQAAAYAAAsAAAAEAACkAgAA
unicodePwd:: VGVzdFBhc3N3b3JkMTIzIQ==

# returned 1 records
"""

SAMPLE_LDIF_REFERRAL = """# record 1
dn: CN=_kerberos._tcp.dc,CN=MicrosoftDNS,CN=System,DC=kcrb,DC=local
ref: ldap://kcrb.local/CN=MicrosoftDNS,DC=DomainDnsZones,DC=kcrb,DC=local

# record 2
dn: CN=Admin,CN=Users,DC=kcrb,DC=local
objectClass: user
cn: Admin
sAMAccountName: Admin

# returned 2 records
# 1 entries
# 1 referrals
"""

SAMPLE_LDIF_FOLDED = """# record 1
dn: CN=VeryLongName ThatIsSplitAcrossMultipleLines,CN=Users,DC=kcrb,DC=local
objectClass: user
cn: VeryLongName ThatIsSplitAcrossMultiple
 Lines
sAMAccountName: longuser
description: This is a very long description that spans multiple
 lines and should be properly joined together by the LDIF parser

# returned 1 records
"""

SAMPLE_LDIF_MULTI_VALUE = """# record 1
dn: CN=TestGroup,CN=Users,DC=kcrb,DC=local
objectClass: group
cn: TestGroup
sAMAccountName: TestGroup
member: CN=user1,CN=Users,DC=kcrb,DC=local
member: CN=user2,CN=Users,DC=kcrb,DC=local
member: CN=user3,CN=Users,DC=kcrb,DC=local

# returned 1 records
"""


# ═══════════════════════════════════════════════════════════════
# Фикстуры LdifRecord
# ═══════════════════════════════════════════════════════════════

@pytest.fixture
def sample_user():
    """Один пользователь LdifRecord."""
    return LdifRecord(
        dn="CN=ivan,CN=Users,DC=kcrb,DC=local",
        attrs={
            "objectClass": ["user", "person"],
            "cn": ["ivan"],
            "sAMAccountName": ["ivan"],
            "sAMAccountType": ["805306368"],
            "userAccountControl": ["512"],
            "givenName": ["Иван"],
            "sn": ["Иванов"],
            "mail": ["ivan@kcrb.local"],
        }
    )


@pytest.fixture
def sample_group():
    """Одна группа LdifRecord."""
    return LdifRecord(
        dn="CN=Domain Users,CN=Users,DC=kcrb,DC=local",
        attrs={
            "objectClass": ["group"],
            "cn": ["Domain Users"],
            "sAMAccountName": ["Domain Users"],
            "sAMAccountType": ["268435456"],
            "member": [
                "CN=Administrator,CN=Users,DC=kcrb,DC=local",
                "CN=ivan,CN=Users,DC=kcrb,DC=local",
            ],
        }
    )


@pytest.fixture
def sample_computer():
    """Один компьютер LdifRecord."""
    return LdifRecord(
        dn="CN=DC01,CN=Computers,DC=kcrb,DC=local",
        attrs={
            "objectClass": ["computer"],
            "cn": ["DC01"],
            "sAMAccountName": ["DC01$"],
            "sAMAccountType": ["805306369"],
        }
    )


@pytest.fixture
def sample_records():
    """Несколько записей для тестирования."""
    return [
        LdifRecord(
            dn="CN=Admin,CN=Users,DC=kcrb,DC=local",
            attrs={"objectClass": ["user"], "cn": ["Admin"], "sAMAccountName": ["Admin"]},
        ),
        LdifRecord(
            dn="CN=ivan,CN=Users,DC=kcrb,DC=local",
            attrs={"objectClass": ["user"], "cn": ["ivan"], "sAMAccountName": ["ivan"]},
        ),
        LdifRecord(
            dn="CN=Domain Admins,CN=Users,DC=kcrb,DC=local",
            attrs={"objectClass": ["group"], "cn": ["Domain Admins"], "sAMAccountName": ["Domain Admins"]},
        ),
    ]


# ═══════════════════════════════════════════════════════════════
# Фикстуры для мокирования subprocess
# ═══════════════════════════════════════════════════════════════

@pytest.fixture
def mock_ldbsearch_users(mocker):
    """Мок ldbsearch, возвращающий пользователей."""
    return mocker.patch(
        'subprocess.run',
        return_value=mocker.Mock(
            returncode=0,
            stdout=SAMPLE_LDIF_SAM_USERS,
            stderr="",
        )
    )


@pytest.fixture
def mock_ldbsearch_privilege(mocker):
    """Мок ldbsearch, возвращающий привилегии."""
    return mocker.patch(
        'subprocess.run',
        return_value=mocker.Mock(
            returncode=0,
            stdout=SAMPLE_LDIF_PRIVILEGE,
            stderr="",
        )
    )


@pytest.fixture
def mock_ldbsearch_idmap(mocker):
    """Мок ldbsearch, возвращающий idmap."""
    return mocker.patch(
        'subprocess.run',
        return_value=mocker.Mock(
            returncode=0,
            stdout=SAMPLE_LDIF_IDMAP,
            stderr="",
        )
    )


@pytest.fixture
def mock_ldbsearch_empty(mocker):
    """Мок ldbsearch, возвращающий пустой результат."""
    return mocker.patch(
        'subprocess.run',
        return_value=mocker.Mock(
            returncode=0,
            stdout="",
            stderr="",
        )
    )


@pytest.fixture
def mock_samba_tool_ok(mocker):
    """Мок samba-tool, успешное выполнение."""
    return mocker.patch(
        'subprocess.run',
        return_value=mocker.Mock(
            returncode=0,
            stdout="User 'testuser' created successfully\n",
            stderr="",
        )
    )


@pytest.fixture
def mock_samba_tool_user_list(mocker):
    """Мок samba-tool user list."""
    return mocker.patch(
        'subprocess.run',
        return_value=mocker.Mock(
            returncode=0,
            stdout="Administrator\nivan\nmaria\ndisabled_user\n",
            stderr="",
        )
    )


@pytest.fixture
def mock_samba_tool_error(mocker):
    """Мок samba-tool, ошибка выполнения."""
    return mocker.patch(
        'subprocess.run',
        return_value=mocker.Mock(
            returncode=1,
            stdout="",
            stderr="ERROR: Unable to find user 'nonexistent'\n",
        )
    )


# ═══════════════════════════════════════════════════════════════
# Вспомогательные функции
# ═══════════════════════════════════════════════════════════════

def parse_ldif(text):
    """Разобрать LDIF текст в записи."""
    parser = LdifParser()
    return parser.parse(text)


def make_record(dn, **attrs):
    """Быстро создать LdifRecord."""
    attr_dict = {k: [v] if isinstance(v, str) else v for k, v in attrs.items()}
    return LdifRecord(dn=dn, attrs=attr_dict)
