"""
Granular permission definitions for the Samba AD DC Management API.

Defines 200+ individual permissions organized by resource category,
default role-permission mappings, and a helper to map request paths
to the required permission.

Roles are fully customisable via the management API.  The three
built-in roles (``admin``, ``operator``, ``auditor``) are seeded
on first database initialisation and can be modified afterwards.

v1.2.5_fix: Added 9 new permissions for ``/full`` endpoints and
dashboard:

- ``user.full``, ``group.full``, ``computer.full``, ``contact.full``,
  ``ou.full``, ``gpo.full``, ``domain.full``, ``fsmo.full`` —
  correspond to the fast ldbsearch ``/full`` GET endpoints added
  in v1.2.1.
- ``dashboard.full`` — corresponds to the ``GET /api/v1/dashboard/full``
  endpoint.

All new permissions are included in ``READ_PERMISSIONS`` (operator
role) and the ``auditor`` role.  Path → permission mappings added
for all ``/full`` routes.

v2.1: Added CFG permissions for runtime .env configuration management
(hot-reload, no service reboot required):

- ``cfg.list``   — list env keys (sensitive values masked)
- ``cfg.show``   — view a single env key value
- ``cfg.schema`` — view settings schema (descriptions, defaults)
- ``cfg.raw``    — download raw .env file
- ``cfg.update`` — update or create an env key (hot-reload)
- ``cfg.bulk``   — bulk update multiple env keys at once
- ``cfg.delete`` — delete an env key from .env
- ``cfg.disable`` — disable a key (set to empty or 'false')
- ``cfg.enable``  — enable a key (set to 'true' or restore)
- ``cfg.reload``  — force reload settings from .env
- ``cfg.persist`` — persist current in-memory env back to .env file

All CFG permissions are admin-only by default (excluded from
``READ_PERMISSIONS`` and ``auditor`` role, because they allow
modifying the running server's configuration). The ``cfg.list``,
``cfg.show``, ``cfg.schema``, ``cfg.raw`` and ``cfg.reload``
permissions are also granted to the ``auditor`` role (read-only
access to view configuration).

v1.2.6_fix (CURRENT): Complete overhaul of the path → permission
resolver. The previous longest-prefix matcher was unable to handle
URLs with path parameters (``{username}``, ``{gpo_id}``, ``{zone}``,
``{projet_id}``, etc.), causing many endpoints to be mapped to the
WRONG permission. As a result non-admin roles (operator, auditor)
were denied access to endpoints they should have been able to use,
or were granted access to endpoints they should NOT have been able
to use.

The fix replaces prefix matching with **regex matching**: each rule
is a compiled regex pattern in which ``{param}`` segments are
rewritten to ``[^/]+``. The longest matching pattern wins. This
correctly distinguishes:

- ``GET  /api/v1/users/john/groups``         → ``user.getgroups``
  (previously matched the ``/api/v1/users/`` prefix → ``user.list``)
- ``POST /api/v1/users/john/enable``         → ``user.enable``
  (previously matched ``/api/v1/users/`` POST → ``user.create``)
- ``POST /api/v1/groups/sales/members``      → ``group.addmembers``
  (previously matched ``/api/v1/groups/`` POST → ``group.create``)
- ``POST /api/v1/shell/projet/42/run``       → ``shell.projet.run``
  (previously matched ``/api/v1/shell/projet/`` POST → ``shell.projet.create``)
- ``GET  /api/v1/dns/zones/example.com/records`` → ``dns.recordlist``
  (previously matched ``/api/v1/dns/`` GET → no rule → ``None``)

In addition, the following previously-unmapped routers now have
explicit permission mappings (so they are no longer "public-by-
accident"):

- **misc** — ``misc.dbcheck``, ``misc.dbcheckfix``, ``misc.ntacl``,
  ``misc.ntaclset``, ``misc.spn``
- **sdb**  — ``sdb.databases``, ``sdb.full``, ``sdb.info``,
  ``sdb.query``, ``sdb.select``, ``sdb.show``, ``sdb.script``,
  ``sdb.synthesis``, ``sdb.export``, ``sdb.exportdownload``,
  ``sdb.exports``
- **report** — ``report.generate``, ``report.download``
- **shell** — ``shell.list``, ``shell.exec``, ``shell.script``
- **shell/projet** — 14 new permissions covering upload-multi, run,
  health, download, owner, tags, schedule, template, snapshot,
  rollback, audit, batch (in addition to the existing create/show/
  list/delete/upload/abort)
- **ai** — ``ai.sdb``, ``ai.balance``, ``ai.test``, ``ai.system``,
  ``ai.datavchema``, ``ai.pipeline``, ``ai.exports``, ``ai.info``,
  ``ai.stream``
- **domain** — ``domain.trustvalidate``, ``domain.backup``,
  ``domain.kdsrootkey``, ``domain.exportkeytab``, ``domain.leave``,
  ``domain.claim``
- **drs** — ``drs.replicate``, ``drs.uptodateness`` (and the
  ``drs.bind`` method corrected from POST to GET)
- **sites** — ``sites.subnetcreate``, ``sites.subnetdelete``,
  ``sites.subnetupdate``
- **service-accounts** — ``serviceaccount.gmsamembers``
- **auth policies / silos** — paths corrected from
  ``/api/v1/auth-policies/`` to ``/api/v1/auth/policies/`` and
  ``/api/v1/auth/silos/`` (matching the actual router prefix)
- **fsmo** — methods corrected from POST to PUT for ``/transfer``
  and ``/seize``
- **dashboard** — added ``dashboard.overview`` for
  ``GET /api/v1/dashboard/overview``
- **cfg** — added ``cfg.persist`` for ``POST /api/v1/cfg/persist``
"""

from __future__ import annotations

import re
from typing import Dict, FrozenSet, List, Optional, Set, Tuple

# ═══════════════════════════════════════════════════════════════════════
# 1. Permission constants  (dot-separated:  resource.action)
# ═══════════════════════════════════════════════════════════════════════

# -- Users ---------------------------------------------------------------
PERM_USER_FULL              = "user.full"
PERM_USER_LIST              = "user.list"
PERM_USER_CREATE            = "user.create"
PERM_USER_SHOW              = "user.show"
PERM_USER_EDIT              = "user.edit"               # v1.2.6_fix
PERM_USER_BATCH             = "user.batch"              # v1.2.6_fix
PERM_USER_DELETE            = "user.delete"
PERM_USER_ENABLE            = "user.enable"
PERM_USER_DISABLE           = "user.disable"
PERM_USER_UNLOCK            = "user.unlock"
PERM_USER_SETPASSWORD       = "user.setpassword"
PERM_USER_GETPASSWORD       = "user.getpassword"
PERM_USER_GETGROUPS         = "user.getgroups"
PERM_USER_SETEXPIRY         = "user.setexpiry"
PERM_USER_SETPRIMARYGROUP   = "user.setprimarygroup"
PERM_USER_ADDUNIXATTRS      = "user.addunixattrs"
PERM_USER_SENSITIVE         = "user.sensitive"
PERM_USER_MOVE              = "user.move"
PERM_USER_RENAME            = "user.rename"
PERM_USER_GETKERBEROSTICKET = "user.getkerberosticket"
PERM_USER_SEARCH            = "user.search"
PERM_USER_IMPORT            = "user.import"
PERM_USER_EXPORT            = "user.export"

# -- Groups --------------------------------------------------------------
PERM_GROUP_FULL           = "group.full"
PERM_GROUP_LIST           = "group.list"
PERM_GROUP_CREATE         = "group.create"
PERM_GROUP_SHOW           = "group.show"
PERM_GROUP_DELETE         = "group.delete"
PERM_GROUP_STATS          = "group.stats"
PERM_GROUP_ADDMEMBERS     = "group.addmembers"
PERM_GROUP_REMOVEMEMBERS  = "group.removemembers"
PERM_GROUP_LISTMEMBERS    = "group.listmembers"
PERM_GROUP_MOVE           = "group.move"
PERM_GROUP_RENAME         = "group.rename"

# -- Computers -----------------------------------------------------------
PERM_COMPUTER_FULL   = "computer.full"
PERM_COMPUTER_LIST   = "computer.list"
PERM_COMPUTER_CREATE = "computer.create"
PERM_COMPUTER_SHOW   = "computer.show"
PERM_COMPUTER_DELETE = "computer.delete"
PERM_COMPUTER_MOVE   = "computer.move"

# -- Contacts ------------------------------------------------------------
PERM_CONTACT_FULL   = "contact.full"
PERM_CONTACT_LIST   = "contact.list"
PERM_CONTACT_CREATE = "contact.create"
PERM_CONTACT_SHOW   = "contact.show"
PERM_CONTACT_DELETE = "contact.delete"
PERM_CONTACT_MOVE   = "contact.move"
PERM_CONTACT_RENAME = "contact.rename"
PERM_CONTACT_SEARCH = "contact.search"

# -- Organizational Units ------------------------------------------------
PERM_OU_FULL         = "ou.full"
PERM_OU_LIST         = "ou.list"
PERM_OU_CREATE       = "ou.create"
PERM_OU_DELETE       = "ou.delete"
PERM_OU_MOVE         = "ou.move"
PERM_OU_RENAME       = "ou.rename"
PERM_OU_LISTOBJECTS  = "ou.listobjects"
PERM_OU_TREE         = "ou.tree"
PERM_OU_STATS        = "ou.stats"
PERM_OU_SEARCH       = "ou.search"

# -- DNS -----------------------------------------------------------------
PERM_DNS_SERVERINFO   = "dns.serverinfo"
PERM_DNS_ZONELIST     = "dns.zonelist"
PERM_DNS_ZONEINFO     = "dns.zoneinfo"
PERM_DNS_ZONECREATE   = "dns.zonecreate"
PERM_DNS_ZONEDELETE   = "dns.zonedelete"
PERM_DNS_RECORDLIST   = "dns.recordlist"
PERM_DNS_RECORDCREATE = "dns.recordcreate"
PERM_DNS_RECORDDELETE = "dns.recorddelete"
PERM_DNS_RECORDUPDATE = "dns.recordupdate"
PERM_DNS_RORECORDS    = "dns.rorecords"
PERM_DNS_ZONEOPTIONS  = "dns.zoneoptions"
PERM_DNS_CACHEFLUSH   = "dns.cacheflush"        # v1.2.6_fix

# -- Group Policy (GPO) --------------------------------------------------
PERM_GPO_FULL        = "gpo.full"
PERM_GPO_LIST        = "gpo.list"
PERM_GPO_CREATE      = "gpo.create"
PERM_GPO_SHOW        = "gpo.show"
PERM_GPO_DELETE      = "gpo.delete"
PERM_GPO_DELETEBYNAME = "gpo.deletebyname"
PERM_GPO_LINK        = "gpo.link"
PERM_GPO_UNLINK      = "gpo.unlink"
PERM_GPO_GETINHERIT  = "gpo.getinherit"
PERM_GPO_SETINHERIT  = "gpo.setinherit"
PERM_GPO_BACKUP      = "gpo.backup"
PERM_GPO_RESTORE     = "gpo.restore"
PERM_GPO_FETCH       = "gpo.fetch"

# -- Domain --------------------------------------------------------------
PERM_DOMAIN_FULL             = "domain.full"
PERM_DOMAIN_INFO             = "domain.info"
PERM_DOMAIN_LEVEL            = "domain.level"
PERM_DOMAIN_PASSWORDSETTINGS = "domain.passwordsettings"
PERM_DOMAIN_SCHEMAS          = "domain.schemas"
PERM_DOMAIN_PROVISION        = "domain.provision"
PERM_DOMAIN_JOIN             = "domain.join"
PERM_DOMAIN_DEMOTE           = "domain.demote"
PERM_DOMAIN_RENAME           = "domain.rename"
PERM_DOMAIN_TRUSTLIST        = "domain.trustlist"
PERM_DOMAIN_TRUSTCREATE      = "domain.trustcreate"
PERM_DOMAIN_TRUSTDELETE      = "domain.trustdelete"
PERM_DOMAIN_TRUSTVALIDATE    = "domain.trustvalidate"   # v1.2.6_fix
PERM_DOMAIN_BACKUP           = "domain.backup"          # v1.2.6_fix
PERM_DOMAIN_KDSROOTKEY       = "domain.kdsrootkey"      # v1.2.6_fix
PERM_DOMAIN_EXPORTKEYTAB     = "domain.exportkeytab"    # v1.2.6_fix
PERM_DOMAIN_LEAVE            = "domain.leave"           # v1.2.6_fix
PERM_DOMAIN_CLAIM            = "domain.claim"           # v1.2.6_fix

# -- DRS (Directory Replication Service) ---------------------------------
PERM_DRS_SHOWREPL     = "drs.showrepl"
PERM_DRS_BIND         = "drs.bind"
PERM_DRS_UNBIND       = "drs.unbind"
PERM_DRS_OPTIONS      = "drs.options"
PERM_DRS_KCC          = "drs.kcc"
PERM_DRS_REPLICATE    = "drs.replicate"      # v1.2.6_fix
PERM_DRS_UPTODATENESS = "drs.uptodateness"   # v1.2.6_fix

# -- Sites ---------------------------------------------------------------
PERM_SITES_LIST          = "sites.list"
PERM_SITES_CREATE        = "sites.create"
PERM_SITES_SHOW          = "sites.show"
PERM_SITES_DELETE        = "sites.delete"
PERM_SITES_SUBNETLIST    = "sites.subnetlist"
PERM_SITES_SUBNETCREATE  = "sites.subnetcreate"   # v1.2.6_fix
PERM_SITES_SUBNETDELETE  = "sites.subnetdelete"   # v1.2.6_fix
PERM_SITES_SUBNETUPDATE  = "sites.subnetupdate"   # v1.2.6_fix

# -- FSMO ----------------------------------------------------------------
PERM_FSMO_FULL     = "fsmo.full"
PERM_FSMO_SHOW     = "fsmo.show"
PERM_FSMO_SEIZE    = "fsmo.seize"
PERM_FSMO_TRANSFER = "fsmo.transfer"
PERM_FSMO_ROLES    = "fsmo.roles"

# -- Schema --------------------------------------------------------------
PERM_SCHEMA_LIST  = "schema.list"
PERM_SCHEMA_SHOW  = "schema.show"
PERM_SCHEMA_QUERY = "schema.query"

