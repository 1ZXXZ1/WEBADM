/**
 * Shared parsers for samba-tool raw text output.
 *
 * The Samba AD DC API returns most data as raw text inside an `output` field.
 * This module provides robust parsers that convert these text formats into
 * structured JavaScript objects for use in React components.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Generic key:value parser
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Try to decode a base64-encoded LDAP value (LDIF :: convention).
 * LDAP servers return base64 for attributes with non-ASCII chars.
 */
export function tryDecodeLdapValue(val: string): string {
  if (!val || typeof val !== 'string') return val;
  // Quick check: LDAP base64 values typically only contain [A-Za-z0-9+/=]
  // and are at least 4 chars long
  if (val.length < 4) return val;
  if (!/^[A-Za-z0-9+/]+=*$/.test(val)) return val;
  try {
    const decoded = decodeURIComponent(escape(atob(val)));
    // If the decoded string looks like readable text, use it
    if (decoded && /[\x20-\x7E\u0400-\u04FF\u4E00-\u9FFF]/.test(decoded)) {
      return decoded;
    }
    return val; // If decoded doesn't look like text, keep original
  } catch {
    return val;
  }
}

/**
 * Recursively decode base64-encoded values in an LDAP object.
 */
export function decodeLdapObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = tryDecodeLdapValue(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map(v => {
        if (typeof v === 'string') return tryDecodeLdapValue(v);
        if (v && typeof v === 'object' && !Array.isArray(v)) return decodeLdapObject(v as Record<string, unknown>);
        return v;
      });
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = decodeLdapObject(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Convert error response data to a safe string for toast messages.
 * Handles Pydantic validation error arrays like [{type, loc, msg, input}].
 */
export function safeToastMessage(val: unknown, fallback: string = 'Error'): string {
  if (!val) return fallback;
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) {
    // Pydantic validation errors are arrays of {msg, type, loc, input}
    return val.map((item: unknown) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        if (obj.msg) return String(obj.msg);
        if (obj.message) return String(obj.message);
        try { return JSON.stringify(item); } catch { return String(item); }
      }
      return String(item);
    }).join('; ');
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (obj.msg) return String(obj.msg);
    if (obj.message) return String(obj.message);
    if (obj.detail) return safeToastMessage(obj.detail, fallback);
    try { return JSON.stringify(val); } catch { return fallback; }
  }
  return String(val);
}

/**
 * Parse a block of "key : value" lines into a Record.
 * Handles multi-valued attributes (e.g. memberOf appears multiple times).
 * Handles LDIF base64 convention: "key :: base64value" (double colon).
 * Keys that appear more than once become arrays.
 */
