# SDB — Samba Database Query Tool (SKILL)

## Overview
SDB is a specialized tool for direct access to Samba LDB databases. It bypasses samba-tool entirely for read operations, providing faster and more flexible access to AD data. This SKILL enables the AI agent to use SDB for ONE-STEP operations that would otherwise require 10-24 steps.

## Key Advantage: ONE-STEP Operations
Without SDB, a typical task like "export all users with their groups to XLSX" requires:
1. `request_api_access` → discover endpoints
2. `execute_samba_api` → list users
3. `data_import` → import data
4. `ldbsearch_ad groups_bulk` → get groups
5. `data_transform enrich` → merge groups
6. `data_transform filter` → exclude system accounts
7. `data_transform select` → select columns
8. `data_export to_xlsx` → export file
= **8-24 steps, ~1.27₽**

With SDB, the same task:
1. `sdb_execute(action='export', filename='users.xlsx', filter='(objectClass=user)', attrs='sAMAccountName,cn,department,groups', exclude='Administrator,Guest,krbtgt')`
= **1 step, ~0.10₽**

## SDB Tool: `sdb_execute`

### Actions

| Action | Description | Replaces Steps |
|--------|-------------|----------------|
| `query` | Direct LDB query with LDAP filter | ldbsearch_ad + data_import |
| `show` | Show AD object from DB | execute_samba_api GET + parse |
| `select` | SQL-like SELECT query | ldbsearch_ad + data_import + filter |
| `script` | Multi-command SDB script | entire pipeline |
| `synthesis` | Schema analysis | multiple shell commands |
| `tool` | samba-tool via SDB wrapper | execute_shell_command |
| `databases` | List LDB databases | shell: ls + testparm |
| `export` | One-step query + save + download | 5-10 step pipeline |

### When to Use SDB vs ldbsearch_ad

**Use `sdb_execute` when:**
- Complex queries across multiple databases
- SQL-like SELECT needed (FROM USERS WHERE cn=*Admin*)
- Schema analysis (SYNTHESIS) needed
- Batch operations via SDB script
- Export to CSV/JSON/TSV/LDIF (not just XLSX)
- Accessing non-SAM databases (share, privilege, hklm, idmap, secrets, dns)

**Use `ldbsearch_ad` when:**
- Simple user/group listing with `export_xlsx`
- Need `include_groups=true` parameter
- Need `groups_bulk` or `groups_of` action
- Just counting objects

### Quick Examples

**List all users:**
```
sdb_execute(action='select', fields='sAMAccountName,cn,department,mail', scope='USERS')
```

**Export groups to CSV:**
```
sdb_execute(action='export', filename='groups.csv', filter='(objectClass=group)', attrs='sAMAccountName,cn,description')
```

**Query share database:**
```
sdb_execute(action='query', database='share', filter='(objectClass=*)')
```

**SQL-like search:**
```
sdb_execute(action='select', fields='sAMAccountName,cn,mail', scope='USERS', where='cn=*Ivan*')
```

**Schema analysis:**
```
sdb_execute(action='synthesis', subcmd='SCHEMA')
```

**SDB script (multi-command):**
```
sdb_execute(action='script', script_text='USE sam\nFORMAT json\nSELECT cn,mail FROM USERS WHERE cn=*Admin*\nOUTPUT /tmp/admins.json')
```

### Available Databases

| Database | Path | Description |
|----------|------|-------------|
| sam | /var/lib/samba/private/sam.ldb | Main AD database (users, groups, computers, OUs, GPOs, DNS) |
| share | /var/lib/samba/share.ldb | Samba share definitions |
| privilege | /var/lib/samba/private/privilege.ldb | Privilege definitions |
| hklm | /var/lib/samba/registry/hklm.ldb | Windows registry (HKLM) |
| idmap | /var/lib/samba/private/idmap.ldb | ID mapping (UID/GID ↔ SID) |
| secrets | /var/lib/samba/private/secrets.ldb | Secrets and credentials |
| dns | /var/lib/samba/private/dns | DNS zones and records |

### SQL-like Tables

| Table | LDAP Filter | Key Attributes |
|-------|-------------|----------------|
| USERS | (objectClass=user)(sAMAccountType=805306368) | sAMAccountName, cn, mail, department |
| GROUPS | (objectClass=group) | sAMAccountName, cn, description |
| COMPUTERS | (objectClass=computer) | sAMAccountName, cn, operatingSystem, dNSHostName |
| OUS | (objectClass=organizationalUnit) | ou, description |
| GPOS | (objectClass=groupPolicyContainer) | cn, displayName, gPCFileSysPath |
| CONTACTS | (objectClass=contact) | cn, mail |
| DNS_RECORDS | (objectClass=dnsNode) | dc, dnsRecord |

### SDB Script DSL Commands

```
USE <database>        Switch database (sam, share, privilege, etc.)
SELECT <fields> FROM <table> [WHERE <filter>]
FROM <table> [WHERE <filter>]   v2: shorthand — set pending scope+filter
                                 (execution deferred until next SHOW AS)
SHOW AS <format> [LIMIT <N>]    v2: run pending FROM (or re-emit last
                                 records) in <format> with optional limit
FORMAT <format>       Set output format (json, csv, xlsx, etc.)
OUTPUT <filepath>     Write results to file
SHOW <type> [<name>]  Show AD objects from DB
TOOL <cmd> [args...]  Run samba-tool command
LIST <type>           List objects (USERS, GROUPS, etc.)
ENABLE <username>     Enable user account
DISABLE <username>    Disable user account
DELETE USER <name>    Delete user account
FIELDS <field_list>   Set fields for output
LIMIT <n>             Limit number of records
SEARCH <term>         Search across all attributes
DATAFRAME             Convert to pandas DataFrame
SYNTHESIS [subcmd]    Schema analysis (SCHEMA, ENTITY, RELATION, etc.)
SET <key>=<value>     Set script variable
IMPORT <file>         Import data from file
```

### v2 Frontend-Friendly Syntax (SDB AI mode)

The frontend AI Chat (SDB mode) generates scripts in this minimal style:

```
USE sam;
FROM USERS;
SHOW AS json LIMIT 5;
```

Supported variants:

```
USE sam;
FROM USERS WHERE adminCount = 1;
SHOW AS json LIMIT 100;

USE sam;
FROM COMPUTERS WHERE operatingSystem LIKE 'Windows 10%';
SHOW AS csv LIMIT 500;

USE sam;
FROM USERS WHERE userAccountControl = '2';
SHOW AS xlsx;
```

Notes:
- `FROM <table>` only stages the scope/filter — no DB hit yet.
- `SHOW AS <fmt> [LIMIT <N>]` triggers the query and renders in fmt.
- Supported `fmt` values: `json`, `csv`, `tsv`, `xlsx`, `ldif`, `table`.
- If no `FROM` precedes `SHOW AS`, the last result set is re-rendered.

## Efficiency Rules

1. **ONE-STEP**: Use `sdb_execute` with `export` action instead of multi-step pipelines
2. **SQL-like > shell**: `sdb_execute(action='select')` is faster than shell commands
3. **Direct DB access**: SDB reads directly from LDB files, no samba-tool needed for reads
4. **Multi-database**: Access share, privilege, registry, idmap databases in one tool
5. **Batch scripts**: Use `sdb_execute(action='script')` for complex multi-step operations
