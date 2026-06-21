import { create } from 'zustand';
import type { ETLStep, ETLRecipe, FieldMapping } from '@/types';
import type { AIAction } from '@/types/ai';

const STORAGE_KEY = 'etl-builder-state';

interface ETLStore {
  steps: ETLStep[];
  selectedStepId: string | null;
  importedData: Record<string, string>[];

  addStep: (step: ETLStep) => void;
  removeStep: (id: string) => void;
  updateStep: (id: string, updates: Partial<ETLStep>) => void;
  reorderSteps: (fromIndex: number, toIndex: number) => void;
  setSelectedStep: (id: string | null) => void;
  setFieldMappings: (stepId: string, mappings: FieldMapping[]) => void;
  setImportedData: (data: Record<string, string>[]) => void;
  removeImportedRow: (index: number) => void;
  clearWorkbench: () => void;
  clearSteps: () => void;
  saveRecipe: (name: string) => ETLRecipe;
  loadRecipe: (recipe: ETLRecipe) => void;
  applyAIActions: (actions: AIAction[], replace?: boolean) => void;
  persist: () => void;
  hydrate: () => void;
}

// ─── Helper: Map HTTP path+method → ETL operation method ─────────────────
// AI бэкенд возвращает { method: "GET", path: "/api/v1/users/" },
// а ETL Builder использует "user.list", "user.create" и т.д.
function pathToOperationMethod(httpMethod: string, path: string): string {
  const segments = path.replace(/^\/api\/v\d+\//, '').replace(/\/$/, '').split('/');
  const resource = segments[0] || '';
  const sub = segments[1] || '';

  // Прямой маппинг известных путей
  const map: Record<string, Record<string, string>> = {
    users: { GET_list: 'user.list', GET_item: 'user.get', POST: 'user.create', DELETE: 'user.delete', PUT: 'user.edit' },
    groups: { GET_list: 'group.list', GET_item: 'group.get', POST: 'group.create', DELETE: 'group.delete' },
    computers: { GET_list: 'computer.list', GET_item: 'computer.get', POST: 'computer.create', DELETE: 'computer.delete' },
    contacts: { GET_list: 'contact.list', GET_item: 'contact.get', POST: 'contact.create', DELETE: 'contact.delete' },
    ous: { GET_list: 'ou.list', GET_item: 'ou.get', POST: 'ou.create', DELETE: 'ou.delete' },
    dns: { GET_zones: 'dns.zone.list', GET_records: 'dns.record.list', POST_zones: 'dns.zone.create', POST_records: 'dns.record.create' },
    gpo: { GET_list: 'gpo.list', POST: 'gpo.create', DELETE: 'gpo.delete' },
    domain: { GET_info: 'domain.info', GET_full: 'domain.full' },
    sites: { GET_list: 'site.list', POST: 'site.create' },
    shell: { GET_list: 'shell.list', POST_exec: 'shell.exec', POST_script: 'shell.script' },
    'service-accounts': { GET_list: 'service-account.list', POST: 'service-account.create' },
    delegation: { POST_add: 'delegation.add', DELETE_remove: 'delegation.remove' },
    auth: { POST_login: 'auth.login', POST_check: 'auth.check', GET_me: 'auth.me' },
    batch: { POST: 'batch.run' },
    mgmt: { GET_users: 'mgmt.users.list', GET_keys: 'mgmt.keys.list', GET_roles: 'mgmt.roles.list' },
    misc: { GET_dbcheck: 'misc.dbcheck', GET_time: 'misc.time', GET_processes: 'misc.processes' },
    fsmo: { GET_list: 'fsmo.list', PUT_transfer: 'fsmo.transfer', PUT_seize: 'fsmo.seize' },
    drs: { GET_showrepl: 'drs.showrepl', POST_replicate: 'drs.replicate' },
    tasks: { GET_item: 'task.get', GET_list: 'task.list' },
  };

  const resourceMap = map[resource];
  if (resourceMap) {
    // Если есть подпуть (например /users/{username}) — это GET_item
    const isList = !sub || sub === 'full' || sub === 'stats' || sub === 'search' || sub === 'tree';
    const key = isList && httpMethod === 'GET' ? 'GET_list' : sub ? `${httpMethod}_${sub}` : httpMethod;

    if (resourceMap[key]) return resourceMap[key];
    if (resourceMap[httpMethod]) return resourceMap[httpMethod];
    if (resourceMap['GET_list']) return resourceMap['GET_list'];
  }

  // Фолбэк: собираем из частей пути
  return `${resource}.${httpMethod.toLowerCase()}`;
}

function pathToCategory(path: string): string {
  const segments = path.replace(/^\/api\/v\d+\//, '').replace(/\/$/, '').split('/');
  const resource = segments[0] || 'misc';

  const categoryMap: Record<string, string> = {
    users: 'users',
    groups: 'groups',
    computers: 'computers',
    contacts: 'contacts',
    ous: 'ou',
    dns: 'dns',
    gpo: 'gpo',
    domain: 'domain',
    sites: 'sites',
    shell: 'shell',
    'service-accounts': 'service-accounts',
    delegation: 'delegation',
    auth: 'auth',
    batch: 'batch',
    mgmt: 'management',
    misc: 'misc',
    fsmo: 'fsmo',
    drs: 'drs',
    tasks: 'tasks',
    health: 'system',
    metrics: 'system',
  };

  return categoryMap[resource] || 'misc';
}

// Load from localStorage
function loadState(): Partial<Pick<ETLStore, 'steps' | 'selectedStepId' | 'importedData'>> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return {
      steps: Array.isArray(data.steps) ? data.steps : [],
      selectedStepId: data.selectedStepId ?? null,
      importedData: Array.isArray(data.importedData) ? data.importedData : [],
    };
  } catch {
    return {};
  }
}

