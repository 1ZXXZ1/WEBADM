'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RequirePermission } from '@/components/permissions/RequirePermission';
import api from '@/lib/api';
import AttributeViewer from '@/components/shared/AttributeViewer';
import ColumnCustomizer, { useColumnConfig, extractAllKeys, type ColumnDef } from '@/components/shared/ColumnCustomizer';
import { ResizeHandle } from '@/components/shared/ResizableTable';
import { Monitor, Trash2, Eye, Search, RefreshCw, Plus, Loader2, PenLine, FolderInput } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { useOrientation } from '@/hooks/use-orientation';

import { toast } from 'sonner';
import { safeToastMessage } from '@/lib/parsers';

interface ComputerLdapObject {
  dn?: string;
  cn?: string;
  sAMAccountName?: string;
  description?: string | string[];
  operatingSystem?: string | string[];
  operatingSystemVersion?: string | string[];
  objectClass?: string | string[];
  servicePrincipalName?: string | string[];
  [key: string]: unknown;
}

export default function ComputersPage() {
  const { t } = useTranslation();
  // useIsMobile checks the SHORT side of the screen, so it returns true
  // even when a phone is rotated to landscape (e.g. Oppo Reno 11F in ⟳ mode:
  // viewport ~920×412, short side 412 < 768 → still mobile → show cards).
  const isMobile = useIsMobile();
  // effectiveLandscape: true when device is in landscape (natural or ⟳ forced).
  const { effectiveLandscape } = useOrientation();
  const isLandscapeMobile = isMobile && effectiveLandscape;
  const [computers, setComputers] = useState<ComputerLdapObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedComputer, setSelectedComputer] = useState<string | null>(null);
  const [computerDetails, setComputerDetails] = useState<ComputerLdapObject | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newComputer, setNewComputer] = useState({
    computername: '',
    description: '',
    computerou: '',
  });

  // Edit computer dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editComputerName, setEditComputerName] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editNewOuDn, setEditNewOuDn] = useState('');

  const defaultColumns: ColumnDef[] = [
    { key: '#', label: '#', visible: true, removable: false },
    { key: 'cn', label: t('computers.computername'), visible: true },
    { key: 'operatingSystem', label: t('computers.os'), visible: true },
    { key: 'description', label: t('common.description'), visible: true },
    { key: 'actions', label: t('common.actions'), visible: true, removable: false },
  ];
  const { columns: colConfig, setColumns: setColConfig, isColumnVisible, visibleColumns, extraVisibleColumns, getColumnWidth, setColumnWidth } = useColumnConfig('computers', defaultColumns);

  const computerDataKeys = useMemo(() => {
    return extractAllKeys(computers as unknown as Record<string, unknown>[]);
  }, [computers]);

  const loadComputers = useCallback(async () => {
    setLoading(true);
    try {
      // Try /computers/full first (returns full LDAP objects)
      let response;
      try {
        response = await api.get('/computers/full');
      } catch {
        // Fallback to old endpoint
        response = await api.get('/computers/');
      }
      const data = response.data;

      // Handle {status: "ok", computers: [...]} format
      if (data?.computers && Array.isArray(data.computers)) {
        setComputers(data.computers);
      } else if (Array.isArray(data)) {
        setComputers(data);
      } else if (data?.data && Array.isArray(data.data)) {
        setComputers(data.data);
      } else if (data?.result && Array.isArray(data.result)) {
        setComputers(data.result);
      } else if (data?.output || data?.data?.output) {
        // Old text format — fallback to name-only list
        const outputText = data?.output || data?.data?.output;
        const lines = String(outputText).split('\n').filter((l: string) => l.trim());
        setComputers(lines.map((line: string) => ({ cn: line.trim(), sAMAccountName: line.trim() })));
      } else {
        setComputers([]);
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('computers.failedLoad')));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadComputers(); }, [loadComputers]);

  const showComputer = useCallback((name: string) => {
    setSelectedComputer(name);
    setDetailsDialogOpen(true);
    // Find the computer from already-loaded data by cn or sAMAccountName
    const found = computers.find(c =>
      c.cn === name || c.sAMAccountName === name || c.sAMAccountName === name + '$' || c.cn === name + '$'
    );
    setComputerDetails(found || null);
  }, [computers]);

  const createComputer = useCallback(async () => {
    try {
      const body: Record<string, string> = { computername: newComputer.computername };
      if (newComputer.description) body.description = newComputer.description;
      if (newComputer.computerou) body.computerou = newComputer.computerou;
      await api.post('/computers/', body);
      toast.success(t('computers.computerCreated'));
      setCreateDialogOpen(false);
      setNewComputer({ computername: '', description: '', computerou: '' });
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message, t('computers.failedCreate')));
    }
  }, [newComputer, t]);

  const deleteComputer = useCallback(async (name: string) => {
    if (!confirm(t('computers.confirmDelete', { name }))) return;
    try {
      await api.delete(`/computers/${encodeURIComponent(name)}`);
      toast.success(t('computers.computerDeleted'));
      if (selectedComputer === name) setSelectedComputer(null);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message, t('computers.failedDelete')));
    }
  }, [selectedComputer]);

  // Open edit dialog for a computer
  const openEditDialog = useCallback((name: string) => {
    setEditComputerName(name);
    setEditNewOuDn('');
    setEditDialogOpen(true);
  }, []);

  // Edit computer: move
  const handleEditMove = useCallback(async () => {
    if (!editComputerName || !editNewOuDn) return;
    setEditLoading(true);
    try {
      await api.post(`/computers/${encodeURIComponent(editComputerName)}/move`, {
        new_ou_dn: editNewOuDn,
      });
      toast.success(t('computers.computerMoved'));
      setEditNewOuDn('');
      setEditDialogOpen(false);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message, t('computers.failedMove')));
    } finally { setEditLoading(false); }
  }, [editComputerName, editNewOuDn, t]);

  const filteredComputers = computers.filter(c => {
    if (!searchQuery) return true;
    const name = getComputerName(c);
    const desc = getComputerDesc(c);
    const os = getComputerOs(c);
    return name.toLowerCase().includes(searchQuery.toLowerCase()) ||
           desc.toLowerCase().includes(searchQuery.toLowerCase()) ||
           os.toLowerCase().includes(searchQuery.toLowerCase());
  });

  // Get display name for a computer (strip trailing $)
  const getComputerName = (c: ComputerLdapObject): string => {
    const raw = c.cn || c.sAMAccountName || '';
    return raw.endsWith('$') ? raw.slice(0, -1) : raw;
  };

  // Get description for a computer
  const getComputerDesc = (c: ComputerLdapObject): string => {
    if (Array.isArray(c.description)) return c.description.join(', ');
    return c.description || '';
  };

  // Get operating system
  const getComputerOs = (c: ComputerLdapObject): string => {
    if (Array.isArray(c.operatingSystem)) return c.operatingSystem.join(', ');
    return c.operatingSystem || '';
  };

  const visibleColCount = colConfig.filter(c => c.visible).length;

  return (
    <RequirePermission permission="computer.list">
      <div className="space-y-4">
        {/* Toolbar - compact on mobile, full on desktop */}
        <div className="flex items-center gap-1 md:gap-2 flex-wrap">
          <RequirePermission permission="computer.create">
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
                  <Plus className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
                  <span className="hidden sm:inline">{t('computers.createComputer')}</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{t('computers.createComputer')}</DialogTitle>
                  <DialogDescription className="sr-only">{t('computers.createComputer')}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('computers.computername')} *</Label>
                    <Input
                      value={newComputer.computername}
                      onChange={(e) => setNewComputer(p => ({ ...p, computername: e.target.value }))}
                      className="h-8 text-sm"
                      placeholder="COMPUTER01"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('common.description')}</Label>
                    <Input
                      value={newComputer.description}
                      onChange={(e) => setNewComputer(p => ({ ...p, description: e.target.value }))}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('computers.computerOU')}</Label>
                    <Input
                      value={newComputer.computerou}
                      onChange={(e) => setNewComputer(p => ({ ...p, computerou: e.target.value }))}
                      className="h-8 text-sm"
                      placeholder="OU=Computers,DC=example,DC=com"
                    />
                  </div>
                  <Button onClick={createComputer} disabled={!newComputer.computername} className="w-full">
                    {t('computers.createComputer')}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </RequirePermission>

          <div className="flex-1" />

          <ColumnCustomizer
            entityType="computers"
            columns={colConfig}
            onColumnsChange={setColConfig}
            dataKeys={computerDataKeys}
          />

          <Button variant="outline" size="sm" onClick={loadComputers} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </Button>
        </div>

        {/* Full-width search row — single field, works on all breakpoints.
            Use type="text" (not "search") to avoid native browser clear
            button overlapping our custom one. */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('computers.searchComputers')}
            className="h-10 md:h-9 text-sm pl-10 pr-10 w-full bg-background"
            autoComplete="off"
            type="text"
            inputMode="search"
          />
          {searchQuery && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 z-10 flex items-center justify-center text-muted-foreground hover:text-foreground rounded"
              onClick={() => setSearchQuery('')}
              title="Очистить"
            >
              <span className="text-lg leading-none">×</span>
            </button>
          )}
        </div>

        {/* Mobile card view — shown when isMobile (checks short screen side,
            so it works in ⟳ rotate mode too, not just narrow viewport).
            Uses max-height + overflow-y-auto so cards scroll independently
            of the page. */}
        {isMobile && (
        <div className="space-y-2 max-h-[calc(100vh-12rem)] overflow-y-auto pb-4" style={{ WebkitOverflowScrolling: 'touch' }}>
          {loading ? (
            <div className="text-center py-8"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
          ) : filteredComputers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">{t('common.noData')}</div>
          ) : (
            filteredComputers.map((computer, i) => {
              const apiName = computer.cn || computer.sAMAccountName || '';
              const displayName = computer.cn || computer.sAMAccountName || '';
              // Show ALL visible columns from ColumnCustomizer as metadata in the card,
              // except # and actions (handled separately). This includes custom columns
              // the user added (e.g. operatingSystemHotfix, whenCreated, etc.).
              const extraCols = visibleColumns.filter(c =>
                c.key !== '#' && c.key !== 'actions' &&
                c.key !== 'cn' && c.key !== 'sAMAccountName' // already shown as displayName
              );
              return (
                <Card key={`m-${apiName}-${i}`} className="p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-shrink-0 w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center">
                      <Monitor className="w-4 h-4 text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-sm truncate block">{displayName}</span>
                      {computer.operatingSystem && <div className="text-xs text-muted-foreground truncate mt-0.5">{Array.isArray(computer.operatingSystem) ? computer.operatingSystem[0] : computer.operatingSystem}</div>}
                      {computer.description && <div className="text-xs text-muted-foreground truncate mt-0.5">{Array.isArray(computer.description) ? computer.description[0] : computer.description}</div>}
                      {/* Extra visible columns from ColumnCustomizer.
                          Custom columns appear here as "key: value" rows. */}
                      {extraCols.length > 0 && (
                        <div className="mt-1.5 pt-1.5 border-t border-border/50 space-y-0.5">
                          {extraCols.map(col => {
                            const val = computer[col.key as keyof typeof computer];
                            if (val === null || val === undefined || val === '') return null;
                            const displayVal = Array.isArray(val) ? val.join(', ') : String(val);
                            return (
                              <div key={col.key} className="flex items-start gap-1 text-[10px]">
                                <span className="font-mono text-muted-foreground/70 flex-shrink-0">{col.label}:</span>
                                <span className="font-mono text-muted-foreground truncate">{displayVal}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 mt-2 pt-2 border-t justify-end">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => showComputer(apiName)} title={t('common.show')}><Eye className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(apiName)} title={t('common.move')}><FolderInput className="w-4 h-4 text-blue-400" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteComputer(apiName)} title={t('common.delete')}><Trash2 className="w-4 h-4 text-red-400" /></Button>
                  </div>
                </Card>
              );
            })
          )}
        </div>
        )}

        {/* Desktop table — shown when NOT mobile (desktop / wide tablet). */}
        {!isMobile && (
        <Card className="overflow-hidden">
          <ScrollArea className="h-[calc(100vh-14rem)]">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {visibleColumns.map(col => {
                      if (col.key === '#') {
                        return (
                          <TableHead key={col.key} className="w-12 relative">
                            #
                            <ResizeHandle onResize={(d) => setColumnWidth('#', (getColumnWidth('#') || 48) + d)} />
                          </TableHead>
                        );
                      }
                      if (col.key === 'actions') {
                        return <TableHead key={col.key} className="w-40">{t('common.actions')}</TableHead>;
                      }
                      const label = col.removable ? col.label : (
                        col.key === 'cn' ? t('computers.computername') :
                        col.key === 'operatingSystem' ? t('computers.os') :
                        col.key === 'description' ? t('common.description') :
                        col.label
                      );
                      return (
                        <TableHead key={col.key} style={{ width: getColumnWidth(col.key) || undefined }} className="text-xs relative">
                          {label}
                          <ResizeHandle onResize={(d) => setColumnWidth(col.key, (getColumnWidth(col.key) || 150) + d)} />
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={visibleColCount} className="text-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ) : filteredComputers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={visibleColCount} className="text-center py-8 text-muted-foreground">
                        {t('common.noData')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredComputers.map((computer, i) => {
                      const name = getComputerName(computer);
                      const os = getComputerOs(computer);
                      const description = getComputerDesc(computer);
                      // Use the raw cn/sAMAccountName for API calls
                      const rawName = computer.cn || computer.sAMAccountName || name;
                      return (
                        <TableRow key={i} className="group">
                          {visibleColumns.map(col => {
                            if (col.key === '#') {
                              return <TableCell key={col.key} className="text-xs text-muted-foreground">{i + 1}</TableCell>;
                            }
                            if (col.key === 'actions') {
                              return (
                                <TableCell key={col.key}>
                                  <div className="flex gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                    <RequirePermission permission="computer.list">
                                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => showComputer(rawName)}>
                                        <Eye className="w-3 h-3" />
                                      </Button>
                                    </RequirePermission>
                                    <RequirePermission permission="computer.list">
                                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditDialog(rawName)} title={t('common.edit')}>
                                        <PenLine className="w-3 h-3 text-blue-400" />
                                      </Button>
                                    </RequirePermission>
                                    <RequirePermission permission="computer.delete">
                                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteComputer(rawName)}>
                                        <Trash2 className="w-3 h-3 text-red-400" />
                                      </Button>
                                    </RequirePermission>
                                  </div>
                                </TableCell>
                              );
                            }
                            if (col.key === 'cn') {
                              return (
                                <TableCell key={col.key}>
                                  <div className="flex items-center gap-2">
                                    <Monitor className="w-4 h-4 text-orange-400" />
                                    <span className="font-medium truncate max-w-[250px]" title={name}>{name}</span>
                                  </div>
                                </TableCell>
                              );
                            }
                            if (col.key === 'operatingSystem') {
                              return (
                                <TableCell key={col.key} className="text-sm text-muted-foreground">
                                  <span className="truncate max-w-[200px] block" title={os}>{os}</span>
                                </TableCell>
                              );
                            }
                            if (col.key === 'description') {
                              return (
                                <TableCell key={col.key} className="text-sm text-muted-foreground">
                                  <span className="truncate max-w-[200px] block" title={description}>{description}</span>
                                </TableCell>
                              );
                            }
                            // Generic extra column
                            const value = computer[col.key as keyof ComputerLdapObject];
                            return (
                              <TableCell key={col.key} className="text-xs">
                                <span className="truncate max-w-[150px] block">
                                  {value !== undefined ? (Array.isArray(value) ? (value as unknown[]).join(', ') : String(value)) : ''}
                                </span>
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </ScrollArea>
        </Card>
        )}

        {/* Computer Details Dialog */}
        <Dialog open={detailsDialogOpen} onOpenChange={(open) => { setDetailsDialogOpen(open); if (!open) setSelectedComputer(null); }}>
          <DialogContent className="max-w-[95vw] md:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-orange-400" />
                {selectedComputer}
              </DialogTitle>
              <DialogDescription className="sr-only">{selectedComputer}</DialogDescription>
            </DialogHeader>
            {computerDetails ? (
              <ScrollArea className="max-h-[65vh]">
                <AttributeViewer
                  entityType="computers"
                  data={computerDetails as Record<string, unknown>}
                  keyInfoKeys={['cn', 'sAMAccountName', 'operatingSystem', 'operatingSystemVersion', 'description', 'status']}
                  showCustomize={true}
                />
              </ScrollArea>
            ) : (
              <div className="py-8 text-center">
                <p className="text-sm text-muted-foreground">{t('common.noData')}</p>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Edit Computer Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <PenLine className="w-4 h-4 text-blue-400" />
                {t('computers.editComputer')}: {editComputerName}
              </DialogTitle>
              <DialogDescription className="sr-only">{t('computers.editComputer')}: {editComputerName}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">{t('computers.newOuDN')} *</Label>
                <Input
                  value={editNewOuDn}
                  onChange={(e) => setEditNewOuDn(e.target.value)}
                  className="h-8 text-sm"
                  autoComplete="off"
                  placeholder="OU=Computers,DC=example,DC=com"
                />
              </div>
              <Button
                onClick={handleEditMove}
                disabled={!editNewOuDn || editLoading}
                className="w-full"
              >
                {editLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <FolderInput className="w-4 h-4 mr-1" />}
                {t('computers.moveComputer')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </RequirePermission>
  );
}
