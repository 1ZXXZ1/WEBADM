'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useETLStore } from '@/stores/etl-store';
import { API_OPERATIONS, CATEGORIES } from '@/lib/api-operations';
import api from '@/lib/api';
import type { ETLStep, FieldMapping, BatchResponse, ParamDef, StepLink } from '@/types';
import {
  Play, Save, FolderOpen, Trash2, FileUp, Download, Plus, Loader2,
  CheckCircle2, XCircle, AlertCircle, Link2, Search, Minus, X,
  UserPlus, Users, FolderPlus, FolderMinus, Globe, Terminal, Shield,
  Monitor, Contact, Server, KeyRound, Lock, PenLine, Eye, List,
  Crown, HardDrive, GitBranch, ArrowRight, ChevronDown, ChevronUp,
  GripVertical, ArrowDown, Zap, Settings2, Database, FileCode,
  RefreshCw, Unlink, Info, BarChart3, ArrowUp, LayoutDashboard,
  CalendarClock, FolderInput, UserMinus, UserCheck, UserX, ShieldAlert,
  Plug, ArrowRightLeft, FilePlus, FileMinus, Trash,
  Activity, Layers, LogIn, LogOut, MapPin, Clock, HeartPulse,
  ShieldCheck, ShieldX, ScrollText, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { toast } from 'sonner';
import { safeToastMessage } from '@/lib/parsers';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS as DndCSS } from '@dnd-kit/utilities';
import * as XLSX from 'xlsx';
import { useIsMobile } from '@/hooks/use-mobile';
import { useOrientation } from '@/hooks/use-orientation';


// ─── Log Entry ────────────────────────────────────────────────────────────
interface LogEntry {
  timestamp: string;
  level: 'info' | 'success' | 'error' | 'warn' | 'data';
  message: string;
}

// ─── Connection state for visual mapping ──────────────────────────────────
interface PortInfo {
  type: 'source' | 'target';
  id: string;
  stepId: string;
}

// ─── Category visual config ───────────────────────────────────────────────
const CATEGORY_COLORS: Record<string, string> = {
  users: 'border-l-blue-500',
  groups: 'border-l-green-500',
  contacts: 'border-l-teal-500',
  computers: 'border-l-cyan-500',
  dns: 'border-l-purple-500',
  ou: 'border-l-orange-500',
  shell: 'border-l-red-500',
  domain: 'border-l-yellow-500',
  drs: 'border-l-indigo-500',
  fsmo: 'border-l-amber-500',
  gpo: 'border-l-pink-500',
  delegation: 'border-l-lime-500',
  'service-accounts': 'border-l-violet-500',
  sites: 'border-l-sky-500',
  'shell-project': 'border-l-rose-500',
  tasks: 'border-l-slate-500',
  misc: 'border-l-gray-500',
  system: 'border-l-emerald-500',
  auth: 'border-l-fuchsia-500',
  management: 'border-l-stone-500',
  batch: 'border-l-zinc-500',
  'auth-policy': 'border-l-rose-400',
  schema: 'border-l-neutral-500',
  ai: 'border-l-blue-400',
};

const CATEGORY_DOT_COLORS: Record<string, string> = {
  users: 'bg-blue-500',
  groups: 'bg-green-500',
  contacts: 'bg-teal-500',
  computers: 'bg-cyan-500',
  dns: 'bg-purple-500',
  ou: 'bg-orange-500',
  shell: 'bg-red-500',
  domain: 'bg-yellow-500',
  drs: 'bg-indigo-500',
  fsmo: 'bg-amber-500',
  gpo: 'bg-pink-500',
  delegation: 'bg-lime-500',
  'service-accounts': 'bg-violet-500',
  sites: 'bg-sky-500',
  'shell-project': 'bg-rose-500',
  tasks: 'bg-slate-500',
  misc: 'bg-gray-500',
  system: 'bg-emerald-500',
  auth: 'bg-fuchsia-500',
  management: 'bg-stone-500',
  batch: 'bg-zinc-500',
  'auth-policy': 'bg-rose-400',
  schema: 'bg-neutral-500',
  ai: 'bg-blue-400',
};

const CATEGORY_ICON_MAP: Record<string, React.ElementType> = {
  users: Users,
  groups: FolderPlus,
  contacts: Contact,
  computers: Monitor,
  dns: Globe,
  ou: FolderPlus,
  shell: Terminal,
  domain: Info,
  drs: RefreshCw,
  fsmo: Crown,
  gpo: FilePlus,
  delegation: Shield,
  'service-accounts': Server,
  sites: Globe,
  'shell-project': FileCode,
  tasks: CheckCircle2,
  misc: Settings2,
  system: Activity,
  auth: Lock,
  management: Settings2,
  batch: Layers,
  'auth-policy': Shield,
  schema: Database,
  ai: Sparkles,
};

// ─── Column-to-param auto-detection mapping rules ─────────────────────────
const AUTO_MAPPING_RULES: Record<string, Record<string, string[]>> = {
  'user.create': {
    username: ['login', 'username', 'user', 'user_name', 'login_name'],
    password: ['password', 'pass', 'pwd', 'пароль'],
    given_name: ['full_name', 'given_name', 'firstname', 'first_name', 'name', 'имя'],
    mail_address: ['email', 'mail', 'mail_address', 'e_mail', 'почта'],
    surname: ['surname', 'last_name', 'lastname', 'family_name', 'фамилия'],
    department: ['department', 'dept', 'отдел'],
    job_title: ['title', 'job_title', 'position', 'должность'],
    company: ['company', 'org', 'organization', 'компания'],
    description: ['description', 'desc', 'описание'],
    telephone_number: ['phone', 'tel', 'telephone', 'телефон'],
    internet_address: ['internet_address', 'url', 'website', 'веб'],
    initials: ['initials', 'init', 'инициалы', 'отчество', 'middlename', 'patronymic'],
    userou: ['ou', 'userou', 'ou_name', 'подразделение'],
    login_shell: ['shell', 'login_shell', 'shell_path'],
    unix_home: ['unix_home', 'home_dir', 'unix_home_dir'],
    uid: ['uid', 'uid_name'],
    uid_number: ['uid_number', 'uid_num', 'uid_no'],
    gid_number: ['gid_number', 'gid_num', 'gid_no'],
    gecos: ['gecos', 'full_name_gecos'],
    nis_domain: ['nis_domain', 'nis', 'nisdomain'],
  },
  'computer.create': {
    computername: ['name', 'computer', 'computer_name', 'hostname', 'host'],
  },
  'group.create': {
    groupname: ['name', 'group', 'group_name', 'группа'],
    description: ['description', 'desc', 'описание'],
  },
  'ou.create': {
    ouname: ['name', 'ou', 'ou_name', 'подразделение'],
    description: ['description', 'desc', 'описание'],
  },
  'contact.create': {
    contactname: ['name', 'contact', 'contact_name', 'контакт'],
    surname: ['surname', 'last_name', 'lastname', 'фамилия'],
    given_name: ['given_name', 'firstname', 'first_name', 'имя'],
    mail_address: ['email', 'mail', 'почта'],
    telephone_number: ['phone', 'tel', 'telephone', 'телефон'],
    description: ['description', 'desc', 'описание'],
  },
  'service-account.create': {
    accountname: ['name', 'account', 'account_name', 'аккаунт'],
    dns_host_name: ['dns_host_name', 'hostname', 'host', 'dns'],
  },
  'dns.record.create': {
    zone: ['zone', 'dns_zone', 'зона'],
    name: ['name', 'record_name', 'record'],
    data: ['data', 'value', 'ip', 'address'],
  },
  'domain.trust.create': {
    trusted_domain: ['domain', 'trusted_domain', 'trust', 'домен'],
  },
  'delegation.add': {
    accountname: ['account', 'accountname', 'user', 'username', 'аккаунт'],
    service: ['service', 'spn', 'сервис'],
  },
};

