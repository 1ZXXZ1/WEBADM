'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RequirePermission } from '@/components/permissions/RequirePermission';
import api from '@/lib/api';
import AttributeViewer from '@/components/shared/AttributeViewer';
import ColumnCustomizer, { useColumnConfig, extractAllKeys, type ColumnDef } from '@/components/shared/ColumnCustomizer';
import { ResizeHandle } from '@/components/shared/ResizableTable';
import {
  Phone, Trash2, Eye, Search, RefreshCw, Plus, Loader2,
  FolderInput, PenLine, Mail,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { safeToastMessage } from '@/lib/parsers';
import { useIsMobile } from '@/hooks/use-mobile';
import { useOrientation } from '@/hooks/use-orientation';

interface ContactLdapObject {
  dn?: string;
  cn?: string;
  mail?: string | string[];
  telephoneNumber?: string | string[];
  description?: string | string[];
  objectClass?: string | string[];
  [key: string]: unknown;
}

export default function ContactsPage() {
  const { t } = useTranslation();
  // useIsMobile checks the SHORT side of the screen, so it returns true
  // even when a phone is rotated to landscape (e.g. Oppo Reno 11F in ⟳ mode:
  // viewport ~920×412, short side 412 < 768 → still mobile → show cards).
  const isMobile = useIsMobile();
  // effectiveLandscape: true when device is in landscape (natural or ⟳ forced).
  // Used to adapt layouts that need to know rotate-mode vs. portrait.
  const { effectiveLandscape } = useOrientation();
  const isLandscapeMobile = isMobile && effectiveLandscape;
  const [contacts, setContacts] = useState<ContactLdapObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContact, setSelectedContact] = useState<string | null>(null);
  const [contactDetails, setContactDetails] = useState<ContactLdapObject | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [renameContactName, setRenameContactName] = useState<string>('');
  const [moveContactName, setMoveContactName] = useState<string>('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [newContact, setNewContact] = useState({
    contactname: '', contactou: '', surname: '', given_name: '',
    display_name: '', mail_address: '', telephone_number: '', description: '',
  });

  const defaultColumns: ColumnDef[] = [
    { key: '#', label: '#', visible: true, removable: false },
    { key: 'cn', label: t('contacts.name'), visible: true },
    { key: 'mail', label: t('contacts.email'), visible: true },
    { key: 'telephoneNumber', label: t('contacts.phone'), visible: true },
    { key: 'description', label: t('common.description'), visible: true },
    { key: 'actions', label: t('common.actions'), visible: true, removable: false },
  ];
  const { columns: colConfig, setColumns: setColConfig, isColumnVisible, visibleColumns, extraVisibleColumns, getColumnWidth, setColumnWidth } = useColumnConfig('contacts', defaultColumns);

  const contactDataKeys = useMemo(() => {
    return extractAllKeys(contacts as unknown as Record<string, unknown>[]);
  }, [contacts]);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      // Try /contacts/full first (returns full LDAP objects)
      let response;
      try {
        response = await api.get('/contacts/full');
      } catch {
        // Fallback to old endpoint
        response = await api.get('/contacts/');
      }
      const data = response.data;

      // Handle {status: "ok", contacts: [...]} format
      if (data?.contacts && Array.isArray(data.contacts)) {
        setContacts(data.contacts);
      } else if (Array.isArray(data)) {
        setContacts(data);
      } else if (data?.data && Array.isArray(data.data)) {
        setContacts(data.data);
      } else if (data?.result && Array.isArray(data.result)) {
        setContacts(data.result);
      } else if (data?.output || data?.data?.output) {
        // Old text format — fallback to name-only list
        const outputText = data?.output || data?.data?.output;
        const lines = String(outputText).split('\n').filter((l: string) => l.trim());
        setContacts(lines.map((line: string) => ({ cn: line.trim() })));
      } else {
        setContacts([]);
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('contacts.failedLoad')));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  const showContact = useCallback((name: string) => {
    setSelectedContact(name);
    setDetailDialogOpen(true);
    // Find the contact from already-loaded data by cn
    const found = contacts.find(c => c.cn === name);
    setContactDetails(found || null);
  }, [contacts]);

  // Open the move dialog for a contact — used by both mobile cards and the
  // desktop table action cell to avoid duplicating the dialog-open logic.
  const openMoveDialog = useCallback((name: string) => {
    setMoveContactName(name);
    setMoveTarget('');
    setMoveDialogOpen(true);
  }, []);

  // Open the rename dialog for a contact — used by both mobile cards and the
  // desktop table action cell. Pre-fills the rename input with the current
  // cn so the user can edit it in place.
  const openRenameDialog = useCallback((name: string) => {
    setRenameContactName(name);
    setRenameValue(name);
    setRenameDialogOpen(true);
  }, []);

  const createContact = useCallback(async () => {
    try {
      const body: Record<string, string> = {};
      if (newContact.contactname) body.contactname = newContact.contactname;
      if (newContact.contactou) body.contactou = newContact.contactou;
      if (newContact.surname) body.surname = newContact.surname;
      if (newContact.given_name) body.given_name = newContact.given_name;
      if (newContact.display_name) body.display_name = newContact.display_name;
      if (newContact.mail_address) body.mail_address = newContact.mail_address;
      if (newContact.telephone_number) body.telephone_number = newContact.telephone_number;
      if (newContact.description) body.description = newContact.description;
      await api.post('/contacts/', body);
      toast.success(t('contacts.contactCreated'));
      setCreateDialogOpen(false);
      setNewContact({
        contactname: '', contactou: '', surname: '', given_name: '',
        display_name: '', mail_address: '', telephone_number: '', description: '',
      });
      loadContacts();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('contacts.failedCreate')));
    }
  }, [newContact, loadContacts]);

  const deleteContact = useCallback(async (name: string) => {
    if (!confirm(t('contacts.confirmDelete', { name }))) return;
    try {
      await api.delete(`/contacts/${encodeURIComponent(name)}`);
      toast.success(t('contacts.contactDeleted'));
      loadContacts();
      if (selectedContact === name) { setSelectedContact(null); setDetailDialogOpen(false); }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('contacts.failedDelete')));
    }
  }, [loadContacts, selectedContact]);

  const moveContact = useCallback(async () => {
    if (!moveContactName || !moveTarget) return;
    try {
      await api.post(`/contacts/${encodeURIComponent(moveContactName)}/move`, { new_parent_dn: moveTarget });
      toast.success(`Contact moved to ${moveTarget}`);
      setMoveDialogOpen(false);
      setMoveTarget('');
      setMoveContactName('');
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('contacts.failedMove')));
    }
  }, [moveTarget]);

  const renameContact = useCallback(async () => {
    if (!renameContactName || !renameValue) return;
    try {
      await api.post(`/contacts/${encodeURIComponent(renameContactName)}/rename`, { new_name: renameValue });
      toast.success(`Contact renamed to ${renameValue}`);
      setRenameDialogOpen(false);
      setRenameValue('');
      setRenameContactName('');
      loadContacts();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('contacts.failedRename')));
    }
  }, [renameValue, loadContacts]);

  const filteredContacts = contacts.filter(c => {
    if (!searchQuery) return true;
    const name = c.cn || '';
    const email = getContactMail(c);
    const phone = getContactPhone(c);
    const desc = getContactDesc(c);
    return name.toLowerCase().includes(searchQuery.toLowerCase()) ||
           email.toLowerCase().includes(searchQuery.toLowerCase()) ||
           phone.toLowerCase().includes(searchQuery.toLowerCase()) ||
           desc.toLowerCase().includes(searchQuery.toLowerCase());
  });

  // Helper to get contact display values
  const getContactMail = (c: ContactLdapObject): string => {
    if (Array.isArray(c.mail)) return c.mail.join(', ');
    return c.mail || '';
  };

  const getContactPhone = (c: ContactLdapObject): string => {
    if (Array.isArray(c.telephoneNumber)) return c.telephoneNumber.join(', ');
    return c.telephoneNumber || '';
  };

  const getContactDesc = (c: ContactLdapObject): string => {
    if (Array.isArray(c.description)) return c.description.join(', ');
    return c.description || '';
  };

  const visibleColCount = colConfig.filter(c => c.visible).length;

  return (
    <RequirePermission permission="contact.list">
      <div className="space-y-2 md:space-y-4">
        {/* Toolbar - compact on mobile, full on desktop */}
        <div className="flex items-center gap-1 md:gap-2 flex-wrap">
          <RequirePermission permission="contact.create">
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
                  <Plus className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
                  <span className="hidden sm:inline">{t('contacts.createContact')}</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-[95vw] md:max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{t('contacts.createContact')}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('contacts.contactname')} *</Label>
                      <Input value={newContact.contactname} onChange={(e) => setNewContact(p => ({ ...p, contactname: e.target.value }))} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('contacts.contactOU')}</Label>
                      <Input value={newContact.contactou} onChange={(e) => setNewContact(p => ({ ...p, contactou: e.target.value }))} className="h-8 text-sm" placeholder="OU=Contacts,DC=example,DC=com" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('contacts.givenName')}</Label>
                      <Input value={newContact.given_name} onChange={(e) => setNewContact(p => ({ ...p, given_name: e.target.value }))} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('contacts.surname')}</Label>
                      <Input value={newContact.surname} onChange={(e) => setNewContact(p => ({ ...p, surname: e.target.value }))} className="h-8 text-sm" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('contacts.displayName')}</Label>
                    <Input value={newContact.display_name} onChange={(e) => setNewContact(p => ({ ...p, display_name: e.target.value }))} className="h-8 text-sm" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('contacts.email')}</Label>
                      <Input value={newContact.mail_address} onChange={(e) => setNewContact(p => ({ ...p, mail_address: e.target.value }))} className="h-8 text-sm" type="email" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('contacts.phone')}</Label>
                      <Input value={newContact.telephone_number} onChange={(e) => setNewContact(p => ({ ...p, telephone_number: e.target.value }))} className="h-8 text-sm" type="tel" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('common.description')}</Label>
                    <Input value={newContact.description} onChange={(e) => setNewContact(p => ({ ...p, description: e.target.value }))} className="h-8 text-sm" />
                  </div>
                  <Button onClick={createContact} disabled={!newContact.contactname} className="w-full">
                    {t('contacts.createContact')}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </RequirePermission>

          <div className="flex-1" />

          {/* Column customizer - available on all devices.
              On mobile it opens as a dialog (list of columns with checkboxes,
              drag to reorder, add custom columns). Hidden columns are hidden
              from both desktop table and mobile cards. */}
          <ColumnCustomizer
            entityType="contacts"
            columns={colConfig}
            onColumnsChange={setColConfig}
            dataKeys={contactDataKeys}
          />

          <Button variant="outline" size="sm" onClick={loadContacts} disabled={loading} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
            <RefreshCw className={`w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{t('common.refresh')}</span>
          </Button>
        </div>

        {/* Full-width search row - single field, works on all breakpoints.
            Use type="text" (not "search") to avoid native browser clear
            button overlapping our custom one. */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('contacts.search')}
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

        {/* Mobile card view - shown when isMobile (checks short screen side,
            so it works in ⟳ rotate mode too, not just narrow viewport).
            Uses max-height + overflow-y-auto so cards scroll independently
            of the page - works in both portrait and ⟳ landscape modes. */}
        {isMobile && (
        <div className="space-y-2 max-h-[calc(100vh-12rem)] overflow-y-auto pb-4" style={{ WebkitOverflowScrolling: 'touch' }}>
          {loading ? (
            <div className="text-center py-8">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {t('common.noData')}
            </div>
          ) : (
            filteredContacts.map((contact, i) => {
              const apiName = contact.cn || '';
              const displayName = contact.cn || '';
              const email = getContactMail(contact);
              const phone = getContactPhone(contact);
              const description = getContactDesc(contact);
              // Show ALL visible columns from ColumnCustomizer as metadata in the card,
              // except # and actions (handled separately). This includes custom columns
              // the user added (e.g. department, whenCreated, etc.).
              const extraCols = visibleColumns.filter(c =>
                c.key !== '#' && c.key !== 'actions' &&
                c.key !== 'cn' // already shown as displayName
              );
              return (
                <Card key={`m-${apiName}-${i}`} className="p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-shrink-0 w-9 h-9 rounded-full bg-orange-500/10 flex items-center justify-center">
                      <Phone className="w-4 h-4 text-orange-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-sm truncate block">{displayName}</span>
                      {email && (
                        <div className="text-xs text-muted-foreground truncate mt-0.5">{email}</div>
                      )}
                      {phone && (
                        <div className="text-xs text-muted-foreground truncate mt-0.5">{phone}</div>
                      )}
                      {description && (
                        <div className="text-xs text-muted-foreground truncate mt-0.5">{description}</div>
                      )}
                      {/* Extra visible columns from ColumnCustomizer.
                          Custom columns appear here as "key: value" rows. */}
                      {extraCols.length > 0 && (
                        <div className="mt-1.5 pt-1.5 border-t border-border/50 space-y-0.5">
                          {extraCols.map(col => {
                            const val = contact[col.key as keyof typeof contact];
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
                    <RequirePermission permission="contact.list">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => showContact(apiName)} title={t('common.show')}>
                        <Eye className="w-4 h-4" />
                      </Button>
                    </RequirePermission>
                    <RequirePermission permission="contact.list">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openMoveDialog(apiName)} title={t('common.move')}>
                        <FolderInput className="w-4 h-4 text-blue-400" />
                      </Button>
                    </RequirePermission>
                    <RequirePermission permission="contact.list">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openRenameDialog(apiName)} title={t('common.rename')}>
                        <PenLine className="w-4 h-4 text-blue-400" />
                      </Button>
                    </RequirePermission>
                    <RequirePermission permission="contact.delete">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteContact(apiName)} title={t('common.delete')}>
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </Button>
                    </RequirePermission>
                  </div>
                </Card>
              );
            })
          )}
        </div>
        )}

        {/* Desktop table - shown when NOT mobile (desktop / wide tablet). */}
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
                        col.key === 'cn' ? t('contacts.name') :
                        col.key === 'mail' ? t('contacts.email') :
                        col.key === 'telephoneNumber' ? t('contacts.phone') :
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
                  ) : filteredContacts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={visibleColCount} className="text-center py-8 text-muted-foreground">
                        {t('common.noData')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredContacts.map((contact, i) => {
                      const name = contact.cn || '';
                      const email = getContactMail(contact);
                      const phone = getContactPhone(contact);
                      const description = getContactDesc(contact);
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
                                    <RequirePermission permission="contact.list">
                                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => showContact(name)}>
                                        <Eye className="w-3 h-3" />
                                      </Button>
                                    </RequirePermission>
                                    <RequirePermission permission="contact.list">
                                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setRenameContactName(name); setRenameValue(name); setRenameDialogOpen(true); }}>
                                        <PenLine className="w-3 h-3" />
                                      </Button>
                                    </RequirePermission>
                                    <RequirePermission permission="contact.list">
                                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setMoveContactName(name); setMoveTarget(''); setMoveDialogOpen(true); }}>
                                        <FolderInput className="w-3 h-3" />
                                      </Button>
                                    </RequirePermission>
                                    <RequirePermission permission="contact.delete">
                                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteContact(name)}>
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
                                    <Phone className="w-4 h-4 text-violet-400" />
                                    <span className="font-medium truncate max-w-[200px]" title={name}>{name}</span>
                                  </div>
                                </TableCell>
                              );
                            }
                            if (col.key === 'mail') {
                              return (
                                <TableCell key={col.key} className="text-sm">
                                  {email ? (
                                    <div className="flex items-center gap-1">
                                      <Mail className="w-3 h-3 text-muted-foreground" />
                                      <span className="truncate max-w-[150px]">{email}</span>
                                    </div>
                                  ) : ''}
                                </TableCell>
                              );
                            }
                            if (col.key === 'telephoneNumber') {
                              return (
                                <TableCell key={col.key} className="text-sm">
                                  {phone ? (
                                    <div className="flex items-center gap-1">
                                      <Phone className="w-3 h-3 text-muted-foreground" />
                                      <span>{phone}</span>
                                    </div>
                                  ) : ''}
                                </TableCell>
                              );
                            }
                            if (col.key === 'description') {
                              return (
                                <TableCell key={col.key} className="text-sm text-muted-foreground max-w-[200px] truncate">{description}</TableCell>
                              );
                            }
                            // Generic extra column
                            const value = contact[col.key as keyof ContactLdapObject];
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

        {/* Contact Details Dialog */}
        <Dialog open={detailDialogOpen} onOpenChange={(open) => { setDetailDialogOpen(open); if (!open) setSelectedContact(null); }}>
          <DialogContent className="max-w-[95vw] md:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-violet-400" />
                {selectedContact}
              </DialogTitle>
              <DialogDescription className="sr-only">{selectedContact}</DialogDescription>
            </DialogHeader>
            {contactDetails ? (
              <ScrollArea className="max-h-[65vh]">
                <AttributeViewer
                  entityType="contacts"
                  data={contactDetails as Record<string, unknown>}
                  keyInfoKeys={['cn', 'mail', 'telephoneNumber', 'description', 'displayName', 'status']}
                  showCustomize={true}
                />
              </ScrollArea>
            ) : (
              <div className="py-8 text-center">
                <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Move Contact Dialog */}
        <Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
          <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t('contacts.moveContact')}</DialogTitle>
              <DialogDescription className="sr-only">{t('contacts.moveContact')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">{t('contacts.newParentDN')}: {moveContactName}</Label>
                <Input value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)} className="h-8 text-sm" placeholder="OU=Contacts,DC=example,DC=com" />
              </div>
              <Button onClick={moveContact} disabled={!moveTarget} className="w-full">{t('contacts.moveContact')}</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Rename Contact Dialog */}
        <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
          <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t('contacts.renameContact')}: {renameContactName}</DialogTitle>
              <DialogDescription className="sr-only">{t('contacts.renameContact')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">{t('contacts.newName')} *</Label>
                <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="h-8 text-sm" />
              </div>
              <Button onClick={renameContact} disabled={!renameValue} className="w-full">{t('contacts.renameContact')}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </RequirePermission>
  );
}