# -- Delegation ----------------------------------------------------------
PERM_DELEGATION_LIST   = "delegation.list"
PERM_DELEGATION_SET    = "delegation.set"
PERM_DELEGATION_DELETE = "delegation.delete"

# -- Service accounts ----------------------------------------------------
PERM_SERVICEACCOUNT_LIST        = "serviceaccount.list"
PERM_SERVICEACCOUNT_CREATE      = "serviceaccount.create"
PERM_SERVICEACCOUNT_SHOW        = "serviceaccount.show"
PERM_SERVICEACCOUNT_DELETE      = "serviceaccount.delete"
PERM_SERVICEACCOUNT_GMSA        = "serviceaccount.gmsamembers"   # v1.2.6_fix

# -- Authentication policies ---------------------------------------------
PERM_AUTHPOLICY_LIST        = "authpolicy.list"
PERM_AUTHPOLICY_SHOW        = "authpolicy.show"
PERM_AUTHPOLICY_CREATE      = "authpolicy.create"
PERM_AUTHPOLICY_DELETE      = "authpolicy.delete"
PERM_AUTHPOLICY_UPDATE      = "authpolicy.update"
PERM_AUTHPOLICY_SILO_LIST   = "authpolicy.silolist"      # v1.2.6_fix
PERM_AUTHPOLICY_SILO_SHOW   = "authpolicy.siloshow"      # v1.2.6_fix
PERM_AUTHPOLICY_SILO_CREATE = "authpolicy.silocreate"    # v1.2.6_fix
PERM_AUTHPOLICY_SILO_DELETE = "authpolicy.silodelete"    # v1.2.6_fix
PERM_AUTHPOLICY_SILO_MEMBERS = "authpolicy.silomembers"  # v1.2.6_fix

# -- Batch operations ----------------------------------------------------
PERM_BATCH_EXECUTE = "batch.execute"
PERM_BATCH_STATUS  = "batch.status"

# -- Shell execution (v1.4.3) ---------------------------------------------
PERM_SHELL_LIST    = "shell.list"      # v1.2.6_fix
PERM_SHELL_EXECUTE = "shell.execute"
PERM_SHELL_SCRIPT  = "shell.script"    # v1.2.6_fix
PERM_SHELL_SUDO    = "shell.sudo"

# -- Shell Project (v1.6.4) -----------------------------------------------
PERM_SHELL_PROJET_CREATE       = "shell.projet.create"
PERM_SHELL_PROJET_RUN          = "shell.projet.run"
PERM_SHELL_PROJET_SHOW         = "shell.projet.show"
PERM_SHELL_PROJET_LIST         = "shell.projet.list"
PERM_SHELL_PROJET_DELETE       = "shell.projet.delete"
PERM_SHELL_PROJET_UPLOAD       = "shell.projet.upload"
PERM_SHELL_PROJET_UPLOADMULTI  = "shell.projet.uploadmulti"   # v1.2.6_fix
PERM_SHELL_PROJET_ABORT        = "shell.projet.abort"         # v1.6.5
PERM_SHELL_PROJET_HEALTH       = "shell.projet.health"        # v1.2.6_fix
PERM_SHELL_PROJET_DOWNLOAD     = "shell.projet.download"      # v1.2.6_fix
PERM_SHELL_PROJET_OWNER        = "shell.projet.owner"         # v1.2.6_fix
PERM_SHELL_PROJET_TAGS         = "shell.projet.tags"          # v1.2.6_fix
PERM_SHELL_PROJET_SCHEDULE     = "shell.projet.schedule"      # v1.2.6_fix
PERM_SHELL_PROJET_TEMPLATE     = "shell.projet.template"      # v1.2.6_fix
PERM_SHELL_PROJET_SNAPSHOT     = "shell.projet.snapshot"      # v1.2.6_fix
PERM_SHELL_PROJET_AUDIT        = "shell.projet.audit"         # v1.2.6_fix
PERM_SHELL_PROJET_BATCH        = "shell.projet.batch"         # v1.2.6_fix

# -- Management API (admin panel) ----------------------------------------
PERM_MGMT_USERS_LIST   = "mgmt.users.list"
PERM_MGMT_USERS_CREATE = "mgmt.users.create"
PERM_MGMT_USERS_SHOW   = "mgmt.users.show"
PERM_MGMT_USERS_UPDATE = "mgmt.users.update"
PERM_MGMT_USERS_DELETE = "mgmt.users.delete"
PERM_MGMT_USERS_ENABLE = "mgmt.users.enable"     # v2.2
PERM_MGMT_USERS_DISABLE = "mgmt.users.disable"   # v2.2
PERM_MGMT_USERS_PURGE  = "mgmt.users.purge"      # v2.2
PERM_MGMT_USERS_RESETPW = "mgmt.users.resetpw"   # v2.2
PERM_MGMT_USERS_KEYS   = "mgmt.users.keys"       # v2.2
PERM_MGMT_USERS_BULK   = "mgmt.users.bulk"       # v2.2
PERM_MGMT_KEYS_LIST    = "mgmt.keys.list"
PERM_MGMT_KEYS_CREATE  = "mgmt.keys.create"
PERM_MGMT_KEYS_SHOW    = "mgmt.keys.show"
PERM_MGMT_KEYS_UPDATE  = "mgmt.keys.update"
PERM_MGMT_KEYS_DELETE  = "mgmt.keys.delete"
PERM_MGMT_KEYS_ROTATE  = "mgmt.keys.rotate"
PERM_MGMT_KEYS_ENABLE  = "mgmt.keys.enable"      # v2.2
PERM_MGMT_KEYS_DISABLE = "mgmt.keys.disable"     # v2.2
PERM_MGMT_KEYS_PURGE   = "mgmt.keys.purge"       # v2.2
PERM_MGMT_KEYS_BULK    = "mgmt.keys.bulk"        # v2.2
PERM_MGMT_AUDIT_VIEW   = "mgmt.audit.view"
PERM_MGMT_ROLES_LIST   = "mgmt.roles.list"
PERM_MGMT_ROLES_SHOW   = "mgmt.roles.show"       # v2.2
PERM_MGMT_ROLES_CREATE = "mgmt.roles.create"
PERM_MGMT_ROLES_UPDATE = "mgmt.roles.update"
PERM_MGMT_ROLES_DELETE = "mgmt.roles.delete"
PERM_MGMT_ROLES_ENABLE = "mgmt.roles.enable"     # v2.2
PERM_MGMT_ROLES_DISABLE = "mgmt.roles.disable"   # v2.2
PERM_MGMT_ROLES_GENKEY = "mgmt.roles.genkey"     # v2.2
PERM_MGMT_ROLES_USERS  = "mgmt.roles.users"      # v2.2
PERM_MGMT_ROLES_KEYS   = "mgmt.roles.keys"       # v2.2
PERM_MGMT_PERMS_LIST   = "mgmt.perms.list"
PERM_MGMT_PERMS_ASSIGN = "mgmt.perms.assign"
PERM_MGMT_PERMS_REVOKE = "mgmt.perms.revoke"
PERM_MGMT_STATS        = "mgmt.stats"            # v2.2

# -- Dashboard ----------------------------------------------------------
PERM_DASHBOARD_FULL     = "dashboard.full"
PERM_DASHBOARD_OVERVIEW = "dashboard.overview"   # v1.2.6_fix

# -- System / monitoring -------------------------------------------------
PERM_SYSTEM_HEALTH  = "system.health"
PERM_SYSTEM_STATS   = "system.stats"
PERM_SYSTEM_METRICS = "system.metrics"
PERM_SYSTEM_TASKS   = "system.tasks"

# -- Tasks ---------------------------------------------------------------
PERM_TASKS_LIST = "tasks.list"
PERM_TASKS_VIEW = "tasks.view"

# -- Authentication ------------------------------------------------------
PERM_AUTH_ME    = "auth.me"
PERM_AUTH_CHECK = "auth.check"

# -- AI Chat (v1.8) ──────────────────────────────────────────────────────
PERM_AI_CHAT_CREATE  = "ai.chat.create"
PERM_AI_CHAT_LIST    = "ai.chat.list"
PERM_AI_CHAT_SHOW    = "ai.chat.show"
PERM_AI_CHAT_DELETE  = "ai.chat.delete"
PERM_AI_CHAT_SEND    = "ai.chat.send"
PERM_AI_CHAT_HISTORY = "ai.chat.history"
PERM_AI_CHAT_ADMIN   = "ai.chat.admin"     # See/manage all users' chats
PERM_AI_CHAT_INFO    = "ai.chat.info"      # v1.2.6_fix
PERM_AI_CHAT_STREAM  = "ai.chat.stream"    # v1.2.6_fix

# -- AI Assistant (v1.8) ────────────────────────────────────────────────
PERM_AI_ASSISTANT   = "ai.assistant"
PERM_AI_AGENT       = "ai.agent"
PERM_AI_SCHEMA      = "ai.schema"
PERM_AI_CONFIG      = "ai.config"
PERM_AI_SDB         = "ai.sdb"             # v1.2.6_fix
PERM_AI_BALANCE     = "ai.balance"         # v1.2.6_fix
PERM_AI_TEST        = "ai.test"            # v1.2.6_fix
PERM_AI_SYSTEM      = "ai.system"          # v1.2.6_fix
PERM_AI_DATASCHEMA  = "ai.datavchema"      # v1.2.6_fix
PERM_AI_PIPELINE    = "ai.pipeline"        # v1.2.6_fix
PERM_AI_EXPORTS     = "ai.exports"         # v1.2.6_fix
PERM_AI_INFO        = "ai.info"            # v1.2.6_fix

# -- Samba Shares (v1.8) ────────────────────────────────────────────────
PERM_SHARE_LIST      = "share.list"
PERM_SHARE_CREATE    = "share.create"
PERM_SHARE_EDIT      = "share.edit"
PERM_SHARE_DELETE    = "share.delete"
PERM_SHARE_CONFIG    = "share.config"

# -- SDB (v2.0) ─────────────────────────────────────────────────────────
PERM_SDB_DATABASES      = "sdb.databases"        # v1.2.6_fix
PERM_SDB_FULL           = "sdb.full"             # v1.2.6_fix
PERM_SDB_INFO           = "sdb.info"             # v1.2.6_fix
PERM_SDB_QUERY          = "sdb.query"            # v1.2.6_fix
PERM_SDB_SELECT         = "sdb.select"           # v1.2.6_fix
PERM_SDB_SHOW           = "sdb.show"             # v1.2.6_fix
PERM_SDB_SCRIPT         = "sdb.script"           # v1.2.6_fix
PERM_SDB_SYNTHESIS      = "sdb.synthesis"        # v1.2.6_fix
PERM_SDB_EXPORT         = "sdb.export"           # v1.2.6_fix
PERM_SDB_EXPORTDOWNLOAD = "sdb.exportdownload"   # v1.2.6_fix
PERM_SDB_EXPORTS        = "sdb.exports"          # v1.2.6_fix

# -- Report (v1.9-3-4) ──────────────────────────────────────────────────
PERM_REPORT_GENERATE = "report.generate"   # v1.2.6_fix
PERM_REPORT_DOWNLOAD = "report.download"   # v1.2.6_fix

# -- Misc ----------------------------------------------------------------
PERM_MISC_TIME        = "misc.time"
PERM_MISC_PROCESSES   = "misc.processes"
PERM_MISC_TESTPARAM   = "misc.testparm"
PERM_MISC_DBCHECK     = "misc.dbcheck"      # v1.2.6_fix
PERM_MISC_DBCHECKFIX  = "misc.dbcheckfix"   # v1.2.6_fix
PERM_MISC_NTACL       = "misc.ntacl"        # v1.2.6_fix
PERM_MISC_NTACLSET    = "misc.ntaclset"     # v1.2.6_fix
PERM_MISC_SPN         = "misc.spn"          # v1.2.6_fix

# -- CFG (Runtime .env configuration — v2.1) -----------------------------
# Hot-reload .env management. Admin-only by default. View permissions
# also granted to auditor role (read-only).
PERM_CFG_LIST    = "cfg.list"     # List all env keys (sensitive masked)
PERM_CFG_SHOW    = "cfg.show"     # View a single env key value
PERM_CFG_SCHEMA  = "cfg.schema"   # View settings schema (descriptions, defaults)
PERM_CFG_RAW     = "cfg.raw"      # Download raw .env file
PERM_CFG_UPDATE  = "cfg.update"   # Update or create an env key (hot-reload)
PERM_CFG_BULK    = "cfg.bulk"     # Bulk update multiple env keys at once
PERM_CFG_DELETE  = "cfg.delete"   # Delete a key from .env
PERM_CFG_DISABLE = "cfg.disable"  # Disable a key (set to empty or 'false')
PERM_CFG_ENABLE  = "cfg.enable"   # Enable a key (set to 'true' or restore)
PERM_CFG_RELOAD  = "cfg.reload"   # Force reload settings from .env
PERM_CFG_PERSIST = "cfg.persist"  # Persist current env back to .env (v1.2.6_fix)

# -- Bans (v1.2.7_ban) ---------------------------------------------------
# Admin-only by default — banning disrupts access. Even read access to
# the ban list is sensitive (reveals who has been blocked and why).
PERM_BAN_CREATE = "ban.create"    # POST /api/v1/ban
PERM_BAN_UNBAN  = "ban.unban"     # POST /api/v1/unban
PERM_BAN_LIST   = "ban.list"      # GET  /api/v1/ban
PERM_BAN_SHOW   = "ban.show"      # GET  /api/v1/ban/{id} + GET /api/v1/ban/check/*
PERM_BAN_DELETE = "ban.delete"    # DELETE /api/v1/ban/{id} (hard-delete)

# -- Webhooks (v2.3) -----------------------------------------------------
PERM_WEBHOOK_LIST   = "webhook.list"
PERM_WEBHOOK_CREATE = "webhook.create"
PERM_WEBHOOK_SHOW   = "webhook.show"
PERM_WEBHOOK_UPDATE = "webhook.update"
PERM_WEBHOOK_DELETE = "webhook.delete"
PERM_WEBHOOK_TEST   = "webhook.test"

# -- Backup & Restore (v2.3) ---------------------------------------------
PERM_BACKUP_CREATE  = "backup.create"
PERM_BACKUP_LIST    = "backup.list"
PERM_BACKUP_DOWNLOAD = "backup.download"
PERM_BACKUP_DELETE  = "backup.delete"
PERM_BACKUP_RESTORE = "backup.restore"