// ─── Sortable Step Card ───────────────────────────────────────────────────
function SortableStepCard({
  step,
  index,
  isSelected,
  onSelect,
  onRemove,
  onLink,
  hasMissingRequired,
}: {
  step: ETLStep;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onLink: () => void;
  hasMissingRequired: boolean;
}) {
  const { t } = useTranslation();
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: step.id });

  const style: React.CSSProperties = {
    transform: DndCSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : 'auto' as const,
  };

  const borderColor = CATEGORY_COLORS[step.category] || 'border-l-gray-500';
  const IconComponent = CATEGORY_ICON_MAP[step.category] || Settings2;
  const dotColor = CATEGORY_DOT_COLORS[step.category] || 'bg-gray-500';

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      transition={{ duration: 0.2 }}
    >
      <Card
        className={`cursor-pointer border-l-4 ${borderColor} ${
          isSelected
            ? 'ring-2 ring-primary shadow-md'
            : 'hover:shadow-sm hover:ring-1 hover:ring-primary/30'
        } transition-all`}
        onClick={onSelect}
      >
        <CardContent className="p-3">
          <div className="flex items-center gap-2">
            {/* Drag handle */}
            <div
              {...attributes}
              {...listeners}
              className="cursor-grab active:cursor-grabbing p-0.5 hover:bg-accent rounded touch-none"
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical className="w-4 h-4 text-muted-foreground" />
            </div>

            {/* Step number badge */}
            <Badge variant="outline" className="h-5 w-5 p-0 flex items-center justify-center text-[10px] font-bold shrink-0">
              {index + 1}
            </Badge>

            {/* Linked indicator */}
            {step.linkedFrom && (
              <div className="w-4 h-4 rounded flex items-center justify-center bg-emerald-500/20 shrink-0" title={t('tasks.linkedFrom') || 'Linked'}>
                <Link2 className="w-3 h-3 text-emerald-500" />
              </div>
            )}

            {/* Category icon */}
            <div className={`w-6 h-6 rounded flex items-center justify-center ${dotColor}/10`}>
              <IconComponent className="w-3.5 h-3.5 text-muted-foreground" />
            </div>

            {/* Step label */}
            <span className="text-xs font-medium truncate flex-1">{step.label}</span>

            {/* Status indicator */}
            {hasMissingRequired && (
              <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" title={t('tasks.missingRequired') || 'Required fields not filled'} />
            )}

            {/* Link button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-emerald-500"
              onClick={(e) => { e.stopPropagation(); onLink(); }}
              title={t('tasks.linkStep') || 'Link step'}
            >
              <Link2 className="w-3.5 h-3.5" />
            </Button>

            {/* Delete button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-red-500"
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              title={t('tasks.deleteStep') || 'Delete step'}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────
export default function ETLBuilder() {
  const { t } = useTranslation();
  // useIsMobile checks the SHORT side of the screen, so it returns true
  // even when a phone is rotated to landscape (e.g. Oppo Reno 11F in ⟳ mode:
  // viewport ~920×412, short side 412 < 768 → still mobile).
  const isMobile = useIsMobile();
  // effectiveLandscape: true when device is in landscape (natural or ⟳ forced).
  const { effectiveLandscape } = useOrientation();
  const isLandscapeMobile = isMobile && effectiveLandscape;
  const {
    steps, selectedStepId, importedData,
    addStep, removeStep, updateStep, reorderSteps,
    setSelectedStep, setFieldMappings, setImportedData, removeImportedRow,
    clearWorkbench, saveRecipe, loadRecipe, hydrate,
  } = useETLStore();

  const [isRunning, setIsRunning] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchResponse | null>(null);
  const [recipeName, setRecipeName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recipeFileRef = useRef<HTMLInputElement>(null);
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [showResultPreview, setShowResultPreview] = useState(false);
  const [saveRecipeDialogOpen, setSaveRecipeDialogOpen] = useState(false);
  const [addParamDialogOpen, setAddParamDialogOpen] = useState(false);
  const [importWindowOpen, setImportWindowOpen] = useState(false);
  const [importWindowTab, setImportWindowTab] = useState('file');
  const [paramSearch, setParamSearch] = useState('');

  // Log terminal state
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Visual connection state
  const [connectingFrom, setConnectingFrom] = useState<PortInfo | null>(null);
  const [hoveredPort, setHoveredPort] = useState<string | null>(null);
  const mappingContainerRef = useRef<HTMLDivElement>(null);
  const [svgLines, setSvgLines] = useState<{ x1: number; y1: number; x2: number; y2: number; key: string }[]>([]);

  // Command popover state for "+" between steps
  const [addBetweenOpen, setAddBetweenOpen] = useState<number | null>(null);
  const [commandSearch, setCommandSearch] = useState('');

  // Step linking state
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkTargetStepId, setLinkTargetStepId] = useState<string | null>(null);
  const [linkFieldMap, setLinkFieldMap] = useState<Record<string, string>>({});

  // Server import state
  const [serverImportOpen, setServerImportOpen] = useState(false);
  const [serverImportTab, setServerImportTab] = useState<string>('users');
  const [serverImportData, setServerImportData] = useState<Record<string, unknown>[]>([]);
  const [serverImportLoading, setServerImportLoading] = useState(false);
  const [serverImportSelected, setServerImportSelected] = useState<Set<number>>(new Set());

  // Operations modal state
  const [operationsModalOpen, setOperationsModalOpen] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [modalSearch, setModalSearch] = useState('');

  // Left panel collapsible sections
  const [csvSectionOpen, setCsvSectionOpen] = useState(true);
  const [apiSectionOpen, setApiSectionOpen] = useState(true);
  const [mappingsSectionOpen, setMappingsSectionOpen] = useState(true);



  const selectedStep = steps.find(s => s.id === selectedStepId);
  const hasActiveMapping = selectedStep && importedData.length > 0 && selectedStep.fieldMappings.length > 0;

  // ─── DnD Sensors ──────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = steps.findIndex(s => s.id === active.id);
      const newIndex = steps.findIndex(s => s.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        reorderSteps(oldIndex, newIndex);
      }
    }
  }, [steps, reorderSteps]);

  // ─── Hydrate from localStorage on mount ──────────────────────────────────
  useEffect(() => {
    hydrate();
    try {
      const savedResult = localStorage.getItem('etl-batch-result');
      if (savedResult) setBatchResult(JSON.parse(savedResult));
    } catch {}
  }, [hydrate]);

  // ─── Persist batchResult to localStorage ──────────────────────────────────
  useEffect(() => {
    if (batchResult) {
      try { localStorage.setItem('etl-batch-result', JSON.stringify(batchResult)); } catch {}
    } else {
      try { localStorage.removeItem('etl-batch-result'); } catch {}
    }
  }, [batchResult]);

  // ─── Auto-scroll log to bottom ──────────────────────────────────────────
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logEntries]);

  // ─── Reset param search when selected step changes ─────────────────────────
  useEffect(() => {
    setParamSearch('');
  }, [selectedStepId]);

  // ─── Auto-open operations modal when pipeline is empty ──────────────────
  useEffect(() => {
    if (steps.length === 0) {
      setOperationsModalOpen(true);
    }
  }, [steps.length]);

  // ─── Auto-expand left panel sections based on state ────────────────────
  useEffect(() => {
    setCsvSectionOpen(importedData.length > 0);
    setApiSectionOpen(!!selectedStep);
    setMappingsSectionOpen(selectedStep ? selectedStep.fieldMappings.length > 0 : false);
  }, [importedData.length, selectedStepId]);

  // ─── Add Step ────────────────────────────────────────────────────────────
  const handleAddStep = useCallback((operationIndex: number) => {
    const op = API_OPERATIONS[operationIndex];
    const step: ETLStep = {
      id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      method: op.method,
      category: op.category,
      label: op.label,
      params: {},
      fieldMappings: [],
    };
    addStep(step);
    setSelectedStep(step.id);
    setOperationsModalOpen(false);
    setModalSearch('');
  }, [addStep, setSelectedStep]);

  // ─── Add step at specific position ────────────────────────────────────────
  const handleAddStepAtIndex = useCallback((operationIndex: number, insertIndex: number) => {
    const op = API_OPERATIONS[operationIndex];
    const step: ETLStep = {
      id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      method: op.method,
      category: op.category,
      label: op.label,
      params: {},
      fieldMappings: [],
    };
    addStep(step);
    setSelectedStep(step.id);
    setAddBetweenOpen(null);
    setCommandSearch('');
    setTimeout(() => {
      const store = useETLStore.getState();
      const newSteps = [...store.steps];
      const addedStepIdx = newSteps.length - 1;
      if (insertIndex < addedStepIdx) {
        useETLStore.getState().reorderSteps(addedStepIdx, insertIndex);
      }
    }, 0);
  }, [addStep, setSelectedStep]);

  // ─── Auto-setup field mappings ───────────────────────────────────────────
  const autoSetupMappings = useCallback((stepId: string, method: string, columns: string[]) => {
    const rules = AUTO_MAPPING_RULES[method];
    if (!rules) return;
    const mappings: FieldMapping[] = [];
    for (const [apiField, patterns] of Object.entries(rules)) {
      const matchedCol = columns.find(col =>
        patterns.some(pattern =>
          col.toLowerCase().replace(/[\s_-]/g, '') === pattern.replace(/[\s_-]/g, '') ||
          col.toLowerCase().includes(pattern.toLowerCase())
        )
      );
      if (matchedCol) {
        mappings.push({ csvColumn: matchedCol, apiField, enabled: true });
      }
    }
    if (mappings.length > 0) {
      setFieldMappings(stepId, mappings);
    }
  }, [setFieldMappings]);

  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await file.arrayBuffer();
      const ext = file.name.split('.').pop()?.toLowerCase();
      let parsed: Record<string, string>[];

      if (ext === 'xlsx' || ext === 'xls') {
        const wb = XLSX.read(data);
        const ws = wb.Sheets[wb.SheetNames[0]];
        parsed = XLSX.utils.sheet_to_json(ws);
      } else if (ext === 'json') {
        const text = new TextDecoder().decode(data);
        parsed = JSON.parse(text);
      } else {
        const text = new TextDecoder().decode(data);
        const lines = text.trim().split('\n');
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        parsed = lines.slice(1).map(line => {
          const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
          const row: Record<string, string> = {};
          headers.forEach((h, i) => { row[h] = values[i] || ''; });
          return row;
        });
      }

      setImportedData(parsed);
      const columns = Object.keys(parsed[0] || {});
      const store = useETLStore.getState();
      for (const step of store.steps) {
        if (step.fieldMappings.length === 0) {
          autoSetupMappings(step.id, step.method, columns);
        }
      }
      toast.success(t('tasks.importSuccess', { count: parsed.length, name: file.name }) || `Imported ${parsed.length} rows`);
    } catch (err) {
      toast.error(safeToastMessage((err as Error).message, t('tasks.importFailed') || 'Import failed'));
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [setImportedData, autoSetupMappings, t]);

  // ─── Auto-create steps from import ──────────────────────────────────────
  const handleAutoCreateSteps = useCallback(() => {
    if (importedData.length === 0) return;
    const templateStep = steps.find(s => s.fieldMappings.length > 0);
    if (!templateStep) {
      toast.error(t('tasks.noTemplateStep') || 'Add an operation and setup field mappings first');
      return;
    }
    const op = API_OPERATIONS.find(o => o.method === templateStep.method);
    if (!op) return;
    const enabledMappings = templateStep.fieldMappings.filter(m => m.enabled !== false);
    let createdCount = 0;
    for (const row of importedData) {
      const params: Record<string, unknown> = {};
      for (const mapping of enabledMappings) {
        let val = row[mapping.csvColumn];
        if (val !== undefined && val !== '') {
          // Transform patronymic (отчество) to AD initials format
          if (mapping.apiField === 'initials' && typeof val === 'string' && val.length > 3) {
            val = val.trim().split(/\s+/).map(p => p.charAt(0).toUpperCase() + '.').join('');
          }
          params[mapping.apiField] = val;
        }
      }
      for (const [key, val] of Object.entries(templateStep.params)) {
        if (!params[key] && val) params[key] = val;
      }
      const identifier = params.username || params.computername || params.groupname || params.ouname || `Row ${createdCount + 1}`;
      const step: ETLStep = {
        id: `step_${Date.now()}_${createdCount}_${Math.random().toString(36).slice(2, 7)}`,
        method: op.method,
        category: op.category,
        label: `${op.label.split('/')[0].trim()} — ${identifier}`,
        params,
        fieldMappings: [],
      };
      addStep(step);
      createdCount++;
    }
    toast.success(t('tasks.autoCreated', { count: createdCount }) || `Created ${createdCount} tasks`);
  }, [importedData, steps, addStep, t]);

  const handleExport = useCallback(() => {
    if (!batchResult) return;
    const blob = new Blob([JSON.stringify(batchResult, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `batch-result-${batchResult.batch_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [batchResult]);

  // ─── Add log entry helper ──────────────────────────────────────────────
  const addLog = useCallback((level: LogEntry['level'], message: string) => {
    setLogEntries(prev => [...prev, { timestamp: new Date().toISOString().substr(11, 12), level, message }]);
  }, []);

  // ─── Run Batch ───────────────────────────────────────────────────────────
  const handleRunBatch = useCallback(async () => {
    if (steps.length === 0) return;
    setIsRunning(true);
    setBatchResult(null);
    setLogEntries([]);
    addLog('info', t('tasks.logRunning') || 'Running batch...');

    try {
      const actions: { id: string; method: string; params: Record<string, unknown>; timeout: number }[] = [];
      const actionMeta: { stepId: string; stepIdx: number; rowIdx?: number }[] = [];

      for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
        const step = steps[stepIdx];
        const enabledMappings = step.fieldMappings.filter(m => m.enabled !== false);

        // Resolve linkedFrom params
        let linkedParams: Record<string, unknown> = {};
        if (step.linkedFrom) {
          const sourceStep = steps.find(s => s.id === step.linkedFrom!.stepId);
          if (sourceStep) {
            // Use source step's params as linked output
            for (const [sourceField, targetParam] of Object.entries(step.linkedFrom.fieldMap)) {
              const sourceVal = sourceStep.params[sourceField];
              if (sourceVal !== undefined && sourceVal !== '') {
                linkedParams[targetParam] = sourceVal;
              }
            }
          }
        }

        if (importedData.length > 0 && enabledMappings.length > 0) {
          for (let rowIdx = 0; rowIdx < importedData.length; rowIdx++) {
            const row = importedData[rowIdx];
            const params = { ...step.params, ...linkedParams };
            for (const mapping of enabledMappings) {
              let val = row[mapping.csvColumn];
              if (val !== undefined && val !== '') {
                // Transform patronymic (отчество) to AD initials format
                // AD rejects full patronymic (e.g. "Александрович") as initials — must be "А."
                if (mapping.apiField === 'initials' && typeof val === 'string' && val.length > 3) {
                  val = val.trim().split(/\s+/).map(p => p.charAt(0).toUpperCase() + '.').join('');
                }
                params[mapping.apiField] = val;
              }
            }
            const actionId = `step${stepIdx + 1}_row${rowIdx + 1}`;
            actions.push({ id: actionId, method: step.method, params, timeout: 60 });
            actionMeta.push({ stepId: step.id, stepIdx, rowIdx });
            addLog('info', t('tasks.logStepStart', { id: actionId, method: step.method }) || `Step ${actionId}: Starting ${step.method}...`);
          }
        } else {
          const params = { ...step.params, ...linkedParams };
          const actionId = `step${stepIdx + 1}`;
          actions.push({ id: actionId, method: step.method, params, timeout: 60 });
          actionMeta.push({ stepId: step.id, stepIdx });
          addLog('info', t('tasks.logStepStart', { id: actionId, method: step.method }) || `Step ${actionId}: Starting ${step.method}...`);
        }
      }

      const response = await api.post('/batch/', { actions, stop_on_failure: false, rollback_on_failure: false, default_timeout: 60 });
      setBatchResult(response.data);

      // Log results with full server output
      for (const stepResult of response.data.steps) {
        if (stepResult.status === 'success') {
          addLog('success', t('tasks.logStepSuccess', { id: stepResult.id || stepResult.step, method: stepResult.method }) || `Step ${stepResult.id}: SUCCESS`);
          // Log full server output if available — parse LDAP-style JSON attributes
          if (stepResult.output) {
            if (typeof stepResult.output === 'object' && stepResult.output !== null) {
              const output = stepResult.output as Record<string, unknown>;
              addLog('data', t('tasks.logServerResponse') || 'Server Response');
              for (const [key, value] of Object.entries(output)) {
                if (Array.isArray(value)) {
                  for (const v of value) {
                    addLog('data', `  ${key}: ${v}`);
                  }
                } else {
                  addLog('data', `  ${key}: ${value}`);
                }
              }
            } else {
              const outputStr = String(stepResult.output);
              if (outputStr.trim()) {
                addLog('data', outputStr);
              }
            }
          }
        } else {
          addLog('error', t('tasks.logStepError', { id: stepResult.id || stepResult.step, method: stepResult.method, error: stepResult.error || '' }) || `Step ${stepResult.id}: ERROR — ${stepResult.error}`);
          // Log error details if available
          if (stepResult.output) {
            if (typeof stepResult.output === 'object' && stepResult.output !== null) {
              const output = stepResult.output as Record<string, unknown>;
              addLog('data', t('tasks.logServerResponse') || 'Server Response');
              for (const [key, value] of Object.entries(output)) {
                if (Array.isArray(value)) {
                  for (const v of value) {
                    addLog('data', `  ${key}: ${v}`);
                  }
                } else {
                  addLog('data', `  ${key}: ${value}`);
                }
              }
            } else {
              const outputStr = String(stepResult.output);
              if (outputStr.trim()) {
                addLog('data', outputStr);
              }
            }
          }
        }
      }
      addLog('success', t('tasks.logBatchComplete', { ok: response.data.successful_steps, total: response.data.total_steps }) || `Batch complete: ${response.data.successful_steps}/${response.data.total_steps} successful`);

      toast.success(t('tasks.batchCompleted', { ok: response.data.successful_steps, total: response.data.total_steps }) || `Batch completed`);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string; detail?: string } }; message?: string };
      const errMsg = error?.response?.data?.detail || error?.message || 'Unknown error';
      addLog('error', errMsg);
      toast.error(safeToastMessage(errMsg, t('tasks.batchFailed') || 'Batch failed'));
    } finally {
      setIsRunning(false);
    }
  }, [steps, importedData, t, addLog]);

  const handleSaveRecipe = useCallback(() => {
    if (!recipeName) return;
    const recipe = saveRecipe(recipeName);
    const blob = new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${recipeName}.recipe.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('tasks.recipeSaved') || `Recipe saved`);
    setRecipeName('');
    setSaveRecipeDialogOpen(false);
  }, [recipeName, saveRecipe, t]);

  const handleLoadRecipe = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const recipe = JSON.parse(text);
      loadRecipe(recipe);
      toast.success(t('tasks.recipeLoaded') || `Recipe loaded`);
    } catch {
      toast.error(safeToastMessage(undefined, t('tasks.recipeLoadFailed') || 'Failed to load recipe'));
    }
  }, [loadRecipe, t]);

  const csvColumns = importedData.length > 0 ? Object.keys(importedData[0]) : [];

  // ─── Port / Mapping Logic ────────────────────────────────────────────────
  const handlePortClick = useCallback((port: PortInfo) => {
    if (!connectingFrom) {
      setConnectingFrom(port);
    } else {
      if (connectingFrom.type === port.type) { setConnectingFrom(port); return; }
      if (!selectedStep) return;
      const sourcePort = connectingFrom.type === 'source' ? connectingFrom : port;
      const targetPort = connectingFrom.type === 'target' ? connectingFrom : port;
      const existingMappings = selectedStep.fieldMappings.filter(m => m.apiField !== targetPort.id);
      existingMappings.push({ csvColumn: sourcePort.id, apiField: targetPort.id, enabled: true });
      setFieldMappings(selectedStep.id, existingMappings);
      setConnectingFrom(null);
    }
  }, [connectingFrom, selectedStep, setFieldMappings]);

  const removeMapping = useCallback((stepId: string, apiField: string) => {
    const step = steps.find(s => s.id === stepId);
    if (!step) return;
    setFieldMappings(stepId, step.fieldMappings.filter(m => m.apiField !== apiField));
  }, [steps, setFieldMappings]);

  const toggleMappingEnabled = useCallback((stepId: string, apiField: string) => {
    const step = steps.find(s => s.id === stepId);
    if (!step) return;
    setFieldMappings(stepId, step.fieldMappings.map(m =>
      m.apiField === apiField ? { ...m, enabled: m.enabled === false ? true : false } : m
    ));
  }, [steps, setFieldMappings]);

  // ─── SVG Line Calculation ────────────────────────────────────────────────
  const updateSvgLines = useCallback(() => {
    if (!selectedStep || !mappingContainerRef.current) { setSvgLines([]); return; }
    const container = mappingContainerRef.current;
    const containerRect = container.getBoundingClientRect();
    const lines: { x1: number; y1: number; x2: number; y2: number; key: string }[] = [];
    for (const mapping of selectedStep.fieldMappings) {
      if (mapping.enabled === false) continue;
      const sourceEl = container.querySelector(`[data-port-type="source"][data-port-id="${globalThis.CSS?.escape(mapping.csvColumn) ?? mapping.csvColumn}"]`);
      const targetEl = container.querySelector(`[data-port-type="target"][data-port-id="${globalThis.CSS?.escape(mapping.apiField) ?? mapping.apiField}"]`);
      if (sourceEl && targetEl) {
        const sourceRect = sourceEl.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        lines.push({
          x1: sourceRect.right - containerRect.left,
          y1: sourceRect.top + sourceRect.height / 2 - containerRect.top,
          x2: targetRect.left - containerRect.left,
          y2: targetRect.top + targetRect.height / 2 - containerRect.top,
          key: `${mapping.csvColumn}->${mapping.apiField}`,
        });
      }
    }
    setSvgLines(lines);
  }, [selectedStep]);

  useEffect(() => {
    updateSvgLines();
    window.addEventListener('resize', updateSvgLines);
    return () => window.removeEventListener('resize', updateSvgLines);
  }, [updateSvgLines, selectedStep?.fieldMappings, importedData, selectedStepId]);

  // ─── Output Table Data ───────────────────────────────────────────────────
  const outputTableData = useMemo(() => {
    if (!batchResult?.steps) return null;
    const rows: Record<string, string>[] = [];
    for (const step of batchResult.steps) {
      const output = step.output;
      if (output && typeof output === 'object') {
        if (Array.isArray(output)) {
          for (const item of output) {
            if (typeof item === 'object' && item !== null) {
              rows.push(Object.fromEntries(Object.entries(item).map(([k, v]) => [k, String(v)])));
            } else { rows.push({ value: String(item) }); }
          }
        } else {
          rows.push(Object.fromEntries(Object.entries(output as Record<string, unknown>).map(([k, v]) => [k, String(v)])));
        }
      } else if (output) { rows.push({ output: String(output) }); }
    }
    return rows;
  }, [batchResult]);

  const outputColumns = useMemo(() => {
    if (!outputTableData || outputTableData.length === 0) return [];
    return Object.keys(outputTableData[0]);
  }, [outputTableData]);

  const totalActionsCount = useMemo(() => {
    let count = 0;
    for (const step of steps) {
      const enabledMappings = step.fieldMappings.filter(m => m.enabled !== false);
      count += (importedData.length > 0 && enabledMappings.length > 0) ? importedData.length : 1;
    }
    return count;
  }, [steps, importedData]);

  // ─── Step params: visible vs hidden ──────────────────────────────────────
  const currentOp = selectedStep ? API_OPERATIONS.find(op => op.method === selectedStep.method) : null;
  const visibleParams = currentOp?.params || [];
  const outputFields = currentOp?.outputFields || [];
  const requiredParams = visibleParams.filter(p => p.required);
  const optionalParams = visibleParams.filter(p => !p.required);
  const hiddenOptionalParams = optionalParams.filter(p =>
    selectedStep?.params[p.name] === undefined
  );

  const handleAddOptionalParam = useCallback((paramName: string) => {
    if (!selectedStep) return;
    // Find the param to get its default value
    const paramDef = optionalParams.find(p => p.name === paramName);
    const defaultValue = paramDef?.type === 'boolean' ? (paramDef.default ?? false) : (paramDef?.default ?? '');
    updateStep(selectedStep.id, { params: { ...selectedStep.params, [paramName]: defaultValue } });
    setAddParamDialogOpen(false);
  }, [selectedStep, updateStep, optionalParams]);

  // ─── Render single param input ───────────────────────────────────────────
  const renderParamInput = (param: ParamDef, step: ETLStep, isAdvanced = false) => {
    if (param.type === 'select') {
      return (
        <Select
          value={String(step.params[param.name] ?? param.default ?? '')}
          onValueChange={(v) => updateStep(step.id, { params: { ...step.params, [param.name]: v } })}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {param.options?.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    if (param.type === 'boolean') {
      // Fix 4: Render boolean params as toggle buttons in advanced tab for non-required with default:false
      if (isAdvanced && !param.required && param.default === false) {
        const isActive = !!(step.params[param.name] ?? param.default ?? false);
        return (
          <Button
            type="button"
            variant={isActive ? 'default' : 'outline'}
            size="sm"
            className={`h-8 text-xs gap-1.5 w-full justify-start ${isActive ? 'bg-primary text-primary-foreground' : ''}`}
            onClick={() => updateStep(step.id, { params: { ...step.params, [param.name]: !isActive } })}
          >
            {isActive ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5 opacity-40" />}
            {param.label}
          </Button>
        );
      }
      return (
        <div className="flex items-center gap-2">
          <Switch
            checked={!!(step.params[param.name] ?? param.default ?? false)}
            onCheckedChange={(v) => updateStep(step.id, { params: { ...step.params, [param.name]: v } })}
          />
          <span className="text-xs text-muted-foreground">
            {(step.params[param.name] ?? param.default ?? false) ? 'true' : 'false'}
          </span>
        </div>
      );
    }
    return (
      <Input
        className="h-8 text-xs"
        type={param.type === 'number' ? 'number' : 'text'}
        value={String(step.params[param.name] ?? '')}
        autoComplete="off"
        onChange={(e) => updateStep(step.id, {
          params: { ...step.params, [param.name]: param.type === 'number' ? Number(e.target.value) : e.target.value }
        })}
        placeholder={String(param.default ?? '')}
      />
    );
  };

  // ─── Check if step has missing required fields ───────────────────────────
  const hasMissingRequiredFields = useCallback((step: ETLStep) => {
    const op = API_OPERATIONS.find(o => o.method === step.method);
    if (!op) return false;
    return op.params.some(p => p.required && (!step.params[p.name] || step.params[p.name] === ''));
  }, []);

  // ─── Filtered operations for command search ──────────────────────────────
  const filteredOperations = useMemo(() => {
    if (!commandSearch.trim()) return API_OPERATIONS;
    const q = commandSearch.toLowerCase();
    return API_OPERATIONS.filter(op =>
      op.label.toLowerCase().includes(q) ||
      op.method.toLowerCase().includes(q) ||
      op.category.toLowerCase().includes(q)
    );
  }, [commandSearch]);

  // ─── Filtered operations for modal search ─────────────────────────────────
  const modalFilteredOperations = useMemo(() => {
    if (!modalSearch.trim()) return API_OPERATIONS;
    const q = modalSearch.toLowerCase();
    return API_OPERATIONS.filter(op =>
      op.label.toLowerCase().includes(q) ||
      op.method.toLowerCase().includes(q) ||
      op.category.toLowerCase().includes(q)
    );
  }, [modalSearch]);

  // ─── Auto-expand categories when searching in modal ─────────────────────
  useEffect(() => {
    if (modalSearch.trim()) {
      const matchingCats = new Set<string>();
      for (const op of modalFilteredOperations) {
        matchingCats.add(op.category);
      }
      setExpandedCategories(matchingCats);
    }
  }, [modalSearch, modalFilteredOperations]);

  // ─── Step Linking ──────────────────────────────────────────────────────
  const handleOpenLinkDialog = useCallback((stepId: string) => {
    const step = steps.find(s => s.id === stepId);
    if (!step) return;
    setLinkTargetStepId(stepId);
    setLinkFieldMap(step.linkedFrom?.fieldMap || {});
    setLinkDialogOpen(true);
  }, [steps]);

  const handleSaveLink = useCallback(() => {
    if (!linkTargetStepId) return;
    // Find source step from the selected linkedFrom step
    const sourceStepId = linkFieldMap['_sourceStepId'] as string;
    if (!sourceStepId) {
      // Remove link
      updateStep(linkTargetStepId, { linkedFrom: undefined });
    } else {
      const cleanMap: Record<string, string> = {};
      for (const [k, v] of Object.entries(linkFieldMap)) {
        if (k !== '_sourceStepId' && v) cleanMap[k] = v;
      }
      updateStep(linkTargetStepId, { linkedFrom: { stepId: sourceStepId, fieldMap: cleanMap } });
    }
    setLinkDialogOpen(false);
    setLinkTargetStepId(null);
    setLinkFieldMap({});
  }, [linkTargetStepId, linkFieldMap, updateStep]);

  // ─── Server Import ──────────────────────────────────────────────────────
  const handleServerImport = useCallback(async (tab: string) => {
    setServerImportLoading(true);
    setServerImportData([]);
    setServerImportSelected(new Set());
    try {
      const endpoint = tab === 'users' ? '/users/' : tab === 'groups' ? '/groups/' : tab === 'computers' ? '/computers/' : '/contacts/';
      const response = await api.get(endpoint);
      const data = Array.isArray(response.data) ? response.data : (response.data?.users || response.data?.groups || response.data?.computers || response.data?.contacts || []);
      setServerImportData(data);
    } catch {
      toast.error(t('tasks.importFailed') || 'Import failed');
    } finally {
      setServerImportLoading(false);
    }
  }, [t]);

  const handleImportSelectedFromServer = useCallback(() => {
    if (serverImportSelected.size === 0) return;
    const rows: Record<string, string>[] = [];
    for (const idx of serverImportSelected) {
      const item = serverImportData[idx];
      if (item && typeof item === 'object') {
        const row: Record<string, string> = {};
        for (const [k, v] of Object.entries(item)) {
          row[k] = String(v ?? '');
        }
        rows.push(row);
      }
    }
    if (rows.length > 0) {
      // Merge with existing imported data
      const merged = [...importedData, ...rows];
      setImportedData(merged);
      const columns = Object.keys(rows[0] || {});
      const store = useETLStore.getState();
      for (const step of store.steps) {
        if (step.fieldMappings.length === 0) {
          autoSetupMappings(step.id, step.method, columns);
        }
      }
      toast.success(t('tasks.importSuccess', { count: rows.length, name: 'Server' }) || `Imported ${rows.length} rows`);
    }
    setServerImportOpen(false);
    setServerImportSelected(new Set());
  }, [serverImportSelected, serverImportData, importedData, setImportedData, autoSetupMappings, t]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Toolbar (two-row layout for better space usage)
  // ═══════════════════════════════════════════════════════════════════════════
  const renderToolbar = () => (
    <div className="border-b bg-background">
      {/* Row 1: Main actions — mobile-adapted: flex-wrap + gap-1 md:gap-2,
          button labels wrapped in <span className="hidden sm:inline"> so
          only icons show on narrow screens. */}
      <div className="flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1.5 flex-wrap">
        <Button
          variant="default"
          size="sm"
          className="h-8 md:h-9 px-2 md:px-3 gap-1.5 text-xs md:text-sm"
          onClick={handleRunBatch}
          disabled={isRunning || steps.length === 0}
        >
          {isRunning ? <Loader2 className="w-3.5 h-3.5 md:w-4 md:h-4 animate-spin" /> : <Play className="w-3.5 h-3.5 md:w-4 md:h-4" />}
          <span className="hidden sm:inline">{t('tasks.run') || 'Run'}</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-8 md:h-9 px-2 md:px-3 gap-1.5 text-xs md:text-sm"
          onClick={() => fileInputRef.current?.click()}
        >
          <FileUp className="w-3.5 h-3.5 md:w-4 md:h-4" />
          <span className="hidden sm:inline">{t('tasks.import') || 'Import'}</span>
          {importedData.length > 0 && (
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{importedData.length}</Badge>
          )}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv,.json"
          className="hidden"
          onChange={handleImportFile}
        />

        <Button
          variant="outline"
          size="sm"
          className="h-8 md:h-9 px-2 md:px-3 gap-1.5 text-xs md:text-sm"
          onClick={() => { setServerImportOpen(true); setServerImportTab('users'); handleServerImport('users'); }}
        >
          <Server className="w-3.5 h-3.5 md:w-4 md:h-4" />
          <span className="hidden sm:inline">{t('tasks.serverImport') || 'Server Import'}</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-8 md:h-9 px-2 md:px-3 gap-1.5 text-xs md:text-sm"
          onClick={handleExport}
          disabled={!batchResult}
        >
          <Download className="w-3.5 h-3.5 md:w-4 md:h-4" />
          <span className="hidden sm:inline">{t('tasks.export') || 'Export'}</span>
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-8 md:h-9 px-2 md:px-3 gap-1.5 text-xs md:text-sm text-destructive hover:text-destructive"
          onClick={clearWorkbench}
          disabled={steps.length === 0 && importedData.length === 0}
        >
          <Trash2 className="w-3.5 h-3.5 md:w-4 md:h-4" />
          <span className="hidden sm:inline">{t('common.clear') || 'Clear'}</span>
        </Button>

        <div className="flex-1" />



        {/* Batch status */}
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] gap-1">
            <Zap className="w-3 h-3" />
            {totalActionsCount} {t('tasks.actions') || 'actions'}
          </Badge>
          {importedData.length > 0 && (
            <Badge variant="secondary" className="text-[10px] gap-1">
              <Database className="w-3 h-3" />
              {importedData.length} {t('tasks.rows') || 'rows'}
            </Badge>
          )}
          {importedData.length > 0 && steps.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] gap-1"
              onClick={handleAutoCreateSteps}
            >
              <Plus className="w-3 h-3" />
              {t('tasks.autoCreate') || 'Auto-create'}
            </Button>
          )}
        </div>
      </div>

      {/* Row 2: Recipe management + search — mobile-adapted with flex-wrap. */}
      <div className="flex items-center gap-1 md:gap-1.5 px-2 md:px-3 py-1 border-t bg-muted/30 flex-wrap">
        <div className="relative flex items-center w-full sm:w-auto sm:flex-initial">
          <Search className="absolute left-1.5 w-3 h-3 text-muted-foreground pointer-events-none" />
          <Input
            className="h-8 md:h-7 pl-6 text-xs w-full sm:w-auto md:max-w-[160px]"
            placeholder={t('tasks.recipeNamePlaceholder') || 'Recipe name...'}
            value={recipeName}
            onChange={(e) => setRecipeName(e.target.value)}
          />
        </div>

        <Dialog open={saveRecipeDialogOpen} onOpenChange={setSaveRecipeDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={steps.length === 0} title={t('tasks.saveRecipe') || 'Save Recipe'}>
              <Save className="w-3.5 h-3.5" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t('tasks.saveRecipe') || 'Save Recipe'}</DialogTitle>
              <DialogDescription>{t('tasks.enterRecipeName') || 'Enter recipe name'}</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 py-2">
              <Input
                value={recipeName}
                onChange={(e) => setRecipeName(e.target.value)}
                placeholder={t('tasks.recipeNameShortPlaceholder') || 'Name...'}
                className="flex-1 h-9 text-sm"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveRecipe(); }}
              />
              <Button onClick={handleSaveRecipe} disabled={!recipeName}>{t('common.save') || 'Save'}</Button>
            </div>
          </DialogContent>
        </Dialog>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => recipeFileRef.current?.click()}
          title={t('tasks.loadRecipe') || 'Load Recipe'}
        >
          <FolderOpen className="w-3.5 h-3.5" />
        </Button>
        <input
          ref={recipeFileRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleLoadRecipe}
        />

        <div className="flex-1" />

        <Badge variant="outline" className="text-[10px] gap-1">
          <GitBranch className="w-3 h-3" />
          {steps.length} {t('tasks.steps') || 'steps'}
        </Badge>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Operations Modal (Dialog)
  // ═══════════════════════════════════════════════════════════════════════════
  const renderOperationsModal = () => (
    <Dialog open={operationsModalOpen} onOpenChange={(open) => { setOperationsModalOpen(open); if (!open) setModalSearch(''); }}>
      <DialogContent className="max-w-[95vw] md:max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            {t('tasks.operationsModal') || 'Select Operation'}
          </DialogTitle>
          <DialogDescription>
            {t('tasks.dragOrClick') || 'Click an operation to add it to the pipeline'}
          </DialogDescription>
        </DialogHeader>

        {/* Search input */}
        <div className="relative shrink-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            className="h-8 pl-8 text-xs"
            placeholder={t('tasks.searchOperation') || 'Search operation...'}
            value={modalSearch}
            onChange={(e) => setModalSearch(e.target.value)}
            autoFocus
          />
        </div>

        {/* Categories with collapsible sections */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-1 space-y-1">
            {CATEGORIES.map((cat) => {
              const catOps = modalFilteredOperations.filter(op => op.category === cat.id);
              if (catOps.length === 0) return null;
              const isExpanded = expandedCategories.has(cat.id);
              const CatIcon = CATEGORY_ICON_MAP[cat.id] || Settings2;
              const dotColor = CATEGORY_DOT_COLORS[cat.id] || 'bg-gray-500';

              return (
                <Collapsible
                  key={cat.id}
                  open={isExpanded}
                  onOpenChange={(open) => {
                    setExpandedCategories(prev => {
                      const next = new Set(prev);
                      if (open) next.add(cat.id);
                      else next.delete(cat.id);
                      return next;
                    });
                  }}
                >
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      className="w-full h-7 justify-start gap-2 px-2 text-xs hover:bg-accent/50"
                    >
                      <div className={`w-2 h-2 rounded-full ${dotColor}`} />
                      <CatIcon className="w-3 h-3 text-muted-foreground" />
                      <span className="font-medium text-muted-foreground uppercase tracking-wider text-[10px] truncate flex-1 text-left">
                        {cat.label}
                      </span>
                      <Badge variant="secondary" className="text-[9px] h-4 px-1.5 shrink-0">
                        {catOps.length}
                      </Badge>
                      {isExpanded ? (
                        <ChevronUp className="w-3 h-3 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="space-y-0.5 pl-2 pb-1">
                      {catOps.map((op) => {
                        const globalIdx = API_OPERATIONS.indexOf(op);
                        return (
                          <Card
                            key={op.method}
                            className={`cursor-pointer hover:bg-accent/50 transition-colors border-l-2 py-0 ${CATEGORY_COLORS[cat.id] || 'border-l-gray-500'}`}
                            onClick={() => handleAddStep(globalIdx)}
                          >
                            <CardContent className="p-1.5 flex items-center gap-1.5">
                              <span className="text-[11px] truncate">{op.label}</span>
                              <span className="text-[9px] text-muted-foreground font-mono ml-auto shrink-0">{op.method}</span>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Left Panel (Data Sources)
  // ═══════════════════════════════════════════════════════════════════════════
  const renderLeftPanel = () => (
    <div className="flex flex-col h-full border rounded-md overflow-hidden">
      <div className="p-2 border-b shrink-0">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5" />
          {t('tasks.dataSources') || 'Data Sources'}
        </h2>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-1.5 space-y-1">

          {/* Section 1: CSV Columns */}
          <Collapsible open={csvSectionOpen} onOpenChange={setCsvSectionOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full h-6 justify-start gap-1.5 px-2 text-[11px] hover:bg-accent/50">
                {csvSectionOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                <FileCode className="w-3 h-3 text-muted-foreground" />
                <span className="font-medium text-muted-foreground">{t('tasks.csvColumns') || 'CSV Columns'}</span>
                {csvColumns.length > 0 && (
                  <Badge variant="secondary" className="text-[9px] h-3.5 px-1 ml-auto">{csvColumns.length}</Badge>
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-0.5 pl-1 pb-1">
                {importedData.length === 0 ? (
                  <div className="px-2 py-3 text-center">
                    <FileUp className="w-5 h-5 text-muted-foreground mx-auto mb-1" />
                    <p className="text-[10px] text-muted-foreground">
                      {t('tasks.noCsvData') || 'Import data for mapping'}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[10px] mt-1.5 gap-1"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <FileUp className="w-2.5 h-2.5" />
                      {t('tasks.import') || 'Import'}
                    </Button>
                  </div>
                ) : (
                  csvColumns.map(col => {
                    const isConnected = selectedStep?.fieldMappings.some(m => m.csvColumn === col && m.enabled !== false);
                    return (
                      <div
                        key={col}
                        data-port-type="source"
                        data-port-id={col}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] cursor-pointer transition-colors ${
                          isConnected ? 'bg-emerald-500/10 border border-emerald-500/20' :
                          connectingFrom?.id === col && connectingFrom?.type === 'source' ? 'ring-2 ring-primary' :
                          'hover:bg-accent'
                        }`}
                        onClick={() => {
                          if (selectedStep) {
                            handlePortClick({ type: 'source', id: col, stepId: selectedStep.id });
                          }
                        }}
                      >
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isConnected ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                        <span className="truncate flex-1">{col}</span>
                        {isConnected && <Link2 className="w-3 h-3 text-emerald-500 shrink-0" />}
                      </div>
                    );
                  })
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Separator />

          {/* Section 2: API Fields (Inputs + Outputs) */}
          <Collapsible open={apiSectionOpen} onOpenChange={setApiSectionOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full h-6 justify-start gap-1.5 px-2 text-[11px] hover:bg-accent/50">
                {apiSectionOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                <Settings2 className="w-3 h-3 text-muted-foreground" />
                <span className="font-medium text-muted-foreground">{t('tasks.apiFields') || 'API Fields'}</span>
                {selectedStep && (visibleParams.length + outputFields.length) > 0 && (
                  <Badge variant="secondary" className="text-[9px] h-3.5 px-1 ml-auto">{visibleParams.length + outputFields.length}</Badge>
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-0.5 pl-1 pb-1">
                {!selectedStep ? (
                  <div className="px-2 py-3 text-center">
                    <ArrowRight className="w-5 h-5 text-muted-foreground mx-auto mb-1" />
                    <p className="text-[10px] text-muted-foreground">
                      {t('tasks.noStepSelected') || 'Select a step'}
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Input fields label */}
                    {visibleParams.length > 0 && (
                      <div className="flex items-center gap-1 px-2 pt-1 pb-0.5">
                        <ArrowRight className="w-2.5 h-2.5 text-blue-400 shrink-0" />
                        <span className="text-[9px] font-medium text-blue-500 dark:text-blue-400 uppercase tracking-wider">{t('tasks.inputFields') || 'Inputs'}</span>
                        <Badge variant="outline" className="text-[8px] h-3 px-0.5 ml-auto">{visibleParams.length}</Badge>
                      </div>
                    )}
                    {visibleParams.map(param => {
                      const mapping = selectedStep.fieldMappings.find(m => m.apiField === param.name);
                      const isConnected = !!mapping && mapping.enabled !== false;
                      return (
                        <div
                          key={param.name}
                          data-port-type="target"
                          data-port-id={param.name}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] cursor-pointer transition-colors ${
                            isConnected ? 'bg-emerald-500/10 border border-emerald-500/20' :
                            connectingFrom?.id === param.name && connectingFrom?.type === 'target' ? 'ring-2 ring-primary' :
                            'hover:bg-accent'
                          }`}
                          onClick={() => handlePortClick({ type: 'target', id: param.name, stepId: selectedStep.id })}
                        >
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isConnected ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                          <span className="truncate flex-1">{param.label}</span>
                          {param.required && <span className="text-red-500 text-[9px] shrink-0">*</span>}
                          {isConnected && (
                            <span className="text-[9px] text-emerald-600 dark:text-emerald-400 shrink-0 truncate max-w-[60px]">← {mapping!.csvColumn}</span>
                          )}
                        </div>
                      );
                    })}

                    {/* Output fields */}
                    {outputFields.length > 0 && (
                      <>
                        <div className="flex items-center gap-1 px-2 pt-1.5 pb-0.5">
                          <ArrowDown className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                          <span className="text-[9px] font-medium text-amber-500 dark:text-amber-400 uppercase tracking-wider">{t('tasks.outputFields') || 'Outputs'}</span>
                          <Badge variant="outline" className="text-[8px] h-3 px-0.5 ml-auto">{outputFields.length}</Badge>
                        </div>
                        {outputFields.map(field => (
                          <div
                            key={`out-${field.name}`}
                            className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] hover:bg-amber-500/5 transition-colors"
                          >
                            <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-amber-400/60" />
                            <span className="truncate flex-1 text-muted-foreground">{field.label}</span>
                            <span className="text-[8px] text-amber-500/70 shrink-0">out</span>
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Separator />

          {/* Section 3: Active Mappings */}
          <Collapsible open={mappingsSectionOpen} onOpenChange={setMappingsSectionOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full h-6 justify-start gap-1.5 px-2 text-[11px] hover:bg-accent/50">
                {mappingsSectionOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                <Link2 className="w-3 h-3 text-muted-foreground" />
                <span className="font-medium text-muted-foreground">{t('tasks.activeMappings') || 'Active Mappings'}</span>
                {selectedStep && selectedStep.fieldMappings.length > 0 && (
                  <Badge variant="secondary" className="text-[9px] h-3.5 px-1 ml-auto">{selectedStep.fieldMappings.length}</Badge>
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-0.5 pl-1 pb-1">
                {!selectedStep ? (
                  <p className="text-[10px] text-muted-foreground px-2 py-2">{t('tasks.noStepSelected') || 'Select a step'}</p>
                ) : selectedStep.fieldMappings.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground px-2 py-2">{t('tasks.importFirst') || 'Import a file first to set up field mapping'}</p>
                ) : (
                  selectedStep.fieldMappings.map(mapping => {
                    // Detect patronymic→initials auto-transform
                    const isPatronymicTransform = mapping.apiField === 'initials' &&
                      ['отчество', 'middlename', 'patronymic'].includes(mapping.csvColumn.toLowerCase());
                    return (
                    <div
                      key={`${mapping.csvColumn}->${mapping.apiField}`}
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border ${
                        mapping.enabled === false ? 'border-border opacity-50' : 'border-emerald-500/20 bg-emerald-500/5'
                      }`}
                    >
                      <Checkbox
                        checked={mapping.enabled !== false}
                        onCheckedChange={() => toggleMappingEnabled(selectedStep.id, mapping.apiField)}
                        className="h-2.5 w-2.5"
                      />
                      <span className="truncate flex-1">{mapping.csvColumn}</span>
                      <ArrowRight className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
                      <span className="truncate flex-1">{mapping.apiField}</span>
                      {isPatronymicTransform && (
                        <span className="text-[8px] text-amber-500 dark:text-amber-400 shrink-0" title="Автопреобразование: Иванович → И.">⚡</span>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-3.5 w-3.5 ml-auto shrink-0"
                        onClick={() => removeMapping(selectedStep.id, mapping.apiField)}
                      >
                        <X className="w-2 h-2 text-red-400" />
                      </Button>
                    </div>
                  );})
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Connection status indicator */}
          {connectingFrom && (
            <div className="flex items-center gap-1.5 p-1.5 bg-primary/10 rounded text-[10px] text-primary mt-1">
              <Link2 className="w-3 h-3" />
              {connectingFrom.type === 'source'
                ? (t('tasks.clickTargetField') || 'Click an API field to connect')
                : (t('tasks.clickSourceField') || 'Click a CSV column to connect')
              }
              <Button variant="ghost" size="sm" className="h-4 text-[9px] ml-auto px-1" onClick={() => setConnectingFrom(null)}>
                {t('common.cancel') || 'Cancel'}
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Center Panel (Canvas)
  // ═══════════════════════════════════════════════════════════════════════════
  const renderCanvas = () => (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b flex items-center justify-between">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <GitBranch className="w-4 h-4" />
          {t('tasks.pipeline') || 'Pipeline'}
        </h2>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            {steps.length} {t('tasks.steps') || 'steps'}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px] gap-1"
            onClick={() => setOperationsModalOpen(true)}
          >
            <Plus className="w-3 h-3" />
            {t('tasks.addOperation') || 'Add Operation'}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4">
          {steps.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <button
                className="w-20 h-20 rounded-full bg-primary/10 hover:bg-primary/20 border-2 border-dashed border-primary/30 hover:border-primary/50 flex items-center justify-center mb-4 transition-colors cursor-pointer"
                onClick={() => setOperationsModalOpen(true)}
              >
                <Plus className="w-10 h-10 text-primary/60" />
              </button>
              <p className="text-base font-medium text-muted-foreground mb-1">
                {t('tasks.noSteps') || 'No steps yet'}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('tasks.addOperation') || 'Add an operation to get started'}
              </p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={steps.map(s => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <AnimatePresence mode="popLayout">
                  {steps.map((step, idx) => (
                    <React.Fragment key={step.id}>
                      {/* "+" connector before first step or between steps */}
                      {idx === 0 && (
                        <div className="flex justify-center mb-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 rounded-full border border-dashed border-muted-foreground/30 hover:border-primary hover:bg-primary/10"
                            onClick={() => { setAddBetweenOpen(0); setOperationsModalOpen(true); }}
                          >
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                      )}

                      {/* Step card */}
                      <SortableStepCard
                        step={step}
                        index={idx}
                        isSelected={step.id === selectedStepId}
                        onSelect={() => setSelectedStep(step.id)}
                        onRemove={() => removeStep(step.id)}
                        onLink={() => handleOpenLinkDialog(step.id)}
                        hasMissingRequired={hasMissingRequiredFields(step)}
                      />

                      {/* Connector line + "+" between steps */}
                      {idx < steps.length - 1 && (
                        <div className="flex flex-col items-center py-1">
                          {/* Connector line */}
                          <div className="w-px h-4 bg-border" />
                          {/* Linked indicator line */}
                          {step.linkedFrom?.stepId === steps[idx + 1]?.id && (
                            <div className="flex items-center gap-1 py-0.5">
                              <Link2 className="w-3 h-3 text-emerald-500" />
                            </div>
                          )}
                          {/* Arrow */}
                          <ArrowDown className="w-3 h-3 text-muted-foreground -mt-1" />
                          {/* "+" button */}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 rounded-full border border-dashed border-muted-foreground/30 hover:border-primary hover:bg-primary/10 my-0.5"
                            onClick={() => { setAddBetweenOpen(idx + 1); setOperationsModalOpen(true); }}
                          >
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                      )}

                      {/* End connector for last step */}
                      {idx === steps.length - 1 && (
                        <div className="flex justify-center mt-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 rounded-full border border-dashed border-muted-foreground/30 hover:border-primary hover:bg-primary/10"
                            onClick={() => { setAddBetweenOpen(steps.length); setOperationsModalOpen(true); }}
                          >
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                      )}
                    </React.Fragment>
                  ))}
                </AnimatePresence>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </ScrollArea>

      {/* Import Preview / Output Section */}
      {(importedData.length > 0 || batchResult) && (
        <div className="border-t">
          <div className="flex items-center border-b">
            {importedData.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className={`h-8 text-xs rounded-none border-b-2 ${showImportPreview ? 'border-primary' : 'border-transparent'}`}
                onClick={() => { setShowImportPreview(true); setShowResultPreview(false); }}
              >
                <Database className="w-3 h-3 mr-1" />
                {t('tasks.importedData') || 'Imported'} ({importedData.length})
              </Button>
            )}
            {batchResult && (
              <Button
                variant="ghost"
                size="sm"
                className={`h-8 text-xs rounded-none border-b-2 ${showResultPreview ? 'border-primary' : 'border-transparent'}`}
                onClick={() => { setShowResultPreview(true); setShowImportPreview(false); }}
              >
                <CheckCircle2 className="w-3 h-3 mr-1" />
                {t('tasks.results') || 'Results'} ({batchResult.successful_steps}/{batchResult.total_steps})
              </Button>
            )}
          </div>

          {showImportPreview && importedData.length > 0 && (
            <ScrollArea className="max-h-48">
              <div className="p-2">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-1 text-muted-foreground">#</th>
                      {csvColumns.slice(0, 6).map(col => (
                        <th key={col} className="text-left p-1 text-muted-foreground truncate max-w-[100px]">{col}</th>
                      ))}
                      <th className="p-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {importedData.slice(0, 10).map((row, rowIdx) => (
                      <tr key={rowIdx} className="border-b hover:bg-accent/30">
                        <td className="p-1 text-muted-foreground">{rowIdx + 1}</td>
                        {csvColumns.slice(0, 6).map(col => (
                          <td key={col} className="p-1 truncate max-w-[100px]">{row[col]}</td>
                        ))}
                        <td className="p-1">
                          <Button variant="ghost" size="icon" className="h-4 w-4" onClick={() => removeImportedRow(rowIdx)}>
                            <X className="w-2.5 h-2.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {importedData.length > 10 && (
                  <p className="text-[10px] text-muted-foreground text-center py-1">
                    {t('tasks.moreRows', { count: importedData.length - 10 }) || `... and ${importedData.length - 10} more rows`}
                  </p>
                )}
              </div>
            </ScrollArea>
          )}

          {showResultPreview && batchResult && (
            <ScrollArea className="max-h-48">
              <div className="p-2 space-y-1">
                {batchResult.steps.map((step, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-[10px] py-1 px-2 rounded hover:bg-accent/30">
                    {step.status === 'success' ? (
                      <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="w-3 h-3 text-red-500 shrink-0" />
                    )}
                    <span className="font-mono text-muted-foreground">{step.id || `Step ${step.step}`}</span>
                    <span className="text-muted-foreground">{step.method}</span>
                    <span className="flex-1" />
                    <Badge variant={step.status === 'success' ? 'default' : 'destructive'} className="text-[9px] h-4">
                      {step.status === 'success' ? 'OK' : 'ERR'}
                    </Badge>
                    {step.error && (
                      <span className="text-red-500 truncate max-w-[200px]" title={step.error}>{step.error}</span>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      )}
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Right Panel (Properties)
  // ═══════════════════════════════════════════════════════════════════════════
  const renderProperties = () => (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b shrink-0 flex items-center justify-between">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Settings2 className="w-4 h-4" />
          {t('tasks.properties') || 'Properties'}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => setOperationsModalOpen(true)}
          title={t('tasks.addOperation') || 'Add Operation'}
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      {!selectedStep ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
            <ArrowRight className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            {t('tasks.selectStep') || 'Select a step to edit'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {t('tasks.clickStepHint') || 'Click a step card in the pipeline'}
          </p>
        </div>
      ) : (
        <Tabs defaultValue="basic" className="flex-1 flex flex-col min-h-0">
          <div className="px-3 pt-2">
            {/* Active mapping info banner */}
            {hasActiveMapping && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded p-2 mb-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <Link2 className="w-3 h-3" />
                  {t('tasks.mappedFromImport') || 'Mapped from import'}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {t('tasks.willProcessRows', { count: importedData.length }) || `${importedData.length} rows`}
                </div>
              </div>
            )}

            {/* Linked step info banner */}
            {selectedStep.linkedFrom && (
              <div className="bg-blue-500/10 border border-blue-500/20 rounded p-2 mb-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400">
                  <Link2 className="w-3 h-3" />
                  {t('tasks.linkedFrom') || 'Linked from'}: {steps.find(s => s.id === selectedStep.linkedFrom!.stepId)?.label || 'Unknown'}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {Object.entries(selectedStep.linkedFrom.fieldMap).map(([src, tgt]) => `${src} → ${tgt}`).join(', ')}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 text-[10px] mt-1 text-red-400 hover:text-red-500"
                  onClick={() => updateStep(selectedStep.id, { linkedFrom: undefined })}
                >
                  <Unlink className="w-3 h-3 mr-1" />
                  {t('tasks.removeLink') || 'Remove link'}
                </Button>
              </div>
            )}

            {/* Step info */}
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className="text-[10px]">{selectedStep.category}</Badge>
              <span className="text-xs text-muted-foreground font-mono">{selectedStep.method}</span>
            </div>

            <TabsList className="w-full">
              <TabsTrigger value="basic" className="text-[11px] flex-1 px-1">
                {t('tasks.basic') || 'Basic'}
              </TabsTrigger>
              <TabsTrigger value="advanced" className="text-[11px] flex-1 px-1">
                {t('tasks.advanced') || 'Advanced'}
              </TabsTrigger>
              <TabsTrigger value="mapping" className="text-[11px] flex-1 px-1">
                {t('tasks.mapping') || 'Mapping'}
              </TabsTrigger>
              <TabsTrigger value="log" className="text-[11px] flex-1 px-1">
                {t('tasks.log') || 'Log'}
              </TabsTrigger>
            </TabsList>
            {/* Second row: Import Data tab */}
            <div className="mt-1">
              <Button
                variant="outline"
                size="sm"
                className="w-full h-7 text-[11px] gap-1.5"
                onClick={() => { setImportWindowOpen(true); setImportWindowTab('file'); }}
              >
                <Database className="w-3 h-3" />
                {t('tasks.importDataTab') || 'Import Data'}
              </Button>
            </div>
            {/* Parameter search */}
            <div className="relative mt-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <Input
                className="h-6 pl-6 text-[11px]"
                placeholder={t('tasks.paramSearch') || 'Search parameters...'}
                value={paramSearch}
                onChange={(e) => setParamSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Basic Tab: Required params */}
          <TabsContent value="basic" className="flex-1 overflow-hidden mt-0 min-h-0">
            <ScrollArea className="h-full">
              <div className="p-3 space-y-3">
                {requiredParams.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    {t('tasks.noRequiredParams') || 'No required parameters'}
                  </p>
                )}
                {requiredParams.filter(p => !paramSearch.trim() || p.label.toLowerCase().includes(paramSearch.toLowerCase()) || p.name.toLowerCase().includes(paramSearch.toLowerCase())).map((param) => {
                  const mapping = selectedStep.fieldMappings.find(m => m.apiField === param.name);
                  const isMapped = !!mapping && mapping.enabled !== false;
                  const isDisabledMapping = !!mapping && mapping.enabled === false;
                  return (
                    <div key={param.name} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs flex items-center gap-1.5">
                          {isMapped && (
                            <Checkbox checked={true} onCheckedChange={() => toggleMappingEnabled(selectedStep.id, param.name)} className="h-3 w-3" />
                          )}
                          {isDisabledMapping && (
                            <Checkbox checked={false} onCheckedChange={() => toggleMappingEnabled(selectedStep.id, param.name)} className="h-3 w-3" />
                          )}
                          {param.label}
                          <span className="text-red-500">*</span>
                        </Label>
                        <div className="flex items-center gap-0.5">
                          {mapping && (
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeMapping(selectedStep.id, param.name)} title={t('common.delete') || 'Delete mapping'}>
                              <Minus className="w-2.5 h-2.5 text-red-400" />
                            </Button>
                          )}
                          {!mapping && (
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => {
                              const newParams = { ...selectedStep.params };
                              delete newParams[param.name];
                              updateStep(selectedStep.id, { params: newParams });
                            }} title={t('common.delete') || 'Clear'}>
                              <Minus className="w-2.5 h-2.5 text-red-400" />
                            </Button>
                          )}
                        </div>
                      </div>
                      {/* Mapping indicator */}
                      {isMapped && (
                        <div className="flex items-center gap-1 h-6 px-2 bg-muted/50 rounded border border-emerald-500/20 text-xs">
                          <span className="text-emerald-600 dark:text-emerald-400">← {mapping!.csvColumn}</span>
                        </div>
                      )}
                      {isDisabledMapping && (
                        <div className="flex items-center gap-1 h-6 px-2 bg-muted/50 rounded border border-border text-xs opacity-50">
                          <span className="text-muted-foreground">← {mapping!.csvColumn} ({t('tasks.disabledMapping') || 'disabled'})</span>
                        </div>
                      )}
                      {renderParamInput(param, selectedStep)}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Advanced Tab: Optional params — Fix 4: Boolean toggle buttons, Fix 5: Add parameter dialog */}
          <TabsContent value="advanced" className="flex-1 overflow-hidden mt-0 min-h-0">
            <ScrollArea className="h-full">
              <div className="p-3 space-y-3">
                {/* Show visible optional params */}
                {optionalParams.filter(p => !paramSearch.trim() || p.label.toLowerCase().includes(paramSearch.toLowerCase()) || p.name.toLowerCase().includes(paramSearch.toLowerCase())).map((param) => {
                  const mapping = selectedStep.fieldMappings.find(m => m.apiField === param.name);
                  const isMapped = !!mapping && mapping.enabled !== false;
                  const isDisabledMapping = !!mapping && mapping.enabled === false;
                  const hasValue = selectedStep.params[param.name] !== undefined && selectedStep.params[param.name] !== '';
                  if (!isMapped && !isDisabledMapping && !hasValue) return null;

                  return (
                    <div key={param.name} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs flex items-center gap-1.5">
                          {isMapped && (
                            <Checkbox checked={true} onCheckedChange={() => toggleMappingEnabled(selectedStep.id, param.name)} className="h-3 w-3" />
                          )}
                          {isDisabledMapping && (
                            <Checkbox checked={false} onCheckedChange={() => toggleMappingEnabled(selectedStep.id, param.name)} className="h-3 w-3" />
                          )}
                          {param.type !== 'boolean' && param.label}
                        </Label>
                        <div className="flex items-center gap-0.5">
                          {mapping && (
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeMapping(selectedStep.id, param.name)} title={t('common.delete') || 'Delete mapping'}>
                              <Minus className="w-2.5 h-2.5 text-red-400" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => {
                            const newParams = { ...selectedStep.params };
                            delete newParams[param.name];
                            updateStep(selectedStep.id, { params: newParams });
                          }} title={t('common.delete') || 'Delete'}>
                            <Minus className="w-2.5 h-2.5 text-red-400" />
                          </Button>
                        </div>
                      </div>
                      {isMapped && (
                        <div className="flex items-center gap-1 h-6 px-2 bg-muted/50 rounded border border-emerald-500/20 text-xs">
                          <span className="text-emerald-600 dark:text-emerald-400">← {mapping!.csvColumn}</span>
                        </div>
                      )}
                      {isDisabledMapping && (
                        <div className="flex items-center gap-1 h-6 px-2 bg-muted/50 rounded border border-border text-xs opacity-50">
                          <span className="text-muted-foreground">← {mapping!.csvColumn} ({t('tasks.disabledMapping') || 'disabled'})</span>
                        </div>
                      )}
                      {renderParamInput(param, selectedStep, true)}
                    </div>
                  );
                })}

                {/* Fix 5: Add parameter dialog — visible and functional */}
                {hiddenOptionalParams.length > 0 && (
                  <Dialog open={addParamDialogOpen} onOpenChange={setAddParamDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" className="w-full h-8 text-xs gap-1.5">
                        <Plus className="w-3.5 h-3.5" />
                        {t('tasks.addParameter') || 'Add parameter'} ({hiddenOptionalParams.length})
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>{t('tasks.addParameter') || 'Add parameter'}</DialogTitle>
                        <DialogDescription>{t('tasks.selectParameter') || 'Select a parameter to add'}</DialogDescription>
                      </DialogHeader>
                      <ScrollArea className="max-h-60">
                        <div className="space-y-1 p-1">
                          {hiddenOptionalParams.filter(p => !paramSearch.trim() || p.label.toLowerCase().includes(paramSearch.toLowerCase()) || p.name.toLowerCase().includes(paramSearch.toLowerCase())).map(param => (
                            <Button
                              key={param.name}
                              variant="ghost"
                              className="w-full justify-start text-xs h-8"
                              onClick={() => handleAddOptionalParam(param.name)}
                            >
                              {param.label}
                              {param.type === 'boolean' && <Badge variant="secondary" className="ml-2 text-[9px] h-4">bool</Badge>}
                              {param.type === 'number' && <Badge variant="secondary" className="ml-2 text-[9px] h-4">num</Badge>}
                            </Button>
                          ))}
                        </div>
                      </ScrollArea>
                    </DialogContent>
                  </Dialog>
                )}

                {optionalParams.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    {t('tasks.noOptionalParams') || 'No optional parameters'}
                  </p>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Mapping Tab: Field Mapping — Improved layout with summary + collapsible sections */}
          <TabsContent value="mapping" className="flex-1 overflow-hidden mt-0 min-h-0">
            <ScrollArea className="h-full">
              <div className="p-3 space-y-3 relative" ref={mappingContainerRef}>
                {/* SVG overlay for mapping lines */}
                {svgLines.length > 0 && (
                  <svg className="absolute inset-0 pointer-events-none" style={{ width: '100%', height: '100%' }}>
                    {svgLines.map(line => (
                      <line
                        key={line.key}
                        x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
                        stroke="currentColor"
                        className="text-emerald-500"
                        strokeWidth={1.5}
                        strokeDasharray="4 2"
                      />
                    ))}
                  </svg>
                )}

                {csvColumns.length === 0 && (
                  <div className="flex flex-col items-center py-8 text-center">
                    <FileUp className="w-8 h-8 text-muted-foreground mb-2" />
                    <p className="text-xs text-muted-foreground mb-1">
                      {t('tasks.mappingNoImport') || 'Import a CSV/Excel file or use Server Import to create field mappings'}
                    </p>
                    <div className="flex gap-2 mt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <FileUp className="w-3 h-3 mr-1" />
                        {t('tasks.import') || 'Import'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => { setServerImportOpen(true); setServerImportTab('users'); handleServerImport('users'); }}
                      >
                        <Server className="w-3 h-3 mr-1" />
                        {t('tasks.serverImport') || 'Server Import'}
                      </Button>
                    </div>
                  </div>
                )}

                {csvColumns.length > 0 && (
                  <>
                    {/* Compact mapping summary */}
                    <div className="flex items-center gap-2 px-2 py-1.5 bg-muted/50 rounded border">
                      <Link2 className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium">
                        {t('tasks.mappedSummary', {
                          mapped: selectedStep.fieldMappings.filter(m => m.enabled !== false).length,
                          total: visibleParams.length,
                        }) || `${selectedStep.fieldMappings.filter(m => m.enabled !== false).length} of ${visibleParams.length} fields mapped`}
                      </span>
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden ml-2">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all"
                          style={{ width: `${visibleParams.length > 0 ? (selectedStep.fieldMappings.filter(m => m.enabled !== false).length / visibleParams.length) * 100 : 0}%` }}
                        />
                      </div>
                    </div>

                    {/* PRIMARY: Dropdown-based mapping for each API field (at top) */}
                    <div>
                      <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                        {t('tasks.apiFields') || 'API Fields'} → {t('tasks.csvColumns') || 'CSV Columns'}
                      </h4>
                      <div className="space-y-2">
                        {visibleParams.filter(p => !paramSearch.trim() || p.label.toLowerCase().includes(paramSearch.toLowerCase()) || p.name.toLowerCase().includes(paramSearch.toLowerCase())).map(param => {
                          const currentMapping = selectedStep.fieldMappings.find(m => m.apiField === param.name);
                          const isMapped = !!currentMapping && currentMapping.enabled !== false;
                          return (
                            <div key={param.name} className="flex items-center gap-2">
                              {/* Status dot */}
                              <div className={`w-2 h-2 rounded-full shrink-0 ${isMapped ? 'bg-emerald-500' : 'bg-muted-foreground/30'}`} />
                              {/* Param label */}
                              <span className="text-xs truncate w-28 shrink-0" title={param.label}>
                                {param.label}
                                {param.required && <span className="text-red-500 ml-0.5">*</span>}
                              </span>
                              {/* Dropdown select */}
                              <Select
                                value={currentMapping?.csvColumn || '__none__'}
                                onValueChange={(val) => {
                                  if (val === '__none__') {
                                    if (currentMapping) {
                                      removeMapping(selectedStep.id, param.name);
                                    }
                                  } else {
                                    const existingMappings = selectedStep.fieldMappings.filter(m => m.apiField !== param.name);
                                    existingMappings.push({ csvColumn: val, apiField: param.name, enabled: true });
                                    setFieldMappings(selectedStep.id, existingMappings);
                                  }
                                }}
                              >
                                <SelectTrigger className="h-7 text-xs flex-1">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">
                                    <span className="text-muted-foreground">{t('tasks.none') || 'None'}</span>
                                  </SelectItem>
                                  {csvColumns.map(col => (
                                    <SelectItem key={col} value={col}>{col}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {/* Mapping status badge */}
                              {isMapped ? (
                                <Badge variant="secondary" className="text-[9px] h-4 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
                                  {t('tasks.mappingMapped') || 'Mapped'}
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[9px] h-4 text-muted-foreground shrink-0">
                                  {t('tasks.mappingUnmapped') || 'Unmapped'}
                                </Badge>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <Separator />

                    {/* Active mappings list (prominent) */}
                    {selectedStep.fieldMappings.length > 0 && (
                      <div>
                        <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                          {t('tasks.activeMappings') || 'Active Mappings'}
                        </h4>
                        <div className="space-y-1">
                          {selectedStep.fieldMappings.map(mapping => (
                            <div
                              key={`${mapping.csvColumn}->${mapping.apiField}`}
                              className={`flex items-center gap-2 px-2 py-1 rounded text-xs border ${
                                mapping.enabled === false ? 'border-border opacity-50' : 'border-emerald-500/20 bg-emerald-500/5'
                              }`}
                            >
                              <Checkbox
                                checked={mapping.enabled !== false}
                                onCheckedChange={() => toggleMappingEnabled(selectedStep.id, mapping.apiField)}
                                className="h-3 w-3"
                              />
                              <span className="truncate">{mapping.csvColumn}</span>
                              <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                              <span className="truncate">{mapping.apiField}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-4 w-4 ml-auto shrink-0"
                                onClick={() => removeMapping(selectedStep.id, mapping.apiField)}
                              >
                                <X className="w-2.5 h-2.5 text-red-400" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Collapsible: CSV columns (source ports) */}
                    <Collapsible defaultOpen={false}>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" className="w-full h-6 justify-start gap-1.5 px-1 text-[10px] text-muted-foreground hover:bg-accent/50">
                          <ChevronDown className="w-3 h-3" />
                          {t('tasks.csvColumns') || 'CSV Columns'} ({csvColumns.length})
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="space-y-1 pl-1 pb-1">
                          {csvColumns.map(col => {
                            const isConnected = selectedStep.fieldMappings.some(m => m.csvColumn === col && m.enabled !== false);
                            return (
                              <div
                                key={col}
                                data-port-type="source"
                                data-port-id={col}
                                className={`flex items-center gap-2 px-2 py-1 rounded text-xs cursor-pointer transition-colors ${
                                  isConnected ? 'bg-emerald-500/10 border border-emerald-500/20' :
                                  connectingFrom?.id === col ? 'ring-2 ring-primary' :
                                  'hover:bg-accent'
                                }`}
                                onClick={() => handlePortClick({ type: 'source', id: col, stepId: selectedStep.id })}
                              >
                                <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
                                <span className="truncate flex-1">{col}</span>
                                {isConnected && <Link2 className="w-3 h-3 text-emerald-500" />}
                              </div>
                            );
                          })}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>

                    {/* Collapsible: API fields (target ports) + Output fields */}
                    <Collapsible defaultOpen={false}>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" className="w-full h-6 justify-start gap-1.5 px-1 text-[10px] text-muted-foreground hover:bg-accent/50">
                          <ChevronDown className="w-3 h-3" />
                          {t('tasks.apiFields') || 'API Fields'} (visual) ({visibleParams.length + outputFields.length})
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="space-y-1 pl-1 pb-1">
                          {/* Input fields */}
                          {visibleParams.length > 0 && (
                            <div className="flex items-center gap-1 px-2 py-0.5">
                              <ArrowRight className="w-2.5 h-2.5 text-blue-400 shrink-0" />
                              <span className="text-[9px] font-medium text-blue-500 dark:text-blue-400 uppercase">{t('tasks.inputFields') || 'Inputs'}</span>
                            </div>
                          )}
                          {visibleParams.filter(p => !paramSearch.trim() || p.label.toLowerCase().includes(paramSearch.toLowerCase()) || p.name.toLowerCase().includes(paramSearch.toLowerCase())).map(param => {
                            const mapping = selectedStep.fieldMappings.find(m => m.apiField === param.name);
                            const isConnected = !!mapping && mapping.enabled !== false;
                            return (
                              <div
                                key={param.name}
                                data-port-type="target"
                                data-port-id={param.name}
                                className={`flex items-center gap-2 px-2 py-1 rounded text-xs cursor-pointer transition-colors ${
                                  isConnected ? 'bg-emerald-500/10 border border-emerald-500/20' :
                                  connectingFrom?.id === param.name ? 'ring-2 ring-primary' :
                                  'hover:bg-accent'
                                }`}
                                onClick={() => handlePortClick({ type: 'target', id: param.name, stepId: selectedStep.id })}
                              >
                                <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
                                <span className="truncate flex-1">{param.label}</span>
                                {isConnected && (
                                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400">← {mapping!.csvColumn}</span>
                                )}
                                {param.required && <span className="text-red-500 text-[10px]">*</span>}
                              </div>
                            );
                          })}
                          {/* Output fields */}
                          {outputFields.length > 0 && (
                            <>
                              <div className="flex items-center gap-1 px-2 py-0.5 mt-1">
                                <ArrowDown className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                                <span className="text-[9px] font-medium text-amber-500 dark:text-amber-400 uppercase">{t('tasks.outputFields') || 'Outputs'}</span>
                              </div>
                              {outputFields.map(field => (
                                <div
                                  key={`out-${field.name}`}
                                  className="flex items-center gap-2 px-2 py-1 rounded text-xs hover:bg-amber-500/5 transition-colors"
                                >
                                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400/60" />
                                  <span className="truncate flex-1 text-muted-foreground">{field.label}</span>
                                  <span className="text-[8px] text-amber-500/70 shrink-0">out</span>
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>

                    {connectingFrom && (
                      <div className="flex items-center gap-2 p-2 bg-primary/10 rounded text-xs text-primary">
                        <Link2 className="w-3 h-3" />
                        {connectingFrom.type === 'source'
                          ? (t('tasks.clickTargetField') || 'Click an API field to connect')
                          : (t('tasks.clickSourceField') || 'Click a CSV column to connect')
                        }
                        <Button variant="ghost" size="sm" className="h-5 text-[10px] ml-auto" onClick={() => setConnectingFrom(null)}>
                          {t('common.cancel') || 'Cancel'}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Log Terminal Tab — shows full server output */}
          <TabsContent value="log" className="flex-1 overflow-hidden mt-0 min-h-0">
            <div className="h-full flex flex-col bg-zinc-950 dark:bg-zinc-900 rounded-md m-1">
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 shrink-0">
                <Terminal className="w-3 h-3 text-green-400" />
                <span className="text-[10px] font-mono text-zinc-400">{t('tasks.log') || 'Log'}</span>
                {isRunning && <Loader2 className="w-3 h-3 animate-spin text-green-400" />}
                <div className="flex-1" />
                {logEntries.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 text-[9px] text-zinc-500 hover:text-zinc-300"
                    onClick={() => setLogEntries([])}
                  >
                    {t('common.clear') || 'Clear'}
                  </Button>
                )}
              </div>
              <ScrollArea className="flex-1 min-h-0">
                <div className="p-2 font-mono text-[11px] leading-5">
                  {logEntries.length === 0 && (
                    <div className="text-zinc-500 py-4 text-center">
                      {t('tasks.logEmpty') || 'No log entries yet. Run a batch to see output.'}
                    </div>
                  )}
                  {logEntries.map((entry, idx) => {
                    // Data level: attribute lines start with two spaces
                    const isAttrLine = entry.level === 'data' && entry.message.startsWith('  ');
                    const isDataHeader = entry.level === 'data' && !entry.message.startsWith('  ');
                    const lines = entry.message.split('\n');
                    return (
                      <div key={idx} className={
                        entry.level === 'data' ? (isAttrLine ? 'ml-4' : 'ml-2 my-0.5') : ''
                      }>
                        {lines.length > 1 ? (
                          // Multi-line: render first line with timestamp, rest indented
                          lines.map((line, lineIdx) => (
                            <div key={lineIdx} className={`flex gap-2 ${
                              entry.level === 'success' ? 'text-green-400' :
                              entry.level === 'error' ? 'text-red-400' :
                              entry.level === 'warn' ? 'text-yellow-400' :
                              entry.level === 'data' ? 'text-cyan-400' :
                              'text-zinc-300'
                            }`}>
                              {lineIdx === 0 ? (
                                <>
                                  {entry.level !== 'data' && <span className="text-zinc-600 shrink-0">{entry.timestamp}</span>}
                                  <span className="shrink-0">
                                    {entry.level === 'success' && '✓'}
                                    {entry.level === 'error' && '✗'}
                                    {entry.level === 'warn' && '⚠'}
                                    {entry.level === 'info' && '›'}
                                    {entry.level === 'data' && !isAttrLine && '│'}
                                    {entry.level === 'data' && isAttrLine && ' '}
                                  </span>
                                  <span className="break-all whitespace-pre-wrap">{line}</span>
                                </>
                              ) : (
                                <>
                                  {entry.level !== 'data' && <span className="w-[88px] shrink-0"></span>}
                                  <span className="shrink-0 w-3"></span>
                                  <span className="break-all whitespace-pre-wrap">{line}</span>
                                </>
                              )}
                            </div>
                          ))
                        ) : (
                          // Single-line format
                          <div className={`flex gap-2 ${
                            entry.level === 'success' ? 'text-green-400' :
                            entry.level === 'error' ? 'text-red-400' :
                            entry.level === 'warn' ? 'text-yellow-400' :
                            entry.level === 'data' ? 'text-cyan-400' :
                            'text-zinc-300'
                          }`}>
                            {entry.level !== 'data' && <span className="text-zinc-600 shrink-0">{entry.timestamp}</span>}
                            <span className="shrink-0">
                              {entry.level === 'success' && '✓'}
                              {entry.level === 'error' && '✗'}
                              {entry.level === 'warn' && '⚠'}
                              {entry.level === 'info' && '›'}
                              {entry.level === 'data' && !isAttrLine && '│'}
                              {entry.level === 'data' && isAttrLine && ' '}
                            </span>
                            <span className="break-all whitespace-pre-wrap">{entry.message}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div ref={logEndRef} />
                </div>
              </ScrollArea>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Link Step Dialog (Fix 7)
  // ═══════════════════════════════════════════════════════════════════════════
  const renderLinkDialog = () => {
    const targetStep = steps.find(s => s.id === linkTargetStepId);
    if (!targetStep) return null;

    const sourceStepId = linkFieldMap['_sourceStepId'] as string;
    const sourceStep = steps.find(s => s.id === sourceStepId);
    const sourceOp = sourceStep ? API_OPERATIONS.find(o => o.method === sourceStep.method) : null;
    const targetOp = API_OPERATIONS.find(o => o.method === targetStep.method);

    // Get available source fields from source step's outputFields (preferred) or params (fallback)
    const sourceOutputFields = sourceOp?.outputFields || [];
    const sourceFields = sourceOutputFields.length > 0
      ? sourceOutputFields.map(f => f.name)
      : (sourceStep ? Object.keys(sourceStep.params) : []);
    const sourceFieldLabels = sourceOutputFields.length > 0
      ? Object.fromEntries(sourceOutputFields.map(f => [f.name, f.label]))
      : {};
    const targetParams = targetOp?.params || [];

    return (
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle>{t('tasks.linkStepTitle') || 'Link Step to Previous Output'}</DialogTitle>
            <DialogDescription>
              {t('tasks.selectSourceStep') || 'Select source step'} → {targetStep.label}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1 overflow-auto flex-1 min-h-0">
            {/* Source step selector */}
            <div>
              <Label className="text-xs mb-1 block">{t('tasks.selectSourceStep') || 'Select source step'}</Label>
              <Select
                value={sourceStepId || '__none__'}
                onValueChange={(val) => {
                  const newMap: Record<string, string> = { '_sourceStepId': val === '__none__' ? '' : val };
                  setLinkFieldMap(newMap);
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t('tasks.none') || 'None'}</SelectItem>
                  {steps.filter(s => s.id !== linkTargetStepId).map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Field mapping */}
            {sourceStepId && sourceStep && (
              <div className="space-y-1.5">
                <Label className="text-xs block">{t('tasks.sourceField') || 'Source field'} → {t('tasks.targetParam') || 'Target parameter'}</Label>
                <div className="max-h-[200px] overflow-auto space-y-1.5">
                {targetParams.filter(p => p.type === 'string').map(tp => (
                  <div key={tp.name} className="flex items-center gap-1.5">
                    <span className="text-[11px] text-muted-foreground w-28 truncate shrink-0">{tp.label}</span>
                    <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                    <Select
                      value={linkFieldMap[tp.name] || '__none__'}
                      onValueChange={(val) => {
                        setLinkFieldMap(prev => ({
                          ...prev,
                          [tp.name]: val === '__none__' ? '' : val,
                        }));
                      }}
                    >
                      <SelectTrigger className="h-7 text-xs flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t('tasks.none') || 'None'}</SelectItem>
                        {sourceFields.map(sf => (
                          <SelectItem key={sf} value={sf}>{sourceFieldLabels[sf] || sf}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setLinkDialogOpen(false)}>
              {t('common.cancel') || 'Cancel'}
            </Button>
            <Button size="sm" onClick={handleSaveLink}>
              {t('common.save') || 'Save'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Server Import Dialog (Fix 8)
  // ═══════════════════════════════════════════════════════════════════════════
  const renderServerImportDialog = () => (
    <Dialog open={serverImportOpen} onOpenChange={setServerImportOpen}>
      <DialogContent className="max-w-[95vw] md:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('tasks.serverImportTitle') || 'Import from Server'}</DialogTitle>
          <DialogDescription>{t('tasks.selectItemsToImport') || 'Select items to import'}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <Tabs value={serverImportTab} onValueChange={(tab) => { setServerImportTab(tab); setServerImportSelected(new Set()); handleServerImport(tab); }} className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <TabsList className="w-full shrink-0">
              <TabsTrigger value="users" className="flex-1 text-xs">
                <Users className="w-3 h-3 mr-1" /> {t('nav.users') || 'Users'}
              </TabsTrigger>
              <TabsTrigger value="groups" className="flex-1 text-xs">
                <FolderPlus className="w-3 h-3 mr-1" /> {t('nav.groups') || 'Groups'}
              </TabsTrigger>
              <TabsTrigger value="computers" className="flex-1 text-xs">
                <Monitor className="w-3 h-3 mr-1" /> {t('nav.computers') || 'Computers'}
              </TabsTrigger>
              <TabsTrigger value="contacts" className="flex-1 text-xs">
                <Contact className="w-3 h-3 mr-1" /> {t('nav.contacts') || 'Contacts'}
              </TabsTrigger>
            </TabsList>

            <div className="mt-4 flex-1 min-h-0 overflow-hidden flex flex-col">
              {serverImportLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">{t('tasks.fetchingData') || 'Fetching data...'}</span>
                </div>
              ) : serverImportData.length === 0 ? (
                <div className="text-center py-12 text-sm text-muted-foreground">
                  {t('tasks.noDataAvailable') || 'No data available'}
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2 shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {t('tasks.selectedCount', { count: serverImportSelected.size }) || `${serverImportSelected.size} selected`}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px]"
                        onClick={() => {
                          const allIndices = new Set(serverImportData.map((_, i) => i));
                          setServerImportSelected(allIndices);
                        }}
                      >
                        {t('management.selectAll') || 'Select all'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px]"
                        onClick={() => setServerImportSelected(new Set())}
                      >
                        {t('management.deselectAll') || 'Deselect all'}
                      </Button>
                    </div>
                  </div>
                  <ScrollArea className="flex-1 min-h-0">
                    <div className="space-y-1">
                      {serverImportData.map((item, idx) => {
                        const name = String(item.username || item.groupname || item.computername || item.contactname || item.name || item.displayName || `Item ${idx + 1}`);
                        const description = String(item.description || item.mail || '');
                        return (
                          <div
                            key={idx}
                            className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-colors ${
                              serverImportSelected.has(idx) ? 'bg-primary/10 border border-primary/20' : 'hover:bg-accent'
                            }`}
                            onClick={() => {
                              setServerImportSelected(prev => {
                                const next = new Set(prev);
                                if (next.has(idx)) next.delete(idx);
                                else next.add(idx);
                                return next;
                              });
                            }}
                          >
                            <Checkbox
                              checked={serverImportSelected.has(idx)}
                              onCheckedChange={() => {
                                setServerImportSelected(prev => {
                                  const next = new Set(prev);
                                  if (next.has(idx)) next.delete(idx);
                                  else next.add(idx);
                                  return next;
                                });
                              }}
                            />
                            <span className="text-xs font-medium truncate">{name}</span>
                            {description && (
                              <span className="text-[10px] text-muted-foreground truncate">{description}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </>
              )}
            </div>
          </Tabs>
        </div>

        <div className="flex justify-end gap-2 pt-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => setServerImportOpen(false)}>
            {t('common.cancel') || 'Cancel'}
          </Button>
          <Button
            size="sm"
            onClick={handleImportSelectedFromServer}
            disabled={serverImportSelected.size === 0 || serverImportLoading}
          >
            <FileUp className="w-3.5 h-3.5 mr-1" />
            {t('tasks.importSelected') || 'Import Selected'} ({serverImportSelected.size})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Import Data Window (dedicated dialog with File/Server/Preview tabs)
  // ═══════════════════════════════════════════════════════════════════════════
  const renderImportWindow = () => (
    <Dialog open={importWindowOpen} onOpenChange={setImportWindowOpen}>
      <DialogContent className="max-w-[95vw] md:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('tasks.importDataTab') || 'Import Data'}</DialogTitle>
          <DialogDescription>{t('tasks.importDataDesc') || 'Import data from a file, server, or preview current data'}</DialogDescription>
        </DialogHeader>

        <Tabs value={importWindowTab} onValueChange={setImportWindowTab} className="flex-1 flex flex-col overflow-hidden min-h-0">
          <TabsList className="w-full">
            <TabsTrigger value="file" className="flex-1 text-xs">
              <FileUp className="w-3 h-3 mr-1" />
              {t('tasks.fileImport') || 'File Import'}
            </TabsTrigger>
            <TabsTrigger value="server" className="flex-1 text-xs">
              <Server className="w-3 h-3 mr-1" />
              {t('tasks.serverImport') || 'Server Import'}
            </TabsTrigger>
            <TabsTrigger value="preview" className="flex-1 text-xs">
              <Eye className="w-3 h-3 mr-1" />
              {t('tasks.preview') || 'Preview'}
            </TabsTrigger>
          </TabsList>

          {/* File Import Tab */}
          <TabsContent value="file" className="flex-1 overflow-auto mt-4 min-h-0">
            <div className="space-y-4">
              <div className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-8 hover:bg-accent/30 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUp className="w-10 h-10 text-muted-foreground mb-3" />
                <p className="text-sm font-medium">{t('tasks.importFile') || 'Import from file'}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('tasks.supportedFormats') || 'Supports XLSX, XLS, CSV, JSON'}
                </p>
                <Button variant="outline" size="sm" className="mt-3 h-7 text-xs gap-1.5">
                  <FileUp className="w-3 h-3" />
                  {t('tasks.selectFile') || 'Select file'}
                </Button>
              </div>
              {importedData.length > 0 && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded p-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />
                    {t('tasks.importSuccess', { count: importedData.length, name: '' }) || `Imported ${importedData.length} rows`}
                  </div>
                </div>
              )}
              {importedData.length > 0 && steps.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-8 text-xs gap-1.5"
                  onClick={handleAutoCreateSteps}
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t('tasks.autoCreate') || 'Auto-create steps from import'}
                </Button>
              )}
            </div>
          </TabsContent>

          {/* Server Import Tab */}
          <TabsContent value="server" className="flex-1 overflow-auto mt-4 min-h-0">
            <div className="space-y-3">
              <Tabs value={serverImportTab} onValueChange={(tab) => { setServerImportTab(tab); setServerImportSelected(new Set()); handleServerImport(tab); }}>
                <TabsList className="w-full">
                  <TabsTrigger value="users" className="flex-1 text-xs">
                    <Users className="w-3 h-3 mr-1" /> {t('nav.users') || 'Users'}
                  </TabsTrigger>
                  <TabsTrigger value="groups" className="flex-1 text-xs">
                    <FolderPlus className="w-3 h-3 mr-1" /> {t('nav.groups') || 'Groups'}
                  </TabsTrigger>
                  <TabsTrigger value="computers" className="flex-1 text-xs">
                    <Monitor className="w-3 h-3 mr-1" /> {t('nav.computers') || 'Computers'}
                  </TabsTrigger>
                  <TabsTrigger value="contacts" className="flex-1 text-xs">
                    <Contact className="w-3 h-3 mr-1" /> {t('nav.contacts') || 'Contacts'}
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {serverImportLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">{t('tasks.fetchingData') || 'Fetching data...'}</span>
                </div>
              ) : serverImportData.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  {t('tasks.noDataAvailable') || 'No data available'}
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">
                      {t('tasks.selectedCount', { count: serverImportSelected.size }) || `${serverImportSelected.size} selected`}
                    </span>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px]"
                        onClick={() => setServerImportSelected(new Set(serverImportData.map((_, i) => i)))}
                      >
                        {t('management.selectAll') || 'All'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px]"
                        onClick={() => setServerImportSelected(new Set())}
                      >
                        {t('management.deselectAll') || 'None'}
                      </Button>
                    </div>
                  </div>
                  <ScrollArea className="max-h-[200px] overflow-hidden">
                    <div className="space-y-0.5">
                      {serverImportData.map((item, idx) => {
                        const name = String(item.username || item.groupname || item.computername || item.contactname || item.name || item.displayName || `Item ${idx + 1}`);
                        return (
                          <div
                            key={idx}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors text-xs overflow-hidden ${
                              serverImportSelected.has(idx) ? 'bg-primary/10 border border-primary/20' : 'hover:bg-accent'
                            }`}
                            onClick={() => {
                              setServerImportSelected(prev => {
                                const next = new Set(prev);
                                if (next.has(idx)) next.delete(idx);
                                else next.add(idx);
                                return next;
                              });
                            }}
                          >
                            <Checkbox checked={serverImportSelected.has(idx)} className="h-3 w-3" />
                            <span className="font-medium truncate">{name}</span>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </>
              )}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={handleImportSelectedFromServer}
                  disabled={serverImportSelected.size === 0 || serverImportLoading}
                >
                  <FileUp className="w-3 h-3" />
                  {t('tasks.importSelected') || 'Import Selected'} ({serverImportSelected.size})
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* Preview Tab */}
          <TabsContent value="preview" className="flex-1 overflow-auto mt-4 min-h-0">
            {importedData.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Database className="w-10 h-10 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">
                  {t('tasks.noImportedData') || 'No imported data yet'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('tasks.importDataHint') || 'Use File Import or Server Import to add data'}
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">
                    {importedData.length} {t('tasks.rows') || 'rows'} · {csvColumns.length} {t('tasks.columns') || 'columns'}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] text-destructive hover:text-destructive"
                    onClick={() => setImportedData([])}
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    {t('common.clear') || 'Clear'}
                  </Button>
                </div>
                <ScrollArea className="max-h-[240px]">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-1 text-muted-foreground">#</th>
                        {csvColumns.slice(0, 8).map(col => (
                          <th key={col} className="text-left p-1 text-muted-foreground truncate max-w-[120px]">{col}</th>
                        ))}
                        <th className="p-1"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {importedData.slice(0, 20).map((row, rowIdx) => (
                        <tr key={rowIdx} className="border-b hover:bg-accent/30">
                          <td className="p-1 text-muted-foreground">{rowIdx + 1}</td>
                          {csvColumns.slice(0, 8).map(col => (
                            <td key={col} className="p-1 truncate max-w-[120px]">{row[col]}</td>
                          ))}
                          <td className="p-1">
                            <Button variant="ghost" size="icon" className="h-4 w-4" onClick={() => removeImportedRow(rowIdx)}>
                              <X className="w-2.5 h-2.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {importedData.length > 20 && (
                    <p className="text-[10px] text-muted-foreground text-center py-1">
                      {t('tasks.moreRows', { count: importedData.length - 20 }) || `... and ${importedData.length - 20} more rows`}
                    </p>
                  )}
                </ScrollArea>
              </>
            )}
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" size="sm" onClick={() => setImportWindowOpen(false)}>
            {t('common.close') || 'Close'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Main Layout
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col h-full border rounded-lg overflow-hidden bg-background relative" style={!isMobile ? { zoom: 1.2 } : undefined}>
      {renderToolbar()}

      {isMobile ? (
        // Mobile: vertical stack of the 3 panels (Left / Canvas / Properties),
        // each gets a fixed viewport-relative height so they don't fight for
        // space. The outer container scrolls vertically. The desktop zoom
        // (1.2) is disabled on mobile so the layout fits the narrow viewport.
        <div className="flex flex-col flex-1 overflow-y-auto p-2 gap-2" style={{ WebkitOverflowScrolling: 'touch' }}>
          <div className="h-[35vh] min-h-[200px]">{renderLeftPanel()}</div>
          <div className="h-[45vh] min-h-[220px]">{renderCanvas()}</div>
          <div className="h-[55vh] min-h-[320px]">{renderProperties()}</div>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <ResizablePanelGroup direction="horizontal" className="flex-1">
            {/* Left Panel: Data Sources */}
            <ResizablePanel defaultSize={18} minSize={12} maxSize={25}>
              {renderLeftPanel()}
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Center Panel: Canvas */}
            <ResizablePanel defaultSize={42} minSize={25}>
              {renderCanvas()}
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Right Panel: Properties — increased size */}
            <ResizablePanel defaultSize={40} minSize={25} maxSize={55}>
              {renderProperties()}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      )}

      {/* Dialogs */}
      {renderOperationsModal()}
      {renderLinkDialog()}
      {renderServerImportDialog()}
      {renderImportWindow()}
    </div>
  );
}
