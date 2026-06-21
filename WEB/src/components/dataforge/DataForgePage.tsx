'use client';

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import api from '@/lib/api';
import {
  Database, Table2, Filter, Download, ChevronDown,
  RefreshCw, Loader2, BarChart3, X,
  FileSpreadsheet, FileText, FileJson, FileDown, FileImage, Plus, Trash2,
  Search, ArrowUpDown, Edit3, Save,
  Columns3, Sparkles, Network, PieChart as PieChartIcon, TrendingUp,
  Sheet, PlusCircle, Copy, Users, Monitor, FolderTree, Shield, Globe2, Mail, LayoutGrid,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line,
} from 'recharts';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import { Document, Packer, Paragraph, Table as DocxTable, TableRow as DocxTableRow, TableCell as DocxTableCell, TextRun, WidthType, HeadingLevel, ImageRun, PageOrientation } from 'docx';
import { saveAs } from 'file-saver';
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent, DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, horizontalListSortingStrategy, verticalListSortingStrategy, useSortable, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useIsMobile } from '@/hooks/use-mobile';
import { useOrientation } from '@/hooks/use-orientation';

// Cached Unicode font for jsPDF (loaded once per session, supports Cyrillic)
let _pdfFontCache: { regular: string; bold: string } | null = null;
async function loadPdfFont(): Promise<{ regular: string; bold: string }> {
  if (_pdfFontCache) return _pdfFontCache;
  try {
    const [r, b] = await Promise.all([
      fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/fonts/DejaVuSans.ttf`).then(r => r.blob()),
      fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/fonts/DejaVuSans-Bold.ttf`).then(r => r.blob()),
    ]);
    const regular = await blobToBase64(r);
    const bold = await blobToBase64(b);
    _pdfFontCache = { regular, bold };
    return _pdfFontCache;
  } catch {
    return { regular: '', bold: '' };
  }
}
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix to get raw base64
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ═══════════════════════════════════════════════════════════════
// Robust chart capture: serialize SVG → Image → Canvas (bypasses
// html2canvas which has known issues with recharts foreignObject).
// Falls back to html2canvas if no SVG is found.
// ═══════════════════════════════════════════════════════════════
async function captureChartToCanvas(node: HTMLDivElement, scale = 2): Promise<HTMLCanvasElement> {
  const svg = node.querySelector('svg') as SVGSVGElement | null;
  if (!svg) {
    return await html2canvas(node, { scale, backgroundColor: '#ffffff', useCORS: true, logging: false });
  }

  // Get real rendered size (fallback to clientWidth/Height)
  const rect = svg.getBoundingClientRect();
  const width = Math.max(rect.width || 0, svg.clientWidth || 0, 320);
  const height = Math.max(rect.height || 0, svg.clientHeight || 0, 240);

  // Clone SVG, set xmlns + explicit width/height
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('viewBox', `0 0 ${width} ${height}`);

  // Inline computed styles for every element so the image renders correctly
  // even when extracted from the document (CSS rules don't travel with the SVG).
  const allElements: Element[] = [clone, ...Array.from(clone.querySelectorAll('*'))];
  for (const el of allElements) {
    const computed = window.getComputedStyle(el);
    // Pick only the properties that matter for SVG rendering to keep size reasonable
    const props = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
      'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'font', 'font-family',
      'font-size', 'font-weight', 'text-anchor', 'opacity', 'visibility', 'display',
      'color', 'text-decoration', 'letter-spacing', 'transform'];
    let styleStr = '';
    for (const p of props) {
      const val = computed.getPropertyValue(p);
      if (val) styleStr += `${p}:${val};`;
    }
    if (styleStr) el.setAttribute('style', styleStr);
  }

  // Serialize → Blob → ObjectURL → Image → Canvas
  const svgString = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob(['<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG image load failed'));
      img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ═══════════════════════════════════════════════════════════════
