'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Settings2, Plus, X, Eye, EyeOff, ChevronDown, ChevronUp } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

/**
 * Safely render any attribute value for display.
 * Handles: null, undefined, arrays, nested objects, primitives.
 */
export function safeRenderValue(value: unknown, maxBadges: number = 10, onShowMore?: () => void): React.ReactNode {
  if (value === null || value === undefined) return <span className="text-muted-foreground">&mdash;</span>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">&mdash;</span>;
    // Check if array elements are objects
    if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
      return (
        <div className="space-y-1">
          {value.slice(0, maxBadges).map((v, idx) => (
            <Badge key={idx} variant="outline" className="text-[10px] font-mono max-w-[300px] truncate block">
              {formatObjectShort(v)}
            </Badge>
          ))}
          {value.length > maxBadges && (
            <span className="text-[10px] text-muted-foreground">+{value.length - maxBadges} more</span>
          )}
        </div>
      );
    }
    return (
      <div className="flex flex-wrap gap-1">
        {value.slice(0, maxBadges).map((v, idx) => (
          <Badge key={idx} variant="outline" className="text-[10px] font-mono max-w-[200px] truncate">{String(v)}</Badge>
        ))}
        {value.length > maxBadges && (
          <span className="text-[10px] text-muted-foreground">+{value.length - maxBadges}</span>
        )}
      </div>
    );
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const entries = Object.entries(obj);
    if (entries.length === 0) return <span className="text-muted-foreground">&mdash;</span>;

    return (
      <div className="space-y-0.5 text-[10px]">
        {entries.slice(0, 8).map(([k, v]) => (
          <div key={k} className="flex gap-1">
            <span className="text-muted-foreground font-mono">{k}:</span>
            <span className="truncate max-w-[200px]">{String(v)}</span>
          </div>
        ))}
        {entries.length > 8 && onShowMore && (
          <span
            className="text-blue-400 cursor-pointer hover:text-blue-300 transition-colors"
            onClick={onShowMore}
            role="button"
            tabIndex={0}
          >
            +{entries.length - 8} {entries.length - 8 === 1 ? 'more key' : 'more keys'} &raquo;
          </span>
        )}
        {entries.length > 8 && !onShowMore && (
          <span className="text-muted-foreground">+{entries.length - 8} more</span>
        )}
      </div>
    );
  }

  const strVal = String(value);
  if (strVal.includes('\n')) {
    return (
      <div className="text-xs whitespace-pre-wrap break-all">
        {strVal.split('\n').map((line, idx) => (
          <div key={idx}>{line || '\u00A0'}</div>
        ))}
      </div>
    );
  }

  return <span className="whitespace-pre-wrap break-all text-xs">{strVal}</span>;
}

/**
 * Render a full expanded object (all entries, not truncated)
 */