# -- Bulk user operations (v2.3) -----------------------------------------
PERM_USER_BULK = "user.bulk"

# -- Audit export (v2.3) -------------------------------------------------
PERM_AUDIT_EXPORT = "audit.export"

# -- 2FA / TOTP (v2.3) ---------------------------------------------------
PERM_AUTH_2FA_SETUP   = "auth.2fa.setup"
PERM_AUTH_2FA_ENABLE  = "auth.2fa.enable"
PERM_AUTH_2FA_DISABLE = "auth.2fa.disable"
PERM_AUTH_2FA_STATUS  = "auth.2fa.status"
PERM_AUTH_2FA_VERIFY  = "auth.2fa.verify"
# v2.3.1: Admin-only endpoints for managing 2FA on OTHER users
PERM_AUTH_2FA_ADMIN_STATUS  = "auth.2fa.admin.status"
PERM_AUTH_2FA_ADMIN_SETUP   = "auth.2fa.admin.setup"
PERM_AUTH_2FA_ADMIN_ENABLE  = "auth.2fa.admin.enable"
PERM_AUTH_2FA_ADMIN_DISABLE = "auth.2fa.admin.disable"
PERM_AUTH_2FA_ADMIN_RESET   = "auth.2fa.admin.reset"
PERM_AUTH_2FA_ADMIN_LIST    = "auth.2fa.admin.list"

# -- Dashboard charts (v2.3) ---------------------------------------------
PERM_DASHBOARD_CHARTS = "dashboard.charts"

# -- Live updates (v2.3) -------------------------------------------------
PERM_LIVE_EVENTS = "live.events"

# -- Shell project files (v2.3) ------------------------------------------
PERM_SHELL_PROJET_FILES_LIST   = "shell.projet.files.list"
PERM_SHELL_PROJET_FILES_READ   = "shell.projet.files.read"
PERM_SHELL_PROJET_FILES_WRITE  = "shell.projet.files.write"
PERM_SHELL_PROJET_FILES_DELETE = "shell.projet.files.delete"

# -- Env encryption (v2.3) -----------------------------------------------
PERM_CFG_ENCRYPT = "cfg.encrypt"

# -- Chat (v2.4) ---------------------------------------------------------
PERM_CHAT_ROOM_LIST    = "chat.room.list"
PERM_CHAT_ROOM_CREATE  = "chat.room.create"
PERM_CHAT_ROOM_SHOW    = "chat.room.show"
PERM_CHAT_ROOM_UPDATE  = "chat.room.update"
PERM_CHAT_ROOM_DELETE  = "chat.room.delete"
PERM_CHAT_MEMBER_LIST  = "chat.member.list"
PERM_CHAT_MEMBER_ADD   = "chat.member.add"
PERM_CHAT_MEMBER_REMOVE = "chat.member.remove"
PERM_CHAT_MESSAGE_LIST = "chat.message.list"
PERM_CHAT_MESSAGE_SEND = "chat.message.send"
PERM_CHAT_MESSAGE_EDIT = "chat.message.edit"
PERM_CHAT_MESSAGE_DELETE = "chat.message.delete"
PERM_CHAT_FILE_UPLOAD  = "chat.file.upload"
PERM_CHAT_FILE_DOWNLOAD = "chat.file.download"
PERM_CHAT_VOICE_UPLOAD = "chat.voice.upload"
PERM_CHAT_SEARCH       = "chat.search"

# ═══════════════════════════════════════════════════════════════════════
# 2. All permissions set
# ═══════════════════════════════════════════════════════════════════════

ALL_PERMISSIONS: FrozenSet[str] = frozenset({
    # Users (23)
    PERM_USER_FULL,
    PERM_USER_LIST, PERM_USER_CREATE, PERM_USER_SHOW, PERM_USER_EDIT,
    PERM_USER_BATCH, PERM_USER_DELETE,
    PERM_USER_ENABLE, PERM_USER_DISABLE, PERM_USER_UNLOCK,
    PERM_USER_SETPASSWORD, PERM_USER_GETPASSWORD, PERM_USER_GETGROUPS,
    PERM_USER_SETEXPIRY, PERM_USER_SETPRIMARYGROUP, PERM_USER_ADDUNIXATTRS,
    PERM_USER_SENSITIVE, PERM_USER_MOVE, PERM_USER_RENAME,
    PERM_USER_GETKERBEROSTICKET, PERM_USER_SEARCH, PERM_USER_IMPORT,
    PERM_USER_EXPORT,
    # Groups (11)
    PERM_GROUP_FULL,
    PERM_GROUP_LIST, PERM_GROUP_CREATE, PERM_GROUP_SHOW, PERM_GROUP_DELETE,
    PERM_GROUP_STATS, PERM_GROUP_ADDMEMBERS, PERM_GROUP_REMOVEMEMBERS,
    PERM_GROUP_LISTMEMBERS, PERM_GROUP_MOVE, PERM_GROUP_RENAME,
    # Computers (6)
    PERM_COMPUTER_FULL,
    PERM_COMPUTER_LIST, PERM_COMPUTER_CREATE, PERM_COMPUTER_SHOW,
    PERM_COMPUTER_DELETE, PERM_COMPUTER_MOVE,
    # Contacts (8)
    PERM_CONTACT_FULL,
    PERM_CONTACT_LIST, PERM_CONTACT_CREATE, PERM_CONTACT_SHOW,
    PERM_CONTACT_DELETE, PERM_CONTACT_MOVE, PERM_CONTACT_RENAME,
    PERM_CONTACT_SEARCH,
    # OUs (10)
    PERM_OU_FULL,
    PERM_OU_LIST, PERM_OU_CREATE, PERM_OU_DELETE, PERM_OU_MOVE,
    PERM_OU_RENAME, PERM_OU_LISTOBJECTS, PERM_OU_TREE, PERM_OU_STATS,
    PERM_OU_SEARCH,
    # DNS (12)
    PERM_DNS_SERVERINFO, PERM_DNS_ZONELIST, PERM_DNS_ZONEINFO,
    PERM_DNS_ZONECREATE, PERM_DNS_ZONEDELETE, PERM_DNS_RECORDLIST,
    PERM_DNS_RECORDCREATE, PERM_DNS_RECORDDELETE, PERM_DNS_RECORDUPDATE,
    PERM_DNS_RORECORDS, PERM_DNS_ZONEOPTIONS, PERM_DNS_CACHEFLUSH,
    # GPO (14)
    PERM_GPO_FULL,
    PERM_GPO_LIST, PERM_GPO_CREATE, PERM_GPO_SHOW, PERM_GPO_DELETE,
    PERM_GPO_DELETEBYNAME, PERM_GPO_LINK, PERM_GPO_UNLINK,
    PERM_GPO_GETINHERIT, PERM_GPO_SETINHERIT, PERM_GPO_BACKUP,
    PERM_GPO_RESTORE, PERM_GPO_FETCH,
    # Domain (18)
    PERM_DOMAIN_FULL,
    PERM_DOMAIN_INFO, PERM_DOMAIN_LEVEL, PERM_DOMAIN_PASSWORDSETTINGS,
    PERM_DOMAIN_SCHEMAS, PERM_DOMAIN_PROVISION, PERM_DOMAIN_JOIN,
    PERM_DOMAIN_DEMOTE, PERM_DOMAIN_RENAME, PERM_DOMAIN_TRUSTLIST,
    PERM_DOMAIN_TRUSTCREATE, PERM_DOMAIN_TRUSTDELETE,
    PERM_DOMAIN_TRUSTVALIDATE, PERM_DOMAIN_BACKUP, PERM_DOMAIN_KDSROOTKEY,
    PERM_DOMAIN_EXPORTKEYTAB, PERM_DOMAIN_LEAVE, PERM_DOMAIN_CLAIM,
    # DRS (7)
    PERM_DRS_SHOWREPL, PERM_DRS_BIND, PERM_DRS_UNBIND, PERM_DRS_OPTIONS,
    PERM_DRS_KCC, PERM_DRS_REPLICATE, PERM_DRS_UPTODATENESS,
    # Sites (8)
    PERM_SITES_LIST, PERM_SITES_CREATE, PERM_SITES_SHOW,
    PERM_SITES_DELETE, PERM_SITES_SUBNETLIST,
    PERM_SITES_SUBNETCREATE, PERM_SITES_SUBNETDELETE, PERM_SITES_SUBNETUPDATE,
    # FSMO (5)
    PERM_FSMO_FULL, PERM_FSMO_SHOW, PERM_FSMO_SEIZE, PERM_FSMO_TRANSFER, PERM_FSMO_ROLES,
    # Schema (3)
    PERM_SCHEMA_LIST, PERM_SCHEMA_SHOW, PERM_SCHEMA_QUERY,
    # Delegation (3)
    PERM_DELEGATION_LIST, PERM_DELEGATION_SET, PERM_DELEGATION_DELETE,
    # Service accounts (5)
    PERM_SERVICEACCOUNT_LIST, PERM_SERVICEACCOUNT_CREATE,
    PERM_SERVICEACCOUNT_SHOW, PERM_SERVICEACCOUNT_DELETE,
    PERM_SERVICEACCOUNT_GMSA,
    # Auth policies (10)
    PERM_AUTHPOLICY_LIST, PERM_AUTHPOLICY_SHOW, PERM_AUTHPOLICY_CREATE,
    PERM_AUTHPOLICY_DELETE, PERM_AUTHPOLICY_UPDATE,
    PERM_AUTHPOLICY_SILO_LIST, PERM_AUTHPOLICY_SILO_SHOW,
    PERM_AUTHPOLICY_SILO_CREATE, PERM_AUTHPOLICY_SILO_DELETE,
    PERM_AUTHPOLICY_SILO_MEMBERS,
    # Shell (4)
    PERM_SHELL_LIST, PERM_SHELL_EXECUTE, PERM_SHELL_SCRIPT, PERM_SHELL_SUDO,
    # Shell Project (17) — v1.6.4 + v1.2.6_fix
    PERM_SHELL_PROJET_CREATE, PERM_SHELL_PROJET_RUN,
    PERM_SHELL_PROJET_SHOW, PERM_SHELL_PROJET_LIST,
    PERM_SHELL_PROJET_DELETE, PERM_SHELL_PROJET_UPLOAD,
    PERM_SHELL_PROJET_UPLOADMULTI, PERM_SHELL_PROJET_ABORT,
    PERM_SHELL_PROJET_HEALTH, PERM_SHELL_PROJET_DOWNLOAD,
    PERM_SHELL_PROJET_OWNER, PERM_SHELL_PROJET_TAGS,
    PERM_SHELL_PROJET_SCHEDULE, PERM_SHELL_PROJET_TEMPLATE,
    PERM_SHELL_PROJET_SNAPSHOT, PERM_SHELL_PROJET_AUDIT,
    PERM_SHELL_PROJET_BATCH,
    # Batch (2)
    PERM_BATCH_EXECUTE, PERM_BATCH_STATUS,
    # Management (extended in v2.2)
    PERM_MGMT_USERS_LIST, PERM_MGMT_USERS_CREATE, PERM_MGMT_USERS_SHOW,
    PERM_MGMT_USERS_UPDATE, PERM_MGMT_USERS_DELETE,
    PERM_MGMT_USERS_ENABLE, PERM_MGMT_USERS_DISABLE, PERM_MGMT_USERS_PURGE,
    PERM_MGMT_USERS_RESETPW, PERM_MGMT_USERS_KEYS, PERM_MGMT_USERS_BULK,
    PERM_MGMT_KEYS_LIST, PERM_MGMT_KEYS_CREATE, PERM_MGMT_KEYS_SHOW,
    PERM_MGMT_KEYS_UPDATE, PERM_MGMT_KEYS_DELETE, PERM_MGMT_KEYS_ROTATE,
    PERM_MGMT_KEYS_ENABLE, PERM_MGMT_KEYS_DISABLE, PERM_MGMT_KEYS_PURGE,
    PERM_MGMT_KEYS_BULK,
    PERM_MGMT_AUDIT_VIEW,
    PERM_MGMT_ROLES_LIST, PERM_MGMT_ROLES_SHOW, PERM_MGMT_ROLES_CREATE,
    PERM_MGMT_ROLES_UPDATE, PERM_MGMT_ROLES_DELETE,
    PERM_MGMT_ROLES_ENABLE, PERM_MGMT_ROLES_DISABLE,
    PERM_MGMT_ROLES_GENKEY, PERM_MGMT_ROLES_USERS, PERM_MGMT_ROLES_KEYS,
    PERM_MGMT_PERMS_LIST, PERM_MGMT_PERMS_ASSIGN, PERM_MGMT_PERMS_REVOKE,
    PERM_MGMT_STATS,
    # Dashboard (2)
    PERM_DASHBOARD_FULL, PERM_DASHBOARD_OVERVIEW,
    # System (4)
    PERM_SYSTEM_HEALTH, PERM_SYSTEM_STATS, PERM_SYSTEM_METRICS,
    PERM_SYSTEM_TASKS,
    # Tasks (2)
    PERM_TASKS_LIST, PERM_TASKS_VIEW,
    # Misc (7)
    PERM_MISC_TIME, PERM_MISC_PROCESSES, PERM_MISC_TESTPARAM,
    PERM_MISC_DBCHECK, PERM_MISC_DBCHECKFIX,
    PERM_MISC_NTACL, PERM_MISC_NTACLSET, PERM_MISC_SPN,
    # Auth (2)
    PERM_AUTH_ME, PERM_AUTH_CHECK,
    # AI Chat (9) — v1.8 + v1.2.6_fix
    PERM_AI_CHAT_CREATE, PERM_AI_CHAT_LIST, PERM_AI_CHAT_SHOW,
    PERM_AI_CHAT_DELETE, PERM_AI_CHAT_SEND, PERM_AI_CHAT_HISTORY,
    PERM_AI_CHAT_ADMIN, PERM_AI_CHAT_INFO, PERM_AI_CHAT_STREAM,
    # AI Assistant (12) — v1.8 + v1.2.6_fix
    PERM_AI_ASSISTANT, PERM_AI_AGENT, PERM_AI_SCHEMA, PERM_AI_CONFIG,
    PERM_AI_SDB, PERM_AI_BALANCE, PERM_AI_TEST, PERM_AI_SYSTEM,
    PERM_AI_DATASCHEMA, PERM_AI_PIPELINE, PERM_AI_EXPORTS, PERM_AI_INFO,
    # Samba Shares (5) — v1.8
    PERM_SHARE_LIST, PERM_SHARE_CREATE, PERM_SHARE_EDIT,
    PERM_SHARE_DELETE, PERM_SHARE_CONFIG,
    # SDB (11) — v2.0
    PERM_SDB_DATABASES, PERM_SDB_FULL, PERM_SDB_INFO,
    PERM_SDB_QUERY, PERM_SDB_SELECT, PERM_SDB_SHOW, PERM_SDB_SCRIPT,
    PERM_SDB_SYNTHESIS, PERM_SDB_EXPORT, PERM_SDB_EXPORTDOWNLOAD,
    PERM_SDB_EXPORTS,
    # Report (2) — v1.9-3-4
    PERM_REPORT_GENERATE, PERM_REPORT_DOWNLOAD,
    # CFG (11) — v2.1 + v1.2.6_fix
    PERM_CFG_LIST, PERM_CFG_SHOW, PERM_CFG_SCHEMA, PERM_CFG_RAW,
    PERM_CFG_UPDATE, PERM_CFG_BULK, PERM_CFG_DELETE,
    PERM_CFG_DISABLE, PERM_CFG_ENABLE, PERM_CFG_RELOAD, PERM_CFG_PERSIST,
    # Bans (5) — v1.2.7_ban
    PERM_BAN_CREATE, PERM_BAN_UNBAN, PERM_BAN_LIST, PERM_BAN_SHOW,
    PERM_BAN_DELETE,
    # Webhooks (6) — v2.3
    PERM_WEBHOOK_LIST, PERM_WEBHOOK_CREATE, PERM_WEBHOOK_SHOW,
    PERM_WEBHOOK_UPDATE, PERM_WEBHOOK_DELETE, PERM_WEBHOOK_TEST,
    # Backup & Restore (5) — v2.3
    PERM_BACKUP_CREATE, PERM_BACKUP_LIST, PERM_BACKUP_DOWNLOAD,
    PERM_BACKUP_DELETE, PERM_BACKUP_RESTORE,
    # Bulk user ops (1) — v2.3
    PERM_USER_BULK,
    # Audit export (1) — v2.3
    PERM_AUDIT_EXPORT,
    # 2FA (5) — v2.3
    PERM_AUTH_2FA_SETUP, PERM_AUTH_2FA_ENABLE, PERM_AUTH_2FA_DISABLE,
    PERM_AUTH_2FA_STATUS, PERM_AUTH_2FA_VERIFY,
    # 2FA admin (6) — v2.3.1
    PERM_AUTH_2FA_ADMIN_STATUS, PERM_AUTH_2FA_ADMIN_SETUP,
    PERM_AUTH_2FA_ADMIN_ENABLE, PERM_AUTH_2FA_ADMIN_DISABLE,
    PERM_AUTH_2FA_ADMIN_RESET, PERM_AUTH_2FA_ADMIN_LIST,
    # Dashboard charts (1) — v2.3
    PERM_DASHBOARD_CHARTS,
    # Live updates (1) — v2.3
    PERM_LIVE_EVENTS,
    # Shell project files (4) — v2.3
    PERM_SHELL_PROJET_FILES_LIST, PERM_SHELL_PROJET_FILES_READ,
    PERM_SHELL_PROJET_FILES_WRITE, PERM_SHELL_PROJET_FILES_DELETE,
    # Env encryption (1) — v2.3
    PERM_CFG_ENCRYPT,
    # Chat (16) — v2.4
    PERM_CHAT_ROOM_LIST, PERM_CHAT_ROOM_CREATE, PERM_CHAT_ROOM_SHOW,
    PERM_CHAT_ROOM_UPDATE, PERM_CHAT_ROOM_DELETE,
    PERM_CHAT_MEMBER_LIST, PERM_CHAT_MEMBER_ADD, PERM_CHAT_MEMBER_REMOVE,
    PERM_CHAT_MESSAGE_LIST, PERM_CHAT_MESSAGE_SEND,
    PERM_CHAT_MESSAGE_EDIT, PERM_CHAT_MESSAGE_DELETE,
    PERM_CHAT_FILE_UPLOAD, PERM_CHAT_FILE_DOWNLOAD,
    PERM_CHAT_VOICE_UPLOAD, PERM_CHAT_SEARCH,
})

