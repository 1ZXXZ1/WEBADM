'use client';

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RequirePermission } from '@/components/permissions/RequirePermission';
import api from '@/lib/api';
import AttributeViewer, { safeRenderValue, formatObjectShort, getAttrLocalName, getAttrWeight } from '@/components/shared/AttributeViewer';
import { decodeLdapObject, safeToastMessage, tryDecodeLdapValue } from '@/lib/parsers';
import {
  Server, Shield, Lock, RefreshCw, Loader2, Globe, Network,
  Crown, Database, KeyRound, Fingerprint, LayoutList,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import ColumnCustomizer, { useColumnConfig, type ColumnDef } from '@/components/shared/ColumnCustomizer';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { useOrientation } from '@/hooks/use-orientation';

// FSMO role display configuration
const FSMO_ROLE_CONFIG: Record<string, { label: string; labelRu: string; icon: React.ElementType; color: string }> = {
  SchemaMasterRole: { label: 'Schema Master', labelRu: 'Мастер схемы', icon: Database, color: 'text-purple-500' },
  InfrastructureMasterRole: { label: 'Infrastructure Master', labelRu: 'Мастер инфраструктуры', icon: LayoutList, color: 'text-cyan-500' },
  RidAllocationMasterRole: { label: 'RID Allocation Master', labelRu: 'Мастер распределения RID', icon: Fingerprint, color: 'text-orange-500' },
  PdcEmulationRole: { label: 'PDC Emulator', labelRu: 'Эмулятор PDC', icon: Crown, color: 'text-amber-500' },
  DomainNamingMasterRole: { label: 'Domain Naming Master', labelRu: 'Мастер именования доменов', icon: KeyRound, color: 'text-emerald-500' },
  schema_master: { label: 'Schema Master', labelRu: 'Мастер схемы', icon: Database, color: 'text-purple-500' },
  infrastructure_master: { label: 'Infrastructure Master', labelRu: 'Мастер инфраструктуры', icon: LayoutList, color: 'text-cyan-500' },
  rid_allocator_master: { label: 'RID Allocation Master', labelRu: 'Мастер распределения RID', icon: Fingerprint, color: 'text-orange-500' },
  pdc_emulator: { label: 'PDC Emulator', labelRu: 'Эмулятор PDC', icon: Crown, color: 'text-amber-500' },
  domain_naming_master: { label: 'Domain Naming Master', labelRu: 'Мастер именования доменов', icon: KeyRound, color: 'text-emerald-500' },
  InfrastructureMasterRole_DomainDnsZones: { label: 'Infrastructure Master (DomainDnsZones)', labelRu: 'Мастер инфраструктуры (DomainDnsZones)', icon: LayoutList, color: 'text-cyan-400' },
  InfrastructureMasterRole_ForestDnsZones: { label: 'Infrastructure Master (ForestDnsZones)', labelRu: 'Мастер инфраструктуры (ForestDnsZones)', icon: LayoutList, color: 'text-cyan-300' },
};

// LDAP metadata keys that should be excluded from policy/data displays
const LDAP_META_KEYS = new Set([
  'dn', 'distinguishedName', 'objectClass', 'objectGUID', 'objectSid',
  'objectCategory', 'whenCreated', 'whenChanged', 'uSNCreated', 'uSNChanged',
  'instanceType', 'name', 'showInAdvancedViewOnly', 'isCriticalSystemObject',
]);

// Password policy field name mapping (CamelCase LDAP → snake_case display)
const PASSWORD_KEY_MAP: Record<string, string> = {
  lockOutObservationWindow: 'reset_account_lockout_after',
  lockoutDuration: 'account_lockout_duration',
  lockoutThreshold: 'account_lockout_threshold',
  maxPwdAge: 'max_password_age',
  minPwdAge: 'min_password_age',
  minPwdLength: 'min_password_length',
  pwdHistoryLength: 'password_history_length',
  pwdProperties: 'password_properties',
  pwdComplexity: 'password_complexity',
  storePlaintext: 'store_plaintext',
};

// Time-related password fields (values are in negative 100ns ticks)
const PASSWORD_TIME_KEYS = new Set([
  'lockOutObservationWindow', 'lockoutDuration', 'maxPwdAge', 'minPwdAge',
]);

// Convert AD negative 100ns ticks to human-readable string
function formatTicksValue(ticks: number): string {
  const absTicks = Math.abs(ticks);
  const totalMinutes = absTicks / 600000000; // 100ns → minutes
  if (totalMinutes >= 1440) { // >= 1 day
    const days = Math.round(totalMinutes / 1440 * 10) / 10;
    return `${days} дн.`;
  }
  return `${Math.round(totalMinutes)} мин.`;
}

// Map msDS-Behavior-Version number to human-readable level name
function behaviorVersionToString(ver: number | string): string {
  const num = typeof ver === 'string' ? parseInt(ver, 10) : ver;
  const levels: Record<number, string> = {
    0: 'Windows 2000',
    1: 'Windows Server 2003 Interim',
    2: 'Windows Server 2003',
    3: 'Windows Server 2008',
    4: 'Windows Server 2008 R2',
    5: 'Windows Server 2012',
    6: 'Windows Server 2012 R2',
    7: 'Windows Server 2016',
  };
  return levels[num] || `Уровень ${num}`;
}

// Format a password policy value for display
function formatPasswordValue(key: string, value: unknown): unknown {
  const numVal = typeof value === 'string' ? parseInt(value, 10) : (typeof value === 'number' ? value : NaN);
  if (isNaN(numVal)) return value;

  if (PASSWORD_TIME_KEYS.has(key) && numVal < 0) {
    return formatTicksValue(numVal);
  }

  if (key === 'pwdProperties') {
    return numVal === 1 ? 'Включена' : numVal === 0 ? 'Отключена' : String(numVal);
  }

  return value;
}

// Parse FSMO text output
function parseFsmoOutput(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^([\w]+Role)\s*(?:owner\s*)?:\s*(.+)$/i);
    if (match) {
      result[match[1].trim()] = match[2].trim();
    }
  }
  return result;
}

// Extract short server name from a DN
function extractServerName(dn: string): string {
  const cnMatch = dn.match(/CN=([^,]+),CN=Servers/i);
  if (cnMatch) return cnMatch[1];
  const firstCn = dn.match(/CN=([^,]+)/);
  return firstCn ? firstCn[1] : dn;
}

