'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Settings2, Plus, X, Search, GripVertical, ArrowUp, ArrowDown } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  DragOverlay,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, verticalListSortingStrategy, useSortable, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export interface ColumnDef {
  key: string;        // attribute key
  label: string;      // display label
  visible: boolean;   // whether column is visible
  removable?: boolean; // whether column can be removed (default columns are not)
  width?: number;     // column width in pixels (for resizable columns)
}

function getStorageKey(entityType: string): string {
  return `samba-cols-${entityType}`;
}

function loadColumnPrefs(entityType: string, defaultColumns: ColumnDef[]): ColumnDef[] {
  try {
    const stored = localStorage.getItem(getStorageKey(entityType));
    if (stored) {
      const parsed = JSON.parse(stored) as { columns?: ColumnDef[] };
      if (parsed?.columns && Array.isArray(parsed.columns)) {
        // Start with defaults, overlay stored visibility and width and order
        const merged: ColumnDef[] = [];
        // First add items in stored order if they exist in defaults or are extra
        for (const sc of parsed.columns) {
          const dc = defaultColumns.find(d => d.key === sc.key);
          if (dc) {
            merged.push({ ...dc, visible: sc.visible ?? dc.visible, width: sc.width ?? dc.width });
          } else {
            merged.push({ key: sc.key, label: sc.label || sc.key, visible: sc.visible ?? true, removable: true, width: sc.width });
          }
        }
        // Add any default columns that weren't in storage
        for (const dc of defaultColumns) {
          if (!merged.find(m => m.key === dc.key)) {
            merged.push(dc);
          }
        }
        return merged;
      }
    }
  } catch { /* ignore */ }
  return defaultColumns;
}

function saveColumnPrefs(entityType: string, columns: ColumnDef[]) {
  try {
    localStorage.setItem(getStorageKey(entityType), JSON.stringify({
      columns: columns.map(c => ({ key: c.key, label: c.label, visible: c.visible, removable: c.removable, width: c.width })),
    }));
  } catch { /* ignore */ }
}

interface ColumnCustomizerProps {
  entityType: string;
  columns: ColumnDef[];
  onColumnsChange: (columns: ColumnDef[]) => void;
  dataKeys?: string[];  // All available keys from data for discovering new columns
}

/**
 * Recursively extract all keys from a data record, including nested objects.
 * For nested objects, keys are prefixed with the parent key (e.g. "user.cn").
 * For arrays of objects, each element's keys are extracted.
 * This ensures ColumnCustomizer shows ALL available keys, not just top-level.
 */
export function extractAllKeys(data: Record<string, unknown>[]): string[] {
  const keySet = new Set<string>();
  const collect = (obj: unknown, prefix: string = '') => {
    if (obj === null || obj === undefined) return;
    if (Array.isArray(obj)) {
      obj.forEach(item => collect(item, prefix));
      return;
    }
    if (typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (k === '__typename') continue;
        const fullKey = prefix ? `${prefix}.${k}` : k;
        keySet.add(fullKey);
        // Recurse into nested objects (but not arrays of primitives)
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          collect(v, fullKey);
        } else if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
          collect(v, fullKey);
        }
      }
    }
  };
  data.forEach(item => collect(item));
  return [...keySet].sort();
}

// ── Sortable column item (drag handle reordering via @dnd-kit) ──
interface SortableColumnRowProps {
  col: ColumnDef;
  index: number;
  total: number;
  onToggle: (key: string) => void;
  onRemove: (key: string) => void;
  onMove: (key: string, direction: 'up' | 'down') => void;
}

