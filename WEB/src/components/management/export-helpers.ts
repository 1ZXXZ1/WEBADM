/**
 * Export helpers — CSV / JSON / XLSX with BOM for Cyrillic compatibility.
 * Modeled on the DataForge export pattern (src/components/dataforge/DataForgePage.tsx).
 */
import * as XLSX from 'xlsx';

function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('\n') || s.includes('"')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export type ExportFormat = 'csv' | 'json' | 'xlsx';

export interface ExportColumn {
  key: string;
  label: string;
}

/**
 * Export an array of rows to the requested format.
 *
 * @param filename  Filename without extension
 * @param rows      Array of row objects
 * @param columns   Ordered column specs (key + label)
 * @param format    'csv' | 'json' | 'xlsx'
 */
export function exportRows(
  filename: string,
  rows: Array<Record<string, unknown>>,
  columns: ExportColumn[],
  format: ExportFormat,
): void {
  if (!rows.length && format !== 'xlsx') return;

  if (format === 'json') {
    const payload = rows.map(r => {
      const o: Record<string, unknown> = {};
      columns.forEach(c => { o[c.label] = r[c.key]; });
      return o;
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    downloadBlob(blob, `${filename}.json`);
    return;
  }

  if (format === 'csv') {
    const parts: string[] = [];
    parts.push(columns.map(c => escapeCsv(c.label)).join(','));
    for (const r of rows) {
      parts.push(columns.map(c => escapeCsv(r[c.key])).join(','));
    }
    // BOM (\uFEFF) ensures Excel reads UTF-8 Cyrillic correctly
    const blob = new Blob(['\uFEFF' + parts.join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    downloadBlob(blob, `${filename}.csv`);
    return;
  }

  // XLSX
  const wb = XLSX.utils.book_new();
  const data = rows.map(r => {
    const o: Record<string, unknown> = {};
    columns.forEach(c => { o[c.label] = r[c.key]; });
    return o;
  });
  const wsData = data.length > 0
    ? data
    : [Object.fromEntries(columns.map(c => [c.label, '']))];
  const ws = XLSX.utils.json_to_sheet(wsData, {
    header: columns.map(c => c.label),
  });
  // Approximate column widths based on label length
  ws['!cols'] = columns.map(c => ({ wch: Math.max(12, c.label.length + 4) }));
  const sheetName = filename.slice(0, 31).replace(/[\\/?*[\]:]/g, '_');
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