// Determine FSMO role name from a DN path
function getFsmoRoleName(dn: string): string {
  const upperDn = dn.toUpperCase();
  if (upperDn.includes('SCHEMA')) return 'SchemaMasterRole';
  if (upperDn.includes('PARTITIONS')) return 'DomainNamingMasterRole';
  if (upperDn.includes('INFRASTRUCTURE')) {
    if (upperDn.includes('DOMAINDNSZONES')) return 'InfrastructureMasterRole_DomainDnsZones';
    if (upperDn.includes('FORESTDNSZONES')) return 'InfrastructureMasterRole_ForestDnsZones';
    return 'InfrastructureMasterRole';
  }
  if (upperDn.includes('RID MANAGER')) return 'RidAllocationMasterRole';
  // PDC Emulator: domain NC head DN (DC=domain,DC=tld format without CN=)
  if (/^DC=[^,]+(,DC=[^,]+)+$/i.test(dn)) return 'PdcEmulationRole';
  if (upperDn.includes('PDC') || upperDn.includes('PDP')) return 'PdcEmulationRole';
  // Fallback: use CN from the DN
  const cnMatch = dn.match(/CN=([^,]+)/);
  return cnMatch ? cnMatch[1] : dn;
}

/**
 * Process an array of LDAP objects for domain info.
 * Picks the main domain object and formats output with proper keys.
 * Also includes DNS partition info as individual entries.
 * Handles cases where item values contain raw LDIF text that needs parsing.
 */
function processDomainInfoArray(items: Record<string, unknown>[]): Record<string, unknown> {
  let mainObj: Record<string, unknown> | null = null;
  const dnsPartitions: { name: string; dn: string }[] = [];

  for (const item of items) {
    const dn = String(item.dn || item.distinguishedName || '');
    const isDnsPartition = dn.includes('DomainDnsZones') || dn.includes('ForestDnsZones');

    if (isDnsPartition) {
      const partitionName = dn.includes('DomainDnsZones') ? 'DomainDnsZones' : 'ForestDnsZones';
      dnsPartitions.push({ name: partitionName, dn });
    } else {
      if (!mainObj || Object.keys(item).length > Object.keys(mainObj).length) {
        mainObj = { ...item };
      }
    }
  }

  // If we didn't find a mainObj with a proper dn, check if any item values
  // contain raw LDIF text and try to parse them
  if (!mainObj && items.length > 0) {
    // Try to merge all items' parsed data
    const merged: Record<string, unknown> = {};
    for (const item of items) {
      for (const [key, value] of Object.entries(item)) {
        if (typeof value === 'string' && isLdifLikeText(value)) {
          // Parse this LDIF string and merge
          const parsed = parseLdifTextToAttrs(value);
          for (const [pk, pv] of Object.entries(parsed)) {
            if (pk === 'distinguishedName' && parsed.dn) continue;
            if (pk === 'msDS-Behavior-Version') {
              merged[pk] = `${behaviorVersionToString(pv)} (${pv})`;
            } else if (pk === 'dn') {
              if (pv.includes('DomainDnsZones')) {
                merged['dn_DomainDnsZones'] = pv;
                dnsPartitions.push({ name: 'DomainDnsZones', dn: pv });
              } else if (pv.includes('ForestDnsZones')) {
                merged['dn_ForestDnsZones'] = pv;
                dnsPartitions.push({ name: 'ForestDnsZones', dn: pv });
              } else {
                merged[pk] = pv;
              }
            } else if (pk === 'domain') {
              const dnVal = String(pv);
              const domainName = dnVal.replace(/DC=/gi, '').replace(/,/g, '.');
              merged['domain'] = domainName !== dnVal ? domainName : pv;
            } else if (!LDAP_META_KEYS.has(pk) || pk === 'objectSid') {
              merged[pk] = pv;
            }
          }
        } else {
          if (key === 'domain') {
            const dnVal = String(value);
            const domainName = dnVal.replace(/DC=/gi, '').replace(/,/g, '.');
            if (isLdifLikeText(dnVal)) {
              // Don't set domain to LDIF text, parse it instead
              const parsed = parseLdifTextToAttrs(dnVal);
              for (const [pk, pv] of Object.entries(parsed)) {
                if (pk === 'domain') {
                  const dName = String(pv).replace(/DC=/gi, '').replace(/,/g, '.');
                  merged['domain'] = dName;
                } else if (pk === 'dn') {
                  if (pv.includes('DomainDnsZones')) {
                    merged['dn_DomainDnsZones'] = pv;
                    dnsPartitions.push({ name: 'DomainDnsZones', dn: pv });
                  } else if (pv.includes('ForestDnsZones')) {
                    merged['dn_ForestDnsZones'] = pv;
                    dnsPartitions.push({ name: 'ForestDnsZones', dn: pv });
                  } else {
                    merged[pk] = pv;
                  }
                } else if (pk === 'msDS-Behavior-Version') {
                  merged[pk] = `${behaviorVersionToString(pv)} (${pv})`;
                } else if (!LDAP_META_KEYS.has(pk) || pk === 'objectSid') {
                  merged[pk] = pv;
                }
              }
            } else {
              merged['domain'] = domainName !== dnVal ? domainName : value;
            }
          } else if (key !== 'status' && key !== 'message') {
            merged[key] = value;
          }
        }
      }
    }
    if (Object.keys(merged).length > 0) mainObj = merged;
  }

  const result: Record<string, unknown> = {};

  if (mainObj) {
    // Extract domain name from DN (DC=kcrb,DC=local → kcrb.local)
    const dnStr = String(mainObj.dn || mainObj.distinguishedName || '');
    // Check if dnStr itself is LDIF-like (shouldn't be, but safety check)
    if (dnStr && !isLdifLikeText(dnStr)) {
      const domainName = dnStr.replace(/DC=/gi, '').replace(/,/g, '.');
      if (domainName && domainName !== dnStr) {
        result['domain'] = domainName;
      }
    }

    // Process attributes with better formatting
    for (const [key, value] of Object.entries(mainObj)) {
      if (key === 'status' || key === 'message') continue;
      // Skip domain key if already set above
      if (key === 'domain' && result['domain']) continue;
      // Check if value is LDIF-like text that should be parsed
      if (typeof value === 'string' && isLdifLikeText(value)) {
        // Parse and merge into result instead of showing raw text
        const parsed = parseLdifTextToAttrs(value);
        for (const [pk, pv] of Object.entries(parsed)) {
          if (pk === 'distinguishedName' && parsed.dn) continue;
          if (pk === 'domain') {
            const dnVal = String(pv);
            const domainName = dnVal.replace(/DC=/gi, '').replace(/,/g, '.');
            if (domainName !== dnVal && !result['domain']) {
              result['domain'] = domainName;
            }
          } else if (pk === 'msDS-Behavior-Version') {
            result[pk] = `${behaviorVersionToString(pv)} (${pv})`;
          } else if (pk === 'dn') {
            if (pv.includes('DomainDnsZones')) {
              result['dn_DomainDnsZones'] = pv;
              if (!dnsPartitions.some(p => p.name === 'DomainDnsZones')) {
                dnsPartitions.push({ name: 'DomainDnsZones', dn: pv });
              }
            } else if (pv.includes('ForestDnsZones')) {
              result['dn_ForestDnsZones'] = pv;
              if (!dnsPartitions.some(p => p.name === 'ForestDnsZones')) {
                dnsPartitions.push({ name: 'ForestDnsZones', dn: pv });
              }
            } else {
              result[pk] = pv;
            }
          } else if (!LDAP_META_KEYS.has(pk) || pk === 'objectSid') {
            if (!result[pk]) result[pk] = pv;
          }
        }
        continue;
      }
      // Skip redundant distinguishedName (same as dn)
      if (key === 'distinguishedName' && mainObj.dn) continue;
      // Format msDS-Behavior-Version with human-readable level
      if (key === 'msDS-Behavior-Version') {
        result[key] = `${behaviorVersionToString(value)} (${value})`;
        continue;
      }
      // Skip LDAP metadata that clutters the card view (but keep dn and objectSid)
      if (LDAP_META_KEYS.has(key) && key !== 'objectSid' && key !== 'dn') continue;
      result[key] = value;
    }
  }

  // Add DNS partition DNs as individual entries
  if (dnsPartitions.length > 0) {
    for (const partition of dnsPartitions) {
      result[`dn_${partition.name}`] = partition.dn;
    }
    result['dnsPartitions'] = dnsPartitions.map(p => p.name).join(', ');
  }

  return Object.keys(result).length > 0 ? result : (mainObj || {});
}