function SortableColumnRow({ col, index, total, onToggle, onRemove, onMove }: SortableColumnRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.key });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    // pan-y allows vertical scrolling (touch) while still enabling drag.
    // 'none' would block touch scrolling on the entire row.
    touchAction: 'pan-y',
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1.5 py-1 px-2 rounded hover:bg-accent group ${isDragging ? 'ring-2 ring-emerald-400/50 bg-emerald-500/5 z-10' : ''}`}
    >
      {/* Drag handle — only this element has touch-action: none so dragging
          works, but the rest of the row allows touch scrolling. */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground/60 hover:text-foreground flex-shrink-0 touch-none"
        style={{ touchAction: 'none' }}
        title="Drag to reorder"
        type="button"
        aria-label={`Drag ${col.label} to reorder`}
      >
        <GripVertical className="w-3 h-3" />
      </button>
      <div className="flex flex-col gap-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          className="h-3 w-3 flex items-center justify-center hover:text-foreground text-muted-foreground"
          onClick={() => onMove(col.key, 'up')}
          disabled={index === 0}
          type="button"
          aria-label="Move up"
        >
          <ArrowUp className="w-2.5 h-2.5" />
        </button>
        <button
          className="h-3 w-3 flex items-center justify-center hover:text-foreground text-muted-foreground"
          onClick={() => onMove(col.key, 'down')}
          disabled={index === total - 1}
          type="button"
          aria-label="Move down"
        >
          <ArrowDown className="w-2.5 h-2.5" />
        </button>
      </div>
      <Checkbox
        checked={col.visible}
        onCheckedChange={() => onToggle(col.key)}
        className="h-3.5 w-3.5"
      />
      <Label className="text-xs cursor-pointer flex-1 font-mono truncate" onClick={() => onToggle(col.key)}>
        {col.label}
      </Label>
      {col.removable && (
        <Button variant="ghost" size="icon" className="h-4 w-4 opacity-0 group-hover:opacity-100" onClick={() => onRemove(col.key)}>
          <X className="w-2.5 h-2.5 text-red-400" />
        </Button>
      )}
    </div>
  );
}

export default function ColumnCustomizer({
  entityType,
  columns,
  onColumnsChange,
  dataKeys = [],
}: ColumnCustomizerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [addInput, setAddInput] = useState('');
  const [draggedKey, setDraggedKey] = useState<string | null>(null);

  // Sensors for drag-and-drop: pointer (mouse/touch) + keyboard (accessibility)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Keys from data that aren't in columns yet
  const availableKeys = useMemo(() => {
    const existingKeys = new Set(columns.map(c => c.key));
    return dataKeys.filter(k => !existingKeys.has(k) && k !== '__typename');
  }, [columns, dataKeys]);

  const filteredAvailableKeys = useMemo(() => {
    if (!search) return availableKeys;
    return availableKeys.filter(k => k.toLowerCase().includes(search.toLowerCase()));
  }, [availableKeys, search]);

  const filteredColumns = useMemo(() => {
    if (!search) return columns;
    return columns.filter(c => c.label.toLowerCase().includes(search.toLowerCase()) || c.key.toLowerCase().includes(search.toLowerCase()));
  }, [columns, search]);

  const toggleColumn = useCallback((key: string) => {
    const updated = columns.map(c =>
      c.key === key ? { ...c, visible: !c.visible } : c
    );
    onColumnsChange(updated);
    saveColumnPrefs(entityType, updated);
  }, [columns, onColumnsChange, entityType]);

  const addColumn = useCallback((key: string) => {
    if (columns.some(c => c.key === key)) return;
    const updated = [...columns, { key, label: key, visible: true, removable: true }];
    onColumnsChange(updated);
    saveColumnPrefs(entityType, updated);
  }, [columns, onColumnsChange, entityType]);

  const removeColumn = useCallback((key: string) => {
    const updated = columns.filter(c => c.key !== key);
    onColumnsChange(updated);
    saveColumnPrefs(entityType, updated);
  }, [columns, onColumnsChange, entityType]);

  const addCustomColumn = useCallback(() => {
    const key = addInput.trim();
    if (!key || columns.some(c => c.key === key)) return;
    addColumn(key);
    setAddInput('');
  }, [addInput, columns, addColumn]);

  const showAll = useCallback(() => {
    const updated = columns.map(c => ({ ...c, visible: true }));
    onColumnsChange(updated);
    saveColumnPrefs(entityType, updated);
  }, [columns, onColumnsChange, entityType]);

  const hideAllExtras = useCallback(() => {
    const updated = columns.map(c => ({ ...c, visible: !c.removable }));
    onColumnsChange(updated);
    saveColumnPrefs(entityType, updated);
  }, [columns, onColumnsChange, entityType]);

  // Move column up/down for reordering (button fallback)
  const moveColumn = useCallback((key: string, direction: 'up' | 'down') => {
    const idx = columns.findIndex(c => c.key === key);
    if (idx < 0) return;
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= columns.length) return;
    const updated = arrayMove(columns, idx, newIdx);
    onColumnsChange(updated);
    saveColumnPrefs(entityType, updated);
  }, [columns, onColumnsChange, entityType]);

  // Drag-and-drop reorder handler
  const handleDragStart = useCallback((e: DragStartEvent) => {
    setDraggedKey(String(e.active.id));
  }, []);

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    setDraggedKey(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const fromIdx = columns.findIndex(c => c.key === active.id);
    const toIdx = columns.findIndex(c => c.key === over.id);
    if (fromIdx === -1 || toIdx === -1) return;
    const updated = arrayMove(columns, fromIdx, toIdx);
    onColumnsChange(updated);
    saveColumnPrefs(entityType, updated);
  }, [columns, onColumnsChange, entityType]);

  const draggedCol = useMemo(
    () => draggedKey ? columns.find(c => c.key === draggedKey) : null,
    [draggedKey, columns]
  );

  return (
    <>
      <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => setOpen(true)}>
        <Settings2 className="w-3.5 h-3.5" />
        {t('customizer.button', 'Настроить')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-md max-h-[85vh] p-0 gap-0 overflow-hidden flex flex-col">
          <DialogHeader className="p-4 pb-2 flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Settings2 className="w-4 h-4" />
              {t('customizer.title', 'Настройка столбцов')}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t('customizer.title', 'Настройка столбцов')}
            </DialogDescription>
          </DialogHeader>
          <div className="px-4 pb-2 space-y-2 flex-shrink-0">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="text-[10px] h-6 flex-1" onClick={showAll}>
                {t('customizer.showAll', 'Показать все')}
              </Button>
              <Button variant="outline" size="sm" className="text-[10px] h-6 flex-1" onClick={hideAllExtras}>
                {t('customizer.hideAll', 'Скрыть все')}
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('customizer.search', 'Поиск столбцов...')}
                className="h-7 text-xs pl-7"
              />
            </div>
            <p className="text-[10px] text-muted-foreground/70 flex items-center gap-1">
              <GripVertical className="w-2.5 h-2.5" />
              {t('customizer.dragHint', 'Перетащите за ручку, чтобы изменить порядок')}
            </p>
          </div>
          {/* Scrollable list — flex-1 min-h-0 so it fills remaining space and scrolls.
              Works identically on desktop and mobile (portrait + ⟳ landscape). */}
          <div
            className="overflow-y-auto overflow-x-hidden flex-1 min-h-0 overscroll-contain border-t"
            style={{ WebkitOverflowScrolling: 'touch' }}
            onWheel={(e) => e.stopPropagation()}
          >
            <div className="px-4 pb-2 space-y-0.5">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={filteredColumns.map(c => c.key)} strategy={verticalListSortingStrategy}>
                  {filteredColumns.map((col, idx) => (
                    <SortableColumnRow
                      key={col.key}
                      col={col}
                      index={idx}
                      total={filteredColumns.length}
                      onToggle={toggleColumn}
                      onRemove={removeColumn}
                      onMove={moveColumn}
                    />
                  ))}
                </SortableContext>
                <DragOverlay>
                  {draggedCol ? (
                    <div
                      className="flex items-center gap-1.5 py-1 px-2 rounded bg-background ring-2 ring-emerald-400/60 shadow-2xl"
                      style={{ touchAction: 'none' }}
                    >
                      <GripVertical className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                      <Checkbox checked={draggedCol.visible} className="h-3.5 w-3.5" />
                      <span className="text-xs font-mono">{draggedCol.label}</span>
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
              {filteredAvailableKeys.length > 0 && (
                <>
                  <div className="text-[10px] text-muted-foreground uppercase mt-2 mb-1 px-2 sticky top-0 bg-background">
                    {t('customizer.available', 'Доступные из данных')} ({filteredAvailableKeys.length})
                  </div>
                  {filteredAvailableKeys.map(key => (
                    <div key={key} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-accent">
                      <Button variant="ghost" size="sm" className="h-5 text-[10px] gap-1 font-mono" onClick={() => addColumn(key)}>
                        <Plus className="w-2.5 h-2.5" />
                        {key}
                      </Button>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
          <div className="p-4 pt-2 border-t flex-shrink-0">
            <div className="flex gap-2">
              <Input
                value={addInput}
                onChange={(e) => setAddInput(e.target.value)}
                placeholder={t('customizer.addColumn', 'Добавить столбец...')}
                className="h-7 text-xs"
                onKeyDown={(e) => { if (e.key === 'Enter') addCustomColumn(); }}
              />
              <Button size="sm" className="h-7" onClick={addCustomColumn} disabled={!addInput.trim()}>
                <Plus className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Hook for managing column config with localStorage persistence
export function useColumnConfig(entityType: string, defaultColumns: ColumnDef[]) {
  const [columns, setColumns] = useState<ColumnDef[]>(() => loadColumnPrefs(entityType, defaultColumns));

  const visibleColumnKeys = useMemo(() =>
    new Set(columns.filter(c => c.visible).map(c => c.key)),
    [columns]
  );

  const isColumnVisible = useCallback((key: string) => visibleColumnKeys.has(key), [visibleColumnKeys]);

  // Visible columns in their configured order (NOT hardcoded order).
  // Use this to render table headers/cells so reordering in the customizer
  // actually reflects in the rendered table.
  const visibleColumns = useMemo(() => columns.filter(c => c.visible), [columns]);

  // Get extra (non-default) visible columns for rendering at the end of the table
  const extraVisibleColumns = useMemo(() =>
    columns.filter(c => c.visible && c.removable),
    [columns]
  );

  // Get width for a column key
  const getColumnWidth = useCallback((key: string): number | undefined => {
    const col = columns.find(c => c.key === key);
    return col?.width;
  }, [columns]);

  // Set width for a column key
  const setColumnWidth = useCallback((key: string, width: number) => {
    setColumns(prev => {
      const updated = prev.map(c => c.key === key ? { ...c, width } : c);
      saveColumnPrefs(entityType, updated);
      return updated;
    });
  }, [entityType]);

  return { columns, setColumns, visibleColumnKeys, isColumnVisible, visibleColumns, extraVisibleColumns, getColumnWidth, setColumnWidth };
}
