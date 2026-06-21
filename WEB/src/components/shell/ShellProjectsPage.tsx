'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useShellStore } from '@/stores/shell-store';
import { RequirePermission } from '@/components/permissions/RequirePermission';
import api, { getErrorMessage } from '@/lib/api';
import type { ShellProjectWorkspaceInfo } from '@/lib/api-types';
import {
  Plus, Play, Trash2, Download, Eye, XCircle,
  Loader2, RefreshCw, FolderSync, Tag, Clock, User,
  Shield, FileArchive, ChevronDown, ChevronUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { useOrientation } from '@/hooks/use-orientation';

const statusColors: Record<string, string> = {
  creating: 'bg-purple-500/20 text-purple-400',
  ready: 'bg-emerald-500/20 text-emerald-400',
  running: 'bg-blue-500/20 text-blue-400',
  completed: 'bg-gray-500/20 text-gray-400',
  failed: 'bg-red-500/20 text-red-400',
  aborted: 'bg-yellow-500/20 text-yellow-400',
  deleting: 'bg-orange-500/20 text-orange-400',
};

function ProjectCard({ project, onRefresh }: { project: ShellProjectWorkspaceInfo; onRefresh: () => void }) {
  const { t } = useTranslation();
  const [isRunning, setIsRunning] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const handleRun = useCallback(async () => {
    const command = prompt(`${t('shellProjects.runCommand')}:`);
    if (!command) return;
    setIsRunning(true);
    try {
      await api.post(`/shell/projet/${project.projet_id}/run`, { run_command: command });
      toast.success(t('shellProjects.commandStarted'));
      onRefresh();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, t('shellProjects.runFailed')));
    } finally {
      setIsRunning(false);
    }
  }, [project.projet_id, onRefresh, t]);

  const handleDelete = useCallback(async () => {
    if (!confirm(t('shellProjects.confirmDelete'))) return;
    try {
      await api.delete(`/shell/projet/${project.projet_id}`);
      toast.success(t('shellProjects.deleted'));
      onRefresh();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, t('shellProjects.deleteFailed')));
    }
  }, [project.projet_id, onRefresh, t]);

  const handleAbort = useCallback(async () => {
    try {
      await api.post(`/shell/projet/${project.projet_id}/abort`);
      toast.success(t('shellProjects.aborted'));
      onRefresh();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, t('shellProjects.abortFailed')));
    }
  }, [project.projet_id, onRefresh, t]);

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

  const statusClass = statusColors[project.status] || 'bg-gray-500/20 text-gray-400';

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <FolderSync className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span className="font-medium text-sm truncate">{project.name}</span>
          </div>
          <Badge className={`text-[10px] px-1.5 ${statusClass}`}>{project.status}</Badge>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          {project.owner && (
            <div className="flex items-center gap-1">
              <User className="w-3 h-3" />
              <span>{project.owner}</span>
            </div>
          )}
          {project.created_at && (
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>{new Date(project.created_at).toLocaleString()}</span>
            </div>
          )}
          {project.last_command && (
            <div className="font-mono text-[10px] bg-muted p-1 rounded truncate">
              $ {project.last_command}
            </div>
          )}
          {project.tags && project.tags.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <Tag className="w-3 h-3" />
              {project.tags.map((tag, i) => (
                <Badge key={i} variant="outline" className="text-[9px] px-1">{tag}</Badge>
              ))}
            </div>
          )}
        </div>

        {showDetails && (
          <div className="text-xs bg-muted p-2 rounded space-y-1 font-mono">
            <div><span className="text-muted-foreground">ID:</span> {project.projet_id}</div>
            <div><span className="text-muted-foreground">{t('shellProjects.workspacePath')}:</span> {project.workspace_path}</div>
            <div><span className="text-muted-foreground">RC:</span> {project.last_returncode ?? '—'}</div>
            <div><span className="text-muted-foreground">{t('shellProjects.health')}:</span> {project.directory_size ? `${(project.directory_size / 1024).toFixed(1)} KB` : '—'}</div>
            <div><span className="text-muted-foreground">{t('shellProjects.uploadFile')}:</span> {project.file_count ?? '—'}</div>
            <div><span className="text-muted-foreground">{t('shell.autoDelete')}:</span> {project.auto_delete ? t('common.yes') : t('common.no')}</div>
            {project.ttl_seconds && <div><span className="text-muted-foreground">TTL:</span> {project.ttl_seconds}s</div>}
            {project.execution_history && project.execution_history.length > 0 && (
              <div>
                <span className="text-muted-foreground">{t('shellProjects.executionHistory')}:</span>
                {project.execution_history.map((h, i) => (
                  <div key={i} className="ml-2 text-[9px]">
                    [{h.rc}] {h.command} ({h.elapsed.toFixed(1)}s)
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleRun} disabled={isRunning || project.status === 'running'}>
            {isRunning ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}
            {t('shellProjects.run')}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowDetails(!showDetails)}>
            <Eye className="w-3 h-3 mr-1" />
            {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleDownload}>
            <Download className="w-3 h-3" />
          </Button>
          {project.status === 'running' && (
            <Button size="sm" variant="ghost" className="h-7 text-xs text-yellow-500" onClick={handleAbort}>
              <XCircle className="w-3 h-3" />
            </Button>
          )}
          <div className="flex-1" />
          <Button size="sm" variant="ghost" className="h-7 text-xs text-red-400" onClick={handleDelete}>
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateProjectDialog({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [runCommand, setRunCommand] = useState('');
  const [owner, setOwner] = useState('');
  const [tags, setTags] = useState('');
  const [sudo, setSudo] = useState(false);
  const [autoDelete, setAutoDelete] = useState(true);
  const [timeout, setTimeout_] = useState(300);
  const [ttlSeconds, setTtlSeconds] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = useCallback(async () => {
    if (!name.trim()) return;
    setIsCreating(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        auto_delete: autoDelete,
        sudo,
        timeout,
      };
      if (runCommand.trim()) body.run_command = runCommand.trim();
      if (owner.trim()) body.owner = owner.trim();
      if (tags.trim()) body.tags = tags.split(',').map(t => t.trim()).filter(Boolean);
      if (ttlSeconds.trim()) body.ttl_seconds = parseInt(ttlSeconds, 10);

      await api.post('/shell/projet/', body);
      toast.success(t('shellProjects.created'));
      setOpen(false);
      setName('');
      setRunCommand('');
      setOwner('');
      setTags('');
      setSudo(false);
      setAutoDelete(true);
      setTimeout_(300);
      setTtlSeconds('');
      onCreated();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, t('shellProjects.createFailed')));
    } finally {
      setIsCreating(false);
    }
  }, [name, runCommand, owner, tags, sudo, autoDelete, timeout, ttlSeconds, onCreated, t]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm bg-emerald-600 hover:bg-emerald-700">
          <Plus className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
          <span className="hidden sm:inline">{t('shellProjects.create')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] md:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('shellProjects.createProject')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t('shellProjects.projectName')} *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="deploy-app" className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">{t('shellProjects.runCommand')}</Label>
            <Input value={runCommand} onChange={e => setRunCommand(e.target.value)} placeholder="./run.sh" className="h-8 text-sm" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('shellProjects.owner')}</Label>
              <Input value={owner} onChange={e => setOwner(e.target.value)} placeholder="admin" className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">{t('shellProjects.tags')}</Label>
              <Input value={tags} onChange={e => setTags(e.target.value)} placeholder="prod, v2" className="h-8 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('shellProjects.timeout')}</Label>
              <Input type="number" value={timeout} onChange={e => setTimeout_(parseInt(e.target.value) || 300)} className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">{t('shellProjects.ttl')}</Label>
              <Input value={ttlSeconds} onChange={e => setTtlSeconds(e.target.value)} placeholder="3600" className="h-8 text-sm" />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch checked={sudo} onCheckedChange={setSudo} />
              <Label className="text-xs flex items-center gap-1">
                <Shield className="w-3 h-3" />
                {t('shell.sudo')}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={autoDelete} onCheckedChange={setAutoDelete} />
              <Label className="text-xs">{t('shellProjects.autoDelete')}</Label>
            </div>
          </div>
          <Button onClick={handleCreate} disabled={!name.trim() || isCreating} className="w-full">
            {isCreating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            {t('shellProjects.create')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ShellProjectsPage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { effectiveLandscape } = useOrientation();
  const isLandscapeMobile = isMobile && effectiveLandscape;
  const { projects, isLoadingProjects, setProjects, setIsLoadingProjects } = useShellStore();
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterTag, setFilterTag] = useState('');

  const fetchProjects = useCallback(async () => {
    setIsLoadingProjects(true);
    try {
      const params: Record<string, string> = {};
      if (filterStatus && filterStatus !== 'all') params.status_filter = filterStatus;
      if (filterTag) params.tag = filterTag;
      const response = await api.get('/shell/projet/list', { params });
      setProjects(response.data.projects || []);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, t('shellProjects.loadFailed')));
    } finally {
      setIsLoadingProjects(false);
    }
  }, [filterStatus, filterTag, setProjects, setIsLoadingProjects, t]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  return (
    <RequirePermission permission="shell.execute">
      <div className="space-y-4">
        {/* Toolbar - title row + controls row. Wraps on mobile. */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FolderSync className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            <span className="truncate">{t('shellProjects.title')}</span>
          </h2>
          <div className="flex items-center gap-1 md:gap-2 flex-wrap">
            <Input
              value={filterTag}
              onChange={e => setFilterTag(e.target.value)}
              placeholder={t('shellProjects.filterTag')}
              className="h-8 md:h-9 w-32 md:w-40 text-xs md:text-sm"
            />
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 md:h-9 w-32 md:w-36 text-xs md:text-sm">
                <SelectValue placeholder={t('shellProjects.filterStatus')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('shellProjects.statusAll')}</SelectItem>
                <SelectItem value="creating">{t('shellProjects.statusCreating')}</SelectItem>
                <SelectItem value="ready">{t('shellProjects.statusReady')}</SelectItem>
                <SelectItem value="running">{t('shellProjects.statusRunning')}</SelectItem>
                <SelectItem value="completed">{t('shellProjects.statusCompleted')}</SelectItem>
                <SelectItem value="failed">{t('shellProjects.statusFailed')}</SelectItem>
                <SelectItem value="aborted">{t('shellProjects.statusAborted')}</SelectItem>
                <SelectItem value="deleting">{t('shellProjects.statusDeleting')}</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm" onClick={fetchProjects}>
              <RefreshCw className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
              <span className="hidden sm:inline">{t('common.refresh')}</span>
            </Button>
            <CreateProjectDialog onCreated={fetchProjects} />
          </div>
        </div>

        {isLoadingProjects ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <FolderSync className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">{t('shellProjects.noProjects')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {projects.map((project) => (
              <ProjectCard key={project.projet_id} project={project} onRefresh={fetchProjects} />
            ))}
          </div>
        )}
      </div>
    </RequirePermission>
  );
}