# ═══════════════════════════════════════════════════════════════════════
# 3. Read-only permissions subset (for operator/auditor default roles)
# ═══════════════════════════════════════════════════════════════════════

READ_PERMISSIONS: FrozenSet[str] = frozenset({
    # /full endpoints (ldbsearch fast reads)
    PERM_USER_FULL, PERM_GROUP_FULL, PERM_COMPUTER_FULL,
    PERM_CONTACT_FULL, PERM_OU_FULL, PERM_GPO_FULL,
    PERM_DOMAIN_FULL, PERM_FSMO_FULL, PERM_DASHBOARD_FULL,
    PERM_DASHBOARD_OVERVIEW,
    # Regular list/show reads
    PERM_USER_LIST, PERM_USER_SHOW, PERM_USER_GETGROUPS, PERM_USER_BATCH,
    PERM_USER_SEARCH, PERM_USER_EXPORT,
    PERM_GROUP_LIST, PERM_GROUP_SHOW, PERM_GROUP_STATS, PERM_GROUP_LISTMEMBERS,
    PERM_COMPUTER_LIST, PERM_COMPUTER_SHOW,
    PERM_CONTACT_LIST, PERM_CONTACT_SHOW, PERM_CONTACT_SEARCH,
    PERM_OU_LIST, PERM_OU_LISTOBJECTS, PERM_OU_TREE, PERM_OU_STATS,
    PERM_OU_SEARCH,
    PERM_DNS_SERVERINFO, PERM_DNS_ZONELIST, PERM_DNS_ZONEINFO,
    PERM_DNS_RECORDLIST, PERM_DNS_RORECORDS,
    PERM_GPO_LIST, PERM_GPO_SHOW, PERM_GPO_GETINHERIT, PERM_GPO_FETCH,
    PERM_DOMAIN_INFO, PERM_DOMAIN_LEVEL, PERM_DOMAIN_PASSWORDSETTINGS,
    PERM_DOMAIN_SCHEMAS, PERM_DOMAIN_TRUSTLIST, PERM_DOMAIN_TRUSTVALIDATE,
    PERM_DOMAIN_KDSROOTKEY, PERM_DOMAIN_CLAIM,
    PERM_DRS_SHOWREPL, PERM_DRS_UPTODATENESS,
    PERM_SITES_LIST, PERM_SITES_SHOW, PERM_SITES_SUBNETLIST,
    PERM_FSMO_SHOW, PERM_FSMO_ROLES,
    PERM_SCHEMA_LIST, PERM_SCHEMA_SHOW, PERM_SCHEMA_QUERY,
    PERM_DELEGATION_LIST,
    PERM_SERVICEACCOUNT_LIST, PERM_SERVICEACCOUNT_SHOW,
    PERM_SERVICEACCOUNT_GMSA,
    PERM_AUTHPOLICY_LIST, PERM_AUTHPOLICY_SHOW,
    PERM_AUTHPOLICY_SILO_LIST, PERM_AUTHPOLICY_SILO_SHOW,
    PERM_SYSTEM_HEALTH, PERM_SYSTEM_STATS, PERM_SYSTEM_METRICS,
    PERM_SYSTEM_TASKS, PERM_TASKS_LIST, PERM_TASKS_VIEW,
    PERM_MISC_TIME, PERM_MISC_PROCESSES, PERM_MISC_TESTPARAM,
    PERM_MISC_DBCHECK, PERM_MISC_NTACL, PERM_MISC_SPN,
    PERM_AUTH_ME, PERM_AUTH_CHECK,
    # AI Chat read permissions — v1.8
    PERM_AI_CHAT_LIST, PERM_AI_CHAT_SHOW, PERM_AI_CHAT_HISTORY,
    PERM_AI_CHAT_INFO,
    PERM_AI_ASSISTANT, PERM_AI_SCHEMA, PERM_AI_CONFIG,
    PERM_AI_BALANCE, PERM_AI_TEST, PERM_AI_INFO,
    PERM_AI_SYSTEM, PERM_AI_DATASCHEMA, PERM_AI_PIPELINE, PERM_AI_EXPORTS,
    # Samba Shares read permissions — v1.8
    PERM_SHARE_LIST, PERM_SHARE_CONFIG,
    # SDB read permissions — v2.0
    PERM_SDB_DATABASES, PERM_SDB_FULL, PERM_SDB_INFO,
    PERM_SDB_SYNTHESIS, PERM_SDB_EXPORTS, PERM_SDB_EXPORTDOWNLOAD,
    # Report read permissions — v1.9-3-4
    PERM_REPORT_DOWNLOAD,
    # Shell projet read permissions — v1.6.4
    PERM_SHELL_PROJET_SHOW, PERM_SHELL_PROJET_LIST,
    PERM_SHELL_PROJET_HEALTH, PERM_SHELL_PROJET_DOWNLOAD,
    PERM_SHELL_PROJET_AUDIT,
    PERM_SHELL_LIST,
    # CFG read-only permissions — v2.1
    # NOTE: Only view/reload permissions are granted to operator.
    # Update/delete/disable/enable/bulk/persist are admin-only because they
    # modify the running server's configuration.
    PERM_CFG_LIST, PERM_CFG_SHOW, PERM_CFG_SCHEMA, PERM_CFG_RELOAD,
    # v2.3 — read-only access to new modules
    PERM_DASHBOARD_CHARTS,
    PERM_LIVE_EVENTS,
    PERM_AUDIT_EXPORT,
    PERM_BACKUP_LIST, PERM_BACKUP_DOWNLOAD,
    PERM_SHELL_PROJET_FILES_LIST, PERM_SHELL_PROJET_FILES_READ,
    # Chat permissions — v2.4 (all users can chat)
    PERM_CHAT_ROOM_LIST, PERM_CHAT_ROOM_CREATE, PERM_CHAT_ROOM_SHOW,
    PERM_CHAT_MEMBER_LIST,
    PERM_CHAT_MESSAGE_LIST, PERM_CHAT_MESSAGE_SEND,
    PERM_CHAT_FILE_UPLOAD, PERM_CHAT_FILE_DOWNLOAD,
    PERM_CHAT_VOICE_UPLOAD, PERM_CHAT_SEARCH,
})

# ═══════════════════════════════════════════════════════════════════════
# 4. Default role → permission mapping
# ═══════════════════════════════════════════════════════════════════════

DEFAULT_ROLE_PERMISSIONS: Dict[str, FrozenSet[str]] = {
    "admin": ALL_PERMISSIONS,
    "operator": READ_PERMISSIONS,
    "auditor": frozenset({
        # /full endpoints (ldbsearch fast reads) — auditor gets ALL of these
        PERM_USER_FULL, PERM_GROUP_FULL, PERM_COMPUTER_FULL,
        PERM_CONTACT_FULL, PERM_OU_FULL, PERM_GPO_FULL,
        PERM_DOMAIN_FULL, PERM_FSMO_FULL, PERM_DASHBOARD_FULL,
        PERM_DASHBOARD_OVERVIEW,
        # Regular read-only permissions
        PERM_USER_LIST, PERM_USER_SHOW, PERM_USER_GETGROUPS, PERM_USER_BATCH,
        PERM_USER_SEARCH, PERM_USER_EXPORT,
        PERM_GROUP_LIST, PERM_GROUP_SHOW, PERM_GROUP_STATS, PERM_GROUP_LISTMEMBERS,
        PERM_COMPUTER_LIST, PERM_COMPUTER_SHOW,
        PERM_CONTACT_LIST, PERM_CONTACT_SHOW, PERM_CONTACT_SEARCH,
        PERM_OU_LIST, PERM_OU_LISTOBJECTS, PERM_OU_TREE, PERM_OU_STATS,
        PERM_OU_SEARCH,
        PERM_DNS_SERVERINFO, PERM_DNS_ZONELIST, PERM_DNS_ZONEINFO,
        PERM_DNS_RECORDLIST, PERM_DNS_RORECORDS,
        PERM_GPO_LIST, PERM_GPO_SHOW, PERM_GPO_GETINHERIT, PERM_GPO_FETCH,
        PERM_DOMAIN_INFO, PERM_DOMAIN_LEVEL, PERM_DOMAIN_PASSWORDSETTINGS,
        PERM_DOMAIN_SCHEMAS, PERM_DOMAIN_TRUSTLIST, PERM_DOMAIN_TRUSTVALIDATE,
        PERM_DOMAIN_KDSROOTKEY, PERM_DOMAIN_CLAIM,
        PERM_DRS_SHOWREPL, PERM_DRS_UPTODATENESS,
        PERM_SITES_LIST, PERM_SITES_SHOW, PERM_SITES_SUBNETLIST,
        PERM_FSMO_SHOW, PERM_FSMO_ROLES,
        PERM_SCHEMA_LIST, PERM_SCHEMA_SHOW,
        PERM_DELEGATION_LIST,
        PERM_SERVICEACCOUNT_LIST, PERM_SERVICEACCOUNT_SHOW,
        PERM_AUTHPOLICY_LIST, PERM_AUTHPOLICY_SHOW,
        PERM_AUTHPOLICY_SILO_LIST, PERM_AUTHPOLICY_SILO_SHOW,
        PERM_SYSTEM_HEALTH, PERM_SYSTEM_STATS, PERM_SYSTEM_METRICS,
        PERM_SYSTEM_TASKS, PERM_TASKS_LIST, PERM_TASKS_VIEW,
        PERM_MISC_TIME, PERM_MISC_PROCESSES,
        PERM_MISC_DBCHECK, PERM_MISC_NTACL, PERM_MISC_SPN,
        PERM_MGMT_AUDIT_VIEW,
        PERM_AUTH_ME, PERM_AUTH_CHECK,
        # AI Chat read permissions — v1.8
        PERM_AI_CHAT_LIST, PERM_AI_CHAT_SHOW, PERM_AI_CHAT_HISTORY,
        PERM_AI_CHAT_INFO,
        PERM_AI_ASSISTANT, PERM_AI_SCHEMA, PERM_AI_CONFIG,
        PERM_AI_BALANCE, PERM_AI_TEST, PERM_AI_INFO,
        PERM_AI_SYSTEM, PERM_AI_DATASCHEMA, PERM_AI_PIPELINE, PERM_AI_EXPORTS,
        # Samba Shares read permissions — v1.8
        PERM_SHARE_LIST, PERM_SHARE_CONFIG,
        # SDB read permissions — v2.0
        PERM_SDB_DATABASES, PERM_SDB_FULL, PERM_SDB_INFO,
        PERM_SDB_SYNTHESIS, PERM_SDB_EXPORTS, PERM_SDB_EXPORTDOWNLOAD,
        # Report read permissions — v1.9-3-4
        PERM_REPORT_DOWNLOAD,
        # Shell projet read permissions — v1.6.4
        PERM_SHELL_PROJET_SHOW, PERM_SHELL_PROJET_LIST,
        PERM_SHELL_PROJET_HEALTH, PERM_SHELL_PROJET_DOWNLOAD,
        PERM_SHELL_PROJET_AUDIT,
        # CFG read-only permissions — v2.1
        # Auditor can view configuration but NOT modify it.
        PERM_CFG_LIST, PERM_CFG_SHOW, PERM_CFG_SCHEMA, PERM_CFG_RAW,
        PERM_CFG_RELOAD,
    }),
}