export function parseKeyValueBlock(text: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for LDIF base64 convention: "key :: base64value"
    const doubleColonMatch = trimmed.match(/^([^:]+?)\s*::\s*(.+)$/);
    if (doubleColonMatch) {
      const key = doubleColonMatch[1].trim();
      const base64Value = doubleColonMatch[2].trim();
      if (!key) continue;
      const value = tryDecodeLdapValue(base64Value);
      // Handle multi-valued
      if (key in result) {
        const existing = result[key];
        if (Array.isArray(existing)) existing.push(value);
        else result[key] = [existing, value];
      } else {
        result[key] = value;
      }
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx <= 0) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (!key) continue;

    // Handle multi-valued attributes (e.g. objectClass, member, memberOf)
    if (key in result) {
      const existing = result[key];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        result[key] = [existing, value];
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Parse text blocks separated by blank lines.
 * Returns an array of parsed key:value records.
 */
export function parseBlocks(text: string): Record<string, string | string[]>[] {
  const blocks = text.split(/\n\s*\n/).filter(b => b.trim());
  return blocks.map(block => parseKeyValueBlock(block));
}

// ═══════════════════════════════════════════════════════════════════════════
// DNS Parsers
// ═══════════════════════════════════════════════════════════════════════════

export interface DNSZoneInfo {
  name: string;
  zoneType?: string;
  flags?: string;
  dpFqdn?: string;
  [key: string]: unknown;
}

/**
 * Parse samba-tool dns zonelist output.
 * Format: header line "N zone(s) found", then blocks separated by blank lines.
 * Each block has key:value pairs like:
 *   pszZoneName : kcrb.local
 *   Flags       : DNS_RPC_ZONE_DSINTEGRATED ...
 *   ZoneType    : DNS_ZONE_TYPE_PRIMARY
 *   pszDpFqdn   : DomainDnsZones.kcrb.local
 */
export function parseDnsZones(text: string): DNSZoneInfo[] {
  const blocks = parseBlocks(text);
  const zones: DNSZoneInfo[] = [];

  for (const block of blocks) {
    const name = block.pszZoneName;
    if (!name || typeof name !== 'string') continue;

    zones.push({
      name: name.trim(),
      zoneType: typeof block.ZoneType === 'string' ? block.ZoneType.trim() : undefined,
      flags: typeof block.Flags === 'string' ? block.Flags.trim() : undefined,
      dpFqdn: typeof block.pszDpFqdn === 'string' ? block.pszDpFqdn.trim() : undefined,
      ...block,
    });
  }

  return zones;
}

export interface DNSRecordInfo {
  name: string;
  type: string;
  data: string;
  ttl?: string;
  serial?: string;
  flags?: string;
}

/**
 * Parse samba-tool dns query output.
 * Format:
 *   Name=www, Records=2, Children=0
 *     A: 192.168.1.1 (flags=600, serial=3, ttl=900)
 *     AAAA: ::1 (flags=600, serial=3, ttl=900)
 *   Name=@, Records=1, Children=0
 *     NS: dc1.example.com (flags=600, serial=3, ttl=900)
 */
export function parseDnsRecords(text: string): DNSRecordInfo[] {
  const records: DNSRecordInfo[] = [];
  let currentName = '';

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // "Name=www, Records=2, Children=0" or "Name=@, Records=1, Children=0"
    const nameMatch = trimmed.match(/^Name=([^,]+)/i);
    if (nameMatch) {
      currentName = nameMatch[1].trim();
      continue;
    }

    // "A: 192.168.1.1 (flags=600, serial=3, ttl=900)"
    // "NS: dc1.example.com (flags=600, serial=3, ttl=900)"
    // Also handles: "SOA: ns1.example.com hostmaster.example.com 1 900 600 86400 3600 (flags=2400, serial=1, ttl=3600)"
    const recordMatch = trimmed.match(/^(\w+):\s+(.+?)(?:\s*\(flags=(\d+),\s*serial=(\d+),\s*ttl=(\d+)\))?$/);
    if (recordMatch) {
      records.push({
        name: currentName || '@',
        type: recordMatch[1],
        data: recordMatch[2].trim(),
        flags: recordMatch[3],
        serial: recordMatch[4],
        ttl: recordMatch[5],
      });
      continue;
    }

    // Fallback: "TYPE VALUE" format
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2 && currentName) {
      records.push({
        name: currentName,
        type: parts[0],
        data: parts.slice(1).join(' '),
      });
    }
  }

  return records;
}

export interface DnsServerInfo {
  serverName?: string;
  domainName?: string;
  forestName?: string;
  serverAddrs?: string[];
  listenAddrs?: string[];
  ipFromServer?: string;  // first server address for auto-detect
  [key: string]: unknown;
}

/**
 * Parse DNS server info output.
 * Extracts key fields and also parses Python list format like ['192.168.31.136'].
 */
