/**
 * Shared utility for reading DataForge (Данные SDB) state from localStorage.
 *
 * Used by AIAssistant in SDB mode so the AI has real data context:
 *  - which sheets are open
 *  - which sheet is active
 *  - what entity + columns + sample rows it has
 *
 * DataForge itself persists its state under `dataforge-state` in localStorage.
 * See DataForgePage.tsx for the writer side.
 */

export interface DataForgeSheetSnapshot {
  id: string;
  name: string;
  entity: string;                 // e.g. 'user', 'group', 'computer', 'ou', 'gpo', 'contact', 'dnsNode'
  columns: string[];              // schema + data attrs (original order)
  colOrder: string[];             // user-reordered column order
  visibleCols: string[];          // visible columns (from Set, serialized to array)
  rowCount: number;               // total rows in allRows
  sampleRows: Record<string, unknown>[]; // up to N sample rows (already filtered for safe mode)
}

export interface DataForgeSnapshot {
  activeSheetId: string | null;
  sheets: DataForgeSheetSnapshot[];
}

// LocalStorage payload shape (matches what DataForgePage persists)
interface StoredSheet {
  id: string;
  name: string;
  entity: string;
  rows?: Record<string, unknown>[];
  allRows?: Record<string, unknown>[];
  columns?: string[];
  colOrder?: string[];
  visibleCols?: string[];
  colFilters?: Record<string, string[]>;
  sortCol?: string;
  sortDir?: 'asc' | 'desc' | string;
  searchText?: string;
}

interface StoredState {
  sheets?: StoredSheet[];
  activeSheetId?: string;
  // ... other fields we don't care about (charts, export prefs, etc.)
}

/**
 * Read the current DataForge snapshot from localStorage.
 * Returns null if nothing is persisted (or parse fails).
 */
export function readDataForgeSnapshot(): DataForgeSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('dataforge-state');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredState;
    if (!parsed || !Array.isArray(parsed.sheets)) return null;

    const sheets: DataForgeSheetSnapshot[] = parsed.sheets.map(s => ({
      id: s.id,
      name: s.name,
      entity: s.entity,
      columns: Array.isArray(s.columns) ? s.columns : [],
      colOrder: Array.isArray(s.colOrder) ? s.colOrder : [],
      visibleCols: Array.isArray(s.visibleCols) ? s.visibleCols : [],
      rowCount: Array.isArray(s.allRows) ? s.allRows.length : (Array.isArray(s.rows) ? s.rows.length : 0),
      sampleRows: Array.isArray(s.allRows) ? s.allRows : (Array.isArray(s.rows) ? s.rows : []),
    }));

    return {
      activeSheetId: parsed.activeSheetId || null,
      sheets,
    };
  } catch {
    return null;
  }
}

/**
 * Mask sensitive values in a row object for Safe Mode.
 * Replaces values of keys matching: PASSWORD, PASSWD, SECRET, API_KEY, APIKEY,
 * TOKEN, PRIVATE_KEY, CERT_KEY, KEYFILE_PASSWORD, POLZA_AI_KEY, JWT_SECRET_KEY
 * with ************.
 */
export function maskSensitiveRow(row: Record<string, unknown>): Record<string, unknown> {
  const SENSITIVE_RE = /PASSWORD|PASSWD|SECRET|API_KEY|APIKEY|TOKEN|PRIVATE_KEY|CERT_KEY|KEYFILE_PASSWORD|POLZA_AI_KEY|JWT_SECRET_KEY/i;
  const masked: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (SENSITIVE_RE.test(k)) {
      masked[k] = '************';
    } else {
      masked[k] = v;
    }
  }
  return masked;
}

/**
 * Build a compact SDB-context block for the AI in SDB mode.
 * Returns empty string if no DataForge data is available.
 *
 * @param safeMode If true, sensitive field values are masked with ************.
 * @param maxRows Max sample rows per sheet (default 3).
 */