# ═══════════════════════════════════════════════════════════════════════
# 5. Path → permission mapping  (REGEX-BASED, v1.2.6_fix)
# ═══════════════════════════════════════════════════════════════════════
#
# Each rule is a tuple ``(method, regex_pattern, permission)``.
# ``resolve_permission()`` compiles each pattern once (cached) and
# returns the permission of the **longest matching pattern** for the
# given method. Path parameters such as ``{username}`` are written
# in the pattern as ``[^/]+`` so they match exactly one path segment.
#
# IMPORTANT RULES for adding new entries:
#   1. More-specific (longer) patterns are preferred automatically
#      by the longest-match algorithm — there is no need to put them
#      in any particular order.
#   2. Use ``[^/]+`` for a single path segment (a username, groupname,
#      gpo_id, projet_id, zone, etc.).
#   3. Patterns are matched against the request path WITH the leading
#      ``/api/v1`` prefix and WITHOUT a trailing slash. Trailing
#      slashes are stripped by ``resolve_permission()`` before
#      matching.
#   4. Public endpoints (health, docs, login, refresh) are handled
#      separately in ``resolve_permission()``.
#

_PATH_PERM_RULES: List[Tuple[str, str, str]] = [
    # ── Users (/api/v1/users) ───────────────────────────────────────────
    # /full must be matched BEFORE the generic /users/{username} route
    ("GET",    r"^/api/v1/users/full$",                              PERM_USER_FULL),
    ("GET",    r"^/api/v1/users$",                                   PERM_USER_LIST),
    ("GET",    r"^/api/v1/users/$",                                  PERM_USER_LIST),
    ("POST",   r"^/api/v1/users$",                                   PERM_USER_CREATE),
    ("POST",   r"^/api/v1/users/$",                                  PERM_USER_CREATE),
    ("GET",    r"^/api/v1/users/search$",                            PERM_USER_SEARCH),
    ("POST",   r"^/api/v1/users/import$",                            PERM_USER_IMPORT),
    ("GET",    r"^/api/v1/users/export$",                            PERM_USER_EXPORT),
    ("GET",    r"^/api/v1/users/batch$",                             PERM_USER_BATCH),
    # Users_mgmt aliases (same router prefix /users)
    ("GET",    r"^/api/v1/users_mgmt/search$",                       PERM_USER_SEARCH),
    ("POST",   r"^/api/v1/users_mgmt/import$",                       PERM_USER_IMPORT),
    ("GET",    r"^/api/v1/users_mgmt/export$",                       PERM_USER_EXPORT),
    # Dynamic paths /users/{username}[/action]
    ("GET",    r"^/api/v1/users/[^/]+$",                             PERM_USER_SHOW),
    ("DELETE", r"^/api/v1/users/[^/]+$",                             PERM_USER_DELETE),
    ("PUT",    r"^/api/v1/users/[^/]+/edit$",                        PERM_USER_EDIT),
    ("POST",   r"^/api/v1/users/[^/]+/enable$",                      PERM_USER_ENABLE),
    ("POST",   r"^/api/v1/users/[^/]+/disable$",                     PERM_USER_DISABLE),
    ("POST",   r"^/api/v1/users/[^/]+/unlock$",                      PERM_USER_UNLOCK),
    ("PUT",    r"^/api/v1/users/[^/]+/password$",                    PERM_USER_SETPASSWORD),
    ("GET",    r"^/api/v1/users/[^/]+/getpassword$",                 PERM_USER_GETPASSWORD),
    ("GET",    r"^/api/v1/users/[^/]+/groups$",                      PERM_USER_GETGROUPS),
    ("PUT",    r"^/api/v1/users/[^/]+/setexpiry$",                   PERM_USER_SETEXPIRY),
    ("PUT",    r"^/api/v1/users/[^/]+/setprimarygroup$",             PERM_USER_SETPRIMARYGROUP),
    ("POST",   r"^/api/v1/users/[^/]+/addunixattrs$",                PERM_USER_ADDUNIXATTRS),
    ("PUT",    r"^/api/v1/users/[^/]+/sensitive$",                   PERM_USER_SENSITIVE),
    ("POST",   r"^/api/v1/users/[^/]+/move$",                        PERM_USER_MOVE),
    ("POST",   r"^/api/v1/users/[^/]+/rename$",                      PERM_USER_RENAME),
    ("GET",    r"^/api/v1/users/[^/]+/get-kerberos-ticket$",         PERM_USER_GETKERBEROSTICKET),
    ("GET",    r"^/api/v1/users/[^/]+/kerberos$",                    PERM_USER_GETKERBEROSTICKET),

    # ── Groups (/api/v1/groups) ────────────────────────────────────────
    ("GET",    r"^/api/v1/groups/full$",                             PERM_GROUP_FULL),
    ("GET",    r"^/api/v1/groups$",                                  PERM_GROUP_LIST),
    ("GET",    r"^/api/v1/groups/$",                                 PERM_GROUP_LIST),
    ("POST",   r"^/api/v1/groups$",                                  PERM_GROUP_CREATE),
    ("POST",   r"^/api/v1/groups/$",                                 PERM_GROUP_CREATE),
    ("GET",    r"^/api/v1/groups/stats$",                            PERM_GROUP_STATS),
    ("GET",    r"^/api/v1/groups/[^/]+$",                            PERM_GROUP_SHOW),
    ("DELETE", r"^/api/v1/groups/[^/]+$",                            PERM_GROUP_DELETE),
    ("POST",   r"^/api/v1/groups/[^/]+/members$",                    PERM_GROUP_ADDMEMBERS),
    ("DELETE", r"^/api/v1/groups/[^/]+/members$",                    PERM_GROUP_REMOVEMEMBERS),
    ("GET",    r"^/api/v1/groups/[^/]+/members$",                    PERM_GROUP_LISTMEMBERS),
    ("POST",   r"^/api/v1/groups/[^/]+/move$",                       PERM_GROUP_MOVE),

    # ── Computers (/api/v1/computers) ──────────────────────────────────
    ("GET",    r"^/api/v1/computers/full$",                          PERM_COMPUTER_FULL),
    ("GET",    r"^/api/v1/computers$",                               PERM_COMPUTER_LIST),
    ("GET",    r"^/api/v1/computers/$",                              PERM_COMPUTER_LIST),
    ("POST",   r"^/api/v1/computers$",                               PERM_COMPUTER_CREATE),
    ("POST",   r"^/api/v1/computers/$",                              PERM_COMPUTER_CREATE),
    ("GET",    r"^/api/v1/computers/[^/]+$",                         PERM_COMPUTER_SHOW),
    ("DELETE", r"^/api/v1/computers/[^/]+$",                         PERM_COMPUTER_DELETE),
    ("POST",   r"^/api/v1/computers/[^/]+/move$",                    PERM_COMPUTER_MOVE),

    # ── Contacts (/api/v1/contacts) ────────────────────────────────────
    ("GET",    r"^/api/v1/contacts/full$",                           PERM_CONTACT_FULL),
    ("GET",    r"^/api/v1/contacts$",                                PERM_CONTACT_LIST),
    ("GET",    r"^/api/v1/contacts/$",                               PERM_CONTACT_LIST),
    ("POST",   r"^/api/v1/contacts$",                                PERM_CONTACT_CREATE),
    ("POST",   r"^/api/v1/contacts/$",                               PERM_CONTACT_CREATE),
    ("GET",    r"^/api/v1/contacts/search$",                         PERM_CONTACT_SEARCH),
    ("GET",    r"^/api/v1/contacts/[^/]+$",                          PERM_CONTACT_SHOW),
    ("DELETE", r"^/api/v1/contacts/[^/]+$",                          PERM_CONTACT_DELETE),
    ("POST",   r"^/api/v1/contacts/[^/]+/move$",                     PERM_CONTACT_MOVE),
    ("POST",   r"^/api/v1/contacts/[^/]+/rename$",                   PERM_CONTACT_RENAME),

    # ── OUs (/api/v1/ous) ──────────────────────────────────────────────
    ("GET",    r"^/api/v1/ous/full$",                                PERM_OU_FULL),
    ("GET",    r"^/api/v1/ous$",                                     PERM_OU_LIST),
    ("GET",    r"^/api/v1/ous/$",                                    PERM_OU_LIST),
    ("POST",   r"^/api/v1/ous$",                                     PERM_OU_CREATE),
    ("POST",   r"^/api/v1/ous/$",                                    PERM_OU_CREATE),
    ("DELETE", r"^/api/v1/ous/[^/]+$",                               PERM_OU_DELETE),
    ("POST",   r"^/api/v1/ous/[^/]+/move$",                          PERM_OU_MOVE),
    ("POST",   r"^/api/v1/ous/[^/]+/rename$",                        PERM_OU_RENAME),
    ("GET",    r"^/api/v1/ous/[^/]+/objects$",                       PERM_OU_LISTOBJECTS),
    # ou_mgmt.py routes
    ("GET",    r"^/api/v1/ous/tree$",                                PERM_OU_TREE),
    ("GET",    r"^/api/v1/ous/search$",                              PERM_OU_SEARCH),
    ("GET",    r"^/api/v1/ous/[^/]+/stats$",                         PERM_OU_STATS),
    ("GET",    r"^/api/v1/ous/[^/]+/tree$",                          PERM_OU_TREE),
    # Legacy aliases
    ("GET",    r"^/api/v1/ous_mgmt/tree$",                           PERM_OU_TREE),
    ("GET",    r"^/api/v1/ous_mgmt/stats$",                          PERM_OU_STATS),
    ("GET",    r"^/api/v1/ous_mgmt/search$",                         PERM_OU_SEARCH),

    # ── DNS (/api/v1/dns) ──────────────────────────────────────────────
    ("GET",    r"^/api/v1/dns/serverinfo$",                          PERM_DNS_SERVERINFO),
    ("GET",    r"^/api/v1/dns/zones$",                               PERM_DNS_ZONELIST),
    ("POST",   r"^/api/v1/dns/zones$",                               PERM_DNS_ZONECREATE),
    ("GET",    r"^/api/v1/dns/zones/[^/]+$",                         PERM_DNS_ZONEINFO),
    ("DELETE", r"^/api/v1/dns/zones/[^/]+$",                         PERM_DNS_ZONEDELETE),
    ("GET",    r"^/api/v1/dns/zones/[^/]+/records$",                 PERM_DNS_RECORDLIST),
    ("POST",   r"^/api/v1/dns/zones/[^/]+/records$",                 PERM_DNS_RECORDCREATE),
    ("DELETE", r"^/api/v1/dns/zones/[^/]+/records$",                 PERM_DNS_RECORDDELETE),
    ("PUT",    r"^/api/v1/dns/zones/[^/]+/records$",                 PERM_DNS_RECORDUPDATE),
    ("GET",    r"^/api/v1/dns/zones/[^/]+/rorecords$",               PERM_DNS_RORECORDS),
    ("PUT",    r"^/api/v1/dns/zones/[^/]+/options$",                 PERM_DNS_ZONEOPTIONS),
    ("POST",   r"^/api/v1/dns/cache/invalidate$",                    PERM_DNS_CACHEFLUSH),
    # Legacy short paths (some clients use /dns/records?zone=...)
    ("GET",    r"^/api/v1/dns/records$",                             PERM_DNS_RECORDLIST),
    ("POST",   r"^/api/v1/dns/records$",                             PERM_DNS_RECORDCREATE),
    ("DELETE", r"^/api/v1/dns/records$",                             PERM_DNS_RECORDDELETE),
    ("PUT",    r"^/api/v1/dns/records$",                             PERM_DNS_RECORDUPDATE),
    ("GET",    r"^/api/v1/dns/zoneinfo$",                            PERM_DNS_ZONEINFO),
    ("GET",    r"^/api/v1/dns/rorecords$",                           PERM_DNS_RORECORDS),
    ("PUT",    r"^/api/v1/dns/options$",                             PERM_DNS_ZONEOPTIONS),

    # ── GPO (/api/v1/gpo) ──────────────────────────────────────────────
    ("GET",    r"^/api/v1/gpo/full$",                                PERM_GPO_FULL),
    ("GET",    r"^/api/v1/gpo$",                                     PERM_GPO_LIST),
    ("GET",    r"^/api/v1/gpo/$",                                    PERM_GPO_LIST),
    ("POST",   r"^/api/v1/gpo$",                                     PERM_GPO_CREATE),
    ("POST",   r"^/api/v1/gpo/$",                                    PERM_GPO_CREATE),
    ("GET",    r"^/api/v1/gpo/[^/]+$",                               PERM_GPO_SHOW),
    ("DELETE", r"^/api/v1/gpo/[^/]+$",                               PERM_GPO_DELETE),
    ("DELETE", r"^/api/v1/gpo/by-name/[^/]+$",                       PERM_GPO_DELETEBYNAME),
    ("POST",   r"^/api/v1/gpo/[^/]+/link$",                          PERM_GPO_LINK),
    ("DELETE", r"^/api/v1/gpo/[^/]+/link$",                          PERM_GPO_UNLINK),
    ("GET",    r"^/api/v1/gpo/[^/]+/inherit$",                       PERM_GPO_GETINHERIT),
    ("PUT",    r"^/api/v1/gpo/[^/]+/inherit$",                       PERM_GPO_SETINHERIT),
    ("POST",   r"^/api/v1/gpo/[^/]+/backup$",                        PERM_GPO_BACKUP),
    ("POST",   r"^/api/v1/gpo/[^/]+/restore$",                       PERM_GPO_RESTORE),
    ("GET",    r"^/api/v1/gpo/[^/]+/fetch$",                         PERM_GPO_FETCH),
    # Legacy short paths
    ("POST",   r"^/api/v1/gpo/link$",                                PERM_GPO_LINK),
    ("DELETE", r"^/api/v1/gpo/link$",                                PERM_GPO_UNLINK),
    ("GET",    r"^/api/v1/gpo/inherit$",                             PERM_GPO_GETINHERIT),
    ("PUT",    r"^/api/v1/gpo/inherit$",                             PERM_GPO_SETINHERIT),
    ("POST",   r"^/api/v1/gpo/backup$",                              PERM_GPO_BACKUP),
    ("POST",   r"^/api/v1/gpo/restore$",                             PERM_GPO_RESTORE),
    ("GET",    r"^/api/v1/gpo/fetch$",                               PERM_GPO_FETCH),

    # ── Domain (/api/v1/domain) ────────────────────────────────────────
    ("GET",    r"^/api/v1/domain/full$",                             PERM_DOMAIN_FULL),
    ("GET",    r"^/api/v1/domain/info$",                             PERM_DOMAIN_INFO),
    ("GET",    r"^/api/v1/domain/$",                                 PERM_DOMAIN_INFO),
    ("GET",    r"^/api/v1/domain/level$",                            PERM_DOMAIN_LEVEL),
    ("PUT",    r"^/api/v1/domain/level$",                            PERM_DOMAIN_LEVEL),
    ("GET",    r"^/api/v1/domain/passwordsettings$",                 PERM_DOMAIN_PASSWORDSETTINGS),
    ("PUT",    r"^/api/v1/domain/passwordsettings$",                 PERM_DOMAIN_PASSWORDSETTINGS),
    ("GET",    r"^/api/v1/domain/schemas$",                          PERM_DOMAIN_SCHEMAS),
    ("POST",   r"^/api/v1/domain/provision$",                        PERM_DOMAIN_PROVISION),
    ("POST",   r"^/api/v1/domain/join$",                             PERM_DOMAIN_JOIN),
    ("POST",   r"^/api/v1/domain/leave$",                            PERM_DOMAIN_LEAVE),
    ("POST",   r"^/api/v1/domain/demote$",                           PERM_DOMAIN_DEMOTE),
    # Trusts — both flat (/domain/trusts) and nested (/domain/trust/*)
    ("GET",    r"^/api/v1/domain/trust/list$",                       PERM_DOMAIN_TRUSTLIST),
    ("GET",    r"^/api/v1/domain/trust/namespaces$",                 PERM_DOMAIN_TRUSTLIST),
    ("GET",    r"^/api/v1/domain/trusts$",                           PERM_DOMAIN_TRUSTLIST),
    ("POST",   r"^/api/v1/domain/trust/create$",                     PERM_DOMAIN_TRUSTCREATE),
    ("POST",   r"^/api/v1/domain/trusts$",                           PERM_DOMAIN_TRUSTCREATE),
    ("DELETE", r"^/api/v1/domain/trust/delete$",                     PERM_DOMAIN_TRUSTDELETE),
    ("DELETE", r"^/api/v1/domain/trusts$",                           PERM_DOMAIN_TRUSTDELETE),
    ("POST",   r"^/api/v1/domain/trust/validate$",                   PERM_DOMAIN_TRUSTVALIDATE),
    # Backup / KDS / keytab / claim
    ("POST",   r"^/api/v1/domain/backup/online$",                    PERM_DOMAIN_BACKUP),
    ("POST",   r"^/api/v1/domain/backup/offline$",                   PERM_DOMAIN_BACKUP),
    ("POST",   r"^/api/v1/domain/kds/root-key/create$",              PERM_DOMAIN_KDSROOTKEY),
    ("GET",    r"^/api/v1/domain/kds/root-key/list$",                PERM_DOMAIN_KDSROOTKEY),
    ("POST",   r"^/api/v1/domain/exportkeytab$",                     PERM_DOMAIN_EXPORTKEYTAB),
    ("GET",    r"^/api/v1/domain/claim/types$",                      PERM_DOMAIN_CLAIM),

    # ── DRS (/api/v1/drs) ──────────────────────────────────────────────
    ("GET",    r"^/api/v1/drs/showrepl$",                            PERM_DRS_SHOWREPL),
    ("GET",    r"^/api/v1/drs/bind$",                                PERM_DRS_BIND),
    ("POST",   r"^/api/v1/drs/bind$",                                PERM_DRS_BIND),
    ("POST",   r"^/api/v1/drs/unbind$",                              PERM_DRS_UNBIND),
    ("GET",    r"^/api/v1/drs/options$",                             PERM_DRS_OPTIONS),
    ("POST",   r"^/api/v1/drs/kcc$",                                 PERM_DRS_KCC),
    ("POST",   r"^/api/v1/drs/replicate$",                           PERM_DRS_REPLICATE),
    ("GET",    r"^/api/v1/drs/uptodateness$",                        PERM_DRS_UPTODATENESS),

    # ── Sites (/api/v1/sites) ──────────────────────────────────────────
    ("GET",    r"^/api/v1/sites$",                                   PERM_SITES_LIST),
    ("GET",    r"^/api/v1/sites/$",                                  PERM_SITES_LIST),
    ("POST",   r"^/api/v1/sites$",                                   PERM_SITES_CREATE),
    ("POST",   r"^/api/v1/sites/$",                                  PERM_SITES_CREATE),
    ("GET",    r"^/api/v1/sites/[^/]+$",                             PERM_SITES_SHOW),
    ("DELETE", r"^/api/v1/sites/[^/]+$",                             PERM_SITES_DELETE),
    ("GET",    r"^/api/v1/sites/[^/]+/subnets$",                     PERM_SITES_SUBNETLIST),
    ("POST",   r"^/api/v1/sites/[^/]+/subnets$",                     PERM_SITES_SUBNETCREATE),
    ("GET",    r"^/api/v1/sites/subnets$",                           PERM_SITES_SUBNETLIST),
    ("GET",    r"^/api/v1/sites/subnets/$",                          PERM_SITES_SUBNETLIST),
    ("DELETE", r"^/api/v1/sites/subnets/$",                          PERM_SITES_SUBNETDELETE),
    ("DELETE", r"^/api/v1/sites/subnets$",                           PERM_SITES_SUBNETDELETE),
    ("PUT",    r"^/api/v1/sites/subnets/site$",                      PERM_SITES_SUBNETUPDATE),

    # ── FSMO (/api/v1/fsmo) — PUT not POST ─────────────────────────────
    ("GET",    r"^/api/v1/fsmo/full$",                               PERM_FSMO_FULL),
    ("GET",    r"^/api/v1/fsmo$",                                    PERM_FSMO_SHOW),
    ("GET",    r"^/api/v1/fsmo/$",                                   PERM_FSMO_SHOW),
    ("PUT",    r"^/api/v1/fsmo/transfer$",                           PERM_FSMO_TRANSFER),
    ("PUT",    r"^/api/v1/fsmo/seize$",                              PERM_FSMO_SEIZE),
    ("GET",    r"^/api/v1/fsmo/roles$",                              PERM_FSMO_ROLES),
    # Backward compat — accept POST on transfer/seize as well
    ("POST",   r"^/api/v1/fsmo/transfer$",                           PERM_FSMO_TRANSFER),
    ("POST",   r"^/api/v1/fsmo/seize$",                              PERM_FSMO_SEIZE),

    # ── Schema (/api/v1/schema) ────────────────────────────────────────
    ("GET",    r"^/api/v1/schema$",                                  PERM_SCHEMA_LIST),
    ("GET",    r"^/api/v1/schema/$",                                 PERM_SCHEMA_LIST),
    ("GET",    r"^/api/v1/schema/query$",                            PERM_SCHEMA_QUERY),
    ("GET",    r"^/api/v1/schema/attributes/[^/]+$",                 PERM_SCHEMA_SHOW),
    ("GET",    r"^/api/v1/schema/classes/[^/]+$",                    PERM_SCHEMA_SHOW),
    ("GET",    r"^/api/v1/schema/[^/]+$",                            PERM_SCHEMA_SHOW),

    # ── Delegation (/api/v1/delegation) ────────────────────────────────
    ("GET",    r"^/api/v1/delegation/for-account$",                  PERM_DELEGATION_LIST),
    ("GET",    r"^/api/v1/delegation$",                              PERM_DELEGATION_LIST),
    ("GET",    r"^/api/v1/delegation/$",                             PERM_DELEGATION_LIST),
    ("POST",   r"^/api/v1/delegation/add$",                          PERM_DELEGATION_SET),
    ("POST",   r"^/api/v1/delegation/$",                             PERM_DELEGATION_SET),
    ("DELETE", r"^/api/v1/delegation/remove$",                       PERM_DELEGATION_DELETE),
    ("DELETE", r"^/api/v1/delegation/$",                             PERM_DELEGATION_DELETE),

    # ── Service accounts (/api/v1/service-accounts) ───────────────────
    ("GET",    r"^/api/v1/service-accounts$",                        PERM_SERVICEACCOUNT_LIST),
    ("GET",    r"^/api/v1/service-accounts/$",                       PERM_SERVICEACCOUNT_LIST),
    ("POST",   r"^/api/v1/service-accounts$",                        PERM_SERVICEACCOUNT_CREATE),
    ("POST",   r"^/api/v1/service-accounts/$",                       PERM_SERVICEACCOUNT_CREATE),
    ("GET",    r"^/api/v1/service-accounts/[^/]+$",                  PERM_SERVICEACCOUNT_SHOW),
    ("DELETE", r"^/api/v1/service-accounts/[^/]+$",                  PERM_SERVICEACCOUNT_DELETE),
    ("POST",   r"^/api/v1/service-accounts/[^/]+/gmsa-members/add$",     PERM_SERVICEACCOUNT_GMSA),
    ("DELETE", r"^/api/v1/service-accounts/[^/]+/gmsa-members/remove$",  PERM_SERVICEACCOUNT_GMSA),
    ("GET",    r"^/api/v1/service-accounts/[^/]+/gmsa-members$",         PERM_SERVICEACCOUNT_GMSA),

    # ── Auth policies & silos (/api/v1/auth/policies, /api/v1/auth/silos)
    ("GET",    r"^/api/v1/auth/policies$",                           PERM_AUTHPOLICY_LIST),
    ("GET",    r"^/api/v1/auth/policies/$",                          PERM_AUTHPOLICY_LIST),
    ("POST",   r"^/api/v1/auth/policies$",                           PERM_AUTHPOLICY_CREATE),
    ("POST",   r"^/api/v1/auth/policies/$",                          PERM_AUTHPOLICY_CREATE),
    ("GET",    r"^/api/v1/auth/policies/[^/]+$",                     PERM_AUTHPOLICY_SHOW),
    ("DELETE", r"^/api/v1/auth/policies/[^/]+$",                     PERM_AUTHPOLICY_DELETE),
    ("PUT",    r"^/api/v1/auth/policies/[^/]+$",                     PERM_AUTHPOLICY_UPDATE),
    ("GET",    r"^/api/v1/auth/silos$",                              PERM_AUTHPOLICY_SILO_LIST),
    ("GET",    r"^/api/v1/auth/silos/$",                             PERM_AUTHPOLICY_SILO_LIST),
    ("POST",   r"^/api/v1/auth/silos$",                              PERM_AUTHPOLICY_SILO_CREATE),
    ("POST",   r"^/api/v1/auth/silos/$",                             PERM_AUTHPOLICY_SILO_CREATE),
    ("GET",    r"^/api/v1/auth/silos/[^/]+$",                        PERM_AUTHPOLICY_SILO_SHOW),
    ("DELETE", r"^/api/v1/auth/silos/[^/]+$",                        PERM_AUTHPOLICY_SILO_DELETE),
    ("POST",   r"^/api/v1/auth/silos/[^/]+/members$",                PERM_AUTHPOLICY_SILO_MEMBERS),
    ("DELETE", r"^/api/v1/auth/silos/[^/]+/members$",                PERM_AUTHPOLICY_SILO_MEMBERS),
    # Legacy alias — old clients used /auth-policies/
    ("GET",    r"^/api/v1/auth-policies/[^/]*$",                     PERM_AUTHPOLICY_LIST),
    ("POST",   r"^/api/v1/auth-policies/[^/]*$",                     PERM_AUTHPOLICY_CREATE),
    ("DELETE", r"^/api/v1/auth-policies/[^/]+$",                     PERM_AUTHPOLICY_DELETE),
    ("PUT",    r"^/api/v1/auth-policies/[^/]+$",                     PERM_AUTHPOLICY_UPDATE),

    # ── Shell (/api/v1/shell) ──────────────────────────────────────────
    ("GET",    r"^/api/v1/shell$",                                   PERM_SHELL_LIST),
    ("GET",    r"^/api/v1/shell/$",                                  PERM_SHELL_LIST),
    ("POST",   r"^/api/v1/shell/exec$",                              PERM_SHELL_EXECUTE),
    ("POST",   r"^/api/v1/shell/$",                                  PERM_SHELL_EXECUTE),
    ("POST",   r"^/api/v1/shell/script$",                            PERM_SHELL_SCRIPT),
    ("POST",   r"^/api/v1/shell/script/file$",                       PERM_SHELL_SCRIPT),
    ("POST",   r"^/api/v1/shell/sudo$",                              PERM_SHELL_SUDO),

    # ── Shell Project (/api/v1/shell/projet) — v1.6.4 ──────────────────
    ("POST",   r"^/api/v1/shell/projet$",                            PERM_SHELL_PROJET_CREATE),
    ("POST",   r"^/api/v1/shell/projet/$",                           PERM_SHELL_PROJET_CREATE),
    ("POST",   r"^/api/v1/shell/projet/template$",                   PERM_SHELL_PROJET_TEMPLATE),
    ("POST",   r"^/api/v1/shell/projet/from-template/[^/]+$",        PERM_SHELL_PROJET_TEMPLATE),
    ("GET",    r"^/api/v1/shell/projet/templates$",                  PERM_SHELL_PROJET_TEMPLATE),
    ("DELETE", r"^/api/v1/shell/projet/template/[^/]+$",             PERM_SHELL_PROJET_TEMPLATE),
    ("GET",    r"^/api/v1/shell/projet/list$",                       PERM_SHELL_PROJET_LIST),
    ("GET",    r"^/api/v1/shell/projet/health$",                     PERM_SHELL_PROJET_HEALTH),
    ("GET",    r"^/api/v1/shell/projet/audit$",                      PERM_SHELL_PROJET_AUDIT),
    ("GET",    r"^/api/v1/shell/projet/show/[^/]+$",                 PERM_SHELL_PROJET_SHOW),
    ("GET",    r"^/api/v1/shell/projet/[^/]+$",                      PERM_SHELL_PROJET_SHOW),
    ("GET",    r"^/api/v1/shell/projet/[^/]+/download$",             PERM_SHELL_PROJET_DOWNLOAD),
    ("GET",    r"^/api/v1/shell/projet/[^/]+/audit$",                PERM_SHELL_PROJET_AUDIT),
    ("GET",    r"^/api/v1/shell/projet/[^/]+/schedule$",             PERM_SHELL_PROJET_SCHEDULE),
    ("PATCH",  r"^/api/v1/shell/projet/[^/]+/owner$",                PERM_SHELL_PROJET_OWNER),
    ("PATCH",  r"^/api/v1/shell/projet/[^/]+/tags$",                 PERM_SHELL_PROJET_TAGS),
    ("DELETE", r"^/api/v1/shell/projet/[^/]+$",                      PERM_SHELL_PROJET_DELETE),
    ("DELETE", r"^/api/v1/shell/projet/[^/]+/schedule/[^/]+$",       PERM_SHELL_PROJET_SCHEDULE),
    ("POST",   r"^/api/v1/shell/projet/[^/]+/upload$",               PERM_SHELL_PROJET_UPLOAD),
    ("POST",   r"^/api/v1/shell/projet/[^/]+/upload-multi$",         PERM_SHELL_PROJET_UPLOADMULTI),
    ("POST",   r"^/api/v1/shell/projet/[^/]+/run$",                  PERM_SHELL_PROJET_RUN),
    ("POST",   r"^/api/v1/shell/projet/[^/]+/abort$",                PERM_SHELL_PROJET_ABORT),
    ("POST",   r"^/api/v1/shell/projet/[^/]+/schedule$",             PERM_SHELL_PROJET_SCHEDULE),
    ("POST",   r"^/api/v1/shell/projet/[^/]+/snapshot$",             PERM_SHELL_PROJET_SNAPSHOT),
    ("POST",   r"^/api/v1/shell/projet/[^/]+/rollback/[^/]+$",       PERM_SHELL_PROJET_SNAPSHOT),
    ("POST",   r"^/api/v1/shell/projet/batch$",                      PERM_SHELL_PROJET_BATCH),

    # ── Batch (/api/v1/batch) ──────────────────────────────────────────
    ("POST",   r"^/api/v1/batch$",                                   PERM_BATCH_EXECUTE),
    ("POST",   r"^/api/v1/batch/$",                                  PERM_BATCH_EXECUTE),
    ("GET",    r"^/api/v1/batch/[^/]+$",                             PERM_BATCH_STATUS),

    # ── Management (/api/v1/mgmt) — v2.2 extended ───────────────────────
    # IMPORTANT: more-specific sub-action routes must come BEFORE generic
    # /mgmt/users/{id}, /mgmt/keys/{id} etc. Longest-match resolver takes
    # care of the priority automatically.

    # ── Users ─────────────────────────────────────────────────────────
    ("GET",    r"^/api/v1/mgmt/users$",                              PERM_MGMT_USERS_LIST),
    ("POST",   r"^/api/v1/mgmt/users$",                              PERM_MGMT_USERS_CREATE),
    ("POST",   r"^/api/v1/mgmt/users/bulk$",                         PERM_MGMT_USERS_BULK),
    ("GET",    r"^/api/v1/mgmt/users/[^/]+/keys$",                   PERM_MGMT_USERS_KEYS),
    ("POST",   r"^/api/v1/mgmt/users/[^/]+/enable$",                 PERM_MGMT_USERS_ENABLE),
    ("POST",   r"^/api/v1/mgmt/users/[^/]+/disable$",                PERM_MGMT_USERS_DISABLE),
    ("POST",   r"^/api/v1/mgmt/users/[^/]+/purge$",                  PERM_MGMT_USERS_PURGE),
    ("POST",   r"^/api/v1/mgmt/users/[^/]+/reset-password$",         PERM_MGMT_USERS_RESETPW),
    ("GET",    r"^/api/v1/mgmt/users/[^/]+$",                        PERM_MGMT_USERS_SHOW),
    ("PUT",    r"^/api/v1/mgmt/users/[^/]+$",                        PERM_MGMT_USERS_UPDATE),
    ("DELETE", r"^/api/v1/mgmt/users/[^/]+$",                        PERM_MGMT_USERS_DELETE),

    # ── API keys ──────────────────────────────────────────────────────
    ("GET",    r"^/api/v1/mgmt/keys$",                               PERM_MGMT_KEYS_LIST),
    ("POST",   r"^/api/v1/mgmt/keys$",                               PERM_MGMT_KEYS_CREATE),
    ("POST",   r"^/api/v1/mgmt/keys/bulk$",                          PERM_MGMT_KEYS_BULK),
    ("POST",   r"^/api/v1/mgmt/keys/[^/]+/rotate$",                  PERM_MGMT_KEYS_ROTATE),
    ("POST",   r"^/api/v1/mgmt/keys/[^/]+/enable$",                  PERM_MGMT_KEYS_ENABLE),
    ("POST",   r"^/api/v1/mgmt/keys/[^/]+/disable$",                 PERM_MGMT_KEYS_DISABLE),
    ("POST",   r"^/api/v1/mgmt/keys/[^/]+/purge$",                   PERM_MGMT_KEYS_PURGE),
    ("GET",    r"^/api/v1/mgmt/keys/[^/]+$",                         PERM_MGMT_KEYS_SHOW),
    ("PUT",    r"^/api/v1/mgmt/keys/[^/]+$",                         PERM_MGMT_KEYS_UPDATE),
    ("DELETE", r"^/api/v1/mgmt/keys/[^/]+$",                         PERM_MGMT_KEYS_DELETE),

    # ── Roles ─────────────────────────────────────────────────────────
    ("GET",    r"^/api/v1/mgmt/roles$",                              PERM_MGMT_ROLES_LIST),
    ("POST",   r"^/api/v1/mgmt/roles$",                              PERM_MGMT_ROLES_CREATE),
    ("GET",    r"^/api/v1/mgmt/roles/[^/]+/users$",                  PERM_MGMT_ROLES_USERS),
    ("GET",    r"^/api/v1/mgmt/roles/[^/]+/keys$",                   PERM_MGMT_ROLES_KEYS),
    ("POST",   r"^/api/v1/mgmt/roles/[^/]+/gen-key$",                PERM_MGMT_ROLES_GENKEY),
    ("POST",   r"^/api/v1/mgmt/roles/[^/]+/enable$",                 PERM_MGMT_ROLES_ENABLE),
    ("POST",   r"^/api/v1/mgmt/roles/[^/]+/disable$",                PERM_MGMT_ROLES_DISABLE),
    ("GET",    r"^/api/v1/mgmt/roles/[^/]+$",                        PERM_MGMT_ROLES_SHOW),
    ("PUT",    r"^/api/v1/mgmt/roles/[^/]+$",                        PERM_MGMT_ROLES_UPDATE),
    ("DELETE", r"^/api/v1/mgmt/roles/[^/]+$",                        PERM_MGMT_ROLES_DELETE),

    # ── Permissions + audit + stats ───────────────────────────────────
    ("GET",    r"^/api/v1/mgmt/permissions$",                        PERM_MGMT_PERMS_LIST),
    ("POST",   r"^/api/v1/mgmt/permissions/assign$",                 PERM_MGMT_PERMS_ASSIGN),
    ("POST",   r"^/api/v1/mgmt/permissions/revoke$",                 PERM_MGMT_PERMS_REVOKE),
    ("GET",    r"^/api/v1/mgmt/audit$",                              PERM_MGMT_AUDIT_VIEW),
    ("GET",    r"^/api/v1/mgmt/stats$",                              PERM_MGMT_STATS),

    # ── Auth (/api/v1/auth) ────────────────────────────────────────────
    ("GET",    r"^/api/v1/auth/me$",                                 PERM_AUTH_ME),
    # /api/v1/auth/login, /refresh, /check are public — no permission

    # ── Dashboard (/api/v1/dashboard) ──────────────────────────────────
    ("GET",    r"^/api/v1/dashboard/full$",                          PERM_DASHBOARD_FULL),
    ("GET",    r"^/api/v1/dashboard/overview$",                      PERM_DASHBOARD_OVERVIEW),

    # ── System ─────────────────────────────────────────────────────────
    ("GET",    r"^/health/detailed$",                                PERM_SYSTEM_HEALTH),
    ("GET",    r"^/api/v1/system/stats$",                            PERM_SYSTEM_STATS),
    ("GET",    r"^/metrics$",                                        PERM_SYSTEM_METRICS),
    ("GET",    r"^/api/v1/tasks$",                                   PERM_TASKS_LIST),
    ("GET",    r"^/api/v1/tasks/[^/]+$",                             PERM_TASKS_VIEW),

    # ── Misc (/api/v1/misc) ────────────────────────────────────────────
    ("GET",    r"^/api/v1/misc/time$",                               PERM_MISC_TIME),
    ("GET",    r"^/api/v1/misc/processes$",                          PERM_MISC_PROCESSES),
    ("GET",    r"^/api/v1/misc/testparm$",                           PERM_MISC_TESTPARAM),
    ("GET",    r"^/api/v1/misc/dbcheck$",                            PERM_MISC_DBCHECK),
    ("POST",   r"^/api/v1/misc/dbcheck/fix$",                        PERM_MISC_DBCHECKFIX),
    ("GET",    r"^/api/v1/misc/ntacl$",                              PERM_MISC_NTACL),
    ("POST",   r"^/api/v1/misc/ntacl/set$",                          PERM_MISC_NTACLSET),
    ("POST",   r"^/api/v1/misc/ntacl/sysvolreset$",                  PERM_MISC_NTACLSET),
    ("GET",    r"^/api/v1/misc/spn/list$",                           PERM_MISC_SPN),
    ("POST",   r"^/api/v1/misc/spn/add$",                            PERM_MISC_SPN),
    ("DELETE", r"^/api/v1/misc/spn/delete$",                         PERM_MISC_SPN),

    # ── AI Chat & Assistant (/api/v1/ai) — v1.8 ────────────────────────
    ("POST",   r"^/api/v1/ai/assistant$",                            PERM_AI_ASSISTANT),
    ("POST",   r"^/api/v1/ai/sdb$",                                  PERM_AI_SDB),
    ("POST",   r"^/api/v1/ai/agent$",                                PERM_AI_AGENT),
    ("GET",    r"^/api/v1/ai/schema$",                               PERM_AI_SCHEMA),
    ("GET",    r"^/api/v1/ai/config$",                               PERM_AI_CONFIG),
    ("GET",    r"^/api/v1/ai/balance$",                              PERM_AI_BALANCE),
    ("GET",    r"^/api/v1/ai/test$",                                 PERM_AI_TEST),
    ("GET",    r"^/api/v1/ai/info$",                                 PERM_AI_INFO),
    ("GET",    r"^/api/v1/ai/system$",                               PERM_AI_SYSTEM),
    ("PUT",    r"^/api/v1/ai/system$",                               PERM_AI_SYSTEM),
    ("GET",    r"^/api/v1/ai/data-schema$",                          PERM_AI_DATASCHEMA),
    ("GET",    r"^/api/v1/ai/exports$",                              PERM_AI_EXPORTS),
    ("GET",    r"^/api/v1/ai/exports/[^/]+$",                        PERM_AI_EXPORTS),
    ("GET",    r"^/api/v1/ai/pipeline/templates$",                   PERM_AI_PIPELINE),
    ("POST",   r"^/api/v1/ai/pipeline/execute$",                     PERM_AI_PIPELINE),
    # AI chat sessions
    ("POST",   r"^/api/v1/ai/chat$",                                 PERM_AI_CHAT_CREATE),
    ("POST",   r"^/api/v1/ai/chat/$",                                PERM_AI_CHAT_CREATE),
    ("GET",    r"^/api/v1/ai/chat/list$",                            PERM_AI_CHAT_LIST),
    ("GET",    r"^/api/v1/ai/chat/history$",                         PERM_AI_CHAT_HISTORY),
    ("GET",    r"^/api/v1/ai/chat/[^/]+$",                           PERM_AI_CHAT_SHOW),
    ("GET",    r"^/api/v1/ai/chat/[^/]+/history$",                   PERM_AI_CHAT_HISTORY),
    ("GET",    r"^/api/v1/ai/chat/[^/]+/info$",                      PERM_AI_CHAT_INFO),
    ("PUT",    r"^/api/v1/ai/chat/[^/]+$",                           PERM_AI_CHAT_ADMIN),
    ("DELETE", r"^/api/v1/ai/chat/[^/]+$",                           PERM_AI_CHAT_DELETE),
    ("POST",   r"^/api/v1/ai/chat/[^/]+/send$",                      PERM_AI_CHAT_SEND),
    ("POST",   r"^/api/v1/ai/chat/[^/]+/stream$",                    PERM_AI_CHAT_STREAM),

    # ── Samba Shares (/api/v1/shares) — v1.8 ───────────────────────────
    ("GET",    r"^/api/v1/shares$",                                  PERM_SHARE_LIST),
    ("GET",    r"^/api/v1/shares/$",                                 PERM_SHARE_LIST),
    ("POST",   r"^/api/v1/shares$",                                  PERM_SHARE_CREATE),
    ("POST",   r"^/api/v1/shares/$",                                 PERM_SHARE_CREATE),
    ("PUT",    r"^/api/v1/shares/[^/]+$",                            PERM_SHARE_EDIT),
    ("DELETE", r"^/api/v1/shares/[^/]+$",                            PERM_SHARE_DELETE),
    ("GET",    r"^/api/v1/shares/config$",                           PERM_SHARE_CONFIG),
    ("PUT",    r"^/api/v1/shares/config$",                           PERM_SHARE_CONFIG),

    # ── SDB (/api/v1/sdb) — v2.0 ───────────────────────────────────────
    ("GET",    r"^/api/v1/sdb/databases$",                           PERM_SDB_DATABASES),
    ("GET",    r"^/api/v1/sdb/full/[^/]+$",                          PERM_SDB_FULL),
    ("GET",    r"^/api/v1/sdb/info/[^/]+$",                          PERM_SDB_INFO),
    ("GET",    r"^/api/v1/sdb/synthesis$",                           PERM_SDB_SYNTHESIS),
    ("POST",   r"^/api/v1/sdb/query$",                               PERM_SDB_QUERY),
    ("POST",   r"^/api/v1/sdb/select$",                              PERM_SDB_SELECT),
    ("POST",   r"^/api/v1/sdb/show$",                                PERM_SDB_SHOW),
    ("POST",   r"^/api/v1/sdb/script$",                              PERM_SDB_SCRIPT),
    ("POST",   r"^/api/v1/sdb/export$",                              PERM_SDB_EXPORT),
    ("GET",    r"^/api/v1/sdb/export-download$",                     PERM_SDB_EXPORTDOWNLOAD),
    ("GET",    r"^/api/v1/sdb/exports$",                             PERM_SDB_EXPORTS),
    ("GET",    r"^/api/v1/sdb/exports/[^/]+$",                       PERM_SDB_EXPORTS),

    # ── Report (/api/v1/report) — v1.9-3-4 ─────────────────────────────
    ("POST",   r"^/api/v1/report/generate$",                         PERM_REPORT_GENERATE),
    ("GET",    r"^/api/v1/report/generate$",                         PERM_REPORT_GENERATE),
    ("GET",    r"^/api/v1/report/exports/[^/]+$",                    PERM_REPORT_DOWNLOAD),

    # ── CFG (/api/v1/cfg) — v2.1: Runtime .env configuration management
    # Static sub-paths first
    ("GET",    r"^/api/v1/cfg$",                                     PERM_CFG_LIST),
    ("GET",    r"^/api/v1/cfg/$",                                    PERM_CFG_LIST),
    ("GET",    r"^/api/v1/cfg/schema$",                              PERM_CFG_SCHEMA),
    ("GET",    r"^/api/v1/cfg/raw$",                                 PERM_CFG_RAW),
    ("POST",   r"^/api/v1/cfg/reload$",                              PERM_CFG_RELOAD),
    ("POST",   r"^/api/v1/cfg/bulk$",                                PERM_CFG_BULK),
    ("POST",   r"^/api/v1/cfg/persist$",                             PERM_CFG_PERSIST),
    # Sub-action: /cfg/{key}/disable|enable  (matched before /cfg/{key})
    ("POST",   r"^/api/v1/cfg/[^/]+/disable$",                       PERM_CFG_DISABLE),
    ("POST",   r"^/api/v1/cfg/[^/]+/enable$",                        PERM_CFG_ENABLE),
    # /cfg/{key} — single key, no sub-action
    ("GET",    r"^/api/v1/cfg/[^/]+$",                               PERM_CFG_SHOW),
    ("PUT",    r"^/api/v1/cfg/[^/]+$",                               PERM_CFG_UPDATE),
    ("DELETE", r"^/api/v1/cfg/[^/]+$",                               PERM_CFG_DELETE),
    ("POST",   r"^/api/v1/cfg/[^/]+$",                               PERM_CFG_UPDATE),
    # Fallback: POST /cfg/ treated as bulk
    ("POST",   r"^/api/v1/cfg/$",                                    PERM_CFG_BULK),

    # ── Bans (/api/v1/ban, /api/v1/unban) — v1.2.7_ban ────────────────
    # IMPORTANT: /ban/check/{type}/{name} must be matched BEFORE /ban/{ban_id}
    ("POST",   r"^/api/v1/ban$",                                     PERM_BAN_CREATE),
    ("POST",   r"^/api/v1/ban/$",                                    PERM_BAN_CREATE),
    ("POST",   r"^/api/v1/unban$",                                   PERM_BAN_UNBAN),
    ("POST",   r"^/api/v1/unban/$",                                  PERM_BAN_UNBAN),
    ("POST",   r"^/api/v1/ban/unban$",                               PERM_BAN_UNBAN),
    ("POST",   r"^/api/v1/ban/unban/$",                              PERM_BAN_UNBAN),
    ("GET",    r"^/api/v1/ban$",                                     PERM_BAN_LIST),
    ("GET",    r"^/api/v1/ban/$",                                    PERM_BAN_LIST),
    ("GET",    r"^/api/v1/ban/check/[^/]+/[^/]+$",                   PERM_BAN_SHOW),
    ("GET",    r"^/api/v1/ban/[^/]+$",                               PERM_BAN_SHOW),
    ("DELETE", r"^/api/v1/ban/[^/]+$",                               PERM_BAN_DELETE),

    # ── Webhooks (/api/v1/webhooks) — v2.3 ────────────────────────────
    ("GET",    r"^/api/v1/webhooks$",                                PERM_WEBHOOK_LIST),
    ("POST",   r"^/api/v1/webhooks$",                                PERM_WEBHOOK_CREATE),
    ("GET",    r"^/api/v1/webhooks/events$",                         PERM_WEBHOOK_LIST),
    ("POST",   r"^/api/v1/webhooks/[^/]+/test$",                     PERM_WEBHOOK_TEST),
    ("GET",    r"^/api/v1/webhooks/[^/]+$",                          PERM_WEBHOOK_SHOW),
    ("PUT",    r"^/api/v1/webhooks/[^/]+$",                          PERM_WEBHOOK_UPDATE),
    ("DELETE", r"^/api/v1/webhooks/[^/]+$",                          PERM_WEBHOOK_DELETE),

    # ── Backup & Restore (/api/v1/backup) — v2.3 ──────────────────────
    ("POST",   r"^/api/v1/backup$",                                  PERM_BACKUP_CREATE),
    ("POST",   r"^/api/v1/backup/$",                                 PERM_BACKUP_CREATE),
    ("GET",    r"^/api/v1/backup$",                                  PERM_BACKUP_LIST),
    ("GET",    r"^/api/v1/backup/$",                                 PERM_BACKUP_LIST),
    ("GET",    r"^/api/v1/backup/[^/]+$",                            PERM_BACKUP_DOWNLOAD),
    ("DELETE", r"^/api/v1/backup/[^/]+$",                            PERM_BACKUP_DELETE),
    ("POST",   r"^/api/v1/backup/restore$",                          PERM_BACKUP_RESTORE),
    ("POST",   r"^/api/v1/backup/restore/$",                         PERM_BACKUP_RESTORE),

    # ── Bulk users (/api/v1/users/bulk) — v2.3 ────────────────────────
    ("POST",   r"^/api/v1/users/bulk$",                              PERM_USER_BULK),

    # ── Audit export (/api/v1/mgmt/audit/export) — v2.3 ───────────────
    ("GET",    r"^/api/v1/mgmt/audit/export$",                       PERM_AUDIT_EXPORT),

    # ── 2FA (/api/v1/auth/2fa/*) — v2.3 ───────────────────────────────
    # NOTE: setup/enable/disable/status manage the CURRENT user's own 2FA,
    # so they require NO specific permission — any authenticated user can
    # manage their own 2FA. We deliberately do NOT add path-rules for
    # these endpoints so resolve_permission() returns None (=> allowed
    # for any authenticated caller). Only /auth/login/verify has an
    # explicit rule because it is a public endpoint tracked for audit.
    ("POST",   r"^/api/v1/auth/login/verify$",                       PERM_AUTH_2FA_VERIFY),

    # ── 2FA admin (/api/v1/mgmt/users/{id}/2fa/*) — v2.3.1 ───────────
    # Admin-only — manage 2FA on OTHER users. Requires admin role.
    ("GET",    r"^/api/v1/mgmt/users/[^/]+/2fa/status$",             PERM_AUTH_2FA_ADMIN_STATUS),
    ("POST",   r"^/api/v1/mgmt/users/[^/]+/2fa/setup$",              PERM_AUTH_2FA_ADMIN_SETUP),
    ("POST",   r"^/api/v1/mgmt/users/[^/]+/2fa/enable$",             PERM_AUTH_2FA_ADMIN_ENABLE),
    ("POST",   r"^/api/v1/mgmt/users/[^/]+/2fa/disable$",            PERM_AUTH_2FA_ADMIN_DISABLE),
    ("POST",   r"^/api/v1/mgmt/users/[^/]+/2fa/reset$",              PERM_AUTH_2FA_ADMIN_RESET),
    ("GET",    r"^/api/v1/mgmt/2fa/enabled$",                        PERM_AUTH_2FA_ADMIN_LIST),
    ("GET",    r"^/api/v1/mgmt/2fa/disabled$",                       PERM_AUTH_2FA_ADMIN_LIST),

    # ── Dashboard charts (/api/v1/dashboard/charts/*) — v2.3 ──────────
    ("GET",    r"^/api/v1/dashboard/charts/[^/]+$",                  PERM_DASHBOARD_CHARTS),

    # ── Live updates (/api/v1/live/events) — v2.3 ─────────────────────
    ("GET",    r"^/api/v1/live/events$",                             PERM_LIVE_EVENTS),

    # ── Shell project files (/api/v1/shell/projet/{id}/files/*) — v2.3
    ("GET",    r"^/api/v1/shell/projet/[^/]+/files$",                PERM_SHELL_PROJET_FILES_LIST),
    ("GET",    r"^/api/v1/shell/projet/[^/]+/files/.+$",             PERM_SHELL_PROJET_FILES_READ),
    ("PUT",    r"^/api/v1/shell/projet/[^/]+/files/.+$",             PERM_SHELL_PROJET_FILES_WRITE),
    ("DELETE", r"^/api/v1/shell/projet/[^/]+/files/.+$",             PERM_SHELL_PROJET_FILES_DELETE),
    ("POST",   r"^/api/v1/shell/projet/[^/]+/mkdir/.+$",             PERM_SHELL_PROJET_FILES_WRITE),

    # ── Chat (/api/v1/chat/*) — v2.4 ───────────────────────────────────
    # NOTE: chat endpoints require NO specific permission (any authenticated
    # user can chat). We deliberately do NOT add path-rules so
    # resolve_permission() returns None (=> allowed for any caller).
    # The chat router checks room membership internally.
]