/**
 * Deep sanitize: check ALL string values in the data object for LDIF-like text,
 * even if they're nested inside other structures.
 * This catches cases where raw LDIF text ends up as a value of any key.
 */
function deepSanitizeDomainInfo(data: Record<string, unknown>): Record<string, unknown> {
  // First run the regular sanitize
  const result = sanitizeDomainInfoInternal(data);

  // Then check if any remaining values contain LDIF-like text or LDAP object arrays
  const final: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string' && isLdifLikeText(value)) {
      // Try to parse this LDIF string and merge results
      const parsed = parseLdifTextToAttrs(value);
      for (const [pk, pv] of Object.entries(parsed)) {
        if (pk === 'distinguishedName' && parsed.dn) continue;
        if (pk === 'domain') {
          const dnVal = String(pv);
          const domainName = dnVal.replace(/DC=/gi, '').replace(/,/g, '.');
          if (domainName !== dnVal) {
            final['domain'] = domainName;
          } else {
            final[pk] = pv;
          }
        } else if (pk === 'msDS-Behavior-Version') {
          final[pk] = `${behaviorVersionToString(pv)} (${pv})`;
        } else if (pk === 'dn') {
          if (pv.includes('DomainDnsZones')) {
            final['dn_DomainDnsZones'] = pv;
          } else if (pv.includes('ForestDnsZones')) {
            final['dn_ForestDnsZones'] = pv;
          } else {
            final[pk] = pv;
          }
        } else if (!LDAP_META_KEYS.has(pk) || pk === 'objectSid') {
          final[pk] = pv;
        }
      }
    } else if (key === 'domain' && Array.isArray(value)) {
      // Array of LDAP objects under 'domain' key - process through processDomainInfoArray
      const items = value.filter((item: unknown): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null && !Array.isArray(item)
      );
      if (items.length > 0) {
        const processed = processDomainInfoArray(items);
        // Merge processed result into final
        for (const [pk, pv] of Object.entries(processed)) {
          if (!(pk in final)) final[pk] = pv;
        }
      }
    } else {
      final[key] = value;
    }
  }

  return final;
}

/**
 * Check if a string value looks like raw LDIF text that should be parsed
 * into individual key-value pairs instead of displayed as-is.
 */
function isLdifLikeText(value: string): boolean {
  // Must contain DC= (DN component)
  if (!value.includes('DC=')) return false;
  // Must contain at least one recognized LDAP attribute key followed by ':'
  const ldifKeys = [
    'dn:', 'distinguishedName:', 'objectSid:', 'objectClass:',
    'msDS-Behavior-Version:', 'objectGUID:', 'instanceType:',
    'name:', 'whenCreated:', 'whenChanged:', 'fSMORoleOwner:',
    'uSNCreated:', 'uSNChanged:', 'objectCategory:',
    'isCriticalSystemObject:', 'showInAdvancedViewOnly:',
    'cn:', 'subSchemaSubEntry:',
  ];
  // Must contain at least 2 LDIF key patterns (not just one DN value that happens to have DC=)
  let matchCount = 0;
  for (const lk of ldifKeys) {
    if (value.includes(lk)) matchCount++;
  }
  return matchCount >= 1;
}

/**
 * Post-process domain info to detect and clean up raw LDIF text in values.
 * Handles cases where the API returns string values containing raw LDIF like
 * "dn:DC=..., distinguishedName:DC=..." or concatenated "DC=..., distinguishedName:DC=..."
 * which should be parsed into individual fields.
 */
function sanitizeDomainInfoInternal(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key === 'status' || key === 'message') continue;

    // Check if value is a string containing raw LDIF text
    if (typeof value === 'string' && isLdifLikeText(value)) {
      // Parse this as LDIF text and extract individual attributes
      const parsed = parseLdifTextToAttrs(value);
      for (const [pk, pv] of Object.entries(parsed)) {
        if (pk === 'distinguishedName' && parsed.dn) continue; // Skip redundant DN
        if (pk === 'domain') {
          // Extract domain name from DN
          const dnVal = String(pv);
          const domainName = dnVal.replace(/DC=/gi, '').replace(/,/g, '.');
          if (domainName !== dnVal) {
            result['domain'] = domainName;
          } else {
            result[pk] = pv;
          }
        } else if (pk === 'msDS-Behavior-Version') {
          result[pk] = `${behaviorVersionToString(pv)} (${pv})`;
        } else if (pk === 'dn') {
          // Store DNS partition DNs as separate named entries
          if (pv.includes('DomainDnsZones')) {
            result['dn_DomainDnsZones'] = pv;
          } else if (pv.includes('ForestDnsZones')) {
            result['dn_ForestDnsZones'] = pv;
          } else {
            result[pk] = pv;
          }
        } else if (!LDAP_META_KEYS.has(pk) || pk === 'objectSid') {
          result[pk] = pv;
        }
      }
      continue;
    }

    result[key] = value;
  }

  return result;
}

/**
 * Parse LDIF-format text into individual key-value attributes.
 * Handles "dn:DC=..., distinguishedName:DC=..., objectSid:S-1-5-..., msDS-Behavior-Version:4"
 * comma-separated or newline-separated format.
 */