function renderFullObject(obj: Record<string, unknown>, depth: number = 0): React.ReactNode {
  const entries = Object.entries(obj);
  if (entries.length === 0) return <span className="text-muted-foreground">&mdash;</span>;

  return (
    <div className={`space-y-1 ${depth > 0 ? 'ml-3 border-l border-border/30 pl-2' : ''}`}>
      {entries.map(([k, v]) => {
        if (v === null || v === undefined) {
          return (
            <div key={k} className="text-xs py-0.5">
              <span className="text-muted-foreground font-mono mr-2">{k}:</span>
              <span className="text-muted-foreground">&mdash;</span>
            </div>
          );
        }
        if (typeof v === 'object' && !Array.isArray(v)) {
          return (
            <div key={k} className="text-xs">
              <span className="text-muted-foreground font-mono">{k}:</span>
              {renderFullObject(v as Record<string, unknown>, depth + 1)}
            </div>
          );
        }
        if (Array.isArray(v)) {
          return (
            <div key={k} className="text-xs">
              <div className="text-muted-foreground font-mono">{k}:</div>
              <div className="flex flex-wrap gap-1 ml-3">
                {v.map((item, idx) => (
                  <Badge key={idx} variant="outline" className="text-[10px] font-mono max-w-[250px] truncate">
                    {typeof item === 'object' ? formatObjectShort(item) : String(item)}
                  </Badge>
                ))}
              </div>
            </div>
          );
        }
        return (
          <div key={k} className="text-xs py-0.5">
            <span className="text-muted-foreground font-mono mr-2">{k}:</span>
            <span className="break-words" title={String(v)}>
              {String(v)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Format an object into a short readable string like "key1:val1, key2:val2"
 */
export function formatObjectShort(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return String(obj);
  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length === 0) return '{}';
  return entries.slice(0, 3).map(([k, v]) => {
    const valStr = typeof v === 'object' ? formatObjectShort(v) : String(v);
    return `${k}:${valStr}`;
  }).join(', ') + (entries.length > 3 ? '...' : '');
}

function getStorageKey(entityType: string): string {
  return `samba-attrs-${entityType}`;
}

interface AttributeViewerProps {
  entityType: string;
  data: Record<string, unknown>;
  keyInfoKeys?: string[];
  showCustomize?: boolean;
}

export default function AttributeViewer({
  entityType,
  data,
  keyInfoKeys = [],
  showCustomize = true,
}: AttributeViewerProps) {
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [customAttrInput, setCustomAttrInput] = useState('');
  const [showAllMode, setShowAllMode] = useState(false);
  // Track which specific keys have their nested objects expanded
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const allKeys = useMemo(() => {
    return Object.keys(data).filter(k => k !== '__typename').sort();
  }, [data]);

  // Track explicitly hidden keys and custom-added keys separately
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(getStorageKey(entityType));
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.hidden && Array.isArray(parsed.hidden)) return new Set(parsed.hidden);
      }
    } catch { /* ignore */ }
    return new Set<string>();
  });

  const [customKeys, setCustomKeys] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(getStorageKey(entityType));
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.custom && Array.isArray(parsed.custom)) return new Set(parsed.custom);
      }
    } catch { /* ignore */ }
    return new Set<string>();
  });

  const persistPrefs = useCallback((hidden: Set<string>, custom: Set<string>) => {
    try {
      localStorage.setItem(getStorageKey(entityType), JSON.stringify({
        hidden: [...hidden],
        custom: [...custom],
      }));
    } catch { /* ignore */ }
  }, [entityType]);

  // Derive effective visible keys: all data keys minus hidden, plus custom
  const visibleKeys = useMemo(() => {
    if (showAllMode) {
      const visible = new Set(allKeys);
      for (const k of customKeys) visible.add(k);
      return visible;
    }
    const visible = new Set(allKeys.filter(k => !hiddenKeys.has(k)));
    for (const k of customKeys) visible.add(k);
    return visible;
  }, [allKeys, hiddenKeys, customKeys, showAllMode]);

  const toggleKey = (key: string) => {
    if (allKeys.includes(key)) {
      setHiddenKeys(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        persistPrefs(next, customKeys);
        return next;
      });
    } else if (customKeys.has(key)) {
      setCustomKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        persistPrefs(hiddenKeys, next);
        return next;
      });
    } else {
      setCustomKeys(prev => {
        const next = new Set(prev);
        next.add(key);
        persistPrefs(hiddenKeys, next);
        return next;
      });
    }
  };

  const addCustomAttr = () => {
    const attr = customAttrInput.trim();
    if (!attr) return;
    setCustomKeys(prev => {
      const next = new Set(prev);
      next.add(attr);
      const newHidden = new Set(hiddenKeys);
      newHidden.delete(attr);
      persistPrefs(newHidden, next);
      setHiddenKeys(newHidden);
      return next;
    });
    setCustomAttrInput('');
  };

  const showAll = () => {
    setHiddenKeys(new Set());
    setShowAllMode(true);
    // Also expand all nested objects
    setExpandedKeys(new Set(allKeys.filter(k => typeof data[k] === 'object' && data[k] !== null && !Array.isArray(data[k]))));
    persistPrefs(new Set(), customKeys);
  };

  const hideAllExtras = () => {
    const newHidden = new Set(allKeys.filter(k => !keyInfoKeys.includes(k)));
    setHiddenKeys(newHidden);
    setShowAllMode(false);
    setExpandedKeys(new Set());
    persistPrefs(newHidden, customKeys);
  };

  const toggleShowAll = () => {
    if (showAllMode) {
      setShowAllMode(false);
      setExpandedKeys(new Set());
    } else {
      showAll();
    }
  };

  const toggleExpanded = (key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const keyInfoEntries = keyInfoKeys
    .filter(k => data[k] !== undefined && data[k] !== null)
    .map(k => [k, data[k]] as [string, unknown]);

  const extraEntries = allKeys
    .filter(k => visibleKeys.has(k) && !keyInfoKeys.includes(k))
    .map(k => [k, data[k]] as [string, unknown]);

  const customOnlyEntries = [...visibleKeys]
    .filter(k => !allKeys.includes(k))
    .map(k => [k, data[k]] as [string, unknown]);

  const totalExtra = allKeys.filter(k => !keyInfoKeys.includes(k)).length;
  const hiddenCount = allKeys.filter(k => !visibleKeys.has(k) && !keyInfoKeys.includes(k)).length;

  // Render a value with expandable nested objects
  const renderValue = (key: string, value: unknown) => {
    if (value === null || value === undefined) {
      return <span className="text-muted-foreground">&mdash;</span>;
    }

    const isExpanded = expandedKeys.has(key);

    // Nested object - show expanded or collapsed
    if (typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      const entries = Object.entries(obj);

      if (isExpanded) {
        return (
          <div className="w-full">
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-[10px] gap-1 mb-1 text-blue-400 hover:text-blue-300"
              onClick={() => toggleExpanded(key)}
            >
              <ChevronUp className="w-3 h-3" />
              {t('attrs.collapse', 'Свернуть')} ({entries.length} {t('attrs.keys', 'ключей')})
            </Button>
            {renderFullObject(obj)}
          </div>
        );
      }

      // Collapsed - show truncated with expand button
      return (
        <div className="w-full">
          {safeRenderValue(value, 10, () => toggleExpanded(key))}
          <Button
            variant="ghost"
            size="sm"
            className="h-5 text-[10px] gap-1 text-blue-400 hover:text-blue-300"
            onClick={() => toggleExpanded(key)}
          >
            <ChevronDown className="w-3 h-3" />
            {t('attrs.expand', 'Развернуть')} ({entries.length} {t('attrs.keys', 'ключей')})
          </Button>
        </div>
      );
    }

    return safeRenderValue(value, 20, toggleShowAll);
  };

  return (
    <div className="space-y-4">
      {keyInfoEntries.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {keyInfoEntries.map(([key, value]) => (
            <div key={key} className="p-3 rounded-lg bg-muted/50 border border-border/50 overflow-hidden">
              <p className="text-[10px] text-muted-foreground uppercase mb-1">{key}</p>
              <div className="text-sm font-medium break-words overflow-hidden">
                {renderValue(key, value)}
              </div>
            </div>
          ))}
        </div>
      )}

      <Separator />
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase">
          {extraEntries.length + customOnlyEntries.length} {t('attrs.attributes', 'Атрибутов')}
          {hiddenCount > 0 && !showAllMode && (
            <span className="font-normal ml-1">({hiddenCount} {t('attrs.hidden', 'скрыто')})</span>
          )}
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs gap-1"
            onClick={toggleShowAll}
          >
            {showAllMode ? (
              <>
                <ChevronUp className="w-3 h-3" />
                {t('attrs.showLess', 'Свернуть')}
              </>
            ) : (
              <>
                <Eye className="w-3 h-3" />
                {t('attrs.showAll', 'Показать все')}
              </>
            )}
          </Button>
          {showCustomize && (
            <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="w-3 h-3" />
              {t('attrs.customize', 'Настроить')}
            </Button>
          )}
        </div>
      </div>
      <div className="space-y-0">
        {[...extraEntries, ...customOnlyEntries].map(([key, value]) => (
          <div key={key} className="grid grid-cols-[minmax(140px,auto)_1fr] gap-x-3 items-start text-xs py-1 border-b border-border/30">
            <span className="text-muted-foreground font-mono truncate" title={key}>{key}</span>
            <span className="break-words min-w-0">
              {renderValue(key, value)}
            </span>
          </div>
        ))}
        {extraEntries.length + customOnlyEntries.length === 0 && (
          <p className="text-xs text-muted-foreground py-2 text-center">
            {hiddenCount > 0
              ? t('attrs.hiddenClick', `${hiddenCount} атрибутов скрыто. Нажмите «Показать все».`)
              : t('attrs.noVisible', 'Нет видимых атрибутов. Нажмите «Настроить» для добавления.')}
          </p>
        )}
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="w-4 h-4" />
              {t('attrs.customizeTitle', 'Настройка атрибутов')}
            </DialogTitle>
            <DialogDescription className="sr-only">{t('attrs.customizeTitle', 'Настройка атрибутов')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3" style={{ maxHeight: 'calc(80vh - 8rem)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="flex gap-2 flex-shrink-0">
              <Button variant="outline" size="sm" className="text-xs flex-1" onClick={() => { showAll(); }}>
                <Eye className="w-3 h-3 mr-1" /> {t('attrs.showAll', 'Показать все')}
              </Button>
              <Button variant="outline" size="sm" className="text-xs flex-1" onClick={hideAllExtras}>
                <EyeOff className="w-3 h-3 mr-1" /> {t('attrs.hideAll', 'Скрыть все')}
              </Button>
            </div>

            <div className="flex gap-2 flex-shrink-0">
              <Input
                value={customAttrInput}
                onChange={(e) => setCustomAttrInput(e.target.value)}
                placeholder={t('attrs.addAttr', 'Добавить атрибут...')}
                className="h-8 text-xs"
                onKeyDown={(e) => { if (e.key === 'Enter') addCustomAttr(); }}
              />
              <Button size="sm" className="h-8" onClick={addCustomAttr} disabled={!customAttrInput.trim()}>
                <Plus className="w-3 h-3" />
              </Button>
            </div>

            <ScrollArea className="flex-1" style={{ maxHeight: '50vh' }}>
              <div className="space-y-0.5">
                {allKeys.map(key => {
                  const val = data[key];
                  const valPreview = val === null || val === undefined ? '—'
                    : typeof val === 'string' ? val.slice(0, 25)
                    : Array.isArray(val) ? `[${val.length}]`
                    : typeof val === 'object' ? `{${Object.keys(val as Record<string, unknown>).length}}`
                    : String(val).slice(0, 20);
                  return (
                    <div key={key} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 py-1 px-2 rounded hover:bg-accent min-w-0">
                      <Checkbox
                        checked={visibleKeys.has(key)}
                        onCheckedChange={() => { toggleKey(key); if (showAllMode) setShowAllMode(false); }}
                        className="h-3.5 w-3.5 flex-shrink-0"
                      />
                      <Label className="text-xs font-mono cursor-pointer truncate" title={key}>{key}</Label>
                      <span className="text-[10px] text-muted-foreground truncate max-w-[120px] text-right flex-shrink-0" title={valPreview}>
                        {valPreview}
                      </span>
                    </div>
                  );
                })}
                {[...visibleKeys].filter(k => !allKeys.includes(k)).map(key => (
                  <div key={key} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-accent bg-amber-500/5 min-w-0">
                    <Checkbox
                      checked={visibleKeys.has(key)}
                      onCheckedChange={() => toggleKey(key)}
                      className="h-3.5 w-3.5 flex-shrink-0"
                    />
                    <Label className="text-xs font-mono cursor-pointer flex-1 truncate" title={key}>{key}</Label>
                    <Button variant="ghost" size="icon" className="h-5 w-5 flex-shrink-0" onClick={() => toggleKey(key)}>
                      <X className="w-3 h-3 text-red-400" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