# ── Compile patterns once (cached) ─────────────────────────────────────
#
# Priority for longest-match-wins is computed as the length of the
# LITERAL prefix of the pattern (the part before any ``[^/]+``
# segment). This ensures that a static path like ``/api/v1/users/full``
# wins over the parameterised ``/api/v1/users/[^/]+`` even though the
# regex of the latter is longer. Ties are broken by the full pattern
# length so that more-specific patterns still win.

def _pattern_priority(pattern: str) -> int:
    """Return a sort key: longer = more specific.

    Examples
    --------
    >>> _pattern_priority(r"^/api/v1/users/full$")
    19
    >>> _pattern_priority(r"^/api/v1/users/[^/]+$")
    16
    >>> _pattern_priority(r"^/api/v1/cfg/bulk$")
    17
    >>> _pattern_priority(r"^/api/v1/cfg/[^/]+$")
    14
    """
    # Strip anchors
    p = pattern.lstrip("^").rstrip("$")
    # Replace each [^/]+ segment with a single placeholder char so it
    # contributes 1 to the priority (the minimum matched length)
    p = re.sub(r"\[\^/\]\+", "X", p)
    return len(p)


_COMPILED_RULES: List[Tuple[str, "re.Pattern[str]", str, int]] = [
    (m, re.compile(p), perm, _pattern_priority(p))
    for (m, p, perm) in _PATH_PERM_RULES
]