function parseLdifTextToAttrs(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  const dnEntries: string[] = []; // Track all DN values separately

  // Try splitting by newlines first
  const lines = text.split(/[\n]/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Each line might contain comma-separated "key:value" pairs
    // But we need to be careful not to split DN values that contain commas
    // Strategy: find key:value boundaries, where key is before the first colon
    // and value continues until the next recognized key
    const pairs = splitLdifPairs(trimmed);
    for (const [k, v] of pairs) {
      if (k && v !== undefined) {
        // Handle duplicate keys (e.g. if 'dn' appears in the same line)
        if (k === 'dn') {
          // Collect all DN values separately
          dnEntries.push(v);
        }

        if (k in result) {
          // If we already have this key from a previous line, append as new line
          // or skip if it's the same value
          if (result[k] !== v) {
            // Store secondary DN entries with suffixed keys
            // e.g. dnsPartition_DomainDnsZones
            if (v.includes('DomainDnsZones')) {
              result['dnsPartitions'] = (result['dnsPartitions'] ? result['dnsPartitions'] + ', ' : '') + 'DomainDnsZones';
            } else if (v.includes('ForestDnsZones')) {
              result['dnsPartitions'] = (result['dnsPartitions'] ? result['dnsPartitions'] + ', ' : '') + 'ForestDnsZones';
            }
          }
        } else {
          result[k] = v;
        }
      }
    }
  }

  // If we collected multiple DN entries, store them individually
  if (dnEntries.length > 1) {
    for (const dnVal of dnEntries) {
      if (dnVal.includes('DomainDnsZones')) {
        result['dn_DomainDnsZones'] = dnVal;
      } else if (dnVal.includes('ForestDnsZones')) {
        result['dn_ForestDnsZones'] = dnVal;
      }
    }
  }

  return result;
}

/**
 * Split a line like "dn:DC=DomainDnsZones,DC=kcrb,DC=local, distinguishedName:DC=DomainDnsZones,DC=kcrb,DC=local"
 * into pairs [["dn", "DC=DomainDnsZones,DC=kcrb,DC=local"], ["distinguishedName", "DC=DomainDnsZones,DC=kcrb,DC=local"]]
 */
function splitLdifPairs(text: string): [string, string][] {
  const pairs: [string, string][] = [];

  // Known LDIF/LDAP attribute names that might appear as keys in this format
  const knownKeys = [
    'dn', 'distinguishedName', 'objectSid', 'objectClass', 'objectGUID',
    'msDS-Behavior-Version', 'instanceType', 'name', 'whenCreated', 'whenChanged',
    'uSNCreated', 'uSNChanged', 'objectCategory', 'isCriticalSystemObject',
    'showInAdvancedViewOnly', 'fSMORoleOwner', 'domain', 'cn',
  ];

  // Find all occurrences of known keys followed by ':'
  const positions: { key: string; start: number; valueStart: number }[] = [];

  for (const kk of knownKeys) {
    let searchFrom = 0;
    while (true) {
      // Look for key pattern: either at start of string or preceded by comma+space or newline
      const idx = text.indexOf(kk + ':', searchFrom);
      if (idx === -1) break;
      // Verify this is a real key (at start or preceded by comma+space)
      if (idx === 0 || text[idx - 1] === ' ' || text[idx - 1] === ',' || text[idx - 1] === '\n') {
        positions.push({
          key: kk,
          start: idx,
          valueStart: idx + kk.length + 1, // after 'key:'
        });
      }
      searchFrom = idx + 1;
    }
  }

  // Sort by position
  positions.sort((a, b) => a.start - b.start);

  // Extract values between positions
  for (let i = 0; i < positions.length; i++) {
    const valStart = positions[i].valueStart;
    const valEnd = i + 1 < positions.length ? positions[i + 1].start : text.length;
    const value = text.slice(valStart, valEnd).replace(/^\s*,\s*/, '').replace(/\s*,\s*$/, '').trim();
    pairs.push([positions[i].key, value]);
  }

  // If no known keys found, fall back to simple colon split
  if (pairs.length === 0) {
    const colonIdx = text.indexOf(':');
    if (colonIdx > 0) {
      pairs.push([text.slice(0, colonIdx).trim(), text.slice(colonIdx + 1).trim()]);
    }
  }

  return pairs;
}

/**
 * Try to extract a domain array from various API response formats.
 * Handles: { domain: [...] }, { data: { domain: [...] } }, { result: { domain: [...] } }
 */
function extractDomainArray(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return null;

  const obj = data as Record<string, unknown>;

  // Direct domain array: { status: "ok", domain: [...] }
  if (Array.isArray(obj.domain)) return obj.domain;

  // Unwrap nested: { data: { domain: [...] } } or { result: { domain: [...] } }
  if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
    const inner = obj.data as Record<string, unknown>;
    if (Array.isArray(inner.domain)) return inner.domain;
  }
  if (obj.result && typeof obj.result === 'object' && !Array.isArray(obj.result)) {
    const inner = obj.result as Record<string, unknown>;
    if (Array.isArray(inner.domain)) return inner.domain;
  }

  return null;
}

/**
 * Detect if data is an object with all numeric keys (from decodeLdapObject on array)
 * and convert it back to an array.
 */
function objectToArrayIfNeeded(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const obj = data as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return data;
  // Check if ALL keys are numeric strings (0, 1, 2, ...)
  const allNumeric = keys.every(k => /^\d+$/.test(k));
  if (allNumeric && keys.length > 1) {
    return keys.sort((a, b) => Number(a) - Number(b)).map(k => obj[k]);
  }
  return data;
}

/**
 * Process password policy data, filtering out LDAP metadata and
 * extracting only policy-relevant attributes with proper formatting.
 */
function processPasswordData(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key === 'status' || key === 'message') continue;

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Nested object (e.g. password_settings) - extract, map and format fields
      const nested = value as Record<string, unknown>;
      for (const [nk, nv] of Object.entries(nested)) {
        if (LDAP_META_KEYS.has(nk)) continue;
        if (nk === 'status' || nk === 'message') continue;
        // Map CamelCase LDAP names to snake_case display names
        const mappedKey = PASSWORD_KEY_MAP[nk] || nk;
        if (LDAP_META_KEYS.has(mappedKey)) continue;
        // Format the value (convert ticks, etc.)
        result[mappedKey] = formatPasswordValue(nk, nv);
      }
    } else {
      if (LDAP_META_KEYS.has(key)) continue;
      // Also map top-level CamelCase keys
      const mappedKey = PASSWORD_KEY_MAP[key] || key;
      result[mappedKey] = formatPasswordValue(key, value);
    }
  }

  return result;
}

/**
 * Process trust data from an array of LDAP objects into a readable format.
 */