// Manual canvas drawing of a table (fallback for PNG export when
// html2canvas throws — e.g. on tables with sticky cells, foreignObject,
// or other CSS features html2canvas can't handle).
// Draws header row + data rows directly using CanvasRenderingContext2D.
// ═══════════════════════════════════════════════════════════════
function drawTableToCanvas(
  cols: string[],
  rows: Record<string, unknown>[],
  lang: string,
  attrNameFn: (a: string, l: string) => string,
  fmtCellFn: (v: unknown, l: string) => string,
  scale = 1.5,
): HTMLCanvasElement {
  // Layout constants
  const rowH = 22;
  const headerH = 28;
  const minColW = 90;
  const maxColW = 260;
  const padding = 8;
  const fontSize = 11;
  const headerFontSize = 11;

  // Compute column widths based on content (cap at maxColW)
  const colWidths = cols.map((c, i) => {
    const header = attrNameFn(c, lang);
    let maxW = header.length * 7 + padding * 2;
    for (const r of rows.slice(0, 200)) {
      const cellText = fmtCellFn(r[c], lang);
      const w = cellText.length * 6.5 + padding * 2;
      if (w > maxW) maxW = w;
    }
    return Math.min(Math.max(maxW, minColW), maxColW);
  });
  const totalW = colWidths.reduce((s, w) => s + w, 0);
  const totalH = headerH + Math.min(rows.length, 500) * rowH + 10;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(totalW * scale);
  canvas.height = Math.round(totalH * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, totalW, totalH);

  // Header background
  ctx.fillStyle = '#10b981';
  ctx.fillRect(0, 0, totalW, headerH);

  // Header text
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${headerFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let x = 0;
  cols.forEach((c, i) => {
    const header = attrNameFn(c, lang);
    // Clip text to column width
    let text = header;
    while (text.length > 1 && ctx.measureText(text).width > colWidths[i] - padding * 2) {
      text = text.slice(0, -1);
    }
    if (text !== header && text.length > 1) text = text.slice(0, -1) + '…';
    ctx.fillText(text, x + padding, headerH / 2);
    x += colWidths[i];
  });

  // Body rows
  ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  const visibleRows = rows.slice(0, 500);
  visibleRows.forEach((row, ri) => {
    const y = headerH + ri * rowH;
    // Zebra stripes
    if (ri % 2 === 1) {
      ctx.fillStyle = '#f5faf8';
      ctx.fillRect(0, y, totalW, rowH);
    }
    // Cell text
    ctx.fillStyle = '#1f2937';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    let cx = 0;
    cols.forEach((c, ci) => {
      const val = fmtCellFn(row[c], lang);
      let text = val;
      while (text.length > 1 && ctx.measureText(text).width > colWidths[ci] - padding * 2) {
        text = text.slice(0, -1);
      }
      if (text !== val && text.length > 1) text = text.slice(0, -1) + '…';
      ctx.fillText(text, cx + padding, y + rowH / 2);
      cx += colWidths[ci];
    });
  });

  // Vertical lines between columns (subtle)
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 0.5;
  x = 0;
  cols.forEach((_, i) => {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, totalH);
    ctx.stroke();
    x += colWidths[i];
  });
  // Bottom border
  ctx.beginPath();
  ctx.moveTo(0, totalH - 0.5);
  ctx.lineTo(totalW, totalH - 0.5);
  ctx.stroke();

  // Footer note if truncated
  if (rows.length > 500) {
    ctx.fillStyle = '#6b7280';
    ctx.font = `${fontSize - 1}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`... +${rows.length - 500} ${lang === 'ru' ? 'ещё записей' : 'more rows'}`, totalW / 2, totalH - 4);
  }

  return canvas;
}

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface SchemaEntity {
  table_name: string;
  key_attr: string;
  name_attr: string;
  desc: string;
  count: number;
  attributes: string[];
}

interface SchemaRelation {
  from: string;
  to: string;
  fk_attr: string;
  type: string;
  desc: string;
}

interface SchemaAssociation {
  name: string;
  from: string;
  to: string;
  assoc_attr: string;
  reverse_attr: string;
  desc: string;
}

interface ChartConfig {
  id: string;
  type: 'bar' | 'pie' | 'line';
  labelField: string;
  valueField: string;
  title: string;
}

interface SheetData {
  id: string;
  name: string;
  entity: string;
  rows: Record<string, unknown>[];
  allRows: Record<string, unknown>[];
  columns: string[];          // schema + data attrs in original order
  colOrder: string[];          // user-customizable column order (drag-and-drop reorders this)
  visibleCols: Set<string>;
  colFilters: Record<string, Set<string>>;
  sortCol: string;
  sortDir: 'asc' | 'desc';
  searchText: string;
}

// ═══════════════════════════════════════════════════════════════
// Russian attribute names
// ═══════════════════════════════════════════════════════════════

const ATTR_RU: Record<string, string> = {
  sAMAccountName: 'Имя входа', cn: 'Общее имя', displayName: 'Отображаемое имя',
  givenName: 'Имя', sn: 'Фамилия', initials: 'Инициалы', description: 'Описание',
  mail: 'Эл. почта', userPrincipalName: 'UPN', memberOf: 'Член групп',
  whenCreated: 'Создан', whenChanged: 'Изменён', lastLogonTimestamp: 'Последний вход',
  lastLogon: 'Последний вход (raw)', logonCount: 'Кол-во входов',
  badPwdCount: 'Неверных попыток', pwdLastSet: 'Пароль изменён',
  accountExpires: 'Срок действия', userAccountControl: 'Флаги УЗ',
  adminCount: 'Флаг админа', primaryGroupID: 'Осн. группа ID',
  objectGUID: 'GUID', objectSid: 'SID', objectCategory: 'Категория',
  objectClass: 'Класс', name: 'Имя (LDAP)', codePage: 'Кодовая страница',
  countryCode: 'Код страны', uidNumber: 'UID', gidNumber: 'GID',
  member: 'Участники', groupType: 'Тип группы', systemFlags: 'Сист. флаги',
  dNSHostName: 'DNS-имя', operatingSystem: 'ОС', operatingSystemVersion: 'Версия ОС',
  ou: 'Название OU', gPLink: 'Привязка GPO',
  flags: 'Флаги', gPCFileSysPath: 'Путь файлов GPO', versionNumber: 'Версия',
  dc: 'DC', dnsRecord: 'DNS-запись',
  badPasswordTime: 'Время неверного пароля', instanceType: 'Тип экземпляра',
  isCriticalSystemObject: 'Критический', showInAdvancedViewOnly: 'Только расш. вид',
  uSNChanged: 'USN изменён', uSNCreated: 'USN создан',
  servicePrincipalName: 'SPN', localPolicyFlags: 'Флаги лок. политики',
  msDS_SupportedEncryptionTypes: 'Типы шифрования',
  gPCFunctionalityVersion: 'Версия функц.', gPCMachineExtensionNames: 'Расш. компьютера',
  gPCUserExtensionNames: 'Расш. пользователя',
  rIDSetReferences: 'Ссылка RID', serverReferenceBL: 'Ссылка на сервер',
  dn: 'DN', distinguishedName: 'Различаемое имя',
};

const ENTITY_RU: Record<string, string> = {
  user: 'Пользователи', group: 'Группы', computer: 'Компьютеры',
  ou: 'Подразделения', gpo: 'Групповые политики', contact: 'Контакты', dnsNode: 'DNS-записи',
};
const ENTITY_EN: Record<string, string> = {
  user: 'Users', group: 'Groups', computer: 'Computers',
  ou: 'Organizational Units', gpo: 'Group Policies', contact: 'Contacts', dnsNode: 'DNS Records',
};
const ENTITY_ICONS: Record<string, React.ReactNode> = {
  user: <Users className="w-3.5 h-3.5" />,
  group: <Shield className="w-3.5 h-3.5" />,
  computer: <Monitor className="w-3.5 h-3.5" />,
  ou: <FolderTree className="w-3.5 h-3.5" />,
  gpo: <LayoutGrid className="w-3.5 h-3.5" />,
  contact: <Mail className="w-3.5 h-3.5" />,
  dnsNode: <Globe2 className="w-3.5 h-3.5" />,
};

const BUILT_IN_SCHEMA_ENTITIES: Record<string, SchemaEntity> = {
  user: { table_name: 'USERS', key_attr: 'sAMAccountName', name_attr: 'cn', desc: 'Пользователи AD', count: 15, attributes: ['sAMAccountName','cn','displayName','givenName','sn','description','mail','userPrincipalName','memberOf','whenCreated','whenChanged','lastLogonTimestamp','pwdLastSet','accountExpires','userAccountControl','adminCount','primaryGroupID','objectGUID','objectSid','name','codePage','countryCode','uidNumber','gidNumber','badPwdCount','logonCount','badPasswordTime','instanceType','isCriticalSystemObject','showInAdvancedViewOnly','uSNChanged','uSNCreated','servicePrincipalName','objectCategory','objectClass','initials','dn'] },
  group: { table_name: 'GROUPS', key_attr: 'sAMAccountName', name_attr: 'cn', desc: 'Группы AD', count: 38, attributes: ['sAMAccountName','cn','description','groupType','member','memberOf','name','objectGUID','objectSid','adminCount','systemFlags','instanceType','isCriticalSystemObject','objectCategory','objectClass','showInAdvancedViewOnly','uSNChanged','uSNCreated','whenChanged','whenCreated','dn'] },
  computer: { table_name: 'COMPUTERS', key_attr: 'sAMAccountName', name_attr: 'cn', desc: 'Компьютеры AD', count: 1, attributes: ['sAMAccountName','cn','dNSHostName','operatingSystem','operatingSystemVersion','description','memberOf','whenCreated','whenChanged','lastLogonTimestamp','userAccountControl','objectGUID','objectSid','name','codePage','countryCode','badPasswordTime','badPwdCount','instanceType','isCriticalSystemObject','logonCount','localPolicyFlags','msDS-SupportedEncryptionTypes','primaryGroupID','pwdLastSet','rIDSetReferences','serverReferenceBL','servicePrincipalName','uSNChanged','uSNCreated','accountExpires','objectCategory','objectClass','showInAdvancedViewOnly','dn'] },
  ou: { table_name: 'OUS', key_attr: 'ou', name_attr: 'ou', desc: 'Подразделения', count: 1, attributes: ['ou','description','gPLink','name','objectGUID','instanceType','isCriticalSystemObject','objectCategory','objectClass','showInAdvancedViewOnly','systemFlags','uSNChanged','uSNCreated','whenChanged','whenCreated','dn'] },
  gpo: { table_name: 'GPOS', key_attr: 'cn', name_attr: 'displayName', desc: 'Групповые политики', count: 2, attributes: ['cn','displayName','flags','gPCFileSysPath','gPCFunctionalityVersion','gPCMachineExtensionNames','gPCUserExtensionNames','name','objectGUID','instanceType','isCriticalSystemObject','objectCategory','objectClass','showInAdvancedViewOnly','systemFlags','uSNChanged','uSNCreated','versionNumber','whenChanged','whenCreated','dn'] },
  contact: { table_name: 'CONTACTS', key_attr: 'cn', name_attr: 'cn', desc: 'Контакты', count: 0, attributes: ['cn','displayName','mail','name','objectGUID','objectCategory','objectClass','whenChanged','whenCreated','dn'] },
  dnsNode: { table_name: 'DNS_RECORDS', key_attr: 'dc', name_attr: 'dc', desc: 'DNS записи', count: 14, attributes: ['dc','dnsRecord','name','objectGUID','instanceType','objectCategory','objectClass','showInAdvancedViewOnly','uSNChanged','uSNCreated','whenChanged','whenCreated','dn'] },
};

const BUILT_IN_RELATIONS: SchemaRelation[] = [
  { from: 'USERS', to: 'OUS', fk_attr: 'dn', type: '1:M', desc: 'Пользователь → OU' },
  { from: 'COMPUTERS', to: 'OUS', fk_attr: 'dn', type: '1:M', desc: 'Компьютер → OU' },
  { from: 'GROUPS', to: 'OUS', fk_attr: 'dn', type: '1:M', desc: 'Группа → OU' },
  { from: 'GPOS', to: 'OUS', fk_attr: 'gPLink', type: '1:M', desc: 'GPO → OU' },
];
const BUILT_IN_ASSOCIATIONS: SchemaAssociation[] = [
  { name: 'USER_GROUP', from: 'USERS', to: 'GROUPS', assoc_attr: 'member', reverse_attr: 'memberOf', desc: 'Пользователь ↔ Группа' },
  { name: 'COMPUTER_GROUP', from: 'COMPUTERS', to: 'GROUPS', assoc_attr: 'member', reverse_attr: 'memberOf', desc: 'Компьютер ↔ Группа' },
  { name: 'GROUP_GROUP', from: 'GROUPS', to: 'GROUPS', assoc_attr: 'member', reverse_attr: 'memberOf', desc: 'Вложенные группы' },
];

// Map internal entity keys (singular) to URL path segments (plural) used by
// the new SDB API endpoints /sdb/full/{entity} and /sdb/info/{entity}.
const ENTITY_URL_PATH: Record<string, string> = {
  user: 'users',
  group: 'groups',
  computer: 'computers',
  ou: 'ous',
  gpo: 'gpos',
  contact: 'contacts',
  dnsNode: 'dns',
};
function entityToUrlPath(entity: string): string {
  return ENTITY_URL_PATH[entity] || entity;
}

// "Важные" поля по умолчанию для каждой сущности — то, что показывается
// при загрузке и при нажатии "Сброс". Остальные можно включить вручную
// галочками в сайдбаре.
const KEY_FIELDS: Record<string, string[]> = {
  user:    ['sAMAccountName', 'cn', 'displayName', 'mail', 'userPrincipalName', 'description', 'whenCreated', 'lastLogonTimestamp', 'userAccountControl', 'memberOf', 'dn'],
  group:   ['sAMAccountName', 'cn', 'description', 'groupType', 'member', 'whenCreated', 'dn'],
  computer:['sAMAccountName', 'cn', 'dNSHostName', 'operatingSystem', 'operatingSystemVersion', 'whenCreated', 'lastLogonTimestamp', 'userAccountControl', 'dn'],
  ou:      ['ou', 'description', 'gPLink', 'whenCreated', 'dn'],
  gpo:     ['cn', 'displayName', 'gPCFileSysPath', 'versionNumber', 'whenCreated', 'dn'],
  contact: ['cn', 'displayName', 'mail', 'whenCreated', 'dn'],
  dnsNode: ['dc', 'dnsRecord', 'name', 'whenChanged', 'dn'],
};
function getKeyFields(entity: string, allCols: string[]): string[] {
  const keys = KEY_FIELDS[entity] || [];
  // Preserve schema order, but only include fields that actually exist in mergedCols
  return allCols.filter(c => keys.includes(c));
}

const CHART_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#a855f7'];

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function attrName(attr: string, lang: string): string {
  return lang === 'ru' ? (ATTR_RU[attr] || attr) : attr;
}

function entityName(entity: string, lang: string): string {
  return lang === 'ru' ? (ENTITY_RU[entity] || entity) : (ENTITY_EN[entity] || entity);
}

function fmtCell(val: unknown, lang: string): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'boolean') return val ? (lang === 'ru' ? 'Да' : 'Yes') : (lang === 'ru' ? 'Нет' : 'No');
  if (Array.isArray(val)) return val.join(', ');
  if (typeof val === 'object') return JSON.stringify(val);
  const s = String(val);
  if (/^\d{18}$/.test(s)) {
    try {
      const ms = (Number(s) - 116444736000000000) / 10000;
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US');
    } catch { /* */ }
  }
  return s;
}

function getUniqueValues(rows: Record<string, unknown>[], col: string): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = r[col];
    if (v !== null && v !== undefined) {
      if (Array.isArray(v)) v.forEach(item => set.add(String(item)));
      else set.add(String(v));
    }
  }
  return [...set].sort().slice(0, 300);
}

function generateDemoData(entity: string): Record<string, unknown>[] {
  if (entity === 'user') {
    return [
      { sAMAccountName: 'admin', cn: 'Administrator', displayName: 'Administrator', givenName: '', sn: '', mail: 'admin@domain.local', userPrincipalName: 'admin@domain.local', memberOf: ['Domain Admins', 'Schema Admins'], description: 'Builtin admin', whenCreated: '20240101000000.0Z', whenChanged: '20240601000000.0Z', userAccountControl: 66048, lastLogonTimestamp: '133614720000000000', pwdLastSet: '133606080000000000', accountExpires: '9223372036854775807', adminCount: 1, primaryGroupID: 513, objectGUID: '{abc-123}', objectSid: 'S-1-5-21-...', name: 'Administrator', codePage: 0, countryCode: 643, uidNumber: '', gidNumber: '', badPwdCount: 0, logonCount: 42, badPasswordTime: '0', instanceType: 4, isCriticalSystemObject: true, showInAdvancedViewOnly: false, uSNChanged: '12345', uSNCreated: '1000', servicePrincipalName: '', objectCategory: 'CN=Person,CN=Schema,...', objectClass: ['top','person','organizationalPerson','user'], initials: '', dn: 'CN=Administrator,CN=Users,DC=domain,DC=local' },
      { sAMAccountName: 'ivanov', cn: 'Иванов Иван', displayName: 'Иванов Иван', givenName: 'Иван', sn: 'Иванов', mail: 'ivanov@domain.local', userPrincipalName: 'ivanov@domain.local', memberOf: ['Domain Users'], description: '', whenCreated: '20240315000000.0Z', whenChanged: '20240601000000.0Z', userAccountControl: 512, lastLogonTimestamp: '133606080000000000', pwdLastSet: '133500000000000000', accountExpires: '9223372036854775807', adminCount: 0, primaryGroupID: 513, objectGUID: '{def-456}', objectSid: 'S-1-5-21-...', name: 'Иванов Иван', codePage: 0, countryCode: 643, uidNumber: '1001', gidNumber: '1001', badPwdCount: 0, logonCount: 15, badPasswordTime: '0', instanceType: 4, isCriticalSystemObject: false, showInAdvancedViewOnly: false, uSNChanged: '12346', uSNCreated: '1001', servicePrincipalName: '', objectCategory: 'CN=Person,CN=Schema,...', objectClass: ['top','person','organizationalPerson','user'], initials: 'И.И.', dn: 'CN=Иванов Иван,CN=Users,DC=domain,DC=local' },
      { sAMAccountName: 'petrov', cn: 'Петров Пётр', displayName: 'Петров Пётр', givenName: 'Пётр', sn: 'Петров', mail: 'petrov@domain.local', userPrincipalName: 'petrov@domain.local', memberOf: ['Domain Users', 'Developers'], description: 'Dev team', whenCreated: '20240520000000.0Z', whenChanged: '20240601000000.0Z', userAccountControl: 512, lastLogonTimestamp: '133614720000000000', pwdLastSet: '133580000000000000', accountExpires: '9223372036854775807', adminCount: 0, primaryGroupID: 513, objectGUID: '{ghi-789}', objectSid: 'S-1-5-21-...', name: 'Петров Пётр', codePage: 0, countryCode: 643, uidNumber: '1002', gidNumber: '1001', badPwdCount: 1, logonCount: 8, badPasswordTime: '133570000000000000', instanceType: 4, isCriticalSystemObject: false, showInAdvancedViewOnly: false, uSNChanged: '12347', uSNCreated: '1002', servicePrincipalName: '', objectCategory: 'CN=Person,CN=Schema,...', objectClass: ['top','person','organizationalPerson','user'], initials: 'П.П.', dn: 'CN=Петров Пётр,CN=Users,DC=domain,DC=local' },
    ];
  }
  if (entity === 'group') {
    return [
      { sAMAccountName: 'Domain Admins', cn: 'Domain Admins', description: 'Администраторы домена', groupType: '-2147483646', member: ['admin', 'kozlov'], memberOf: [], name: 'Domain Admins', objectGUID: '{grp-001}', objectSid: 'S-1-5-21-...-512', adminCount: 1, systemFlags: '-1946157056', instanceType: 4, isCriticalSystemObject: true, objectCategory: 'CN=Group,...', objectClass: ['top','group'], showInAdvancedViewOnly: false, uSNChanged: '20001', uSNCreated: '2000', whenChanged: '20240601000000.0Z', whenCreated: '20240101000000.0Z', dn: 'CN=Domain Admins,CN=Users,DC=domain,DC=local' },
      { sAMAccountName: 'Domain Users', cn: 'Domain Users', description: 'Все пользователи', groupType: '-2147483646', member: ['admin', 'ivanov', 'petrov'], memberOf: [], name: 'Domain Users', objectGUID: '{grp-002}', objectSid: 'S-1-5-21-...-513', adminCount: 1, systemFlags: '-1946157056', instanceType: 4, isCriticalSystemObject: true, objectCategory: 'CN=Group,...', objectClass: ['top','group'], showInAdvancedViewOnly: false, uSNChanged: '20002', uSNCreated: '2001', whenChanged: '20240601000000.0Z', whenCreated: '20240101000000.0Z', dn: 'CN=Domain Users,CN=Users,DC=domain,DC=local' },
      { sAMAccountName: 'Developers', cn: 'Developers', description: 'Разработчики', groupType: '-2147483644', member: ['petrov'], memberOf: [], name: 'Developers', objectGUID: '{grp-003}', objectSid: 'S-1-5-21-...-1104', adminCount: 0, systemFlags: '0', instanceType: 4, isCriticalSystemObject: false, objectCategory: 'CN=Group,...', objectClass: ['top','group'], showInAdvancedViewOnly: false, uSNChanged: '20003', uSNCreated: '2002', whenChanged: '20240315000000.0Z', whenCreated: '20240315000000.0Z', dn: 'CN=Developers,CN=Users,DC=domain,DC=local' },
    ];
  }
  return [{ name: 'demo', value: 'test', dn: 'CN=demo,DC=domain,DC=local' }];
}

// ═══════════════════════════════════════════════════════════════
// Column Filter Dialog (instead of popover to avoid overflow)
// ═══════════════════════════════════════════════════════════════

interface ColFilterDialogProps {
  column: string;
  lang: string;
  selectedValues: Set<string>;
  allValues: string[];
  onApply: (col: string, values: Set<string>) => void;
  onClear: (col: string) => void;
  onSortAsc: (col: string) => void;
  onSortDesc: (col: string) => void;
  open: boolean;
  onClose: () => void;
}

function ColumnFilterDialog({ column, lang, selectedValues, allValues, onApply, onClear, onSortAsc, onSortDesc, open, onClose }: ColFilterDialogProps) {
  const [temp, setTemp] = useState<Set<string>>(new Set(selectedValues));
  const [search, setSearch] = useState('');

  useEffect(() => { setTemp(new Set(selectedValues)); setSearch(''); }, [selectedValues, open]);

  const filtered = allValues.filter(v => !search || v.toLowerCase().includes(search.toLowerCase()));
  const allSelected = temp.size === 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[95vw] md:max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Filter className="w-4 h-4 text-amber-400" />
            {attrName(column, lang)}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs flex-1" onClick={() => { onSortAsc(column); onClose(); }}>
              <ArrowUpDown className="w-3 h-3 mr-1" />A→Z
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs flex-1" onClick={() => { onSortDesc(column); onClose(); }}>
              <ArrowUpDown className="w-3 h-3 mr-1 rotate-180" />Z→A
            </Button>
          </div>
          <Separator />
          <Input placeholder={lang === 'ru' ? 'Поиск значений...' : 'Search values...'} value={search} onChange={e => setSearch(e.target.value)} className="h-8 text-sm" />
          <ScrollArea className="h-64">
            <div className="space-y-0.5">
              <label className="flex items-center gap-2 text-xs px-1 py-1 hover:bg-accent/50 rounded cursor-pointer">
                <input type="checkbox" checked={allSelected} onChange={() => { setTemp(new Set()); }} className="w-3.5 h-3.5" />
                <span className="text-muted-foreground font-medium">{lang === 'ru' ? '(Все)' : '(All)'}</span>
              </label>
              {filtered.slice(0, 200).map(v => {
                const checked = allSelected || temp.has(v);
                return (
                  <label key={v} className="flex items-center gap-2 text-xs px-1 py-0.5 hover:bg-accent/50 rounded cursor-pointer">
                    <input type="checkbox" checked={checked} onChange={() => {
                      const next = new Set(temp);
                      if (allSelected) {
                        // Currently all selected (temp is empty = all). Clicking one item should DESELECT it:
                        // add all OTHER values to temp, leave this one out.
                        allValues.forEach(other => { if (other !== v) next.add(other); });
                      } else {
                        if (checked) next.delete(v); else next.add(v);
                      }
                      setTemp(next);
                    }} className="w-3.5 h-3.5" />
                    <span className="truncate max-w-[220px]">{v || (lang === 'ru' ? '(пусто)' : '(empty)')}</span>
                  </label>
                );
              })}
              {filtered.length > 200 && <p className="text-[10px] text-muted-foreground px-1">+{filtered.length - 200} {lang === 'ru' ? 'ещё' : 'more'}</p>}
            </div>
          </ScrollArea>
          <Separator />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs flex-1" onClick={() => { onClear(column); onClose(); }}>
              {lang === 'ru' ? 'Сбросить' : 'Clear'}
            </Button>
            <Button size="sm" className="h-7 text-xs flex-1" onClick={() => { onApply(column, temp); onClose(); }}>
              {lang === 'ru' ? 'Применить' : 'Apply'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════
// Edit Cell Component
// ═══════════════════════════════════════════════════════════════

interface EditCellProps {
  value: unknown;
  lang: string;
  onSave: (val: string) => void;
  onCancel: () => void;
}

function EditCell({ value, lang, onSave, onCancel }: EditCellProps) {
  const str = value === null || value === undefined ? '' : String(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const [editVal, setEditVal] = useState(str);
  return (
    <input
      ref={ref}
      value={editVal}
      onChange={e => setEditVal(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') onSave(editVal); if (e.key === 'Escape') onCancel(); }}
      onBlur={() => onSave(editVal)}
      className="h-full w-full bg-emerald-500/10 border border-emerald-500/40 px-1 text-[11px] font-mono outline-none"
    />
  );
}

// ═══════════════════════════════════════════════════════════════
// Relation Diagram Component
// ═══════════════════════════════════════════════════════════════

function RelationDiagram({ entities, relations, associations, selectedEntity, onSelectEntity, lang }: {
  entities: Record<string, SchemaEntity>;
  relations: SchemaRelation[];
  associations: SchemaAssociation[];
  selectedEntity: string;
  onSelectEntity: (e: string) => void;
  lang: string;
}) {
  const entityKeys = Object.keys(entities);
  const nodeW = 150;
  const nodeH = 55;
  const gapX = 200;
  const gapY = 90;

  const layoutMap: Record<string, { col: number; row: number }> = {
    ou: { col: 2, row: 1 },
    user: { col: 1, row: 0 },
    computer: { col: 1, row: 1 },
    group: { col: 1, row: 2 },
    gpo: { col: 3, row: 1 },
    contact: { col: 2, row: 2 },
    dnsNode: { col: 3, row: 2 },
  };

  const positions = entityKeys.map(ek => {
    const l = layoutMap[ek] || { col: 0, row: 0 };
    return { key: ek, x: 40 + l.col * gapX, y: 40 + l.row * gapY, col: l.col, row: l.row };
  });

  const getPos = (tableName: string) => {
    const ek = Object.entries(entities).find(([_, e]) => e.table_name === tableName)?.[0];
    return positions.find(p => p.key === ek);
  };

  const lines: Array<{ x1: number; y1: number; x2: number; y2: number; label: string; color: string; dashed?: boolean }> = [];
  relations.forEach(r => {
    const from = getPos(r.from);
    const to = getPos(r.to);
    if (from && to) lines.push({ x1: from.x + nodeW / 2, y1: from.y + nodeH / 2, x2: to.x + nodeW / 2, y2: to.y + nodeH / 2, label: r.type, color: '#3b82f6' });
  });
  associations.forEach(a => {
    const from = getPos(a.from);
    const to = getPos(a.to);
    if (from && to) lines.push({ x1: from.x + nodeW / 2, y1: from.y + nodeH / 2, x2: to.x + nodeW / 2, y2: to.y + nodeH / 2, label: 'M:M', color: '#10b981', dashed: true });
  });

  const svgW = 4 * gapX + 40;
  const svgH = 3 * gapY + 40;

  return (
    <div className="overflow-auto">
      <svg width={svgW} height={svgH} className="select-none" style={{ minWidth: '100%' }}>
        {lines.map((l, i) => {
          const mx = (l.x1 + l.x2) / 2;
          const my = (l.y1 + l.y2) / 2 - 8;
          return (
            <g key={i}>
              <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.color} strokeWidth={2} strokeDasharray={l.dashed ? '6,3' : undefined} opacity={0.6} />
              <rect x={mx - 16} y={my - 8} width={32} height={16} rx={4} fill="var(--background)" stroke={l.color} strokeWidth={1} opacity={0.9} />
              <text x={mx} y={my + 4} textAnchor="middle" className="text-[9px]" fill={l.color}>{l.label}</text>
              <polygon points={`${l.x2},${l.y2} ${l.x2 - 8},${l.y2 - 5} ${l.x2 - 8},${l.y2 + 5}`} fill={l.color} opacity={0.7} />
            </g>
          );
        })}
        {positions.map(p => {
          const e = entities[p.key];
          const isSelected = p.key === selectedEntity;
          return (
            <g key={p.key} className="cursor-pointer" onClick={() => onSelectEntity(p.key)}>
              <rect x={p.x} y={p.y} width={nodeW} height={nodeH} rx={8}
                fill={isSelected ? 'rgba(16,185,129,0.15)' : 'var(--card)'}
                stroke={isSelected ? '#10b981' : 'var(--border)'}
                strokeWidth={isSelected ? 2 : 1}
              />
              <text x={p.x + nodeW / 2} y={p.y + 20} textAnchor="middle" className="text-[11px] font-semibold" fill="var(--foreground)">
                {entityName(p.key, lang)}
              </text>
              <text x={p.x + nodeW / 2} y={p.y + 38} textAnchor="middle" className="text-[9px]" fill="var(--muted-foreground)">
                {e.count} {lang === 'ru' ? 'зап.' : 'rows'} · {e.attributes.length} {lang === 'ru' ? 'атр.' : 'attr'}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex items-center gap-4 mt-3 px-2">
        <div className="flex items-center gap-1.5 text-[10px]">
          <div className="w-6 h-0.5 bg-blue-500" />
          <span className="text-muted-foreground">{lang === 'ru' ? 'Принадлежность (1:M)' : 'Belongs to (1:M)'}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px]">
          <div className="w-6 h-0.5" style={{ borderTop: '2px dashed #10b981' }} />
          <span className="text-muted-foreground">{lang === 'ru' ? 'Связь M:M' : 'Many-to-Many'}</span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Sortable Column Item (drag-and-drop reordering for sidebar list)
// ═══════════════════════════════════════════════════════════════

interface SortableColumnItemProps {
  col: string;
  isVisible: boolean;
  label: string;
  lang: string;
  onToggle: () => void;
}

function SortableColumnItem({ col, isVisible, label, lang, onToggle }: SortableColumnItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`flex items-center gap-1 text-[10px] cursor-grab hover:bg-accent/30 rounded px-0.5 py-px select-none ${isDragging ? 'ring-1 ring-emerald-400/50 bg-emerald-500/5' : ''}`}
      title={lang === 'ru' ? 'Перетащите, чтобы изменить порядок столбцов' : 'Drag to reorder columns'}
    >
      <span className="text-muted-foreground/60 flex-shrink-0">⠿</span>
      <input
        type="checkbox"
        checked={isVisible}
        onClick={e => e.stopPropagation()}
        onChange={onToggle}
        className="w-2.5 h-2.5 flex-shrink-0"
      />
      <span className={`truncate ${isVisible ? '' : 'text-muted-foreground/60 line-through'}`}>{label}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Sortable Table Header (drag-and-drop reordering for table columns)
// ═══════════════════════════════════════════════════════════════

interface SortableTableHeaderProps {
  col: string;
  children: React.ReactNode;
}

const SortableTableHeader = React.forwardRef<HTMLTableCellElement, SortableTableHeaderProps & React.HTMLAttributes<HTMLTableCellElement>>(
  function SortableTableHeaderImpl({ col, children, className, ...rest }, _ref) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col });
    const style: React.CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
      cursor: isDragging ? 'grabbing' : 'grab',
      touchAction: 'none',
    };
    return (
      <TableHead
        ref={setNodeRef}
        style={style}
        className={className}
        {...attributes}
        {...listeners}
        {...rest}
      >
        {children}
      </TableHead>
    );
  }
);

// ═══════════════════════════════════════════════════════════════
// Sortable Sheet Tab (drag-and-drop reordering via @dnd-kit)
// ═══════════════════════════════════════════════════════════════

interface SortableSheetTabProps {
  sheet: SheetData;
  isActive: boolean;
  isMulti: boolean;
  lang: string;
  onSelect: () => void;
  onClose: () => void;
}

function SortableSheetTab({ sheet, isActive, isMulti, lang, onSelect, onClose }: SortableSheetTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sheet.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
    touchAction: 'none',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded select-none transition-colors ${isActive ? 'bg-emerald-600 text-white font-medium' : 'bg-muted/50 text-muted-foreground hover:bg-accent/30'} ${isDragging ? 'shadow-lg ring-2 ring-emerald-400/50 z-10' : ''}`}
      title={lang === 'ru' ? 'Перетащите, чтобы изменить порядок листов' : 'Drag to reorder sheets'}
    >
      <Sheet className="w-2.5 h-2.5 flex-shrink-0" />
      <span className="max-w-[100px] truncate">{sheet.name}</span>
      {isMulti && (
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="ml-0.5 p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 transition-colors"
          title={lang === 'ru' ? 'Закрыть лист' : 'Close sheet'}
        >
          <X className="w-2 h-2" />
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Sortable Entity Tab (drag-and-drop reordering for top entity buttons)
// ═══════════════════════════════════════════════════════════════

interface SortableEntityTabProps {
  entityKey: string;
  isActive: boolean;
  icon: React.ReactNode;
  label: string;
  count: number;
  onClick: () => void;
}

function SortableEntityTab({ entityKey, isActive, icon, label, count, onClick }: SortableEntityTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entityKey });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
    touchAction: 'none',
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className={`flex items-center gap-1.5 h-7 text-[11px] px-2.5 rounded select-none transition-colors ${
        isActive
          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
          : 'hover:bg-accent/30'
      } ${isDragging ? 'ring-2 ring-emerald-400/50 shadow-lg z-10' : ''}`}
      title={label}
    >
      {icon}
      <span className="truncate max-w-[100px]">{label}</span>
      <span className="text-[9px] opacity-70">({count})</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════

export default function DataForgePage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'ru' ? 'ru' : 'en';

  // useIsMobile checks the SHORT side of the screen, so it returns true
  // even when a phone is rotated to landscape.
  const isMobile = useIsMobile();
  const { effectiveLandscape } = useOrientation();
  const isLandscapeMobile = isMobile && effectiveLandscape;

  const [entities] = useState<Record<string, SchemaEntity>>(BUILT_IN_SCHEMA_ENTITIES);
  const [relations] = useState<SchemaRelation[]>(BUILT_IN_RELATIONS);
  const [associations] = useState<SchemaAssociation[]>(BUILT_IN_ASSOCIATIONS);

  // ── Entity tab order (reorderable via drag-and-drop, persisted in localStorage) ──
  const [entityOrder, setEntityOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('dataforge-entity-order');
      const parsed = saved ? JSON.parse(saved) : null;
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Filter to only valid entity keys, then append any missing ones (forward compat)
        const valid = parsed.filter((k: string) => BUILT_IN_SCHEMA_ENTITIES[k]);
        const missing = Object.keys(BUILT_IN_SCHEMA_ENTITIES).filter(k => !valid.includes(k));
        return [...valid, ...missing];
      }
    } catch { /* */ }
    return Object.keys(BUILT_IN_SCHEMA_ENTITIES);
  });

  // ── Sheets ──
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // ── Charts ──
  const [charts, setCharts] = useState<ChartConfig[]>([]);
  const [chartDialogOpen, setChartDialogOpen] = useState(false);
  const [newChart, setNewChart] = useState<ChartConfig>({ id: '', type: 'bar', labelField: '', valueField: 'count', title: '' });

  // ── Export ──
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState('xlsx');
  const [exportOrientation, setExportOrientation] = useState<'portrait' | 'landscape'>('landscape');
  const [exportAllSheets, setExportAllSheets] = useState(false);
  const [exportIncludeCharts, setExportIncludeCharts] = useState(false);
  const [exporting, setExporting] = useState(false);

  // ── Edit ──
  const [editCell, setEditCell] = useState<{ rowIdx: number; col: string } | null>(null);

  // ── Chart refs (for export to PDF/DOCX as images) ──
  const chartRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // ── Tab ──
  const [activeTab, setActiveTab] = useState('data');

  // ── Column filter dialog ──
  const [filterDialogCol, setFilterDialogCol] = useState<string | null>(null);

  // ── Drag-and-drop reorder state ──
  const [draggedSheetId, setDraggedSheetId] = useState<string | null>(null);
  const [draggedEntityId, setDraggedEntityId] = useState<string | null>(null);

  // ── Sidebar tab: which panel is shown (Столбцы / Связи) ──
  const [sidebarTab, setSidebarTab] = useState<'columns' | 'relations'>('columns');

  // ── Table container ref (for PNG export) ──
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // DnD sensors — distance constraint so a click still selects the tab,
  // only a real drag (>= 5 px) triggers reorder.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setDraggedSheetId(String(e.active.id));
  }, []);

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    setDraggedSheetId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setSheets(prev => {
      const fromIdx = prev.findIndex(s => s.id === active.id);
      const toIdx = prev.findIndex(s => s.id === over.id);
      if (fromIdx === -1 || toIdx === -1) return prev;
      return arrayMove(prev, fromIdx, toIdx);
    });
  }, []);

  // ── Entity tab drag-and-drop reorder ──
  const handleEntityDragStart = useCallback((e: DragStartEvent) => {
    setDraggedEntityId(String(e.active.id));
  }, []);

  const handleEntityDragEnd = useCallback((e: DragEndEvent) => {
    setDraggedEntityId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setEntityOrder(prev => {
      const fromIdx = prev.indexOf(String(active.id));
      const toIdx = prev.indexOf(String(over.id));
      if (fromIdx === -1 || toIdx === -1) return prev;
      return arrayMove(prev, fromIdx, toIdx);
    });
  }, []);

  // Persist entity order to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('dataforge-entity-order', JSON.stringify(entityOrder));
    } catch { /* */ }
  }, [entityOrder]);

  // ── Saved views ──
  const [savedViews, setSavedViews] = useState<Array<{ id: string; name: string; entity: string; visibleCols: string[]; filters: Record<string, string[]> }>>([]);

  useEffect(() => {
    try {
      const s = localStorage.getItem('dataforge-views');
      if (s) setSavedViews(JSON.parse(s));
    } catch { /* */ }
  }, []);

  const currentSheet = useMemo(() => sheets.find(s => s.id === activeSheetId), [sheets, activeSheetId]);

  // ── Load data (MERGE schema attributes + data columns) ──
  const loadData = useCallback(async (entity: string, sheetId?: string) => {
    if (!entity) return;
    setLoading(true);
    setEditCell(null);
    try {
      let loadedRows: Record<string, unknown>[] = [];
      const urlPath = entityToUrlPath(entity);

      // 1st try: new canonical endpoint /sdb/full/{entity}?fields=*&limit=2000
      try {
        const res = await api.get(`/sdb/full/${encodeURIComponent(urlPath)}`, {
          params: { fields: '*', limit: 2000 },
        });
        const data = res.data;
        if (Array.isArray(data)) loadedRows = data;
        else if (data?.data && Array.isArray(data.data)) loadedRows = data.data;
        else if (data?.rows && Array.isArray(data.rows)) loadedRows = data.rows;
      } catch {
        // 2nd try: legacy SQL-like /sdb/select POST endpoint
        try {
          const tableName = entities[entity]?.table_name || entity.toUpperCase();
          const res = await api.post('/sdb/select', { scope: tableName, format: 'json', limit: 2000 });
          const data = res.data;
          if (Array.isArray(data)) loadedRows = data;
          else if (data?.data && Array.isArray(data.data)) loadedRows = data.data;
          else if (data?.rows && Array.isArray(data.rows)) loadedRows = data.rows;
          else if (data?.output) {
            try { const p = JSON.parse(data.output); loadedRows = Array.isArray(p) ? p : [p]; } catch { /* */ }
          }
        } catch {
          // 3rd try: SDB script engine
          try {
            const tableName = entities[entity]?.table_name || entity.toUpperCase();
            const res = await api.post('/sdb/script', { script: `USE sam;\nFROM ${tableName};\nSHOW AS json LIMIT 2000;` });
            const data = res.data;
            if (data?.output) {
              try { const p = JSON.parse(data.output); loadedRows = Array.isArray(p) ? p : [p]; } catch { /* */ }
            }
          } catch {
            // 4th fallback: demo data
            loadedRows = generateDemoData(entity);
          }
        }
      }

      // MERGE: schema attributes first, then any extra from data
      const schemaAttrs = entities[entity]?.attributes || [];
      const dataKeysLoaded = loadedRows.length > 0 ? Object.keys(loadedRows[0]) : [];
      const mergedCols = [...new Set([...schemaAttrs, ...dataKeysLoaded])];

      // Default visible = KEY_FIELDS for this entity (the "important" subset).
      // Falls back to first 8 columns if no key fields match.
      const keyFields = getKeyFields(entity, mergedCols);
      const defaultVisible = keyFields.length > 0 ? keyFields : mergedCols.slice(0, 8);

      if (sheetId) {
        setSheets(prev => prev.map(s => s.id === sheetId ? {
          ...s, rows: loadedRows, allRows: loadedRows, columns: mergedCols, colOrder: mergedCols,
          visibleCols: new Set(defaultVisible), colFilters: {}, sortCol: '', sortDir: 'asc' as const, searchText: '',
        } : s));
      } else {
        const newSheet: SheetData = {
          id: `sheet-${Date.now()}`, name: entityName(entity, lang), entity,
          rows: loadedRows, allRows: loadedRows, columns: mergedCols, colOrder: mergedCols,
          visibleCols: new Set(defaultVisible), colFilters: {}, sortCol: '', sortDir: 'asc', searchText: '',
        };
        setSheets(prev => [...prev, newSheet]);
        setActiveSheetId(newSheet.id);
      }
    } catch {
      toast.error(t('dataforge.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [entities, lang, t]);

  // On mount: try to restore from localStorage so F5 refresh keeps everything.
  // Only auto-load 'user' if nothing was restored.
  useEffect(() => {
    let restored = false;
    try {
      const saved = localStorage.getItem('dataforge-state');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.sheets && Array.isArray(parsed.sheets) && parsed.sheets.length > 0) {
          const restoredSheets: SheetData[] = parsed.sheets.map((s: any) => ({
            id: s.id,
            name: s.name,
            entity: s.entity,
            rows: s.rows || [],
            allRows: s.allRows || [],
            columns: s.columns || [],
            colOrder: s.colOrder || s.columns || [],
            visibleCols: new Set(Array.isArray(s.visibleCols) ? s.visibleCols : []),
            colFilters: Object.fromEntries(
              Object.entries(s.colFilters || {}).map(([k, v]: [string, any]) => [k, new Set(Array.isArray(v) ? v : [])])
            ),
            sortCol: s.sortCol || '',
            sortDir: s.sortDir || 'asc',
            searchText: s.searchText || '',
          }));
          setSheets(restoredSheets);
          const restoredActive = parsed.activeSheetId && restoredSheets.some(s => s.id === parsed.activeSheetId)
            ? parsed.activeSheetId
            : restoredSheets[0].id;
          setActiveSheetId(restoredActive);
          restored = true;
        }
        if (Array.isArray(parsed.charts)) setCharts(parsed.charts);
        if (parsed.sidebarTab === 'columns' || parsed.sidebarTab === 'relations') setSidebarTab(parsed.sidebarTab);
        if (typeof parsed.exportFormat === 'string') setExportFormat(parsed.exportFormat);
        if (parsed.exportOrientation === 'portrait' || parsed.exportOrientation === 'landscape') setExportOrientation(parsed.exportOrientation);
        if (typeof parsed.exportAllSheets === 'boolean') setExportAllSheets(parsed.exportAllSheets);
        if (typeof parsed.exportIncludeCharts === 'boolean') setExportIncludeCharts(parsed.exportIncludeCharts);
      }
    } catch (e) {
      console.warn('[dataforge] localStorage restore failed', e);
      try { localStorage.removeItem('dataforge-state'); } catch { /* */ }
    }
    if (!restored && sheets.length === 0) {
      loadData('user');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Listen for "open entity in DataForge" requests from AI Chat (SDB mode) ──
  // The AI Chat dispatches a `dataforge-load-entity` CustomEvent when the user
  // clicks "Open in DataForge" on an SDB-mode AI response. The detail.entity
  // is the singular entity key (e.g. 'user', 'group', 'computer').
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ entity: string }>).detail;
      if (!detail || !detail.entity) return;
      if (!BUILT_IN_SCHEMA_ENTITIES[detail.entity]) return;
      // Reuse existing sheet if one exists for this entity, else create new
      const existing = sheets.find(s => s.entity === detail.entity);
      if (existing) {
        setActiveSheetId(existing.id);
        // Force reload data
        loadData(detail.entity, existing.id);
      } else {
        loadData(detail.entity);
      }
      setActiveTab('data');
    };
    window.addEventListener('dataforge-load-entity', handler as EventListener);
    return () => window.removeEventListener('dataforge-load-entity', handler as EventListener);
  }, [sheets, loadData]);

  // ── Listen for "create sheet from SDB query results" from AI Chat ──
  // AI Chat (SDB mode) executes the SDB query itself and dispatches this event
  // with the actual rows. We create a new sheet directly with the provided rows
  // (no API round-trip needed — data already loaded).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{
        entity: string;
        sheetName: string;
        rows: Record<string, unknown>[];
        description?: string;
      }>).detail;
      if (!detail || !detail.entity || !Array.isArray(detail.rows)) return;
      if (!BUILT_IN_SCHEMA_ENTITIES[detail.entity]) return;

      const entity = detail.entity;
      const loadedRows = detail.rows;
      const sheetName = detail.sheetName || `${entity} (${loadedRows.length})`;

      // MERGE: schema attributes first, then any extra from data (same as loadData)
      const schemaAttrs = BUILT_IN_SCHEMA_ENTITIES[entity]?.attributes || [];
      const dataKeysLoaded = loadedRows.length > 0 ? Object.keys(loadedRows[0]) : [];
      const mergedCols = [...new Set([...schemaAttrs, ...dataKeysLoaded])];

      // Default visible = KEY_FIELDS for this entity
      const keyFields = getKeyFields(entity, mergedCols);
      const defaultVisible = keyFields.length > 0 ? keyFields : mergedCols.slice(0, 8);

      // Reuse existing sheet with same name, else create new
      const existingByName = sheets.find(s => s.name === sheetName);
      if (existingByName) {
        setSheets(prev => prev.map(s => s.id === existingByName.id ? {
          ...s,
          rows: loadedRows,
          allRows: loadedRows,
          columns: mergedCols,
          colOrder: mergedCols,
          visibleCols: new Set(defaultVisible),
          colFilters: {},
          sortCol: '',
          sortDir: 'asc' as const,
          searchText: '',
        } : s));
        setActiveSheetId(existingByName.id);
      } else {
        const newSheet: SheetData = {
          id: `sheet-${Date.now()}`,
          name: sheetName,
          entity,
          rows: loadedRows,
          allRows: loadedRows,
          columns: mergedCols,
          colOrder: mergedCols,
          visibleCols: new Set(defaultVisible),
          colFilters: {},
          sortCol: '',
          sortDir: 'asc',
          searchText: '',
        };
        setSheets(prev => [...prev, newSheet]);
        setActiveSheetId(newSheet.id);
      }
      setActiveTab('data');
      toast.success(`Создан лист «${sheetName}» с ${loadedRows.length} записями`);
    };
    window.addEventListener('dataforge-create-sheet-from-query', handler as EventListener);
    return () => window.removeEventListener('dataforge-create-sheet-from-query', handler as EventListener);
  }, [sheets]);

  const updateSheet = useCallback((sheetId: string, updates: Partial<SheetData>) => {
    setSheets(prev => prev.map(s => s.id === sheetId ? { ...s, ...updates } : s));
  }, []);

  // ── Column drag-and-drop reorder (used by sidebar column list AND table headers) ──
  const reorderColumns = useCallback((sheetId: string, newOrder: string[]) => {
    setSheets(prev => prev.map(s => s.id === sheetId ? { ...s, colOrder: newOrder } : s));
  }, []);

  const handleColumnDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id || !currentSheet) return;
    const order = currentSheet.colOrder?.length ? currentSheet.colOrder : currentSheet.columns;
    const fromIdx = order.indexOf(String(active.id));
    const toIdx = order.indexOf(String(over.id));
    if (fromIdx === -1 || toIdx === -1) return;
    const newOrder = arrayMove(order, fromIdx, toIdx);
    reorderColumns(currentSheet.id, newOrder);
  }, [currentSheet, reorderColumns]);

  // ── Clear all sheets + charts (the "Очистить" button) ──
  const clearAll = useCallback(() => {
    if (!confirm(lang === 'ru' ? 'Очистить все листы и диаграммы? Действие необратимо.' : 'Clear all sheets and charts? This cannot be undone.')) return;
    setSheets([]);
    setActiveSheetId('');
    setCharts([]);
    try { localStorage.removeItem('dataforge-state'); } catch { /* */ }
    toast.success(lang === 'ru' ? 'Данные очищены' : 'Cleared');
  }, [lang]);

  // ── Persist to localStorage so F5 refresh restores everything ──
  // Debounced 500ms; saves sheet metadata + charts + UI prefs.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const payload = {
          version: 2,
          activeSheetId,
          sidebarTab,
          exportFormat,
          exportOrientation,
          exportAllSheets,
          exportIncludeCharts,
          charts,
          sheets: sheets.map(s => ({
            id: s.id,
            name: s.name,
            entity: s.entity,
            // Include rows so reload shows real data without re-fetching
            rows: s.rows,
            allRows: s.allRows,
            columns: s.columns,
            colOrder: s.colOrder,
            visibleCols: [...s.visibleCols],
            colFilters: Object.fromEntries(
              Object.entries(s.colFilters).map(([k, v]) => [k, [...v]])
            ),
            sortCol: s.sortCol,
            sortDir: s.sortDir,
            searchText: s.searchText,
          })),
        };
        localStorage.setItem('dataforge-state', JSON.stringify(payload));
      } catch (e) {
        // Likely quota exceeded — drop the persisted state so it doesn't block
        console.warn('[dataforge] localStorage save failed', e);
        try { localStorage.removeItem('dataforge-state'); } catch { /* */ }
      }
    }, 500);
    return () => clearTimeout(t);
  }, [sheets, charts, activeSheetId, sidebarTab, exportFormat, exportOrientation, exportAllSheets, exportIncludeCharts]);

  const filteredRows = useMemo(() => {
    if (!currentSheet) return [];
    let result = [...currentSheet.allRows];
    for (const [col, vals] of Object.entries(currentSheet.colFilters)) {
      if (vals.size > 0) result = result.filter(r => vals.has(String(r[col] ?? '')));
    }
    if (currentSheet.searchText) {
      const lower = currentSheet.searchText.toLowerCase();
      result = result.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(lower)));
    }
    if (currentSheet.sortCol) {
      result.sort((a, b) => {
        const va = String(a[currentSheet.sortCol] ?? '');
        const vb = String(b[currentSheet.sortCol] ?? '');
        return currentSheet.sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      });
    }
    return result;
  }, [currentSheet]);

  const displayCols = useMemo(() => {
    if (!currentSheet) return [];
    // Respect user's custom column order (drag-and-drop reorders this).
    // Falls back to original schema order if colOrder is missing for any reason.
    const order = currentSheet.colOrder?.length ? currentSheet.colOrder : currentSheet.columns;
    return order.filter(c => currentSheet.visibleCols.has(c));
  }, [currentSheet]);

  // All columns (schema + data) in the user's custom order (or schema order fallback).
  // Sidebar lists every column; empty cells just show as blank — user wants to see the FULL schema.
  const dataCols = useMemo(() => {
    if (!currentSheet) return [];
    return currentSheet.colOrder?.length ? currentSheet.colOrder : currentSheet.columns;
  }, [currentSheet]);

  const applyColFilter = useCallback((col: string, vals: Set<string>) => {
    if (!currentSheet) return;
    updateSheet(currentSheet.id, { colFilters: { ...currentSheet.colFilters, [col]: vals } });
  }, [currentSheet, updateSheet]);

  const clearColFilter = useCallback((col: string) => {
    if (!currentSheet) return;
    const next = { ...currentSheet.colFilters };
    delete next[col];
    updateSheet(currentSheet.id, { colFilters: next });
  }, [currentSheet, updateSheet]);

  const handleSort = useCallback((col: string, dir: 'asc' | 'desc') => {
    if (!currentSheet) return;
    updateSheet(currentSheet.id, { sortCol: col, sortDir: dir });
  }, [currentSheet, updateSheet]);

  const saveEdit = useCallback((rowIdx: number, col: string, value: string) => {
    if (!currentSheet) return;
    const origRow = filteredRows[rowIdx];
    setSheets(prev => prev.map(s => {
      if (s.id !== currentSheet.id) return s;
      const origIdx = s.allRows.indexOf(origRow);
      if (origIdx < 0) return s;
      const nextAllRows = [...s.allRows];
      nextAllRows[origIdx] = { ...nextAllRows[origIdx], [col]: value };
      return { ...s, allRows: nextAllRows };
    }));
    setEditCell(null);
  }, [currentSheet, filteredRows]);

  const addSheet = useCallback((entity: string) => { loadData(entity); }, [loadData]);

  const removeSheet = useCallback((sheetId: string) => {
    setSheets(prev => {
      const next = prev.filter(s => s.id !== sheetId);
      if (activeSheetId === sheetId && next.length > 0) setActiveSheetId(next[0].id);
      return next;
    });
  }, [activeSheetId]);

  const duplicateSheet = useCallback((sheetId: string) => {
    setSheets(prev => {
      const src = prev.find(s => s.id === sheetId);
      if (!src) {
        return prev;
      }
      const dup: SheetData = {
        id: `sheet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: src.name + (lang === 'ru' ? ' (копия)' : ' (copy)'),
        entity: src.entity,
        // Deep-copy rows so editing the duplicate doesn't affect the source
        rows: src.rows.map(r => ({ ...r })),
        allRows: src.allRows.map(r => ({ ...r })),
        columns: [...src.columns],
        colOrder: [...(src.colOrder || src.columns)],
        visibleCols: new Set(src.visibleCols),
        colFilters: Object.fromEntries(Object.entries(src.colFilters).map(([k, v]) => [k, new Set(v)])),
        sortCol: src.sortCol,
        sortDir: src.sortDir,
        searchText: src.searchText,
      };
      // Insert the new sheet right after the source
      const idx = prev.findIndex(s => s.id === sheetId);
      const next = [...prev];
      next.splice(idx + 1, 0, dup);
      // Switch to the duplicate synchronously (React 18 batches these safely)
      setActiveSheetId(dup.id);
      return next;
    });
    toast.success(lang === 'ru' ? 'Лист скопирован' : 'Sheet duplicated');
  }, [lang]);

  // ── Chart data builder (FIX: proper fallback + grouping, no filter of 0 values) ──
  const buildChartData = useCallback((cfg: ChartConfig) => {
    if (!currentSheet || filteredRows.length === 0) return [];
    const rows = filteredRows;
    const dataKeys = rows[0] ? Object.keys(rows[0]) : [];

    // Find a valid label field — fall back to first data key if cfg.labelField is not in data
    let labelKey = cfg.labelField;
    if (!labelKey || !dataKeys.includes(labelKey)) {
      labelKey = dataKeys[0] || currentSheet.columns[0] || 'name';
    }

    // Count grouping (default) — also used as fallback when valueField isn't numeric / not in data
    if (cfg.valueField === 'count' || !dataKeys.includes(cfg.valueField)) {
      const groups = new Map<string, number>();
      for (const r of rows) {
        const rawVal = r[labelKey];
        let key: string;
        if (Array.isArray(rawVal)) key = rawVal.length > 0 ? rawVal.join(', ') : (lang === 'ru' ? '(пусто)' : '(empty)');
        else if (rawVal === null || rawVal === undefined || rawVal === '') key = lang === 'ru' ? '(пусто)' : '(empty)';
        else key = String(rawVal).slice(0, 60);
        groups.set(key, (groups.get(key) || 0) + 1);
      }
      return [...groups.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 25);
    }

    // Numeric value field — DON'T filter out 0 values (user wants to see real values)
    return rows.slice(0, 50).map(r => {
      const rawLabel = r[labelKey];
      const labelStr = Array.isArray(rawLabel) ? rawLabel.join(', ') : String(rawLabel ?? '');
      return {
        name: (labelStr || (lang === 'ru' ? '(пусто)' : '(empty)')).slice(0, 40),
        value: Number(r[cfg.valueField]) || 0,
      };
    });
  }, [currentSheet, filteredRows, lang]);

  // ── Export ──
  const handleExport = useCallback(async () => {
    if (sheets.length === 0) { toast.error(t('dataforge.noDataToExport')); return; }
    setExporting(true);
    // For PDF/DOCX with charts — switch to charts tab first so chart DOM is rendered.
    // PNG handles its own tab-switching logic below (since it may need BOTH data + charts).
    const needChartsForVector = exportIncludeCharts && charts.length > 0 && (exportFormat === 'pdf' || exportFormat === 'docx');
    const prevTab = activeTab;
    let switchedTab = false;
    if (needChartsForVector) {
      if (activeTab !== 'charts') {
        setActiveTab('charts');
        switchedTab = true;
      }
      // Wait for charts tab to render AND chartRefs to be populated.
      // Poll up to ~3 seconds for all chart refs to appear (recharts may take
      // a few frames to mount ResponsiveContainer + SVG).
      const expectedIds = charts.map(c => c.id);
      const waited = await new Promise<number>(resolve => {
        const start = Date.now();
        const tick = () => {
          const allReady = expectedIds.every(id => chartRefs.current[id]);
          if (allReady) return resolve(Date.now() - start);
          if (Date.now() - start > 3000) return resolve(Date.now() - start);
          setTimeout(tick, 50);
        };
        tick();
      });
      // Extra paint frame so recharts SVG is laid out
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      // eslint-disable-next-line no-console
      console.debug('[export] charts ready after', waited, 'ms; refs:', expectedIds.map(id => !!chartRefs.current[id]));
    }
    try {
      const entityNameStr = currentSheet ? entityName(currentSheet.entity, lang) : 'data';
      const filename = `${entityNameStr}_export`;
      // Helper: ordered visible columns — respect user's custom colOrder (drag-and-drop).
      const orderedCols = (sh: SheetData): string[] => {
        const order = sh.colOrder?.length ? sh.colOrder : sh.columns;
        return order.filter(c => sh.visibleCols.has(c));
      };
      // Sheets to export: either all sheets or just current
      const sheetsToExport = exportAllSheets ? sheets : (currentSheet ? [currentSheet] : []);

      if (exportFormat === 'png') {
        // PNG export: capture the visible table (and optionally charts) as one stacked image.
        // NOTE: must switch to data tab to capture the table (otherwise it's unmounted),
        // then switch to charts tab to capture charts.
        const canvases: HTMLCanvasElement[] = [];

        // 1. Capture the data table
        if (currentSheet && filteredRows.length > 0) {
          if (activeTab !== 'data') {
            setActiveTab('data');
            switchedTab = true;
            // Wait for data tab to mount + render
            await new Promise(r => setTimeout(r, 150));
          }
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          const tableEl = tableContainerRef.current?.querySelector('table') as HTMLElement | null;
          let tableCaptured = false;
          if (tableEl) {
            try {
              const tableCanvas = await html2canvas(tableEl, {
                scale: 1.5,
                backgroundColor: '#ffffff',
                useCORS: true,
                logging: false,
                windowWidth: Math.max(tableEl.scrollWidth, 800),
                windowHeight: Math.max(tableEl.scrollHeight, 400),
              });
              canvases.push(tableCanvas);
              tableCaptured = true;
            } catch (e) {
              console.warn('PNG html2canvas failed, falling back to manual draw', e);
            }
          }
          // Fallback: draw the table manually using canvas drawing API
          // (works even when html2canvas throws on sticky cells, foreignObject, etc.)
          if (!tableCaptured) {
            try {
              const cols = orderedCols(currentSheet);
              const rows = filteredRows.slice(0, 500);
              const manualCanvas = drawTableToCanvas(cols, rows, lang, attrName, fmtCell, 1.5);
              canvases.push(manualCanvas);
              tableCaptured = true;
            } catch (e) {
              console.error('PNG manual draw also failed', e);
            }
          }
          if (!tableCaptured) {
            toast.error(lang === 'ru' ? 'Не удалось захватить таблицу' : 'Table capture failed');
          }
        }

        // 2. Capture charts if requested
        if (exportIncludeCharts && charts.length > 0) {
          if (activeTab !== 'charts') {
            setActiveTab('charts');
            switchedTab = true;
            // Wait for charts tab to mount
            await new Promise(r => setTimeout(r, 150));
          }
          // Poll for chart refs to be ready
          const expectedIds = charts.map(c => c.id);
          await new Promise<void>(resolve => {
            const start = Date.now();
            const tick = () => {
              if (expectedIds.every(id => chartRefs.current[id])) return resolve();
              if (Date.now() - start > 3000) return resolve();
              setTimeout(tick, 50);
            };
            tick();
          });
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          for (const chart of charts) {
            const node = chartRefs.current[chart.id];
            if (node) {
              try {
                const c = await captureChartToCanvas(node, 2);
                canvases.push(c);
              } catch (e) { console.warn('chart png export error', e); }
            }
          }
        }

        if (canvases.length === 0) {
          toast.error(lang === 'ru' ? 'Нет данных для экспорта' : 'No data to export');
          return;
        }
        // Stack canvases vertically with a small gap
        const gap = 16;
        const totalW = Math.max(...canvases.map(c => c.width));
        const totalH = canvases.reduce((s, c) => s + c.height, 0) + gap * (canvases.length - 1);
        const out = document.createElement('canvas');
        out.width = totalW;
        out.height = totalH;
        const ctx = out.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, totalW, totalH);
        let y = 0;
        for (const c of canvases) {
          ctx.drawImage(c, 0, y);
          y += c.height + gap;
        }
        out.toBlob(blob => {
          if (blob) saveAs(blob, `${filename}.png`);
        }, 'image/png');
      } else if (exportFormat === 'json') {
        const allData = sheetsToExport.map(sh => ({
          sheet: sh.name,
          entity: sh.entity,
          data: sh.allRows.map(r => {
            const o: Record<string, unknown> = {};
            orderedCols(sh).forEach(c => { o[attrName(c, lang)] = r[c]; });
            return o;
          }),
        }));
        const payload = allData.length === 1 ? allData[0].data : allData;
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        downloadBlob(blob, `${filename}.json`);
      } else if (exportFormat === 'csv') {
        // Multi-sheet CSV: concatenate with sheet name headers
        const parts: string[] = [];
        for (const sh of sheetsToExport) {
          const cols = orderedCols(sh);
          const rows = exportAllSheets ? sh.allRows : (sh.id === currentSheet?.id ? filteredRows : sh.allRows);
          if (sheetsToExport.length > 1) {
            parts.push(`# ${sh.name}`);
          }
          parts.push(cols.map(c => escapeCsv(attrName(c, lang))).join(','));
          for (const r of rows) parts.push(cols.map(c => escapeCsv(fmtCell(r[c], lang))).join(','));
          parts.push('');
        }
        const blob = new Blob(['\uFEFF' + parts.join('\n')], { type: 'text/csv;charset=utf-8' });
        downloadBlob(blob, `${filename}.csv`);
      } else if (exportFormat === 'xlsx' || exportFormat === 'xls') {
        // Multi-sheet Excel: all selected sheets in one file
        const wb = XLSX.utils.book_new();
        for (const sh of sheetsToExport) {
          const cols = orderedCols(sh);
          const rows = sh.id === currentSheet?.id && !exportAllSheets ? filteredRows : sh.allRows;
          const data = rows.map(r => {
            const o: Record<string, unknown> = {};
            cols.forEach(c => { o[attrName(c, lang)] = fmtCell(r[c], lang); });
            return o;
          });
          // If no rows, add at least the header row so the sheet isn't empty
          const wsData = data.length > 0 ? data : [Object.fromEntries(cols.map(c => [attrName(c, lang), '']))];
          const ws = XLSX.utils.json_to_sheet(wsData, { header: cols.map(c => attrName(c, lang)) });
          const sheetName = sh.name.slice(0, 31).replace(/[\\/?*[\]:]/g, '_'); // Excel sheet name limits
          XLSX.utils.book_append_sheet(wb, ws, sheetName);
        }
        XLSX.writeFile(wb, `${filename}.${exportFormat}`);
      } else if (exportFormat === 'pdf') {
        // PDF via jsPDF + autotable + embedded Unicode font (Cyrillic support)
        const font = await loadPdfFont();
        const pdf = new jsPDF({ orientation: exportOrientation, unit: 'mm', format: 'a4' });
        if (font.regular) {
          pdf.addFileToVFS('DejaVuSans.ttf', font.regular);
          pdf.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');
          if (font.bold) {
            pdf.addFileToVFS('DejaVuSans-Bold.ttf', font.bold);
            pdf.addFont('DejaVuSans-Bold.ttf', 'DejaVuSans', 'bold');
          }
          pdf.setFont('DejaVuSans');
        }
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        let firstSheet = true;
        for (const sh of sheetsToExport) {
          const cols = orderedCols(sh);
          const rows = (sh.id === currentSheet?.id && !exportAllSheets) ? filteredRows.slice(0, 500) : sh.allRows.slice(0, 500);
          if (!firstSheet) pdf.addPage();
          firstSheet = false;
          // Title
          pdf.setFontSize(14);
          pdf.text(sh.name, 14, 15);
          pdf.setFontSize(9);
          pdf.setTextColor(120);
          pdf.text(
            `${rows.length} ${lang === 'ru' ? 'записей' : 'rows'}, ${cols.length} ${lang === 'ru' ? 'столбцов' : 'columns'} — ${new Date().toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')}`,
            14, 21
          );
          pdf.setTextColor(0);
          // Table
          autoTable(pdf, {
            startY: 26,
            head: [cols.map(c => attrName(c, lang))],
            body: rows.map(r => cols.map(c => fmtCell(r[c], lang))),
            styles: {
              font: font.regular ? 'DejaVuSans' : 'helvetica',
              fontSize: 7,
              cellPadding: 1.5,
              overflow: 'linebreak',
              textColor: 20,
            },
            headStyles: {
              fillColor: [16, 185, 129],
              textColor: 255,
              fontStyle: 'bold',
              fontSize: 8,
            },
            alternateRowStyles: { fillColor: [245, 250, 248] },
            margin: { left: 10, right: 10, top: 26, bottom: 10 },
            tableWidth: pageW - 20,
          });
        }
        // Append charts as images
        if (exportIncludeCharts && charts.length > 0) {
          pdf.addPage();
          pdf.setFontSize(14);
          pdf.text(lang === 'ru' ? 'Диаграммы' : 'Charts', 14, 15);
          let chartY = 25;
          const chartW = pageW - 20;
          const chartH = 90;
          for (const chart of charts) {
            const node = chartRefs.current[chart.id];
            if (node) {
              try {
                // Give recharts one more paint frame to be safe
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                const canvas = await captureChartToCanvas(node, 2);
                if (chartY + chartH > pageH - 10) { pdf.addPage(); chartY = 15; }
                pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 10, chartY, chartW, chartH);
                chartY += chartH + 6;
              } catch (e) { console.warn('chart export error', e); }
            }
          }
        }
        pdf.save(`${filename}.pdf`);
      } else if (exportFormat === 'docx') {
        // Multi-sheet DOCX with orientation — use PageOrientation enum explicitly
        const orientation: PageOrientation = exportOrientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT;
        const isLandscape = orientation === PageOrientation.LANDSCAPE;
        const pageW = isLandscape ? 16838 : 11906;
        const pageH = isLandscape ? 11906 : 16838;
        // Capture charts as PNG blobs first (so we can embed in DOCX)
        const chartImages: Array<{ blob: ArrayBuffer; width: number; height: number; title: string }> = [];
        if (exportIncludeCharts) {
          for (const chart of charts) {
            const node = chartRefs.current[chart.id];
            if (node) {
              try {
                // Give recharts one more paint frame to be safe
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                const canvas = await captureChartToCanvas(node, 2);
                const blob: ArrayBuffer = await new Promise(resolve => canvas.toBlob(b => {
                  if (b) b.arrayBuffer().then(resolve); else resolve(new ArrayBuffer(0));
                }) as any);
                // For Word: width ~ 600px, height = aspect-ratio
                const aspect = canvas.height / canvas.width;
                const w = 600;
                const h = Math.round(w * aspect);
                chartImages.push({ blob, width: w, height: h, title: chart.title || `${attrName(chart.labelField, lang)}` });
              } catch (e) { console.warn('chart docx export error', e); }
            }
          }
        }
        const sections = [];
        for (const sh of sheetsToExport) {
          const cols = orderedCols(sh);
          const rows = (sh.id === currentSheet?.id && !exportAllSheets) ? filteredRows.slice(0, 500) : sh.allRows.slice(0, 500);
          const headerCells = cols.map(c =>
            new DocxTableCell({
              children: [new Paragraph({ children: [new TextRun({ text: attrName(c, lang), bold: true, size: 16, font: 'Calibri' })] })],
              width: { size: Math.floor(14000 / Math.max(cols.length, 1)), type: WidthType.DXA },
              shading: { fill: '10B981', type: 'clear' as unknown as undefined },
            })
          );
          const dataRows = rows.map(r =>
            new DocxTableRow({
              children: cols.map(c =>
                new DocxTableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: fmtCell(r[c], lang).slice(0, 200), size: 14, font: 'Calibri' })] })],
                  width: { size: Math.floor(14000 / Math.max(cols.length, 1)), type: WidthType.DXA },
                })
              ),
            })
          );
          const children: Array<Paragraph | DocxTable> = [
            new Paragraph({ text: sh.name, heading: HeadingLevel.HEADING_1 }),
            new Paragraph({ children: [new TextRun({ text: `${rows.length} ${lang === 'ru' ? 'записей' : 'rows'}, ${cols.length} ${lang === 'ru' ? 'столбцов' : 'columns'}`, size: 14, color: '888888' })] }),
            new DocxTable({
              rows: [new DocxTableRow({ children: headerCells, tableHeader: true }), ...dataRows],
              width: { size: 14000, type: WidthType.DXA },
            }),
          ];
          sections.push({
            properties: {
              page: {
                size: { orientation, width: pageW, height: pageH },
                margin: { top: 720, right: 720, bottom: 720, left: 720 },
              },
            },
            children,
          });
        }
        // Add charts section at the end
        if (chartImages.length > 0) {
          const chartChildren: Array<Paragraph> = [new Paragraph({ text: lang === 'ru' ? 'Диаграммы' : 'Charts', heading: HeadingLevel.HEADING_1 })];
          for (const img of chartImages) {
            chartChildren.push(new Paragraph({ text: img.title, heading: HeadingLevel.HEADING_3 }));
            chartChildren.push(new Paragraph({
              children: [new ImageRun({
                data: img.blob,
                transformation: { width: img.width, height: img.height },
                type: 'png',
              })],
            }));
          }
          sections.push({
            properties: {
              page: {
                size: { orientation, width: pageW, height: pageH },
                margin: { top: 720, right: 720, bottom: 720, left: 720 },
              },
            },
            children: chartChildren,
          });
        }
        const doc = new Document({ sections });
        const blob = await Packer.toBlob(doc);
        saveAs(blob, `${filename}.docx`);
      }
      toast.success(t('dataforge.exportSuccess'));
    } catch (err) {
      console.error('Export error:', err);
      toast.error(t('dataforge.exportFailed'));
    } finally {
      setExporting(false);
      setExportDialogOpen(false);
      // Restore previous tab if we switched for export (charts or PNG data table)
      if (switchedTab) {
        setTimeout(() => setActiveTab(prevTab), 100);
      }
    }
  }, [sheets, filteredRows, currentSheet, exportFormat, exportOrientation, exportAllSheets, exportIncludeCharts, charts, lang, t, activeTab]);

  function escapeCsv(val: string): string {
    if (!val) return '';
    if (val.includes(',') || val.includes('\n') || val.includes('"')) return '"' + val.replace(/"/g, '""') + '"';
    return val;
  }

  function downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }

  const saveView = useCallback(() => {
    if (!currentSheet) return;
    const name = currentSheet.name + ' — ' + new Date().toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'en-US');
    const view = { id: `v-${Date.now()}`, name, entity: currentSheet.entity, visibleCols: [...currentSheet.visibleCols], filters: Object.fromEntries(Object.entries(currentSheet.colFilters).map(([k, v]) => [k, [...v]])) };
    const updated = [...savedViews, view];
    setSavedViews(updated);
    localStorage.setItem('dataforge-views', JSON.stringify(updated));
    toast.success(t('dataforge.viewSaved'));
  }, [currentSheet, savedViews, lang, t]);

  // Custom recharts tooltip
  const CustomTooltip = useCallback(({ active, payload, label: lbl }: { active?: boolean; payload?: Array<{ name: string; value: number; payload?: { name: string; value: number } }>; label?: string }) => {
    if (!active || !payload?.length) return null;
    const total = payload.reduce((s, p) => s + p.value, 0);
    return (
      <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-lg text-xs">
        <p className="font-medium">{lbl || payload[0]?.payload?.name}</p>
        {payload.map((p, i) => (
          <p key={i} className="text-muted-foreground">{p.name}: <span className="text-foreground font-medium">{p.value}</span>{total > 0 && <span className="ml-1">({((p.value / total) * 100).toFixed(1)}%)</span>}</p>
        ))}
      </div>
    );
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="h-full flex flex-col gap-0">

        {/* ── TOP: Entity tabs (drag-and-drop reorderable) ── */}
        <div className="flex items-center gap-1 md:gap-2 px-1 py-2 border-b bg-background/80 flex-wrap">
          <div className="flex items-center gap-2 mr-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <h1 className="text-sm font-bold">{t('dataforge.title')}</h1>
          </div>
          <Separator orientation="vertical" className="h-6 hidden md:flex" />
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleEntityDragStart}
            onDragEnd={handleEntityDragEnd}
          >
            <SortableContext items={entityOrder} strategy={horizontalListSortingStrategy}>
              <div className="flex items-center gap-1 flex-wrap">
                {entityOrder.map(ek => {
                  const isActive = currentSheet?.entity === ek;
                  const sheetForEntity = sheets.find(s => s.entity === ek);
                  return (
                    <SortableEntityTab
                      key={ek}
                      entityKey={ek}
                      isActive={isActive}
                      icon={ENTITY_ICONS[ek]}
                      label={entityName(ek, lang)}
                      count={entities[ek].count}
                      onClick={() => {
                        if (sheetForEntity) {
                          setActiveSheetId(sheetForEntity.id);
                        } else {
                          addSheet(ek);
                        }
                      }}
                    />
                  );
                })}
              </div>
            </SortableContext>
            <DragOverlay>
              {draggedEntityId ? (
                <div
                  className="flex items-center gap-1.5 h-7 text-[11px] px-2.5 rounded select-none bg-emerald-600 text-white font-medium shadow-2xl ring-2 ring-emerald-400/60"
                  style={{ touchAction: 'none' }}
                >
                  {ENTITY_ICONS[draggedEntityId]}
                  <span className="truncate max-w-[100px]">{entityName(draggedEntityId, lang)}</span>
                  <span className="text-[9px] opacity-70">({entities[draggedEntityId]?.count ?? 0})</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
          <div className="flex-1" />
          {currentSheet && (
            <Badge variant="outline" className="text-[10px] h-6">{filteredRows.length}/{currentSheet.allRows.length}</Badge>
          )}
          <Button variant="outline" size="sm" className="h-7 text-[11px] px-2 md:px-3" onClick={saveView} disabled={!currentSheet}><Save className="w-3 h-3 md:mr-1" /><span className="hidden sm:inline">{t('dataforge.saveView')}</span></Button>
          {currentSheet && (
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => loadData(currentSheet.entity, currentSheet.id)} disabled={loading}>
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          )}
          {sheets.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400" onClick={clearAll} title={lang === 'ru' ? 'Очистить все листы' : 'Clear all sheets'}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{lang === 'ru' ? 'Очистить все листы' : 'Clear all sheets'}</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* ── MAIN: Sidebar + Content ── */}
        <div className="flex-1 flex flex-col md:flex-row gap-0 min-h-0 overflow-hidden relative">
          {/* ── Left Sidebar ── */}
          {currentSheet && (
            <div className="w-full md:w-48 flex-shrink-0 flex flex-col gap-2 overflow-y-auto p-2 border-b md:border-b-0 md:border-r bg-background/50 min-h-0 max-h-[40vh] md:max-h-none">
              {/* Search */}
              <div className="relative flex-shrink-0">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                <Input
                  value={currentSheet.searchText}
                  onChange={e => updateSheet(currentSheet.id, { searchText: e.target.value })}
                  placeholder={t('dataforge.searchInTable')}
                  className="h-7 text-[11px] pl-7"
                />
              </div>

              {/* ── Sidebar tabs: Столбцы | Связи (side-by-side, switchable) ── */}
              <div className="flex gap-0.5 flex-shrink-0 p-0.5 rounded-md bg-muted/40">
                <button
                  onClick={() => setSidebarTab('columns')}
                  className={`flex-1 flex items-center justify-center gap-1 h-6 text-[10px] rounded transition-colors ${sidebarTab === 'columns' ? 'bg-emerald-600 text-white font-medium' : 'text-muted-foreground hover:bg-accent/30'}`}
                  title={lang === 'ru' ? 'Столбцы' : 'Columns'}
                >
                  <Columns3 className="w-2.5 h-2.5" />
                  {t('dataforge.columns')}
                  <span className={`text-[8px] ${sidebarTab === 'columns' ? 'opacity-80' : 'opacity-60'}`}>({currentSheet.visibleCols.size}/{dataCols.length})</span>
                </button>
                <button
                  onClick={() => setSidebarTab('relations')}
                  className={`flex-1 flex items-center justify-center gap-1 h-6 text-[10px] rounded transition-colors ${sidebarTab === 'relations' ? 'bg-emerald-600 text-white font-medium' : 'text-muted-foreground hover:bg-accent/30'}`}
                  title={lang === 'ru' ? 'Связи' : 'Relations'}
                >
                  <Network className="w-2.5 h-2.5" />
                  {t('dataforge.relations')}
                </button>
              </div>

              {/* Active filters (always shown if any, above the active panel) */}
              {Object.keys(currentSheet.colFilters).length > 0 && (
                <Card className="bg-background/50 flex-shrink-0">
                  <CardHeader className="py-1.5 px-2">
                    <CardTitle className="text-[10px] flex items-center gap-1"><Filter className="w-2.5 h-2.5 text-amber-400" />{t('dataforge.activeFilters')}</CardTitle>
                  </CardHeader>
                  <CardContent className="px-2 pb-1.5 space-y-0.5">
                    {Object.entries(currentSheet.colFilters).map(([col, vals]) => (
                      <div key={col} className="flex items-center gap-1">
                        <Badge variant="secondary" className="text-[8px] px-1 py-0 truncate max-w-[80px]">{attrName(col, lang)}: {vals.size}</Badge>
                        <button onClick={() => clearColFilter(col)} className="text-muted-foreground hover:text-red-400"><X className="w-2.5 h-2.5" /></button>
                      </div>
                    ))}
                    <Button variant="ghost" size="sm" className="h-4 text-[8px] w-full" onClick={() => updateSheet(currentSheet.id, { colFilters: {} })}>{t('dataforge.clearAllFilters')}</Button>
                  </CardContent>
                </Card>
              )}

              {/* ── Columns panel (drag-and-drop reorderable) ── */}
              {sidebarTab === 'columns' && (
                <Card className="bg-background/50 flex-shrink-0 overflow-hidden flex flex-col" style={{ maxHeight: isMobile ? '32vh' : 'calc(100vh - 220px)' }}>
                  <CardHeader className="py-1.5 px-2 flex-shrink-0">
                    <CardTitle className="text-[10px] flex items-center gap-1">
                      <Columns3 className="w-2.5 h-2.5" />{t('dataforge.columns')} <span className="text-muted-foreground">({currentSheet.visibleCols.size}/{dataCols.length})</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-2 pb-1.5 flex flex-col min-h-0 flex-1">
                    <div className="flex gap-1 mb-1 flex-shrink-0">
                      <Button variant="ghost" size="sm" className="h-4 text-[8px] px-1" onClick={() => updateSheet(currentSheet.id, { visibleCols: new Set(dataCols) })}>{t('common.all')}</Button>
                      <Button variant="ghost" size="sm" className="h-4 text-[8px] px-1" onClick={() => updateSheet(currentSheet.id, { visibleCols: new Set(getKeyFields(currentSheet.entity, dataCols)) })}>{t('dataforge.resetCols')}</Button>
                    </div>
                    <div className="overflow-y-auto overflow-x-hidden flex-1 min-h-0 pr-0.5">
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleColumnDragEnd}
                      >
                        <SortableContext items={dataCols} strategy={verticalListSortingStrategy}>
                          <div className="space-y-0">
                            {dataCols.map(col => (
                              <SortableColumnItem
                                key={col}
                                col={col}
                                isVisible={currentSheet.visibleCols.has(col)}
                                label={attrName(col, lang)}
                                lang={lang}
                                onToggle={() => {
                                  const next = new Set(currentSheet.visibleCols);
                                  if (next.has(col)) next.delete(col); else next.add(col);
                                  updateSheet(currentSheet.id, { visibleCols: next });
                                }}
                              />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                    </div>
                    <p className="text-[8px] text-muted-foreground/70 mt-1 px-0.5 leading-tight flex-shrink-0">
                      {lang === 'ru' ? '⠿ Перетащите, чтобы изменить порядок столбцов' : '⠿ Drag to reorder columns'}
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* ── Relations panel ── */}
              {sidebarTab === 'relations' && (
                <Card className="bg-background/50 flex-shrink-0">
                  <CardHeader className="py-1.5 px-2">
                    <CardTitle className="text-[10px] flex items-center gap-1"><Network className="w-2.5 h-2.5 text-teal-400" />{t('dataforge.relations')}</CardTitle>
                  </CardHeader>
                  <CardContent className="px-2 pb-1.5 space-y-1">
                    <p className="text-[8px] text-muted-foreground">{lang === 'ru' ? 'Принадлежность (1:M)' : 'Belongs to (1:M)'}</p>
                    {relations.map((r, i) => (
                      <div key={i} className="text-[9px] flex items-center gap-0.5 cursor-pointer hover:bg-accent/30 rounded px-0.5" onClick={() => { const ek = Object.entries(entities).find(([_, e]) => e.table_name === r.from)?.[0]; if (ek) addSheet(ek); }}>
                        <Badge variant="outline" className="text-[7px] px-0.5 py-0">{r.from}</Badge><span className="text-muted-foreground">→</span><Badge variant="outline" className="text-[7px] px-0.5 py-0">{r.to}</Badge>
                        <span className="text-[8px] text-muted-foreground truncate">{r.desc}</span>
                      </div>
                    ))}
                    <p className="text-[8px] text-muted-foreground mt-1">{lang === 'ru' ? 'Связь M:M' : 'Many-to-Many'}</p>
                    {associations.map((a, i) => (
                      <div key={i} className="text-[9px] flex items-center gap-0.5 cursor-pointer hover:bg-accent/30 rounded px-0.5" onClick={() => { const ek = Object.entries(entities).find(([_, e]) => e.table_name === a.from)?.[0]; if (ek) addSheet(ek); }}>
                        <Badge variant="outline" className="text-[7px] px-0.5 py-0">{a.from}</Badge><span className="text-teal-400">↔</span><Badge variant="outline" className="text-[7px] px-0.5 py-0">{a.to}</Badge>
                        <span className="text-[8px] text-muted-foreground truncate">{a.desc}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* ── Main Content ── */}
          <div className="flex-1 flex flex-col gap-0 min-h-0 overflow-hidden">
            {/* ── TOP: Sheet tabs (moved from bottom) ── */}
            <div className="flex items-center gap-0 border-b bg-background/80 px-1 py-0.5">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <ScrollArea className="flex-1">
                  <SortableContext items={sheets.map(s => s.id)} strategy={horizontalListSortingStrategy}>
                    <div className="flex items-center gap-0.5 py-0.5">
                      {sheets.map(sheet => (
                        <SortableSheetTab
                          key={sheet.id}
                          sheet={sheet}
                          isActive={sheet.id === activeSheetId}
                          isMulti={sheets.length > 1}
                          lang={lang}
                          onSelect={() => setActiveSheetId(sheet.id)}
                          onClose={() => removeSheet(sheet.id)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </ScrollArea>
                {/* Drag overlay — keeps the dragged tab visually "lifted" */}
                <DragOverlay>
                  {draggedSheetId ? (
                    (() => {
                      const s = sheets.find(x => x.id === draggedSheetId);
                      if (!s) return null;
                      return (
                        <div className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-emerald-600 text-white font-medium shadow-2xl ring-2 ring-emerald-300/60 select-none">
                          <Sheet className="w-2.5 h-2.5" />
                          <span className="max-w-[100px] truncate">{s.name}</span>
                        </div>
                      );
                    })()
                  ) : null}
                </DragOverlay>
              </DndContext>
              {currentSheet && (
                <div className="flex items-center gap-0.5 ml-1">
                  {sheets.length > 1 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="text-[8px] h-5 px-1 mr-0.5 text-muted-foreground hidden md:flex items-center gap-0.5">
                          <span className="opacity-60">⇄</span>
                          {lang === 'ru' ? 'тяните' : 'drag'}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>{lang === 'ru' ? 'Перетащите вкладки, чтобы изменить их порядок' : 'Drag tabs to reorder them'}</TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => duplicateSheet(currentSheet.id)}><Copy className="w-2.5 h-2.5" /></Button></TooltipTrigger><TooltipContent>{lang === 'ru' ? 'Копировать лист' : 'Duplicate'}</TooltipContent></Tooltip>
                  <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setExportDialogOpen(true)}><Download className="w-2.5 h-2.5" /></Button></TooltipTrigger><TooltipContent>{lang === 'ru' ? 'Экспорт' : 'Export'}</TooltipContent></Tooltip>
                </div>
              )}
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center gap-1 md:gap-2 px-2 py-1 border-b flex-wrap">
                <TabsList className="h-7">
                  <TabsTrigger value="data" className="text-[11px] px-2.5"><Table2 className="w-3 h-3 mr-1" />{t('dataforge.tabData')}</TabsTrigger>
                  <TabsTrigger value="charts" className="text-[11px] px-2.5"><BarChart3 className="w-3 h-3 mr-1" />{t('dataforge.tabCharts')}{charts.length > 0 && <Badge variant="secondary" className="text-[8px] ml-1 px-1 py-0">{charts.length}</Badge>}</TabsTrigger>
                  <TabsTrigger value="links" className="text-[11px] px-2.5"><Network className="w-3 h-3 mr-1" />{t('dataforge.tabLinks')}</TabsTrigger>
                </TabsList>
                <div className="flex-1" />
                {activeTab === 'data' && currentSheet && (
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setChartDialogOpen(true)} disabled={filteredRows.length === 0}><BarChart3 className="w-3 h-3 md:mr-1" /><span className="hidden sm:inline">{t('dataforge.addChart')}</span></Button>
                    <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setExportDialogOpen(true)} disabled={filteredRows.length === 0}><Download className="w-3 h-3 md:mr-1" /><span className="hidden sm:inline">{t('common.export')}</span></Button>
                  </div>
                )}
              </div>

              {/* ── Data Tab ── */}
              <TabsContent value="data" className="mt-0 flex-1 min-h-0 overflow-auto">
                {loading ? (
                  <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-emerald-400" /></div>
                ) : !currentSheet || filteredRows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                    <Database className="w-12 h-12 mb-3 opacity-30" />
                    <p className="text-sm">{t('common.noData')}</p>
                  </div>
                ) : isMobile ? (
                  <div className="space-y-2 max-h-[calc(100vh-12rem)] overflow-y-auto pb-4 p-2" style={{ WebkitOverflowScrolling: 'touch' }}>
                    {filteredRows.slice(0, 500).map((row, idx) => {
                      const keyAttr = entities[currentSheet.entity]?.key_attr;
                      const nameAttr = entities[currentSheet.entity]?.name_attr;
                      const titleCol = nameAttr || keyAttr || displayCols[0];
                      const titleVal = titleCol ? row[titleCol] : Object.values(row)[0];
                      const extraCols = displayCols.filter(c => c !== titleCol);
                      return (
                        <Card key={`m-${idx}`} className="p-2.5">
                          <div className="flex items-start gap-2">
                            <div className="flex-shrink-0 w-7 h-7 rounded bg-emerald-500/10 flex items-center justify-center text-[10px] text-emerald-400 font-mono font-medium">
                              {idx + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-xs truncate">{fmtCell(titleVal, lang) || `#${idx + 1}`}</div>
                              <div className={`mt-1 pt-1 border-t border-border/50 gap-0.5 ${isLandscapeMobile ? 'grid grid-cols-2' : 'space-y-0.5'}`}>
                                {extraCols.map(col => {
                                  const val = row[col];
                                  if (val === null || val === undefined || val === '') return null;
                                  return (
                                    <div key={col} className="flex items-start gap-1 text-[10px] min-w-0">
                                      <span className="font-mono text-muted-foreground/70 flex-shrink-0">{attrName(col, lang)}:</span>
                                      <span className="font-mono text-muted-foreground truncate flex-1 min-w-0">{Array.isArray(val) ? val.join(', ') : fmtCell(val, lang)}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                    {filteredRows.length > 500 && <p className="text-[9px] text-muted-foreground text-center py-2">{t('dataforge.showingFirst', { count: 500, total: filteredRows.length })}</p>}
                  </div>
                ) : (
                  <div ref={tableContainerRef} className="overflow-auto h-full">
                    <Table>
                      <TableHeader>
                        <DndContext
                          sensors={sensors}
                          collisionDetection={closestCenter}
                          onDragEnd={handleColumnDragEnd}
                        >
                          <SortableContext items={displayCols} strategy={horizontalListSortingStrategy}>
                            <TableRow>
                              <TableHead className="w-9 text-[9px] sticky left-0 bg-background z-10">#</TableHead>
                              {displayCols.map(col => {
                                const hasFilter = currentSheet.colFilters[col]?.size > 0;
                                const isSorted = currentSheet.sortCol === col;
                                return (
                                  <SortableTableHeader key={col} col={col} className="text-[9px] whitespace-nowrap group min-w-[120px]">
                                    <div className="flex items-center gap-0.5">
                                      <span>{attrName(col, lang)}</span>
                                      {isSorted && <ArrowUpDown className={`w-2 h-2 text-emerald-400 ${currentSheet.sortDir === 'desc' ? 'rotate-180' : ''}`} />}
                                      {hasFilter && <Filter className="w-2 h-2 text-amber-400" />}
                                      <button
                                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-accent/50 rounded transition-opacity"
                                        onPointerDown={e => e.stopPropagation()}
                                        onClick={e => { e.stopPropagation(); setFilterDialogCol(col); }}
                                      >
                                        <ChevronDown className="w-2.5 h-2.5" />
                                      </button>
                                    </div>
                                  </SortableTableHeader>
                                );
                              })}
                            </TableRow>
                          </SortableContext>
                        </DndContext>
                      </TableHeader>
                      <TableBody>
                        {filteredRows.slice(0, 500).map((row, idx) => (
                          <TableRow key={idx} className="hover:bg-accent/20 group/row">
                            <TableCell className="text-[9px] text-muted-foreground sticky left-0 bg-background z-10">{idx + 1}</TableCell>
                            {displayCols.map(col => {
                              const isEditing = editCell?.rowIdx === idx && editCell?.col === col;
                              const val = row[col];
                              return (
                                <TableCell key={col} className={`text-[10px] max-w-[240px] font-mono ${isEditing ? 'p-0' : 'truncate cursor-default'}`} onDoubleClick={() => setEditCell({ rowIdx: idx, col })}>
                                  {isEditing ? <EditCell value={val} lang={lang} onSave={(v) => saveEdit(idx, col, v)} onCancel={() => setEditCell(null)} /> : (
                                    <span className="group-hover/row:whitespace-normal group-hover/row:overflow-visible">{fmtCell(val, lang)}</span>
                                  )}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {filteredRows.length > 500 && <p className="text-[9px] text-muted-foreground text-center py-2">{t('dataforge.showingFirst', { count: 500, total: filteredRows.length })}</p>}
                  </div>
                )}
              </TabsContent>

              {/* ── Charts Tab ── */}
              <TabsContent value="charts" className="mt-0 flex-1 min-h-0 overflow-auto">
                <div className="p-2 h-full flex flex-col gap-2">
                  {charts.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                      <BarChart3 className="w-12 h-12 mb-3 opacity-30" />
                      <p className="text-sm">{t('dataforge.noCharts')}</p>
                      <Button variant="outline" size="sm" className="mt-3" onClick={() => setChartDialogOpen(true)} disabled={!currentSheet || filteredRows.length === 0}><Plus className="w-3 h-3 mr-1" />{t('dataforge.addChart')}</Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                      {charts.map((chart) => {
                        const data = buildChartData(chart);
                        return (
                          <Card key={chart.id} className="bg-background/50">
                            <CardHeader className="py-1.5 px-3">
                              <div className="flex items-center justify-between">
                                <CardTitle className="text-[11px] truncate">{chart.title || `${attrName(chart.labelField, lang)} — ${chart.valueField === 'count' ? t('dataforge.actionCount') : attrName(chart.valueField, lang)}`}</CardTitle>
                                <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-muted-foreground hover:text-red-400 flex-shrink-0" onClick={() => setCharts(prev => prev.filter(c => c.id !== chart.id))}><Trash2 className="w-3 h-3" /></Button>
                              </div>
                            </CardHeader>
                            <CardContent className="px-3 pb-2" style={{ height: 260 }}>
                              <div ref={el => { chartRefs.current[chart.id] = el; }} style={{ width: '100%', height: '100%', background: 'white' }}>
                              {data.length === 0 ? (
                                <div className="h-full flex items-center justify-center text-muted-foreground text-xs">{lang === 'ru' ? 'Нет данных' : 'No data'}</div>
                              ) : chart.type === 'bar' ? (
                                <ResponsiveContainer width="100%" height="100%">
                                  <BarChart data={data} margin={{ top: 5, right: 5, bottom: 40, left: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                                    <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} height={55} />
                                    <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                                    <RTooltip content={<CustomTooltip />} />
                                    <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                                      {data.map((_, index) => <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                                    </Bar>
                                  </BarChart>
                                </ResponsiveContainer>
                              ) : chart.type === 'pie' ? (
                                <ResponsiveContainer width="100%" height="100%">
                                  <PieChart>
                                    <Pie data={data} cx="50%" cy="42%" outerRadius={70} dataKey="value" nameKey="name" label={({ name, value, percent }) => `${name}: ${value} (${(percent * 100).toFixed(1)}%)`} labelLine={true}>
                                      {data.map((_, index) => <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                                    </Pie>
                                    <RTooltip content={<CustomTooltip />} />
                                    <Legend layout="horizontal" verticalAlign="bottom" wrapperStyle={{ fontSize: 9 }} />
                                  </PieChart>
                                </ResponsiveContainer>
                              ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                  <LineChart data={data} margin={{ top: 5, right: 5, bottom: 40, left: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                                    <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} height={55} />
                                    <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                                    <RTooltip content={<CustomTooltip />} />
                                    <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3, fill: '#3b82f6' }} />
                                  </LineChart>
                                </ResponsiveContainer>
                              )}
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* ── Links Tab ── */}
              <TabsContent value="links" className="mt-0 flex-1 min-h-0 overflow-auto">
                <Card className="h-full bg-background/50 rounded-none">
                  <CardHeader className="py-2 px-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-xs flex items-center gap-2"><Network className="w-3.5 h-3.5 text-teal-400" />{t('dataforge.schemaRelations')}</CardTitle>
                      <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => setActiveTab('data')}><Table2 className="w-3 h-3 mr-1" />{t('dataforge.tabData')}</Button>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <RelationDiagram entities={entities} relations={relations} associations={associations} selectedEntity={currentSheet?.entity || ''} onSelectEntity={(ek) => { addSheet(ek); setActiveTab('data'); }} lang={lang} />
                    <div className="mt-3 space-y-2">
                      <h3 className="text-[10px] font-semibold text-muted-foreground">{t('dataforge.manyToMany')}</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                        {associations.map((a, i) => (
                          <Card key={i} className="bg-background/80 px-2 py-1.5 cursor-pointer hover:bg-accent/20 transition-colors" onClick={() => { const ek = Object.entries(entities).find(([_, e]) => e.table_name === a.from)?.[0]; if (ek) { addSheet(ek); setActiveTab('data'); } }}>
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <Badge variant="outline" className="text-[8px] border-blue-400/40 text-blue-300 px-1 py-0">{a.from}</Badge>
                              <span className="text-teal-400 text-xs">↔</span>
                              <Badge variant="outline" className="text-[8px] border-purple-400/40 text-purple-300 px-1 py-0">{a.to}</Badge>
                            </div>
                            <p className="text-[9px]">{a.desc}</p>
                          </Card>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* ── Column Filter Dialog ── */}
        {filterDialogCol && currentSheet && (
          <ColumnFilterDialog
            column={filterDialogCol}
            lang={lang}
            selectedValues={currentSheet.colFilters[filterDialogCol] || new Set()}
            allValues={getUniqueValues(currentSheet.allRows, filterDialogCol)}
            onApply={applyColFilter}
            onClear={clearColFilter}
            onSortAsc={c => handleSort(c, 'asc')}
            onSortDesc={c => handleSort(c, 'desc')}
            open={!!filterDialogCol}
            onClose={() => setFilterDialogCol(null)}
          />
        )}

        {/* ── Chart Builder Dialog ── */}
        <Dialog open={chartDialogOpen} onOpenChange={setChartDialogOpen}>
          <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{t('dataforge.addChart')}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">{t('dataforge.chartType')}</Label>
                <Select value={newChart.type} onValueChange={v => setNewChart(p => ({ ...p, type: v as ChartConfig['type'] }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bar"><div className="flex items-center gap-2"><BarChart3 className="w-3 h-3" />{t('dataforge.chartBar')}</div></SelectItem>
                    <SelectItem value="pie"><div className="flex items-center gap-2"><PieChartIcon className="w-3 h-3" />{t('dataforge.chartPie')}</div></SelectItem>
                    <SelectItem value="line"><div className="flex items-center gap-2"><TrendingUp className="w-3 h-3" />{t('dataforge.chartLine')}</div></SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t('dataforge.labelField')} (X)</Label>
                <Select value={newChart.labelField} onValueChange={v => setNewChart(p => ({ ...p, labelField: v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t('dataforge.selectField')} /></SelectTrigger>
                  <SelectContent>{dataCols.map(c => <SelectItem key={c} value={c}>{attrName(c, lang)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t('dataforge.valueField')} (Y)</Label>
                <Select value={newChart.valueField} onValueChange={v => setNewChart(p => ({ ...p, valueField: v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="count">{t('dataforge.actionCount')}</SelectItem>
                    {dataCols.map(c => <SelectItem key={c} value={c}>{attrName(c, lang)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t('dataforge.chartTitle')}</Label>
                <Input value={newChart.title} onChange={e => setNewChart(p => ({ ...p, title: e.target.value }))} className="h-8 text-sm" placeholder={t('dataforge.chartTitlePlaceholder')} />
              </div>
              <Button className="w-full" onClick={() => {
                if (!newChart.labelField) { toast.error(t('dataforge.needLabelField')); return; }
                setCharts(prev => [...prev, { ...newChart, id: `chart-${Date.now()}` }]);
                setNewChart({ id: '', type: 'bar', labelField: '', valueField: 'count', title: '' });
                setChartDialogOpen(false);
                setActiveTab('charts');
                toast.success(t('dataforge.chartAdded'));
              }}><Plus className="w-4 h-4 mr-1" />{t('dataforge.addChart')}</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Export Dialog ── */}
        <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
          <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{t('dataforge.exportData')}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">{t('dataforge.exportInfo', { count: filteredRows.length, cols: displayCols.length })} {sheets.length > 1 && `· ${sheets.length} ${lang === 'ru' ? 'листов' : 'sheets'}`}</p>
              <div>
                <Label className="text-xs">{t('dataforge.exportFormat')}</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-1">
                  {[
                    { v: 'xlsx', label: 'Excel (.xlsx)', icon: FileSpreadsheet },
                    { v: 'xls', label: 'Excel (.xls)', icon: FileSpreadsheet },
                    { v: 'csv', label: 'CSV', icon: FileText },
                    { v: 'json', label: 'JSON', icon: FileJson },
                    { v: 'pdf', label: 'PDF', icon: FileDown },
                    { v: 'docx', label: 'Word (.docx)', icon: FileText },
                    { v: 'png', label: 'PNG', icon: FileImage },
                  ].map(fmt => {
                    const FIcon = fmt.icon;
                    return (
                      <button key={fmt.v} onClick={() => setExportFormat(fmt.v)} className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-xs transition-colors ${exportFormat === fmt.v ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400' : 'border-border hover:bg-accent/30'}`}>
                        <FIcon className="w-4 h-4" />{fmt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Orientation (PDF/DOCX only) */}
              {(exportFormat === 'pdf' || exportFormat === 'docx') && (
                <div>
                  <Label className="text-xs">{lang === 'ru' ? 'Ориентация' : 'Orientation'}</Label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
                    <button onClick={() => setExportOrientation('portrait')} className={`flex items-center justify-center gap-2 p-2 rounded-lg border text-xs transition-colors ${exportOrientation === 'portrait' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400' : 'border-border hover:bg-accent/30'}`}>
                      <div className="w-3 h-4 border-2 border-current rounded-sm" />{lang === 'ru' ? 'Книжная' : 'Portrait'}
                    </button>
                    <button onClick={() => setExportOrientation('landscape')} className={`flex items-center justify-center gap-2 p-2 rounded-lg border text-xs transition-colors ${exportOrientation === 'landscape' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400' : 'border-border hover:bg-accent/30'}`}>
                      <div className="w-4 h-3 border-2 border-current rounded-sm" />{lang === 'ru' ? 'Альбомная' : 'Landscape'}
                    </button>
                  </div>
                </div>
              )}

              {/* All sheets option */}
              {sheets.length > 1 && (
                <label className="flex items-center gap-2 text-xs cursor-pointer p-2 rounded-lg border border-border hover:bg-accent/30">
                  <input type="checkbox" checked={exportAllSheets} onChange={e => setExportAllSheets(e.target.checked)} className="w-3.5 h-3.5" />
                  <span>{lang === 'ru' ? `Экспортировать все листы (${sheets.length}) одним файлом` : `Export all ${sheets.length} sheets as one file`}</span>
                </label>
              )}

              {/* Include charts option (PDF/DOCX/PNG) */}
              {(exportFormat === 'pdf' || exportFormat === 'docx' || exportFormat === 'png') && charts.length > 0 && (
                <label className="flex items-center gap-2 text-xs cursor-pointer p-2 rounded-lg border border-border hover:bg-accent/30">
                  <input type="checkbox" checked={exportIncludeCharts} onChange={e => setExportIncludeCharts(e.target.checked)} className="w-3.5 h-3.5" />
                  <span>{lang === 'ru' ? `Включить диаграммы (${charts.length})` : `Include ${charts.length} charts as images`}</span>
                </label>
              )}

              <Button className="w-full" onClick={handleExport} disabled={exporting}>
                {exporting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
                {t('common.export')} ({exportAllSheets && sheets.length > 1 ? sheets.length + ' ' + (lang === 'ru' ? 'листов' : 'sheets') : filteredRows.length + ' ' + t('dataforge.rows')})
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