export function parseDnsServerInfo(text: string): DnsServerInfo {
  const parsed = parseKeyValueBlock(text);
  const result: DnsServerInfo = { ...parsed };

  // Parse Python list strings like "['192.168.31.136']"
  const parsePyList = (val: string | string[]): string[] => {
    const str = Array.isArray(val) ? val.join(', ') : val;
    // Match content inside brackets
    const inner = str.match(/\[(.+)\]/);
    if (inner) {
      return inner[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    }
    if (str === 'None' || str === '[]') return [];
    return [str];
  };

  if (parsed.aipServerAddrs) {
    result.serverAddrs = parsePyList(parsed.aipServerAddrs);
    result.ipFromServer = result.serverAddrs[0] || undefined;
  }
  if (parsed.aipListenAddrs) {
    result.listenAddrs = parsePyList(parsed.aipListenAddrs);
  }

  result.serverName = typeof parsed.pszServerName === 'string' ? parsed.pszServerName : undefined;
  result.domainName = typeof parsed.pszDomainName === 'string' ? parsed.pszDomainName : undefined;
  result.forestName = typeof parsed.pszForestName === 'string' ? parsed.pszForestName : undefined;

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// LDAP Attribute Parser (for user/group/computer details)
// ═══════════════════════════════════════════════════════════════════════════

export interface LdapAttributes {
  [key: string]: string | string[];
}

/**
 * Parse LDAP attribute output from samba-tool.
 * Handles multi-valued attributes (e.g. objectClass, member, memberOf)
 * and special formats like:
 *   dn: CN=...
 *   objectClass: top
 *   objectClass: group
 *   member: CN=User1,...
 *   memberOf: CN=Group1,...
 *   userAccountControl: 512
 */
export function parseLdapAttributes(text: string): LdapAttributes {
  return parseKeyValueBlock(text);
}

// ═══════════════════════════════════════════════════════════════════════════
// User details parser
// ═══════════════════════════════════════════════════════════════════════════

export interface UserDetail {
  username: string;
  sn?: string;
  givenName?: string;
  mail?: string;
  department?: string;
  title?: string;
  company?: string;
  description?: string;
  telephoneNumber?: string;
  sAMAccountName?: string;
  userAccountControl?: string;
  whenCreated?: string;
  whenChanged?: string;
  lastLogonTimestamp?: string;
  pwdLastSet?: string;
  memberOf?: string[];
  dn?: string;
  [key: string]: unknown;
}

/**
 * Parse user show output into a structured UserDetail.
 */
export function parseUserDetail(username: string, text: string): UserDetail {
  const attrs = parseLdapAttributes(text);
  const memberOf: string[] | undefined = Array.isArray(attrs.memberOf) ? attrs.memberOf : typeof attrs.memberOf === 'string' ? [attrs.memberOf] : undefined;
  const { memberOf: _memberOf, ...restAttrs } = attrs;

  return {
    username,
    sn: typeof attrs.sn === 'string' ? attrs.sn : undefined,
    givenName: typeof attrs.givenName === 'string' ? attrs.givenName : undefined,
    mail: typeof attrs.mail === 'string' ? attrs.mail : undefined,
    department: typeof attrs.department === 'string' ? attrs.department : undefined,
    title: typeof attrs.title === 'string' ? attrs.title : undefined,
    company: typeof attrs.company === 'string' ? attrs.company : undefined,
    description: typeof attrs.description === 'string' ? attrs.description : undefined,
    telephoneNumber: typeof attrs.telephoneNumber === 'string' ? attrs.telephoneNumber : undefined,
    sAMAccountName: typeof attrs.sAMAccountName === 'string' ? attrs.sAMAccountName : undefined,
    userAccountControl: typeof attrs.userAccountControl === 'string' ? attrs.userAccountControl : undefined,
    whenCreated: typeof attrs.whenCreated === 'string' ? attrs.whenCreated : undefined,
    whenChanged: typeof attrs.whenChanged === 'string' ? attrs.whenChanged : undefined,
    lastLogonTimestamp: typeof attrs.lastLogonTimestamp === 'string' ? attrs.lastLogonTimestamp : undefined,
    pwdLastSet: typeof attrs.pwdLastSet === 'string' ? attrs.pwdLastSet : undefined,
    memberOf,
    dn: typeof attrs.dn === 'string' ? attrs.dn : undefined,
    ...restAttrs,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Group details parser
// ═══════════════════════════════════════════════════════════════════════════

export interface GroupDetail {
  groupname: string;
  cn?: string;
  description?: string;
  member?: string[];
  memberOf?: string[];
  sAMAccountName?: string;
  groupType?: string;
  dn?: string;
  [key: string]: unknown;
}

/**
 * Parse group show output into a structured GroupDetail.
 */
export function parseGroupDetail(groupname: string, text: string): GroupDetail {
  const attrs = parseLdapAttributes(text);

  // Normalize array fields — ...attrs would overwrite with raw values
  const member: string[] | undefined = Array.isArray(attrs.member) ? attrs.member as string[] : typeof attrs.member === 'string' ? [attrs.member] : undefined;
  const memberOf: string[] | undefined = Array.isArray(attrs.memberOf) ? attrs.memberOf as string[] : typeof attrs.memberOf === 'string' ? [attrs.memberOf] : undefined;

  // Spread attrs first, then override with normalized values
  const { member: _m, memberOf: _mo, ...restAttrs } = attrs;

  return {
    groupname,
    cn: typeof attrs.cn === 'string' ? attrs.cn : undefined,
    description: typeof attrs.description === 'string' ? attrs.description : undefined,
    member,
    memberOf,
    sAMAccountName: typeof attrs.sAMAccountName === 'string' ? attrs.sAMAccountName : undefined,
    groupType: typeof attrs.groupType === 'string' ? attrs.groupType : undefined,
    dn: typeof attrs.dn === 'string' ? attrs.dn : undefined,
    ...restAttrs,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// FSMO roles parser
// ═══════════════════════════════════════════════════════════════════════════

export interface FsmoRoleInfo {
  role: string;
  owner: string;
  shortName: string;
}

/**
 * Parse FSMO role output like:
 *   SchemaMasterRole owner: CN=NTDS Settings,CN=DC1,CN=Servers,...
 */
export function parseFsmoRoles(text: string): FsmoRoleInfo[] {
  const roles: FsmoRoleInfo[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^([\w]+Role)\s*(?:owner\s*)?:\s*(.+)$/i);
    if (match) {
      const role = match[1].trim();
      const owner = match[2].trim();
      const cnMatch = owner.match(/CN=([^,]+),CN=Servers/i);
      const shortName = cnMatch ? cnMatch[1] : owner.match(/CN=([^,]+)/)?.[1] || owner;

      roles.push({ role, owner, shortName });
    }
  }

  return roles;
}

// ═══════════════════════════════════════════════════════════════════════════
// GPO parser
// ═══════════════════════════════════════════════════════════════════════════

export interface GpoInfo {
  gpoId: string;
  displayname: string;
  path?: string;
  dn?: string;
  version?: number;
  flags?: string;
}

/**
 * Parse samba-tool gpo listall output.
 * Format: blocks separated by blank lines, each block has:
 *   GPO          : {GUID}
 *   display name : Name
 *   path         : \\domain\sysvol\...
 *   dn           : CN=...
 *   version      : 0
 *   flags        : NONE
 */
export function parseGpoList(text: string): GpoInfo[] {
  const blocks = parseBlocks(text);
  const gpos: GpoInfo[] = [];

  for (const block of blocks) {
    const gpoId = typeof block.GPO === 'string' ? block.GPO.trim() : undefined;
    if (!gpoId) continue;

    gpos.push({
      gpoId,
      displayname: typeof block['display name'] === 'string' ? block['display name'].trim() : gpoId,
      path: typeof block.path === 'string' ? block.path.trim() : undefined,
      dn: typeof block.dn === 'string' ? block.dn.trim() : undefined,
      version: typeof block.version === 'string' ? Number(block.version) || 0 : undefined,
      flags: typeof block.flags === 'string' ? block.flags.trim() : undefined,
    });
  }

  return gpos;
}

// ═══════════════════════════════════════════════════════════════════════════
// LDAP Attribute Value Renderer
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Render any LDAP attribute value into a display-safe form.
 * - null/undefined → '—'
 * - Array → array of stringified elements (for Badge list rendering)
 * - Object → JSON string
 * - Primitives → string
 */
export function renderAttrValue(value: unknown): string | string[] {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.map(v => String(v));
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Normalize a field that could be a string, array, or undefined into an array.
 * LDAP attributes like `member` and `memberOf` can come as either a single
 * string or an array of strings depending on how many values exist.
 */
export function normalizeToArray(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map(v => String(v));
  if (typeof value === 'string') return [value];
  return [String(value)];
}

// ═══════════════════════════════════════════════════════════════════════════
// API Response Unwrapper
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract the output text from various API response wrappers.
 * Handles: {output: "..."}, {data: {output: "..."}}, {result: {output: "..."}}
 */
export function extractOutputText(data: unknown): string | undefined {
  if (typeof data === 'string') return data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;

  const d = data as Record<string, unknown>;

  // Direct output
  if (typeof d.output === 'string') return d.output;

  // data.data.output
  if (d.data && typeof d.data === 'object' && !Array.isArray(d.data)) {
    const inner = d.data as Record<string, unknown>;
    if (typeof inner.output === 'string') return inner.output;
  }

  // data.result.output
  if (d.result && typeof d.result === 'object' && !Array.isArray(d.result)) {
    const inner = d.result as Record<string, unknown>;
    if (typeof inner.output === 'string') return inner.output;
  }

  return undefined;
}

/**
 * Extract the inner data object from various API response wrappers.
 */
export function unwrapResponse(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const d = data as Record<string, unknown>;

  if (d.data && typeof d.data === 'object' && !Array.isArray(d.data)) return d.data;
  if (d.result && typeof d.result === 'object' && !Array.isArray(d.result)) return d.result;
  return data;
}

/**
 * Extract a simple list of names from an API response.
 * Handles: ["name1", "name2"], {output: "name1\nname2"}, {data: [...]}, etc.
 */
export function extractNameList(data: unknown): string[] {
  if (Array.isArray(data)) {
    return data.map((item: unknown) => {
      if (item === null || item === undefined) return '';
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        return String(obj.name || obj.groupname || obj.computername || obj.username || obj.cn || Object.values(obj)[0] || '').trim();
      }
      return String(item).trim();
    }).filter(Boolean);
  }

  const outputText = extractOutputText(data);
  if (outputText) {
    // Skip header lines like "3 zone(s) found" or "X user(s) found"
    return outputText.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.match(/^\d+\s+(zone|user|group|computer|contact|ou)s?\s*\(/i));
  }

  const unwrapped = unwrapResponse(data);
  if (Array.isArray(unwrapped)) {
    return extractNameList(unwrapped);
  }

  return [];
}
