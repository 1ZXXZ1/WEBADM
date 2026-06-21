import { create } from 'zustand';
import type { ShellScript } from '@/types';
import type { ShellInfo, ShellProjectWorkspaceInfo } from '@/lib/api-types';

interface EnvEntry {
  key: string;
  value: string;
}

interface ShellStore {
  scripts: ShellScript[];
  currentOutput: string;
  isExecuting: boolean;
  activeShell: 'bash' | 'python3';
  sudoEnabled: boolean;
  envVars: EnvEntry[];
  availableShells: ShellInfo[];
  projects: ShellProjectWorkspaceInfo[];
  isLoadingProjects: boolean;
  activeTab: 'terminal' | 'projects' | 'env';

  setScripts: (scripts: ShellScript[]) => void;
  addScript: (script: ShellScript) => void;
  removeScript: (id: string) => void;
  updateScript: (id: string, updates: Partial<ShellScript>) => void;
  setCurrentOutput: (output: string) => void;
  appendOutput: (text: string) => void;
  setIsExecuting: (v: boolean) => void;
  setActiveShell: (shell: 'bash' | 'python3') => void;
  setSudoEnabled: (v: boolean) => void;
  setEnvVars: (vars: EnvEntry[]) => void;
  addEnvVar: () => void;
  removeEnvVar: (index: number) => void;
  updateEnvVar: (index: number, field: 'key' | 'value', val: string) => void;
  clearEnvVars: () => void;
  getEnvRecord: () => Record<string, string>;
  setAvailableShells: (shells: ShellInfo[]) => void;
  setProjects: (projects: ShellProjectWorkspaceInfo[]) => void;
  setIsLoadingProjects: (v: boolean) => void;
  setActiveTab: (tab: 'terminal' | 'projects') => void;
}

export const useShellStore = create<ShellStore>((set, get) => ({
  scripts: [],
  currentOutput: '',
  isExecuting: false,
  activeShell: 'bash',
  sudoEnabled: false,
  envVars: [{ key: '', value: '' }],
  availableShells: [],
  projects: [],
  isLoadingProjects: false,
  activeTab: 'terminal',

  setScripts: (scripts) => set({ scripts }),
  addScript: (script) => set((state) => ({ scripts: [...state.scripts, script] })),
  removeScript: (id) => set((state) => ({ scripts: state.scripts.filter((s) => s.id !== id) })),
  updateScript: (id, updates) => set((state) => ({
    scripts: state.scripts.map((s) => s.id === id ? { ...s, ...updates } : s),
  })),
  setCurrentOutput: (output) => set({ currentOutput: output }),
  appendOutput: (text) => set((state) => ({ currentOutput: state.currentOutput + text })),
  setIsExecuting: (v) => set({ isExecuting: v }),
  setActiveShell: (shell) => set({ activeShell: shell }),
  setSudoEnabled: (v) => set({ sudoEnabled: v }),
  setEnvVars: (vars) => set({ envVars: vars }),
  addEnvVar: () => set((state) => ({ envVars: [...state.envVars, { key: '', value: '' }] })),
  removeEnvVar: (index) => set((state) => ({
    envVars: state.envVars.length <= 1 ? [{ key: '', value: '' }] : state.envVars.filter((_, i) => i !== index),
  })),
  updateEnvVar: (index, field, val) => set((state) => ({
    envVars: state.envVars.map((entry, i) => i === index ? { ...entry, [field]: val } : entry),
  })),
  clearEnvVars: () => set({ envVars: [{ key: '', value: '' }] }),
  getEnvRecord: () => {
    const envVars = get().envVars;
    const record: Record<string, string> = {};
    for (const entry of envVars) {
      if (entry.key.trim()) {
        record[entry.key.trim()] = entry.value;
      }
    }
    return record;
  },
  setAvailableShells: (shells) => set({ availableShells: shells }),
  setProjects: (projects) => set({ projects }),
  setIsLoadingProjects: (v) => set({ isLoadingProjects: v }),
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