function processTrustArray(items: Record<string, unknown>[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  items.forEach((item, idx) => {
    const trustName = String(
      item.trustPartner || item.trusted_domain || item.cn || item.name || item.dn || `Доверие ${idx + 1}`
    );
    // Format the trust attributes nicely
    const attrs: string[] = [];
    for (const [key, value] of Object.entries(item)) {
      if (key === 'status' || key === 'message' || key === 'dn' || key === 'distinguishedName') continue;
      if (LDAP_META_KEYS.has(key)) continue;
      const valStr = Array.isArray(value) ? value.join(', ') : String(value);
      if (valStr && valStr !== 'undefined') {
        attrs.push(`${getAttrLocalName(key)}: ${valStr}`);
      }
    }
    result[trustName] = attrs.length > 0 ? attrs.join('\n') : String(item.dn || trustName);
  });

  return result;
}

export default function DomainPage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { effectiveLandscape } = useOrientation();
  const isLandscapeMobile = isMobile && effectiveLandscape;

  const defaultSections: ColumnDef[] = useMemo(() => [
    { key: 'domain-info', label: t('domain.domainInfo'), visible: true, removable: false },
    { key: 'domain-level', label: t('domain.functionalLevel'), visible: true },
    { key: 'domain-password', label: t('domain.passwordPolicy'), visible: true },
    { key: 'domain-fsmo', label: t('domain.fsmoRoles'), visible: true },
    { key: 'domain-trusts', label: t('domain.trusts'), visible: true },
  ], [t]);
  const { columns: sectionConfig, setColumns: setSectionConfig, isColumnVisible: isSectionVisible } = useColumnConfig('domain', defaultSections);

  const [loading, setLoading] = useState(false);
  const [ipAddress, setIpAddress] = useState('127.0.0.1');
  const [domainInfo, setDomainInfo] = useState<Record<string, unknown> | null>(null);
  const [domainLevel, setDomainLevel] = useState<Record<string, unknown> | null>(null);
  const [passwordPolicy, setPasswordPolicy] = useState<Record<string, unknown> | null>(null);
  const [fsmoRoles, setFsmoRoles] = useState<Record<string, unknown> | null>(null);
  const [trustList, setTrustList] = useState<Record<string, unknown> | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [detailTitle, setDetailTitle] = useState('');
  const [detailData, setDetailData] = useState<Record<string, unknown>>({});
  const [detailEntityType, setDetailEntityType] = useState('domain-info');
  const initialLoadDone = useRef(false);

  const unwrapResponse = (data: unknown): unknown => {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const d = data as Record<string, unknown>;
      if (d.data && typeof d.data === 'object' && !Array.isArray(d.data)) return d.data;
      if (d.result && typeof d.result === 'object') return d.result;
    }
    return data;
  };

  const getOutputText = (data: unknown): string | undefined => {
    if (typeof data === 'string') return data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const d = data as Record<string, unknown>;
      if (typeof d.output === 'string') return d.output;
    }
    return undefined;
  };

  // Process FSMO data from various API response formats
  function processFsmoData(unwrapped: unknown): Record<string, unknown> {
    // Handle nested wrappers: {fsmo_roles: [...]} or {roles: [...]} or {data: [...]}
    let data = unwrapped;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const obj = data as Record<string, unknown>;
      if (Array.isArray(obj.fsmo_roles)) data = obj.fsmo_roles;
      else if (Array.isArray(obj.roles)) data = obj.roles;
      else if (Array.isArray(obj.data)) data = obj.data;
      // Also check for numeric keys (from decodeLdapObject on array)
      const numericKeys = Object.keys(obj).filter(k => /^\d+$/.test(k));
      if (numericKeys.length > 0) {
        data = numericKeys.map(k => obj[k]).filter((v): v is Record<string, unknown> =>
          typeof v === 'object' && v !== null && !Array.isArray(v)
        );
      }
    }

    if (Array.isArray(data)) {
      const rolesMap: Record<string, unknown> = {};
      for (const role of data as Record<string, unknown>[]) {
        const dn = String(role.dn || '');
        const ownerVal = role.fSMORoleOwner || role.fsmORoleOwner || role.owner || '';
        const owner = typeof ownerVal === 'string' ? ownerVal : formatObjectShort(ownerVal);
        const roleName = getFsmoRoleName(dn);
        if (roleName) rolesMap[roleName] = owner;
      }
      return rolesMap;
    }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      // Could be a direct role map like {schema_master: "...", ...}
      return data as Record<string, unknown>;
    }
    return {};
  }

  const loadAllData = useCallback(async (ip?: string) => {
    setLoading(true);
    const targetIp = ip || ipAddress;

    const results = await Promise.allSettled([
      targetIp ? api.get('/domain/info', { params: { ip_address: targetIp } }) : Promise.reject(new Error('No IP')),
      api.get('/domain/level'),
      api.get('/domain/passwordsettings'),
      api.get('/fsmo/'),
      api.get('/domain/trust/list'),
    ]);

    // Domain Info - pick the main domain object, not flatten the array
    if (results[0].status === 'fulfilled') {
      const raw = results[0].value.data;
      const outputText = getOutputText(raw) || getOutputText(raw?.data) || getOutputText(raw?.result);
      if (outputText) {
        // Parse LDIF blocks separated by blank lines
        const blocks = outputText.split(/\n\s*\n/).filter(b => b.trim());
        if (blocks.length > 1) {
          // Multiple LDIF blocks - parse each separately
          const items: Record<string, string>[] = [];
          for (const block of blocks) {
            const parsed: Record<string, string> = {};
            for (const line of block.split('\n')) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              const doubleColonMatch = trimmed.match(/^([^:]+?)\s*::\s*(.+)$/);
              if (doubleColonMatch) {
                const key = doubleColonMatch[1].trim();
                const base64Value = doubleColonMatch[2].trim();
                if (key) parsed[key] = tryDecodeLdapValue(base64Value);
                continue;
              }
              const colonIdx = trimmed.indexOf(':');
              if (colonIdx > 0) {
                const key = trimmed.slice(0, colonIdx).trim();
                const value = trimmed.slice(colonIdx + 1).trim();
                if (key) parsed[key] = value;
              }
            }
            if (Object.keys(parsed).length > 0) items.push(parsed);
          }
          const processed = items.length > 0 ? processDomainInfoArray(items as Record<string, unknown>[]) : {};
          setDomainInfo(deepSanitizeDomainInfo(processed));
        } else {
          // Single block
          const parsed: Record<string, string> = {};
          for (const line of outputText.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const doubleColonMatch = trimmed.match(/^([^:]+?)\s*::\s*(.+)$/);
            if (doubleColonMatch) {
              const key = doubleColonMatch[1].trim();
              const base64Value = doubleColonMatch[2].trim();
              if (key) parsed[key] = tryDecodeLdapValue(base64Value);
              continue;
            }
            const colonIdx = trimmed.indexOf(':');
            if (colonIdx > 0) {
              const key = trimmed.slice(0, colonIdx).trim();
              const value = trimmed.slice(colonIdx + 1).trim();
              if (key) parsed[key] = value;
            }
          }
          if (Object.keys(parsed).length > 0) {
            setDomainInfo(deepSanitizeDomainInfo(processDomainInfoArray([parsed])));
          } else {
            const data = objectToArrayIfNeeded(unwrapResponse(raw));
            // Check for API response format: { status: "ok", domain: [...] }
            const domainArr = extractDomainArray(data);
            if (domainArr) {
              const items = domainArr
                .filter((item: unknown): item is Record<string, unknown> =>
                  typeof item === 'object' && item !== null && !Array.isArray(item)
                )
                .map(item => decodeLdapObject(item));
              setDomainInfo(deepSanitizeDomainInfo(items.length > 0 ? processDomainInfoArray(items) : {}));
            } else if (Array.isArray(data)) {
              const items = data.filter((item: unknown): item is Record<string, unknown> =>
                typeof item === 'object' && item !== null && !Array.isArray(item)
              );
              setDomainInfo(deepSanitizeDomainInfo(items.length > 0 ? processDomainInfoArray(items) : {}));
            } else {
              setDomainInfo(deepSanitizeDomainInfo(unwrapResponse(raw) as Record<string, unknown>));
            }
          }
        }
      } else {
        const rawUnwrapped = objectToArrayIfNeeded(unwrapResponse(raw));

        // Check for API response format: { status: "ok", domain: [...] }
        const domainArr = extractDomainArray(rawUnwrapped);
        if (domainArr) {
          const items = domainArr
            .filter((item: unknown): item is Record<string, unknown> =>
              typeof item === 'object' && item !== null && !Array.isArray(item)
            )
            .map(item => decodeLdapObject(item));
          setDomainInfo(deepSanitizeDomainInfo(items.length > 0 ? processDomainInfoArray(items) : {}));
        } else if (Array.isArray(rawUnwrapped)) {
          // Array of LDAP objects - decode each and pick the main domain object
          const items = rawUnwrapped
            .filter((item: unknown): item is Record<string, unknown> =>
              typeof item === 'object' && item !== null && !Array.isArray(item)
            )
            .map(item => decodeLdapObject(item));
          setDomainInfo(deepSanitizeDomainInfo(items.length > 0 ? processDomainInfoArray(items) : {}));
        } else if (rawUnwrapped && typeof rawUnwrapped === 'object') {
          const decoded = decodeLdapObject(rawUnwrapped as Record<string, unknown>);
          // Check if decoded has numeric keys (array converted to object)
          const reArrayed = objectToArrayIfNeeded(decoded);
          if (Array.isArray(reArrayed)) {
            const items = reArrayed
              .filter((item: unknown): item is Record<string, unknown> =>
                typeof item === 'object' && item !== null && !Array.isArray(item)
              );
            setDomainInfo(deepSanitizeDomainInfo(items.length > 0 ? processDomainInfoArray(items) : {}));
          } else {
            // Also try extracting domain array from the decoded object
            const domainArr2 = extractDomainArray(decoded);
            if (domainArr2) {
              const items = domainArr2
                .filter((item: unknown): item is Record<string, unknown> =>
                  typeof item === 'object' && item !== null && !Array.isArray(item)
                );
              setDomainInfo(deepSanitizeDomainInfo(items.length > 0 ? processDomainInfoArray(items) : {}));
            } else {
              setDomainInfo(deepSanitizeDomainInfo(decoded as Record<string, unknown>));
            }
          }
        } else {
          setDomainInfo(rawUnwrapped as Record<string, unknown>);
        }
      }
    }

    // Domain Level - already a flat object, just decode
    if (results[1].status === 'fulfilled') {
      const data = unwrapResponse(results[1].value.data);
      const decoded = (data && typeof data === 'object') ? decodeLdapObject(data as Record<string, unknown>) : data;
      if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
        // Format msDS-Behavior-Version values
        const levelData = { ...(decoded as Record<string, unknown>) };
        for (const key of Object.keys(levelData)) {
          if (key.toLowerCase().includes('behavior-version') || key.toLowerCase().includes('behaviour')) {
            const rawVal = levelData[key];
            levelData[key] = `${behaviorVersionToString(rawVal)} (${rawVal})`;
          }
        }
        setDomainLevel(levelData);
      } else {
        setDomainLevel(decoded as Record<string, unknown>);
      }
    }

    // Password Policy - filter LDAP metadata and format values
    if (results[2].status === 'fulfilled') {
      const data = unwrapResponse(results[2].value.data);
      const decoded = (data && typeof data === 'object') ? decodeLdapObject(data as Record<string, unknown>) : data;
      if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
        const processed = processPasswordData(decoded as Record<string, unknown>);
        setPasswordPolicy(processed);
      } else {
        setPasswordPolicy(decoded as Record<string, unknown>);
      }
    }

    // FSMO Roles - map array to role names properly
    if (results[3].status === 'fulfilled') {
      const raw = results[3].value.data;
      const outputText = getOutputText(raw) || getOutputText(raw?.data) || getOutputText(raw?.result);
      if (outputText) {
        const parsed = parseFsmoOutput(outputText);
        if (Object.keys(parsed).length > 0) {
          setFsmoRoles(parsed);
        } else {
          // Try parsing as LDIF blocks
          const blocks = outputText.split(/\n\s*\n/).filter(b => b.trim());
          if (blocks.length > 0) {
            const rolesArray: Record<string, string>[] = [];
            for (const block of blocks) {
              const obj: Record<string, string> = {};
              for (const line of block.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                const colonIdx = trimmed.indexOf(':');
                if (colonIdx > 0) {
                  const key = trimmed.slice(0, colonIdx).trim();
                  const value = trimmed.slice(colonIdx + 1).trim();
                  if (key) obj[key] = value;
                }
              }
              if (Object.keys(obj).length > 0) rolesArray.push(obj);
            }
            if (rolesArray.length > 0) {
              setFsmoRoles(processFsmoData(rolesArray));
            } else {
              setFsmoRoles(processFsmoData(unwrapResponse(raw)));
            }
          } else {
            setFsmoRoles(processFsmoData(unwrapResponse(raw)));
          }
        }
      } else {
        const unwrapped = unwrapResponse(raw);
        setFsmoRoles(processFsmoData(unwrapped));
      }
    }

    // Trusts - format properly
    if (results[4].status === 'fulfilled') {
      const raw = results[4].value.data;
      const outputText = getOutputText(raw);
      if (outputText) {
        const trimmed = outputText.trim();
        if (trimmed) {
          setTrustList({ output: trimmed });
        } else {
          setTrustList({ trusts: t('domain.noTrusts') || '(нет доверий)' });
        }
      } else {
        const data = unwrapResponse(raw);
        // Handle nested trust arrays: {trusts: [...]} or {data: [...]}
        let trustArray: unknown[] | null = null;
        if (Array.isArray(data)) {
          trustArray = data;
        } else if (data && typeof data === 'object' && !Array.isArray(data)) {
          const obj = data as Record<string, unknown>;
          if (Array.isArray(obj.trusts)) trustArray = obj.trusts;
          else if (Array.isArray(obj.trustList)) trustArray = obj.trustList;
          else if (Array.isArray(obj.data)) trustArray = obj.data;
          // Check for numeric keys (from decodeLdapObject on array)
          const numericKeys = Object.keys(obj).filter(k => /^\d+$/.test(k));
          if (numericKeys.length > 0 && !trustArray) {
            trustArray = numericKeys.map(k => obj[k]).filter((v): v is Record<string, unknown> =>
              typeof v === 'object' && v !== null && !Array.isArray(v)
            );
          }
        }

        if (trustArray && trustArray.length > 0) {
          const decoded = trustArray.map((item: unknown) =>
            (item && typeof item === 'object') ? decodeLdapObject(item as Record<string, unknown>) : item
          );
          const items = decoded.filter((item): item is Record<string, unknown> =>
            typeof item === 'object' && item !== null && !Array.isArray(item)
          );
          setTrustList(items.length > 0 ? processTrustArray(items) : { trusts: t('domain.noTrusts') || '(нет доверий)' });
        } else if (trustArray && trustArray.length === 0) {
          setTrustList({ trusts: t('domain.noTrusts') || '(нет доверий)' });
        } else if (data && typeof data === 'object' && !Array.isArray(data)) {
          // Single trust object or non-array response
          const decoded = decodeLdapObject(data as Record<string, unknown>);
          // Check if decoded is just metadata with no real trust data
          const keys = Object.keys(decoded as Record<string, unknown>);
          const meaningfulKeys = keys.filter(k => !['status', 'message', 'dn', 'distinguishedName'].includes(k));
          if (meaningfulKeys.length === 0) {
            setTrustList({ trusts: t('domain.noTrusts') || '(нет доверий)' });
          } else {
            setTrustList(decoded as Record<string, unknown>);
          }
        } else {
          setTrustList(data ? { trusts: String(data) } : { trusts: t('domain.noTrusts') || '(нет доверий)' });
        }
      }
    }

    setLoading(false);
  }, [ipAddress, t]);

  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    const init = async () => {
      let detectedIp = '';

      try {
        const dnsRes = await api.get('/dns/serverinfo');
        const dnsData = dnsRes.data;
        const dnsOutput = getOutputText(dnsData) || getOutputText(dnsData?.data) || getOutputText(dnsData?.result);
        if (dnsOutput) {
          const addrMatch = dnsOutput.match(/aipServerAddrs\s*:\s*\[?'?([^'"\]]+)'?\]?/);
          if (addrMatch) {
            detectedIp = addrMatch[1].trim().replace(/^['"]|['"]$/g, '');
          }
        } else if (dnsData?.ipFromServer) {
          detectedIp = dnsData.ipFromServer;
        } else if (dnsData?.data?.ipFromServer) {
          detectedIp = dnsData.data.ipFromServer;
        }
      } catch { /* silently fail */ }

      if (!detectedIp) {
        try {
          const healthRes = await api.get('/health');
          const healthData = healthRes.data;
          detectedIp = healthData?.ip_address || healthData?.server_ip || healthData?.data?.ip_address || '';
        } catch { /* silently fail */ }
      }

      // Default to 127.0.0.1
      if (!detectedIp) {
        detectedIp = '127.0.0.1';
      }

      setIpAddress(detectedIp);
      loadAllData(detectedIp);
    };
    init();
  }, [loadAllData]);

  // Open detail dialog with full attributes
  const openDetail = (title: string, entityType: string, data: Record<string, unknown>) => {
    setDetailTitle(title);
    setDetailEntityType(entityType);
    setDetailData(data);
    setDetailDialogOpen(true);
  };

  // Render a localized attribute key with weight badge
  const renderAttrKey = (key: string) => {
    const localName = getAttrLocalName(key);
    const weight = getAttrWeight(key);
    const isLocalized = localName !== key;
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        <Badge variant="outline" className={`text-[8px] px-1 py-0 flex-shrink-0 font-mono ${
          weight >= 3 ? 'bg-red-500/15 text-red-400 border-red-500/30' :
          weight >= 2 ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' :
          weight >= 1 ? 'bg-blue-500/15 text-blue-400 border-blue-500/30' :
          'bg-muted text-muted-foreground border-border/50'
        }`}>
          {weight >= 3 ? 'Крит.' : weight >= 2 ? 'Важн.' : weight >= 1 ? 'Обычн.' : 'Редк.'}
        </Badge>
        <span className="font-mono text-xs truncate" title={isLocalized ? `${key} → ${localName}` : key}>
          {isLocalized ? localName : key}
        </span>
      </div>
    );
  };

  const renderKeyValueCard = (
    title: string,
    icon: React.ElementType,
    data: Record<string, unknown> | null,
    color: string,
    entityType: string
  ) => {
    const Icon = icon;
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <div className={`p-1.5 rounded-lg bg-muted ${color}`}>
              <Icon className="w-4 h-4" />
            </div>
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-4 text-center">
              <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : !data ? (
            <p className="text-sm text-muted-foreground py-2">{t('common.noData')}</p>
          ) : (
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-1">
                {Object.entries(data).map(([key, value]) => {
                  if (key === 'status' || key === 'message' || key === 'output') return null;
                  return (
                    <div key={key} className="flex flex-col sm:flex-row sm:items-start gap-x-3 gap-y-0.5 py-1 border-b border-border/50">
                      <div className="flex-shrink-0 sm:min-w-[140px] sm:max-w-[200px] text-xs text-muted-foreground">
                        {renderAttrKey(key)}
                      </div>
                      <span className="text-sm font-medium break-words flex-1 min-w-0 overflow-hidden">
                        {safeRenderValue(value)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <Button variant="ghost" size="sm" className="w-full mt-2 text-xs" onClick={() => openDetail(title, entityType, data)}>
                {t('domain.showAllAttributes')}
              </Button>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    );
  };

  // Render FSMO roles with nice card layout
  const renderFsmoCard = () => {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-muted text-purple-500">
              <Shield className="w-4 h-4" />
            </div>
            {t('domain.fsmoRoles')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-4 text-center">
              <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : !fsmoRoles ? (
            <p className="text-sm text-muted-foreground py-2">{t('common.noData')}</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(fsmoRoles).map(([key, value]) => {
                if (key === 'status' || key === 'message' || key === 'output') return null;
                const config = FSMO_ROLE_CONFIG[key];
                const RoleIcon = config?.icon || Shield;
                const roleColor = config?.color || 'text-purple-500';
                const roleLabel = config?.labelRu || config?.label || key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();

                // Handle value that could be an object
                const ownerDn = typeof value === 'object' && value !== null
                  ? formatObjectShort(value)
                  : String(value || '\u2014');
                const shortName = ownerDn !== '\u2014' ? extractServerName(ownerDn) : '\u2014';

                // Weight badge for FSMO role
                const weight = getAttrWeight(key);

                return (
                  <div key={key} className="flex items-start gap-2 p-2 rounded-lg border border-border/50 hover:bg-accent/50 transition-colors">
                    <div className={`p-1.5 rounded-md bg-muted ${roleColor} flex-shrink-0 mt-0.5`}>
                      <RoleIcon className="w-4 h-4" />
                    </div>
                    <Badge variant="outline" className={`text-[8px] px-1 py-0 flex-shrink-0 font-mono mt-0.5 ${
                      weight >= 3 ? 'bg-red-500/15 text-red-400 border-red-500/30' :
                      weight >= 2 ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' :
                      weight >= 1 ? 'bg-blue-500/15 text-blue-400 border-blue-500/30' :
                      'bg-muted text-muted-foreground border-border/50'
                    }`}>
                      {weight >= 3 ? 'Крит.' : weight >= 2 ? 'Важн.' : weight >= 1 ? 'Обычн.' : 'Редк.'}
                    </Badge>
                    <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <span className="text-xs font-medium">{roleLabel}</span>
                      <div className="text-[10px] text-muted-foreground font-mono break-all leading-tight" title={ownerDn}>
                        {ownerDn}
                      </div>
                    </div>
                  </div>
                );
              })}
              <Button variant="ghost" size="sm" className="w-full mt-2 text-xs" onClick={() => openDetail(t('domain.fsmoRoles'), 'domain-fsmo', fsmoRoles)}>
                {t('domain.showAllAttributes')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderTrustCard = () => {
    const output = trustList?.output as string | undefined;

    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-muted text-cyan-500">
              <Network className="w-4 h-4" />
            </div>
            {t('domain.trusts')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-4 text-center">
              <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : !trustList ? (
            <p className="text-sm text-muted-foreground py-2">{t('common.noData')}</p>
          ) : output ? (
            <ScrollArea className="max-h-64">
              {output.trim() ? (
                <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground">{output}</pre>
              ) : (
                <p className="text-sm text-muted-foreground py-2">{t('domain.noTrusts') || 'No trust relationships configured'}</p>
              )}
            </ScrollArea>
          ) : (
            <ScrollArea className="max-h-64">
              <div className="space-y-2">
                {Object.entries(trustList).map(([key, value]) => {
                  if (key === 'status' || key === 'message') return null;
                  // Check if value is a multi-line trust info string
                  const strVal = String(value);
                  const isMultiLine = strVal.includes('\n');
                  return (
                    <div key={key} className="text-sm py-1 border-b border-border/50">
                      <div className="font-medium text-xs mb-1 flex items-center gap-1.5 min-w-0">
                        <Network className="w-3 h-3 text-cyan-500 flex-shrink-0" />
                        <span className="truncate">{key}</span>
                      </div>
                      {isMultiLine ? (
                        <div className="pl-5 space-y-0.5">
                          {strVal.split('\n').map((line, idx) => (
                            <div key={idx} className="text-xs text-muted-foreground break-words">{line}</div>
                          ))}
                        </div>
                      ) : (
                        <div className="pl-5 text-xs text-muted-foreground break-words overflow-hidden">{safeRenderValue(value)}</div>
                      )}
                    </div>
                  );
                })}
              </div>
              <Button variant="ghost" size="sm" className="w-full mt-2 text-xs" onClick={() => openDetail(t('domain.trusts'), 'domain-trusts', trustList)}>
                {t('domain.showAllAttributes')}
              </Button>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <RequirePermission permission="domain.info">
      <div className="space-y-4">
        {/* IP Address Input */}
        <div className="flex items-center gap-1 md:gap-2 flex-wrap">
          <div className="flex items-center gap-1 md:gap-2">
            <Label className="text-xs whitespace-nowrap">{t('domain.ipAddress')}:</Label>
            <Input
              value={ipAddress}
              onChange={(e) => setIpAddress(e.target.value)}
              placeholder="127.0.0.1"
              className="h-8 text-sm w-48"
            />
          </div>
          <ColumnCustomizer
            entityType="domain"
            columns={sectionConfig}
            onColumnsChange={setSectionConfig}
          />
          <Button variant="outline" size="sm" className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm" onClick={() => loadAllData()} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 md:w-4 md:h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{t('common.refresh')}</span>
          </Button>
        </div>

        {/* Domain Info Cards — single column on mobile, two columns on lg+
            with more space for content. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Domain Info */}
          {isSectionVisible('domain-info') && renderKeyValueCard(t('domain.domainInfo'), Globe, domainInfo, 'text-emerald-500', 'domain-info')}

          {/* Functional Level */}
          {isSectionVisible('domain-level') && renderKeyValueCard(t('domain.functionalLevel'), Server, domainLevel, 'text-blue-500', 'domain-level')}

          {/* Password Policy */}
          {isSectionVisible('domain-password') && renderKeyValueCard(t('domain.passwordPolicy'), Lock, passwordPolicy, 'text-orange-500', 'domain-password')}

          {/* FSMO Roles */}
          {isSectionVisible('domain-fsmo') && renderFsmoCard()}

          {/* Trusts */}
          {isSectionVisible('domain-trusts') && renderTrustCard()}
        </div>

        {/* Detail Dialog with AttributeViewer for full attribute customization */}
        <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
          <DialogContent className="max-w-[95vw] md:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{detailTitle}</DialogTitle>
              <DialogDescription className="sr-only">{detailTitle}</DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[65vh]">
              <AttributeViewer
                entityType={detailEntityType}
                data={detailData}
                keyInfoKeys={detailEntityType === 'domain-fsmo'
                  ? Object.keys(FSMO_ROLE_CONFIG).filter(k => k.includes('Role') || k.includes('Role_'))
                  : detailEntityType === 'domain-password'
                    ? ['min_password_length', 'minimum_password_length', 'password_complexity', 'complexity', 'max_password_age', 'maximum_password_age']
                    : detailEntityType === 'domain-info'
                      ? ['domain', 'dn', 'objectSid', 'msDS-Behavior-Version', 'dnsPartitions', 'dn_DomainDnsZones', 'dn_ForestDnsZones']
                      : detailEntityType === 'domain-level'
                        ? ['domain_function_level', 'forest_function_level', 'lowest_dc_function_level', 'msDS-Behavior-Version']
                        : []
                }
                showCustomize={true}
              />
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </div>
    </RequirePermission>
  );
}
