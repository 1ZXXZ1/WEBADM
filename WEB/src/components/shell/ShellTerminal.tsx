'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useShellStore } from '@/stores/shell-store';
import { RequirePermission } from '@/components/permissions/RequirePermission';
import api, { getErrorMessage } from '@/lib/api';
import type {
  ShellInfo,
  ShellProjectWorkspaceInfo,
  ShellProjectCreateRequest,
} from '@/lib/api-types';
import type { ShellScript } from '@/types';
import {
  Play, Save, Download, Pencil, Trash2, Terminal,
  Loader2, ChevronRight, FileCode, Shield, Upload,
  Plus, X, ChevronDown, ChevronUp, RefreshCw,
  FolderKanban, Eye, Square, MoreVertical, List,
  FileUp, Variable, Server,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
// Note: Collapsible still used elsewhere — do not remove import.
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { useOrientation } from '@/hooks/use-orientation';

// ─── Status Badge Helpers ──────────────────────────────────────────────────

function statusColor(status: string): string {
  switch (status) {
    case 'ready': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    case 'running': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    case 'completed': return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    case 'failed': return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'aborted': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 'creating': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
    case 'deleting': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
}

function statusIcon(status: string) {
  switch (status) {
    case 'running': return <Loader2 className="w-3 h-3 animate-spin" />;
    case 'completed': return <span className="w-2 h-2 rounded-full bg-gray-400 inline-block" />;
    case 'failed': return <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />;
    case 'ready': return <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />;
    default: return <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />;
  }
}

// ─── Env Editor Sub-component ──────────────────────────────────────────────

function EnvEditor() {
  const { envVars, addEnvVar, removeEnvVar, updateEnvVar, clearEnvVars } = useShellStore();
  const { t } = useTranslation();

  const filledCount = envVars.filter((e) => e.key.trim()).length;

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        {envVars.map((entry, idx) => (
          <div key={idx} className="flex items-center gap-1">
            <Input
              value={entry.key}
              onChange={(e) => updateEnvVar(idx, 'key', e.target.value)}
              placeholder="KEY"
              className="h-7 text-xs font-mono bg-gray-800 border-gray-700 text-emerald-300 placeholder:text-gray-600 focus-visible:ring-emerald-500/30 w-1/3"
            />
            <span className="text-gray-600 text-xs">=</span>
            <Input
              value={entry.value}
              onChange={(e) => updateEnvVar(idx, 'value', e.target.value)}
              placeholder="value"
              className="h-7 text-xs font-mono bg-gray-800 border-gray-700 text-emerald-300 placeholder:text-gray-600 focus-visible:ring-emerald-500/30 flex-1"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-gray-500 hover:text-red-400 flex-shrink-0"
              onClick={() => removeEnvVar(idx)}
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs text-emerald-400 hover:text-emerald-300 border-gray-700"
          onClick={addEnvVar}
        >
          <Plus className="w-3 h-3 mr-1" />
          {t('shell.addEnv') || 'Добавить переменную'}
        </Button>
        {filledCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-gray-500 hover:text-red-400"
            onClick={clearEnvVars}
          >
            {t('shell.clearEnv') || 'Очистить все'}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Create Project Dialog ─────────────────────────────────────────────────

function CreateProjectDialog({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ShellProjectCreateRequest>({
    name: '',
    run_command: '',
    sudo: false,
    timeout: 120,
    auto_delete: false,
    env: {},
    owner: '',
    tags: [],
    labels: {},
  });
  const [envPairs, setEnvPairs] = useState<Array<{ key: string; value: string }>>([
    { key: '', value: '' },
  ]);
  const [tagsInput, setTagsInput] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const updateField = <K extends keyof ShellProjectCreateRequest>(
    key: K,
    value: ShellProjectCreateRequest[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleCreate = useCallback(async () => {
    if (!form.name.trim()) {
      toast.error(t('shell.projectNameRequired') || 'Project name is required');
      return;
    }

    setCreating(true);
    try {
      // Build env record
      const envRecord: Record<string, string> = {};
      for (const pair of envPairs) {
        if (pair.key.trim()) {
          envRecord[pair.key.trim()] = pair.value;
        }
      }

      // Build tags
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const payload: ShellProjectCreateRequest = {
        ...form,
        env: Object.keys(envRecord).length > 0 ? envRecord : undefined,
        tags: tags.length > 0 ? tags : undefined,
      };

      const response = await api.post('/shell/projet/', payload);
      const projetId = response.data?.projet_id;

      if (projetId && selectedFile) {
        const fd = new FormData();
        fd.append('file', selectedFile);
        await api.post(`/shell/projet/${projetId}/upload`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }

      toast.success(
        t('shell.projectCreated', { name: form.name })
      );
      setOpen(false);
      resetForm();
      onCreated();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, t('shell.failedToCreateProject')));
    } finally {
      setCreating(false);
    }
  }, [form, envPairs, tagsInput, selectedFile, onCreated, t]);

  const resetForm = () => {
    setForm({
      name: '',
      run_command: '',
      sudo: false,
      timeout: 120,
      auto_delete: false,
      env: {},
      owner: '',
      tags: [],
      labels: {},
    });
    setEnvPairs([{ key: '', value: '' }]);
    setTagsInput('');
    setSelectedFile(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm bg-emerald-600 hover:bg-emerald-700 text-white">
          <Plus className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
          <span className="hidden sm:inline">{t('shell.createProject') || 'New Project'}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] md:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderKanban className="w-5 h-5 text-emerald-500" />
            {t('shell.createProject') || 'Create Shell Project'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label className="text-xs">
              {t('shell.projectName')} <span className="text-red-400">*</span>
            </Label>
            <Input
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="my-project"
              className="h-8 text-sm"
            />
          </div>

          {/* Run command */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t('shell.runCommand')}</Label>
            <Input
              value={form.run_command || ''}
              onChange={(e) => updateField('run_command', e.target.value)}
              placeholder="./run.sh"
              className="h-8 text-sm font-mono"
            />
          </div>

          {/* Owner */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t('shell.owner')}</Label>
            <Input
              value={form.owner || ''}
              onChange={(e) => updateField('owner', e.target.value)}
              placeholder="admin"
              className="h-8 text-sm"
            />
          </div>

          {/* Tags */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t('shell.tags')}</Label>
            <Input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="deploy, test (comma separated)"
              className="h-8 text-sm"
            />
          </div>

          {/* Toggles row */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch
                checked={form.sudo || false}
                onCheckedChange={(v) => updateField('sudo', v)}
              />
              <Label className="text-xs flex items-center gap-1">
                <Shield className="w-3 h-3" /> {t('shell.sudo')}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.auto_delete || false}
                onCheckedChange={(v) => updateField('auto_delete', v)}
              />
              <Label className="text-xs">{t('shell.autoDelete')}</Label>
            </div>
          </div>

          {/* Timeout */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t('shell.timeout')}</Label>
            <Input
              type="number"
              value={form.timeout || 120}
              onChange={(e) => updateField('timeout', Number(e.target.value))}
              className="h-8 text-sm w-28"
              min={1}
            />
          </div>

          {/* TTL */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t('shell.ttlSeconds')}</Label>
            <Input
              type="number"
              value={form.ttl_seconds || 0}
              onChange={(e) => updateField('ttl_seconds', Number(e.target.value) || undefined)}
              className="h-8 text-sm w-28"
              min={0}
            />
          </div>

          {/* Env vars */}
          <div className="space-y-2">
            <Label className="text-xs flex items-center gap-1">
              <Variable className="w-3 h-3" />
              {t('shell.envVars')}
            </Label>
            {envPairs.map((pair, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <Input
                  value={pair.key}
                  onChange={(e) => {
                    const next = [...envPairs];
                    next[idx] = { ...next[idx], key: e.target.value };
                    setEnvPairs(next);
                  }}
                  placeholder="KEY"
                  className="h-7 text-xs font-mono w-1/3"
                />
                <span className="text-gray-500 text-xs">=</span>
                <Input
                  value={pair.value}
                  onChange={(e) => {
                    const next = [...envPairs];
                    next[idx] = { ...next[idx], value: e.target.value };
                    setEnvPairs(next);
                  }}
                  placeholder="value"
                  className="h-7 text-xs font-mono flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 flex-shrink-0"
                  onClick={() => {
                    setEnvPairs((prev) =>
                      prev.length <= 1
                        ? [{ key: '', value: '' }]
                        : prev.filter((_, i) => i !== idx)
                    );
                  }}
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-emerald-500"
              onClick={() => setEnvPairs((prev) => [...prev, { key: '', value: '' }])}
            >
              <Plus className="w-3 h-3 mr-1" /> {t('shell.addEnv')}
            </Button>
          </div>

          {/* Archive file upload */}
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1">
              <FileUp className="w-3 h-3" />
              {t('shell.archiveFile')}
            </Label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => uploadRef.current?.click()}
              >
                <Upload className="w-3 h-3 mr-1" />
                {selectedFile ? selectedFile.name : t('shell.chooseFile')}
              </Button>
              {selectedFile && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setSelectedFile(null)}
                >
                  <X className="w-3 h-3" />
                </Button>
              )}
              <input
                ref={uploadRef}
                type="file"
                accept=".sh,.py,.tar,.tar.gz,.tgz,.zip"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setSelectedFile(file);
                  if (uploadRef.current) uploadRef.current.value = '';
                }}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              {t('common.cancel') || 'Cancel'}
            </Button>
          </DialogClose>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={handleCreate}
            disabled={creating || !form.name.trim()}
          >
            {creating ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1" />
            ) : (
              <Plus className="w-4 h-4 mr-1" />
            )}
            {t('shell.create') || 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Project Detail Dialog ─────────────────────────────────────────────────

function ProjectDetailDialog({
  projetId,
  open,
  onOpenChange,
}: {
  projetId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<ShellProjectWorkspaceInfo | null>(null);
  const [fetchedId, setFetchedId] = useState<string | null>(null);

  // Derive loading state from open + projetId vs last fetched
  const loading = open && projetId !== null && fetchedId !== projetId;

  useEffect(() => {
    if (!open || !projetId) return;

    let cancelled = false;

    api
      .get(`/shell/projet/show/${projetId}`)
      .then((res) => {
        if (!cancelled) {
          setDetail(res.data?.workspace || null);
          setFetchedId(projetId);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          toast.error(getErrorMessage(err, t('shell.failedToLoadProject')));
          setFetchedId(projetId); // stop loading even on error
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, projetId, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] md:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-emerald-500" />
            {t('shell.projectDetails') || 'Project Details'}
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
          </div>
        ) : detail ? (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <span className="text-xs text-muted-foreground">{t('shell.projectName') || 'Name'}</span>
                <p className="font-medium">{detail.name}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">{t('shell.status') || 'Status'}</span>
                <p>
                  <Badge variant="outline" className={`text-xs ${statusColor(detail.status)}`}>
                    {statusIcon(detail.status)}
                    <span className="ml-1 capitalize">{detail.status}</span>
                  </Badge>
                </p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">{t('shell.owner') || 'Owner'}</span>
                <p>{detail.owner || '—'}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">{t('shell.workspacePath') || 'Workspace'}</span>
                <p className="font-mono text-xs truncate">{detail.workspace_path || '—'}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">{t('shell.createdAt') || 'Created'}</span>
                <p className="text-xs">{detail.created_at ? new Date(detail.created_at).toLocaleString() : '—'}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">{t('shell.completedAt') || 'Completed'}</span>
                <p className="text-xs">{detail.completed_at ? new Date(detail.completed_at).toLocaleString() : '—'}</p>
              </div>
            </div>

            {detail.last_command && (
              <div>
                <span className="text-xs text-muted-foreground">{t('shell.lastCommand') || 'Last Command'}</span>
                <pre className="bg-muted p-2 rounded text-xs font-mono mt-1 whitespace-pre-wrap">
                  {detail.last_command}
                </pre>
              </div>
            )}

            {detail.tags && detail.tags.length > 0 && (
              <div>
                <span className="text-xs text-muted-foreground">{t('shell.tags') || 'Tags'}</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {detail.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[10px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {detail.labels && Object.keys(detail.labels).length > 0 && (
              <div>
                <span className="text-xs text-muted-foreground">{t('shell.labels') || 'Labels'}</span>
                <div className="space-y-0.5 mt-1">
                  {Object.entries(detail.labels).map(([k, v]) => (
                    <p key={k} className="text-xs font-mono">
                      <span className="text-emerald-400">{k}</span>={String(v)}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {detail.execution_history && detail.execution_history.length > 0 && (
              <div>
                <span className="text-xs text-muted-foreground">
                  {t('shell.executionHistory') || 'Execution History'}
                </span>
                <div className="space-y-1 mt-1 max-h-48 overflow-y-auto">
                  {detail.execution_history.map((entry, idx) => (
                    <div key={idx} className="bg-muted p-2 rounded text-xs font-mono space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${entry.rc === 0 ? 'text-emerald-400' : 'text-red-400'}`}
                        >
                          rc={entry.rc}
                        </Badge>
                        <span className="text-muted-foreground">{entry.elapsed?.toFixed(1)}s</span>
                        {entry.timed_out && (
                          <Badge variant="outline" className="text-[10px] text-yellow-400">
                            {t('shell.timedOut')}
                          </Badge>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap">{entry.command}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">{t('shellProjects.noData')}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Run Project Dialog ────────────────────────────────────────────────────

function RunProjectDialog({
  projetId,
  projectName,
  onRan,
}: {
  projetId: string;
  projectName: string;
  onRan: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [runCommand, setRunCommand] = useState('');
  const [sudo, setSudo] = useState(false);
  const [timeout, setTimeout] = useState(120);
  const [envPairs, setEnvPairs] = useState<Array<{ key: string; value: string }>>([
    { key: '', value: '' },
  ]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    try {
      const envRecord: Record<string, string> = {};
      for (const pair of envPairs) {
        if (pair.key.trim()) {
          envRecord[pair.key.trim()] = pair.value;
        }
      }

      const payload: Record<string, unknown> = {
        run_command: runCommand || undefined,
        sudo,
        timeout,
        env: Object.keys(envRecord).length > 0 ? envRecord : undefined,
      };

      const response = await api.post(`/shell/projet/${projetId}/run`, payload);

      if (response.data?.status === 'ok') {
        const result = response.data;
        toast.success(
          t('shell.projectCompleted', { name: projectName, rc: result.returncode ?? 'n/a' })
        );
      } else {
        toast.success(t('shell.projectRunInitiated', { name: projectName }));
      }

      setOpen(false);
      setRunCommand('');
      setEnvPairs([{ key: '', value: '' }]);
      onRan();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, t('shell.failedToRunProject')));
    } finally {
      setRunning(false);
    }
  }, [projetId, projectName, runCommand, sudo, timeout, envPairs, onRan]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-400 hover:text-emerald-300">
          <Play className="w-3.5 h-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="w-5 h-5 text-emerald-500" />
            {t('shell.runProject') || 'Run Project'}: {projectName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">{t('shell.runCommand') || 'Run Command (optional override)'}</Label>
            <Input
              value={runCommand}
              onChange={(e) => setRunCommand(e.target.value)}
              placeholder="./run.sh"
              className="h-8 text-sm font-mono"
            />
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch checked={sudo} onCheckedChange={setSudo} />
              <Label className="text-xs flex items-center gap-1">
                <Shield className="w-3 h-3" /> {t('shell.sudo')}
              </Label>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('shell.timeout')}</Label>
              <Input
                type="number"
                value={timeout}
                onChange={(e) => setTimeout(Number(e.target.value))}
                className="h-8 text-sm w-24"
                min={1}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1">
              <Variable className="w-3 h-3" />
              {t('shell.envVars') || 'Env Variables'}
            </Label>
            {envPairs.map((pair, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <Input
                  value={pair.key}
                  onChange={(e) => {
                    const next = [...envPairs];
                    next[idx] = { ...next[idx], key: e.target.value };
                    setEnvPairs(next);
                  }}
                  placeholder="KEY"
                  className="h-7 text-xs font-mono w-1/3"
                />
                <span className="text-gray-500 text-xs">=</span>
                <Input
                  value={pair.value}
                  onChange={(e) => {
                    const next = [...envPairs];
                    next[idx] = { ...next[idx], value: e.target.value };
                    setEnvPairs(next);
                  }}
                  placeholder="value"
                  className="h-7 text-xs font-mono flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 flex-shrink-0"
                  onClick={() => {
                    setEnvPairs((prev) =>
                      prev.length <= 1
                        ? [{ key: '', value: '' }]
                        : prev.filter((_, i) => i !== idx)
                    );
                  }}
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-emerald-500"
              onClick={() => setEnvPairs((prev) => [...prev, { key: '', value: '' }])}
            >
              <Plus className="w-3 h-3 mr-1" /> {t('shell.addEnv')}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              {t('common.cancel') || 'Cancel'}
            </Button>
          </DialogClose>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={handleRun}
            disabled={running}
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Play className="w-4 h-4 mr-1" />}
            {t('shell.run') || 'Run'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Project Card ──────────────────────────────────────────────────────────

function ProjectCard({
  project,
  onRefresh,
}: {
  project: ShellProjectWorkspaceInfo;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [detailOpen, setDetailOpen] = useState(false);

  const handleDelete = useCallback(
    async (force: boolean) => {
      try {
        await api.delete(`/shell/projet/${project.projet_id}`, {
          params: { force },
        });
        toast.success(t('shell.projectDeleted', { name: project.name }));
        onRefresh();
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, t('shell.failedToDeleteProject')));
      }
    },
    [project.projet_id, project.name, onRefresh]
  );

  const handleAbort = useCallback(async () => {
    try {
      await api.post(`/shell/projet/${project.projet_id}/abort`);
      toast.success(t('shell.projectAbortRequested', { name: project.name }));
      onRefresh();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, t('shell.failedToAbortProject')));
    }
  }, [project.projet_id, project.name, onRefresh]);

  const handleDownload = useCallback(async () => {
    try {
      const response = await api.get(`/shell/projet/${project.projet_id}/download`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name}.tar.gz`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, t('shell.failedToDownloadProject')));
    }
  }, [project.projet_id, project.name, t]);

  return (
    <>
      <Card className="border-border/50 hover:border-emerald-500/30 transition-colors">
        <CardContent className="p-4 space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <FolderKanban className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                <span className="font-medium text-sm truncate">{project.name}</span>
              </div>
              <p className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">
                {project.projet_id}
              </p>
            </div>
            <Badge variant="outline" className={`text-[10px] px-1.5 flex-shrink-0 ${statusColor(project.status)}`}>
              {statusIcon(project.status)}
              <span className="ml-1 capitalize">{project.status}</span>
            </Badge>
          </div>

          {/* Meta info */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {project.owner && (
              <span className="flex items-center gap-1">
                <Server className="w-3 h-3" />
                {project.owner}
              </span>
            )}
            {project.created_at && (
              <span>{new Date(project.created_at).toLocaleDateString()}</span>
            )}
          </div>

          {/* Tags */}
          {project.tags && project.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {project.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-[10px] px-1 py-0">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {/* Last command */}
          {project.last_command && (
            <pre className="bg-muted/50 p-2 rounded text-[10px] font-mono max-h-16 overflow-auto whitespace-pre-wrap text-muted-foreground">
              {project.last_command.slice(0, 200)}
              {project.last_command.length > 200 ? '...' : ''}
            </pre>
          )}

          {/* Actions */}
          <div className="flex items-center gap-1 pt-1">
            <RunProjectDialog
              projetId={project.projet_id}
              projectName={project.name}
              onRan={onRefresh}
            />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setDetailOpen(true)}
                >
                  <Eye className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('shell.showDetails') || 'Show details'}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleDownload}
                >
                  <Download className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('shell.download') || 'Download'}</TooltipContent>
            </Tooltip>

            <div className="flex-1" />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <MoreVertical className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {project.status === 'running' && (
                  <DropdownMenuItem onClick={handleAbort}>
                    <Square className="w-3.5 h-3.5 mr-1.5 text-yellow-500" />
                    {t('shell.abort') || 'Abort'}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => handleDelete(false)}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  {t('shell.delete') || 'Delete'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => handleDelete(true)}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  {t('shell.forceDelete') || 'Force Delete'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>

      <ProjectDetailDialog
        projetId={project.projet_id}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export default function ShellTerminal() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { effectiveLandscape } = useOrientation();
  const isLandscapeMobile = isMobile && effectiveLandscape;
  // On mobile, saved scripts sidebar is collapsed by default (hidden).
  // User can toggle it with a button to avoid it taking space in the middle.
  const [scriptsPanelOpen, setScriptsPanelOpen] = useState(false);
  // Count of filled env vars — shown as a badge on the env tab
  const filledEnvCount = useShellStore(s => s.envVars.filter(e => e.key.trim()).length);
  const {
    scripts, currentOutput, isExecuting, activeShell, sudoEnabled,
    addScript, removeScript, setCurrentOutput, appendOutput, setIsExecuting,
    setActiveShell, setSudoEnabled,
    getEnvRecord, availableShells, setAvailableShells,
    projects, setProjects, isLoadingProjects, setIsLoadingProjects,
    activeTab, setActiveTab,
  } = useShellStore();

  const [command, setCommand] = useState('');
  const [scriptName, setScriptName] = useState('');
  const terminalRef = useRef<HTMLDivElement>(null);
  const scriptFileRef = useRef<HTMLInputElement>(null);
  const scriptUploadFileRef = useRef<HTMLInputElement>(null);
  const commandHistory = useRef<string[]>([]);
  const historyIndex = useRef(-1);

  // ─── Auto-scroll terminal ────────────────────────────────────────────

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [currentOutput]);

  // ─── Execute command (with env) ──────────────────────────────────────

  const executeCommand = useCallback(async (cmd: string) => {
    if (!cmd.trim()) return;

    setIsExecuting(true);
    commandHistory.current.unshift(cmd);
    historyIndex.current = -1;

    const env = getEnvRecord();
    const hasEnv = Object.keys(env).length > 0;

    const outputLine = `${sudoEnabled ? 'root' : 'user'}@samba-dc $ ${cmd}\n`;
    appendOutput(outputLine);

    try {
      // Detect multi-line: use script endpoint for multiline, exec for single
      const lines = cmd.split('\n').filter((l) => l.trim());
      let response;

      if (lines.length > 1) {
        response = await api.post('/shell/script', {
          shell: activeShell,
          sudo: sudoEnabled,
          lines,
          timeout: 30,
          ...(hasEnv ? { env } : {}),
        });
      } else {
        response = await api.post('/shell/exec', {
          shell: activeShell,
          sudo: sudoEnabled,
          cmd,
          timeout: 30,
          ...(hasEnv ? { env } : {}),
        });
      }

      const result = response.data;
      if (result.data?.stdout) {
        appendOutput(result.data.stdout + '\n');
      }
      if (result.data?.stderr) {
        appendOutput('\x1b[31m' + result.data.stderr + '\x1b[0m\n');
      }
      if (result.data?.returncode !== 0 && result.data?.returncode !== undefined) {
        appendOutput(`\x1b[33m[Exit code: ${result.data.returncode}]\x1b[0m\n`);
      }
    } catch (err: unknown) {
      appendOutput(`\x1b[31m${t('common.error')}: ${getErrorMessage(err, 'Unknown error')}\x1b[0m\n`);
    } finally {
      setIsExecuting(false);
      setCommand('');
    }
  }, [activeShell, sudoEnabled, appendOutput, setIsExecuting, getEnvRecord, t]);

  // ─── Key handlers ────────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      executeCommand(command);
    } else if (e.key === 'ArrowUp' && !e.shiftKey) {
      const textarea = e.target as HTMLTextAreaElement;
      if (textarea.selectionStart === 0 || command.split('\n').length <= 1) {
        e.preventDefault();
        if (historyIndex.current < commandHistory.current.length - 1) {
          historyIndex.current++;
          setCommand(commandHistory.current[historyIndex.current]);
        }
      }
    } else if (e.key === 'ArrowDown' && !e.shiftKey) {
      const textarea = e.target as HTMLTextAreaElement;
      const lines = command.split('\n').length;
      const lastLineStart = command.lastIndexOf('\n') + 1;
      if (lines <= 1 || textarea.selectionStart >= lastLineStart) {
        e.preventDefault();
        if (historyIndex.current > 0) {
          historyIndex.current--;
          setCommand(commandHistory.current[historyIndex.current]);
        } else {
          historyIndex.current = -1;
          setCommand('');
        }
      }
    }
  }, [command, executeCommand]);

  // ─── Script file upload (shell.script.file API) ─────────────────────

  const handleUploadScriptFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsExecuting(true);
    const outputLine = `${sudoEnabled ? 'root' : 'user'}@samba-dc $ [upload: ${file.name}]\n`;
    appendOutput(outputLine);

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('shell', activeShell);
      fd.append('sudo', String(sudoEnabled));
      fd.append('timeout', '60');
      fd.append('auto_delete', 'true');

      const response = await api.post('/shell/script/file', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });

      const result = response.data;
      if (result.data?.stdout) {
        appendOutput(result.data.stdout + '\n');
      }
      if (result.data?.stderr) {
        appendOutput('\x1b[31m' + result.data.stderr + '\x1b[0m\n');
      }
      if (result.data?.returncode !== undefined && result.data.returncode !== 0) {
        appendOutput(`\x1b[33m[Exit code: ${result.data.returncode}]\x1b[0m\n`);
      }
      toast.success(t('shell.scriptExecuted', { name: file.name }));
    } catch (err: unknown) {
      appendOutput(`\x1b[31m${t('common.error')}: ${getErrorMessage(err, 'Unknown error')}\x1b[0m\n`);
      toast.error(t('shell.failedToExecuteScriptFile'));
    } finally {
      setIsExecuting(false);
      if (scriptUploadFileRef.current) scriptUploadFileRef.current.value = '';
    }
  }, [activeShell, sudoEnabled, appendOutput, setIsExecuting]);

  // ─── Load script into editor (local) ─────────────────────────────────

  const handleLoadScriptFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      if (content) {
        setCommand(content);
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (ext === 'py') {
          setActiveShell('python3');
        } else {
          setActiveShell('bash');
        }
        toast.success(t('shell.scriptLoaded', { name: file.name }));
      }
    };
    reader.readAsText(file);
    if (scriptFileRef.current) scriptFileRef.current.value = '';
  }, [setActiveShell]);

  // ─── Saved scripts ───────────────────────────────────────────────────

  const handleSaveScript = useCallback(() => {
    if (!scriptName || !command.trim()) return;
    const script: ShellScript = {
      id: `script_${Date.now()}`,
      name: scriptName,
      content: command,
      shell: activeShell,
      sudo: sudoEnabled,
      createdAt: new Date().toISOString(),
    };
    addScript(script);
    toast.success(t('shell.scriptSaved', { name: scriptName }));
    setScriptName('');
  }, [scriptName, command, activeShell, sudoEnabled, addScript]);

  const handleRunSavedScript = useCallback(async (script: ShellScript) => {
    setActiveShell(script.shell);
    setSudoEnabled(script.sudo);
    await executeCommand(script.content);
  }, [executeCommand, setActiveShell, setSudoEnabled]);

  const handleExportScript = useCallback((script: ShellScript) => {
    const ext = script.shell === 'python3' ? '.py' : '.sh';
    const blob = new Blob([script.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${script.name}${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ─── Fetch available shells ──────────────────────────────────────────

  const fetchShells = useCallback(async () => {
    try {
      const response = await api.get('/shell/');
      const shells: ShellInfo[] = response.data?.shells || [];
      setAvailableShells(shells);
      if (shells.length > 0) {
        toast.success(t('shell.shellsAvailable', { count: shells.filter((s) => s.available).length }));
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, t('shell.failedToFetchShells')));
    }
  }, [setAvailableShells]);

  // ─── Fetch projects ──────────────────────────────────────────────────

  const fetchProjects = useCallback(async () => {
    setIsLoadingProjects(true);
    try {
      const response = await api.get('/shell/projet/list');
      setProjects(response.data?.projects || []);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, t('shell.failedToFetchProjects')));
    } finally {
      setIsLoadingProjects(false);
    }
  }, [setProjects, setIsLoadingProjects]);

  // ─── Load projects when tab switches ─────────────────────────────────

  useEffect(() => {
    if (activeTab === 'projects') {
      fetchProjects();
    }
  }, [activeTab, fetchProjects]);

  // ─── ANSI color rendering ────────────────────────────────────────────

  const renderOutput = (text: string | unknown) => {
    const safeText = typeof text === 'string' ? text : String(text ?? '');
    return safeText.split('\n').map((line, i) => {
      const colored = line
        .replace(/\x1b\[31m(.*?)\x1b\[0m/g, '<span class="text-red-400">$1</span>')
        .replace(/\x1b\[33m(.*?)\x1b\[0m/g, '<span class="text-yellow-400">$1</span>')
        .replace(/\x1b\[32m(.*?)\x1b\[0m/g, '<span class="text-emerald-400">$1</span>');
      return <div key={i} dangerouslySetInnerHTML={{ __html: colored || '&nbsp;' }} />;
    });
  };

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <RequirePermission permission="shell.execute">
      <div className="flex flex-col md:flex-row h-[calc(100vh-7rem)] gap-4 overflow-hidden">
        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'terminal' | 'projects' | 'env')} className="flex flex-col flex-1 gap-0">
            {/* Top toolbar — terminal controls (shell selector, sudo, clear, etc.).
                Tabs are moved to the BOTTOM as a navigation bar so they're
                always visible and accessible. */}
            <div className="flex items-center gap-1 md:gap-2 mb-2 flex-wrap">
              {activeTab === 'terminal' && (
                <>
                  <Select value={activeShell} onValueChange={(v) => setActiveShell(v as 'bash' | 'python3')}>
                    <SelectTrigger className="w-28 md:w-32 h-8 md:h-9 text-xs md:text-sm">
                      <Terminal className="w-3 h-3 mr-1" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableShells.length > 0 ? (
                        availableShells
                          .filter((s) => s.available)
                          .map((s) => (
                            <SelectItem key={s.name} value={s.name}>
                              {s.name}
                              {s.description && (
                                <span className="text-muted-foreground ml-1 text-[10px]">
                                  — {s.description}
                                </span>
                              )}
                            </SelectItem>
                          ))
                      ) : (
                        <>
                          <SelectItem value="bash">Bash</SelectItem>
                          <SelectItem value="python3">Python 3</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>

                  <div className="flex items-center gap-2">
                    <Switch checked={sudoEnabled} onCheckedChange={setSudoEnabled} />
                    <Label className="text-xs flex items-center gap-1">
                      <Shield className="w-3 h-3" />
                      {t('shell.sudo')}
                    </Label>
                  </div>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={fetchShells}
                      >
                        <List className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('shell.listShells') || 'List available shells'}</TooltipContent>
                  </Tooltip>

                  {/* Toggle saved scripts panel — mobile only (desktop always shows it) */}
                  {isMobile && (
                    <Button
                      variant={scriptsPanelOpen ? 'default' : 'ghost'}
                      size="icon"
                      className="h-8 w-8 md:hidden"
                      onClick={() => setScriptsPanelOpen(v => !v)}
                      title={t('shell.savedScripts') || 'Saved scripts'}
                    >
                      <FileCode className="w-3.5 h-3.5" />
                    </Button>
                  )}

                  <div className="flex-1" />

                  <Button variant="ghost" size="sm" className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm" onClick={() => setCurrentOutput('')}>
                    <span className="hidden sm:inline">{t('common.clear')}</span>
                    <span className="sm:hidden">clr</span>
                  </Button>
                </>
              )}

              {activeTab === 'projects' && (
                <>
                  <div className="flex-1" />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={fetchProjects}
                    disabled={isLoadingProjects}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingProjects ? 'animate-spin' : ''}`} />
                  </Button>
                  <CreateProjectDialog onCreated={fetchProjects} />
                </>
              )}
            </div>

            {/* ── Terminal Tab ──────────────────────────────────────────── */}
            <TabsContent value="terminal" className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <Card className="flex-1 flex flex-col min-h-0 overflow-hidden bg-gray-950 border-gray-800 py-0 gap-0">
                {/* Terminal output — explicit height via calc so overflow-y-auto
                    works reliably on mobile + rotate. flex-1 alone doesn't
                    constrain height properly in nested flex/Tabs on some
                    browsers, causing scroll to "bleed" to body. */}
                <div
                  ref={terminalRef}
                  className="p-4 font-mono text-sm text-emerald-400 overflow-y-auto overflow-x-hidden whitespace-pre-wrap leading-relaxed h-[calc(100vh-22rem)] md:h-[calc(100vh-20rem)] min-h-[200px] overscroll-contain"
                  style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
                >
                  {currentOutput ? (
                    renderOutput(currentOutput)
                  ) : (
                    <span className="text-gray-600">
                      {t('shell.welcomeMessage')}{'\n'}
                      {t('shell.welcomeHint')}{'\n'}
                      {t('shell.welcomeEnv')}{'\n\n'}
                    </span>
                  )}
                </div>

                {/* Command input area */}
                <div className="border-t border-gray-800 bg-gray-900">
                  <div className="flex items-center gap-2 px-3 pt-2">
                    <ChevronRight className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <span className="text-xs text-gray-500 font-mono">
                      {activeShell === 'bash' ? 'bash' : 'python3'}{sudoEnabled ? ' (sudo)' : ''}
                    </span>
                    <div className="flex-1" />
                    {/* Load into editor */}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-gray-500 hover:text-emerald-400"
                      onClick={() => scriptFileRef.current?.click()}
                      title={t('shell.loadScript') || 'Load script from file'}
                    >
                      <Upload className="w-3.5 h-3.5" />
                    </Button>
                    <input
                      ref={scriptFileRef}
                      type="file"
                      accept=".sh,.py,.txt"
                      className="hidden"
                      onChange={handleLoadScriptFile}
                    />
                    {/* Execute script file directly via API */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-gray-500 hover:text-amber-400"
                          onClick={() => scriptUploadFileRef.current?.click()}
                          disabled={isExecuting}
                        >
                          <FileUp className="w-3.5 h-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t('shell.uploadAndRun') || 'Upload & run script file'}
                      </TooltipContent>
                    </Tooltip>
                    <input
                      ref={scriptUploadFileRef}
                      type="file"
                      accept=".sh,.py,.txt,.tar,.tar.gz,.tgz,.zip"
                      className="hidden"
                      onChange={handleUploadScriptFile}
                    />
                    {/* Execute button */}
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => executeCommand(command)}
                      disabled={isExecuting || !command.trim()}
                      className="h-6 w-6 text-emerald-400 hover:text-emerald-300"
                      title={t('shell.run')}
                    >
                      {isExecuting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  </div>
                  <Textarea
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isExecuting}
                    placeholder={activeShell === 'bash' ? '$ enter command...' : '>>> enter code...'}
                    className="flex-1 bg-transparent text-emerald-400 font-mono text-sm border-0 resize-y min-h-[60px] max-h-[200px] focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-gray-600 p-3 pt-1"
                    autoFocus
                    rows={3}
                  />
                </div>
              </Card>
            </TabsContent>

            {/* ── Env Tab (Environment Variables) ────────────────────────── */}
            <TabsContent value="env" className="flex-1 min-h-0">
              <Card className="h-full flex flex-col overflow-hidden bg-gray-950 border-gray-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Variable className="w-4 h-4 text-emerald-400" />
                    {t('shell.envVars') || 'Переменные окружения'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto">
                  <EnvEditor />
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Projects Tab ──────────────────────────────────────────── */}
            <TabsContent value="projects" className="flex-1 min-h-0">
              <ScrollArea className="h-full">
                {isLoadingProjects && projects.length === 0 ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                  </div>
                ) : projects.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <FolderKanban className="w-12 h-12 mb-3 opacity-30" />
                    <p className="text-sm">{t('shell.noProjects') || 'No projects yet'}</p>
                    <p className="text-xs mt-1">
                      {t('shell.createFirstProject') || 'Create your first shell project to get started'}
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                    {projects.map((project) => (
                      <ProjectCard
                        key={project.projet_id}
                        project={project}
                        onRefresh={fetchProjects}
                      />
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            {/* Bottom navigation bar — tabs (Терминал / Проекты / env).
                Placed at the bottom so it's always visible and easy to tap,
                like a mobile bottom-nav. Visible on all screen sizes. */}
            <TabsList className="flex flex-row justify-around w-full h-12 flex-shrink-0 bg-gray-900 border border-gray-800 rounded-lg">
              <TabsTrigger value="terminal" className="flex-1 flex flex-col items-center gap-0.5 text-xs py-1.5 data-[state=active]:bg-emerald-600/20 data-[state=active]:text-emerald-400 rounded-md">
                <Terminal className="w-4 h-4" />
                <span>{t('shell.terminal') || 'Терминал'}</span>
              </TabsTrigger>
              <TabsTrigger value="projects" className="flex-1 flex flex-col items-center gap-0.5 text-xs py-1.5 data-[state=active]:bg-emerald-600/20 data-[state=active]:text-emerald-400 rounded-md">
                <FolderKanban className="w-4 h-4" />
                <span>{t('shell.projects') || 'Проекты'}</span>
              </TabsTrigger>
              <TabsTrigger value="env" className="flex-1 flex flex-col items-center gap-0.5 text-xs py-1.5 data-[state=active]:bg-emerald-600/20 data-[state=active]:text-emerald-400 rounded-md relative">
                <Variable className="w-4 h-4" />
                <span>env</span>
                {filledEnvCount > 0 && (
                  <Badge variant="outline" className="absolute top-0.5 right-1/4 text-[9px] px-1 py-0 h-3 border-emerald-500/30 text-emerald-400 bg-gray-900">
                    {filledEnvCount}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* ── Saved Scripts Sidebar ───────────────────────────────────────
            Desktop: always visible as a column on the right.
            Mobile: HIDDEN by default (collapsed), toggled by a button in the
            terminal toolbar. This prevents it from taking space in the middle
            and pushing the terminal output around. */}
        {(!isMobile || scriptsPanelOpen) && (
        <div className="w-full md:w-72 flex-shrink-0 max-h-[30vh] md:max-h-none overflow-hidden">
          <Card className="h-full flex flex-col overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileCode className="w-4 h-4" />
                {t('shell.savedScripts')}
              </CardTitle>
            </CardHeader>
            <ScrollArea className="flex-1 overflow-y-auto">
              <CardContent className="pt-0 space-y-2">
                {/* Save current script */}
                <div className="flex gap-1">
                  <Input
                    value={scriptName}
                    onChange={(e) => setScriptName(e.target.value)}
                    placeholder={t('shell.scriptName')}
                    className="h-7 text-xs"
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-7 w-7 flex-shrink-0"
                    onClick={handleSaveScript}
                    disabled={!scriptName || !command.trim()}
                  >
                    <Save className="w-3 h-3" />
                  </Button>
                </div>

                {/* Load script from file */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-7 text-xs"
                  onClick={() => scriptFileRef.current?.click()}
                >
                  <Upload className="w-3 h-3 mr-1" />
                  {t('shell.loadScript') || 'Load script file'}
                </Button>

                {/* Available shells indicator */}
                {availableShells.length > 0 && (
                  <>
                    <Separator className="my-2" />
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        {t('shell.availableShells') || 'Available Shells'}
                      </span>
                      {availableShells.map((sh) => (
                        <div
                          key={sh.name}
                          className="flex items-center gap-2 text-xs px-2 py-1 rounded bg-muted/50"
                        >
                          <span
                            className={`w-2 h-2 rounded-full ${
                              sh.available ? 'bg-emerald-400' : 'bg-gray-500'
                            }`}
                          />
                          <span className="font-mono">{sh.name}</span>
                          {sh.path && (
                            <span className="text-muted-foreground text-[10px] truncate flex-1 text-right">
                              {sh.path}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <Separator className="my-2" />

                {/* Script list */}
                {scripts.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    {t('shell.noScripts')}
                  </p>
                ) : (
                  scripts.map((script) => (
                    <div key={script.id} className="rounded-md border p-2 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium truncate">{script.name}</span>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="text-[10px] px-1">
                            {script.shell}
                          </Badge>
                          {script.sudo && (
                            <Badge className="text-[10px] px-1 bg-red-500/20 text-red-400 border-0">
                              sudo
                            </Badge>
                          )}
                        </div>
                      </div>
                      <pre className="text-[10px] text-muted-foreground bg-muted p-1.5 rounded max-h-24 overflow-auto font-mono whitespace-pre-wrap">
                        {script.content.slice(0, 200)}
                        {script.content.length > 200 ? '...' : ''}
                      </pre>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => handleRunSavedScript(script)}
                          title={t('shell.runScript')}
                        >
                          <Play className="w-3 h-3 text-emerald-500" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => {
                            setCommand(script.content);
                            setActiveShell(script.shell);
                            setSudoEnabled(script.sudo);
                          }}
                          title={t('shell.editScript')}
                        >
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => handleExportScript(script)}
                          title={t('shell.exportScript')}
                        >
                          <Download className="w-3 h-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => removeScript(script.id)}
                        >
                          <Trash2 className="w-3 h-3 text-red-400" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </ScrollArea>
          </Card>
        </div>
        )}
      </div>
    </RequirePermission>
  );
}