export const useETLStore = create<ETLStore>((set, get) => {
  const saved = loadState();

  return {
    steps: saved.steps || [],
    selectedStepId: saved.selectedStepId || null,
    importedData: saved.importedData || [],

    addStep: (step) => set((state) => {
      const newState = { steps: [...state.steps, step] };
      // persist after update
      setTimeout(() => get().persist(), 0);
      return newState;
    }),

    removeStep: (id) => set((state) => {
      const newState = {
        steps: state.steps.filter((s) => s.id !== id),
        selectedStepId: state.selectedStepId === id ? null : state.selectedStepId,
      };
      setTimeout(() => get().persist(), 0);
      return newState;
    }),

    updateStep: (id, updates) => set((state) => {
      const newState = {
        steps: state.steps.map((s) => s.id === id ? { ...s, ...updates } : s),
      };
      setTimeout(() => get().persist(), 0);
      return newState;
    }),

    reorderSteps: (fromIndex, toIndex) => set((state) => {
      const newSteps = [...state.steps];
      const [removed] = newSteps.splice(fromIndex, 1);
      newSteps.splice(toIndex, 0, removed);
      setTimeout(() => get().persist(), 0);
      return { steps: newSteps };
    }),

    setSelectedStep: (id) => {
      set({ selectedStepId: id });
      // Don't persist selection change to avoid flicker on restore
    },

    setFieldMappings: (stepId, mappings) => set((state) => {
      const newState = {
        steps: state.steps.map((s) =>
          s.id === stepId ? { ...s, fieldMappings: mappings } : s
        ),
      };
      setTimeout(() => get().persist(), 0);
      return newState;
    }),

    setImportedData: (data) => {
      set({ importedData: data });
      setTimeout(() => get().persist(), 0);
    },

    removeImportedRow: (index) => set((state) => {
      const newData = state.importedData.filter((_, i) => i !== index);
      setTimeout(() => get().persist(), 0);
      return { importedData: newData };
    }),

    clearWorkbench: () => {
      set({ steps: [], selectedStepId: null, importedData: [] });
      setTimeout(() => get().persist(), 0);
    },

    clearSteps: () => {
      set({ steps: [], selectedStepId: null });
      setTimeout(() => get().persist(), 0);
    },

    saveRecipe: (name) => {
      const { steps } = get();
      const recipe: ETLRecipe = {
        name,
        steps,
        createdAt: new Date().toISOString(),
      };
      return recipe;
    },

    loadRecipe: (recipe) => {
      set({
        steps: recipe.steps,
        selectedStepId: null,
      });
      setTimeout(() => get().persist(), 0);
    },

    applyAIActions: (actions, replace) => {
      if (!actions || actions.length === 0) return;

      const currentSteps = replace ? [] : get().steps;
      let newSteps = [...currentSteps];

      actions.forEach(action => {
        if (action.type === 'add_api_node') {
          // Safe payload access: handle AI returning "config" instead of "payload",
          // or data directly on action object without a wrapper
          const rawPayload = action.payload || (action as Record<string, unknown>).config || {};
          const payload = rawPayload as {
            node_id?: string;
            method?: string;
            path?: string;
            operationId?: string;
            label?: string;
            params?: Record<string, unknown>;
            field_mappings?: Array<{ csvColumn: string; apiField: string; enabled?: boolean; transform?: string }>;
          };

          // Маппим HTTP-путь + метод → operation method (user.list, group.create и т.д.)
          const method = payload.method?.toUpperCase() || 'GET';
          const path = payload.path || '';
          const operationMethod = pathToOperationMethod(method, path);

          // Convert field_mappings from action payload to FieldMapping[] format
          const mappings: FieldMapping[] = (payload.field_mappings || []).map(fm => ({
            csvColumn: fm.csvColumn,
            apiField: fm.apiField,
            enabled: fm.enabled !== false,
            ...(fm.transform ? { transform: fm.transform } : {}),
          }));

          const step: ETLStep = {
            id: payload.node_id || `ai_step_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            method: operationMethod,
            category: pathToCategory(path),
            label: payload.label || `${method} ${path}`,
            params: payload.params || {},
            fieldMappings: mappings,
          };
          newSteps.push(step);
        }

        else if (action.type === 'connect_nodes') {
          const payload = (action.payload || {}) as {
            from_node_id: string;
            to_node_id: string;
          };
          // Находим целевой шаг и устанавливаем linkedFrom
          const toIdx = newSteps.findIndex(s => s.id === payload.to_node_id);
          if (toIdx !== -1) {
            newSteps[toIdx] = {
              ...newSteps[toIdx],
              linkedFrom: {
                stepId: payload.from_node_id,
                fieldMap: {},
              },
            };
          }
        }

        else if (action.type === 'set_param') {
          const payload = (action.payload || {}) as {
            node_id: string;
            param_name: string;
            param_value: unknown;
          };
          const idx = newSteps.findIndex(s => s.id === payload.node_id);
          if (idx !== -1) {
            newSteps[idx] = {
              ...newSteps[idx],
              params: {
                ...newSteps[idx].params,
                [payload.param_name]: payload.param_value,
              },
            };
          }
        }

        else if (action.type === 'remove_node') {
          const payload = (action.payload || {}) as { node_id: string };
          newSteps = newSteps.filter(s => s.id !== payload.node_id);
        }
      });

      set({ steps: newSteps });
      // Выбираем последний добавленный шаг, если он есть
      if (newSteps.length > 0) {
        const lastStep = newSteps[newSteps.length - 1];
        set({ selectedStepId: lastStep.id });
      }
      setTimeout(() => get().persist(), 0);
    },

    persist: () => {
      if (typeof window === 'undefined') return;
      try {
        const { steps, importedData } = get();
        // Don't persist selectedStepId to avoid confusion on reload
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          steps,
          importedData,
          savedAt: new Date().toISOString(),
        }));
      } catch {
        // localStorage full or unavailable — silently ignore
      }
    },

    hydrate: () => {
      const saved = loadState();
      set({
        steps: saved.steps || [],
        selectedStepId: null, // Don't restore selection
        importedData: saved.importedData || [],
      });
    },
  };
});