def resolve_permission(method: str, path: str) -> Optional[str]:
    """Determine the required permission for a given HTTP request.

    Parameters
    ----------
    method : str
        HTTP method (GET, POST, PUT, DELETE, PATCH).
    path : str
        Request path (e.g. ``/api/v1/users/john``).

    Returns
    -------
    str or None
        The permission string required, or ``None`` if no specific
        permission is defined (public endpoints, health checks, etc.).
    """
    method = method.upper()

    # Public paths that need no permission
    _PUBLIC = frozenset({
        "/health", "/docs", "/openapi.json", "/redoc",
        "/api/v1/auth/login", "/api/v1/auth/refresh", "/api/v1/auth/check",
        "/web/api/health",
    })
    if path in _PUBLIC:
        return None
    if path.startswith("/docs") or path.startswith("/ws/") or path.startswith("/web/"):
        return None
    if method == "OPTIONS":
        return None

    # Normalise: strip query string and trailing slash
    if "?" in path:
        path = path.split("?", 1)[0]
    if "#" in path:
        path = path.split("#", 1)[0]
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")

    # Try regex matching — longest pattern wins
    best_match: Optional[str] = None
    best_len = 0
    for m, pattern, perm, plen in _COMPILED_RULES:
        if m != method:
            continue
        if pattern.match(path) and plen > best_len:
            best_match = perm
            best_len = plen

    return best_match


def validate_permission_name(perm: str) -> bool:
    """Return True if *perm* is a known permission string."""
    return perm in ALL_PERMISSIONS


def get_permissions_by_category() -> Dict[str, List[str]]:
    """Return all permissions grouped by resource category."""
    cats: Dict[str, List[str]] = {}
    for p in sorted(ALL_PERMISSIONS):
        cat = p.split(".")[0]
        cats.setdefault(cat, []).append(p)
    return cats


def list_all_permissions() -> List[str]:
    """Return a sorted list of all permission strings (for introspection)."""
    return sorted(ALL_PERMISSIONS)


def list_unmapped_routes() -> List[str]:
    """Diagnostic helper: return regex patterns that have no rules.

    Currently returns an empty list — this is a placeholder for a
    future route-scanner that compares the OpenAPI spec against
    ``_PATH_PERM_RULES`` to detect endpoints with no permission mapping.
    """
    return []