export function buildSdbContext(safeMode: boolean, maxRows = 3): string {
  const snap = readDataForgeSnapshot();
  if (!snap || snap.sheets.length === 0) return '';

  const parts: string[] = ['### DataForge / SDB Context (открытые листы)'];

  if (snap.activeSheetId) {
    const active = snap.sheets.find(s => s.id === snap.activeSheetId);
    if (active) {
      parts.push(`Активный лист: "${active.name}" (сущность: ${active.entity}, ${active.rowCount} записей)`);
    }
  }

  for (const sheet of snap.sheets) {
    parts.push(`\n#### Лист "${sheet.name}" — сущность: ${sheet.entity}`);
    parts.push(`Колонки (${sheet.columns.length}): ${sheet.columns.join(', ')}`);
    if (sheet.visibleCols.length > 0 && sheet.visibleCols.length !== sheet.columns.length) {
      parts.push(`Видимые колонки: ${sheet.visibleCols.join(', ')}`);
    }
    if (sheet.colOrder.length > 0) {
      parts.push(`Порядок колонок: ${sheet.colOrder.join(', ')}`);
    }
    parts.push(`Всего записей: ${sheet.rowCount}`);

    if (sheet.sampleRows.length > 0) {
      const sample = sheet.sampleRows.slice(0, maxRows);
      if (safeMode) {
        parts.push(`Пример записей (Safe Mode — секреты замаскированы):`);
        sample.forEach((row, idx) => {
          const masked = maskSensitiveRow(row);
          const rowValues = sheet.columns
            .slice(0, 10) // limit columns shown
            .map(c => `${c}="${String(masked[c] ?? '')}"`)
            .join(', ');
          parts.push(`  Row ${idx + 1}: ${rowValues}`);
        });
        if (sheet.rowCount > maxRows) {
          parts.push(`  ... и ещё ${sheet.rowCount - maxRows} записей (та же структура)`);
        }
      } else {
        parts.push(`Пример записей:`);
        sample.forEach((row, idx) => {
          const rowValues = sheet.columns
            .slice(0, 10)
            .map(c => `${c}="${String(row[c] ?? '')}"`)
            .join(', ');
          parts.push(`  Row ${idx + 1}: ${rowValues}`);
        });
        if (sheet.rowCount > maxRows) {
          parts.push(`  ... и ещё ${sheet.rowCount - maxRows} записей`);
        }
      }
    } else {
      parts.push(`(лист пуст — данные не загружены)`);
    }
  }

  parts.push('');
  parts.push('ВАЖНО для AI:');
  parts.push('- Ты видишь РЕАЛЬНЫЕ данные из листов DataForge. Используй их, чтобы строить осмысленные SDB-запросы.');
  parts.push('- НЕ используй плейсхолдер {USER_INPUT} — подставляй реальные значения из контекста или разумные примеры.');
  parts.push('- Если пользователь спрашивает про конкретную сущность (например, "admin пользователей"), ищи в активном листе подходящие строки и предлагай SDB-запрос с конкретными DN/именами.');
  parts.push('- В Safe Mode значения секретов замаскированы как ************ — НЕ пытайся их угадать.');

  return parts.join('\n');
}

/**
 * Suggested SDB SQL examples per entity — helps AI produce correct queries.
 */
export const SDB_ENTITY_EXAMPLES: Record<string, string[]> = {
  user: [
    'USE sam; FROM USERS; SHOW AS json LIMIT 1000;',
    'USE sam; FROM USERS WHERE userAccountControl LIKE "%2%"; SHOW AS json LIMIT 500;',
    'USE sam; FROM USERS WHERE adminCount = 1; SHOW AS json LIMIT 100;',
  ],
  group: [
    'USE sam; FROM GROUPS; SHOW AS json LIMIT 1000;',
    'USE sam; FROM GROUPS WHERE cn = "Domain Admins"; SHOW AS json LIMIT 10;',
  ],
  computer: [
    'USE sam; FROM COMPUTERS; SHOW AS json LIMIT 1000;',
    'USE sam; FROM COMPUTERS WHERE operatingSystem LIKE "Windows%"; SHOW AS json LIMIT 500;',
  ],
  ou: ['USE sam; FROM OUS; SHOW AS json LIMIT 500;'],
  gpo: ['USE sam; FROM GPOS; SHOW AS json LIMIT 100;'],
  contact: ['USE sam; FROM CONTACTS; SHOW AS json LIMIT 500;'],
  dnsNode: ['USE sam; FROM DNS_RECORDS; SHOW AS json LIMIT 1000;'],
};
