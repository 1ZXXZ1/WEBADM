'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useETLStore } from '@/stores/etl-store';
import { useAuthStore } from '@/stores/auth-store';
import { API_OPERATIONS } from '@/lib/api-operations';
import { aiAPI } from '@/lib/api-ai';
import api from '@/lib/api';
import { buildSdbContext, SDB_ENTITY_EXAMPLES } from '@/lib/sdb-context';
import type {
  AIChatMessage, AIAction, AIConfig, AIAgentStep, AIChatMode,
  AIChatSession, AIStreamEvent, AIDataSchemaResponse, AIDataSchemaField,
  AISDBQueryPayload, AIResponse,
} from '@/types/ai';
import type { BatchResponse } from '@/types';
import {
  Sparkles, Send, Loader2, ShieldCheck, ShieldOff,
  Trash2, ChevronDown, ChevronUp, Bot, User, Zap,
  Settings2, AlertCircle, CheckCircle2, XCircle, Info,
  X, Play, Wrench, Eye, ListChecks, Cpu, GripHorizontal,
  Plus, MessageSquare, Maximize2, Minimize2, Wallet,
  Database, ArrowRightLeft, FileSpreadsheet, Code2,
  ArrowDown, ArrowUp, LogIn, LogOut, Terminal, MessageCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ─── Resize constraints ──────────────────────────────────────────────────
const MIN_WIDTH = 320;
const MIN_HEIGHT = 300;
const MAX_WIDTH_RATIO = 0.9;
const MAX_HEIGHT_RATIO = 0.9;

// ─── Fallback Data Schema (when backend unavailable) ──────────────────
function buildFallbackDataSchema(): AIDataSchemaResponse {
  return {
    entities: {
      USERS: {
        key_attr: 'username',
        count: 0,
        fields: [
          { name: 'username', label: 'Имя пользователя', type: 'string', required: true },
          { name: 'given_name', label: 'Имя', type: 'string' },
          { name: 'surname', label: 'Фамилия', type: 'string' },
          { name: 'initials', label: 'Инициалы', type: 'string' },
          { name: 'mail_address', label: 'Эл. почта', type: 'string' },
          { name: 'department', label: 'Отдел', type: 'string' },
          { name: 'company', label: 'Компания', type: 'string' },
          { name: 'description', label: 'Описание', type: 'string' },
          { name: 'job_title', label: 'Должность', type: 'string' },
          { name: 'telephone_number', label: 'Телефон', type: 'string' },
          { name: 'password', label: 'Пароль', type: 'string' },
          { name: 'userou', label: 'OU', type: 'string' },
        ],
      },
      GROUPS: {
        key_attr: 'groupname',
        count: 0,
        fields: [
          { name: 'groupname', label: 'Имя группы', type: 'string', required: true },
          { name: 'description', label: 'Описание', type: 'string' },
          { name: 'mail_address', label: 'Эл. почта', type: 'string' },
          { name: 'group_scope', label: 'Область', type: 'string' },
          { name: 'group_type', label: 'Тип', type: 'string' },
          { name: 'gid_number', label: 'GID', type: 'number' },
        ],
      },
      COMPUTERS: {
        key_attr: 'computername',
        count: 0,
        fields: [
          { name: 'computername', label: 'Имя компьютера', type: 'string', required: true },
          { name: 'description', label: 'Описание', type: 'string' },
          { name: 'ip_address', label: 'IP-адрес', type: 'string' },
          { name: 'operating_system', label: 'ОС', type: 'string' },
        ],
      },
      OUS: {
        key_attr: 'ouname',
        count: 0,
        fields: [
          { name: 'ouname', label: 'Имя OU', type: 'string', required: true },
          { name: 'description', label: 'Описание', type: 'string' },
        ],
      },
      GPOS: {
        key_attr: 'name',
        count: 0,
        fields: [
          { name: 'name', label: 'Имя GPO', type: 'string', required: true },
          { name: 'status', label: 'Статус', type: 'string' },
        ],
      },
      DNS_RECORDS: {
        key_attr: 'name',
        count: 0,
        fields: [
          { name: 'zone', label: 'Зона', type: 'string', required: true },
          { name: 'name', label: 'Имя записи', type: 'string', required: true },
          { name: 'record_type', label: 'Тип', type: 'string', required: true },
          { name: 'data', label: 'Данные', type: 'string', required: true },
          { name: 'ttl', label: 'TTL', type: 'number' },
        ],
      },
    },
  };
}

// ─── AI Action Badge ──────────────────────────────────────────────────────
function ActionBadge({ action, t }: { action: AIAction; t: (key: string) => string }) {
  const typeColors: Record<string, string> = {
    add_api_node: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    connect_nodes: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    set_param: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    remove_node: 'bg-red-500/20 text-red-400 border-red-500/30',
    sdb_query: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    info: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  };

  const payload = action.payload as Record<string, unknown>;
  const path = String(payload.path || '');

  // If add_api_node targets an SDB endpoint, treat it as an SDB query badge
  const isSdbNode = action.type === 'add_api_node' && /\/api\/v1\/sdb\/(query|select|script|full|info|show)/i.test(path);
  const effectiveType = isSdbNode ? 'sdb_query' : action.type;

  const typeLabels: Record<string, string> = {
    add_api_node: `+ ${t('ai.nodeAdded')}`,
    connect_nodes: t('ai.nodesConnected'),
    set_param: t('ai.paramSet'),
    remove_node: 'Remove',
    sdb_query: '🔍 SDB',
    info: 'Info',
  };

  const color = typeColors[effectiveType] || typeColors.info;
  const label = typeLabels[effectiveType] || action.type;

  let detail = '';
  if (effectiveType === 'add_api_node') {
    detail = `${(payload.method as string) || ''} ${(payload.path as string) || ''}`;
  } else if (effectiveType === 'connect_nodes') {
    detail = `${payload.from_node_id} → ${payload.to_node_id}`;
  } else if (effectiveType === 'set_param') {
    detail = `${payload.node_id}.${payload.param_name} = ${String(payload.param_value ?? '')}`;
  } else if (effectiveType === 'sdb_query') {
    // SDB query (either our sdb_query type OR add_api_node with SDB path)
    const sheetName = (payload.sheet_name as string) || (payload.label as string) || '';
    const entity = (payload.entity as string) || '';
    const where = (payload.where as string) || '';
    const limit = (payload.limit as number) ||
      ((payload.params as Record<string, unknown>)?.limit as number) || '';
    const queryStr = ((payload.params as Record<string, unknown>)?.query as string) ||
      ((payload.params as Record<string, unknown>)?.script as string) || '';
    const parts: string[] = [];
    if (sheetName) parts.push(`"${sheetName}"`);
    if (entity) parts.push(entity);
    if (where) parts.push(`WHERE ${where}`);
    if (limit) parts.push(`LIMIT ${limit}`);
    if (queryStr) parts.push(`q: ${queryStr.length > 40 ? queryStr.slice(0, 40) + '…' : queryStr}`);
    detail = parts.join(' · ');
  }

  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] border ${color} font-mono`}>
      <span className="font-semibold">{label}</span>
      {detail && <span className="opacity-70 truncate max-w-[260px]">{detail}</span>}
    </div>
  );
}

// ─── Agent Step Card ────────────────────────────────────────────────────
function AgentStepCard({ step, t }: { step: AIAgentStep; t: (key: string) => string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`rounded border text-[10px] ${
      step.success
        ? 'border-emerald-500/20 bg-emerald-500/5'
        : 'border-red-500/20 bg-red-500/5'
    }`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-2 py-1.5 flex items-center gap-1.5 text-left hover:bg-white/5 transition-colors"
      >
        {step.success ? (
          <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
        ) : (
          <XCircle className="w-3 h-3 text-red-400 shrink-0" />
        )}
        <span className="font-semibold text-muted-foreground">#{step.step}</span>
        <span className="font-mono text-foreground truncate">{step.tool_name}</span>
        {step.tool_args.method && step.tool_args.path && (
          <span className="text-muted-foreground truncate">
            {String(step.tool_args.method)} {String(step.tool_args.path)}
          </span>
        )}
        <ChevronDown className={`w-3 h-3 ml-auto text-muted-foreground transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-1.5 border-t border-border/30">
          {step.tool_args && Object.keys(step.tool_args).length > 0 && (
            <div>
              <p className="text-muted-foreground font-medium mb-0.5">{t('ai.agentStepArgs')}:</p>
              <pre className="bg-background/50 rounded p-1.5 overflow-x-auto text-[9px] font-mono text-foreground/80 max-h-24">
                {JSON.stringify(step.tool_args, null, 2)}
              </pre>
            </div>
          )}
          <div>
            <p className="text-muted-foreground font-medium mb-0.5">{t('ai.agentStepResult')}:</p>
            <pre className="bg-background/50 rounded p-1.5 overflow-x-auto text-[9px] font-mono text-foreground/80 max-h-32 whitespace-pre-wrap break-words">
              {step.result_preview}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Streaming Step Indicator ──────────────────────────────────────────
function StreamingStepIndicator({
  step, tool, success, t,
}: {
  step: number;
  tool?: string;
  success?: boolean;
  t: (key: string) => string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] py-0.5">
      {success === true ? (
        <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
      ) : success === false ? (
        <XCircle className="w-3 h-3 text-red-400 shrink-0" />
      ) : (
        <Loader2 className="w-3 h-3 text-purple-400 shrink-0 animate-spin" />
      )}
      <span className="font-semibold text-muted-foreground">#{step}</span>
      {tool && <span className="font-mono text-foreground truncate">{tool}</span>}
    </div>
  );
}

// ─── Main AIAssistant Component ──────────────────────────────────────────
export default function AIAssistant() {
  const { t } = useTranslation();
  const steps = useETLStore((s) => s.steps);
  const importedData = useETLStore((s) => s.importedData);
  const applyAIActions = useETLStore((s) => s.applyAIActions);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canAccessSdb = hasPermission('sdb.info');

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [safeMode, setSafeMode] = useState(true);
  const [loading, setLoading] = useState(false);
  const [aiConfig, setAiConfig] = useState<AIConfig | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [chatMode, setChatMode] = useState<AIChatMode>('ai');
  const [maxSteps, setMaxSteps] = useState(50);

  // ─── Listen for "open-ai-assistant" events from Chat page tabs ──────
  // When the user clicks "Конструктор" or "Агент" tab in the Chat page,
  // it dispatches this event to open the AI panel with the right mode.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ mode: AIChatMode }>).detail;
      if (detail?.mode) {
        setChatMode(detail.mode);
        setIsOpen(true);
        setIsMinimized(false);
      }
    };
    window.addEventListener('open-ai-assistant', handler as EventListener);
    return () => window.removeEventListener('open-ai-assistant', handler as EventListener);
  }, []);

  // ─── Slash command autocomplete state ─────────────────────────────────
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [selectedCommandIdx, setSelectedCommandIdx] = useState(0);
  const commandMenuRef = useRef<HTMLDivElement>(null);

  // ─── System prompt & Data context state (v1.9-3-6) ────────────────
  // Per-mode system prompts persisted to localStorage so switching modes
  // does not lose the user's custom prompt for each mode.
  // Note: 'agent' mode ignores custom prompts (always uses DEFAULT_SYSTEM_PROMPT_EXECUTOR).
  type ModePromptMap = Partial<Record<AIChatMode, string>>;
  const [systemPromptByMode, setSystemPromptByMode] = useState<ModePromptMap>(() => {
    try {
      const stored = localStorage.getItem('ai-system-prompts');
      if (stored) return JSON.parse(stored) as ModePromptMap;
    } catch { /* ignore */ }
    return {};
  });

  // Helper: get the prompt for the currently active mode
  const systemPrompt = systemPromptByMode[chatMode] || '';
  const setSystemPrompt = useCallback((value: string) => {
    setSystemPromptByMode(prev => {
      const next = { ...prev, [chatMode]: value.slice(0, 8000) };
      try {
        localStorage.setItem('ai-system-prompts', JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });
  }, [chatMode]);
  const [showDataSources, setShowDataSources] = useState(false);
  const [dataSchema, setDataSchema] = useState<AIDataSchemaResponse | null>(null);

  // ─── Default system prompts per mode ────────────────────────────────
  const DEFAULT_SYSTEM_PROMPT_CONSTRUCTOR = `Ты — AI-Конструктор задач Samba AD.

КРИТИЧЕСКИ ВАЖНО:
- Ты ДОЛЖЕН создавать ноды пайплайна САМОСТОЯТЕЛЬНО.
- НЕ спрашивай уточнения — действуй немедленно на основе контекста данных.
- НЕ используй {USER_INPUT} — используй реальные данные из CSV или разумные значения по умолчанию.
- Если CSV данные есть в контексте — создай ОДНУ ноду с field_mappings, НЕ N нод на каждую строку CSV.
- ОТВЕТ — ТОЛЬКО JSON с actions.

ВАЖНО: МАППИНГ ВМЕСТО ДУБЛИРОВАНИЯ
Когда CSV данные доступны (контекст содержит "CSV Data"), НЕ создавай отдельную ноду для каждой строки.
Вместо этого создай 1 ноду с field_mappings:
{
  "actions": [
    {
      "type": "add_api_node",
      "payload": {
        "node_id": "step_1",
        "method": "POST",
        "path": "/api/v1/users/",
        "label": "Создать пользователей (N из CSV)",
        "params": {"password": "P@ssw0rd!", "use_username_as_cn": true},
        "field_mappings": [
          {"csvColumn": "login", "apiField": "username", "enabled": true},
          {"csvColumn": "имя", "apiField": "given_name", "enabled": true},
          {"csvColumn": "фамилия", "apiField": "surname", "enabled": true},
          {"csvColumn": "отчество", "apiField": "initials", "enabled": true, "transform": "first_letter_with_dot"}
        ]
      }
    }
  ]
}

ВАЖНО: ПОЛЕ initials И use_username_as_cn
1. Поле AD "initials" принимает ТОЛЬКО короткие инициалы (1-3 символа), НЕ полное отчество.
   Если CSV содержит столбец "отчество", добавь маппинг с transform:
   {"csvColumn": "отчество", "apiField": "initials", "enabled": true, "transform": "first_letter_with_dot"}
   Значение "Иванович" будет АВТОМАТИЧЕСКИ преобразовано в "И." при выполнении.
   ОБЯЗАТЕЛЬНО добавляй "transform": "first_letter_with_dot" для initials!
2. ВСЕГДА добавляй "use_username_as_cn": true в params при создании пользователей.
   Без этого AD строит CN как "Иван Иванович. Иванов" что вызывает ошибку.

ТИПЫ ACTIONS: add_api_node (method, path, params, field_mappings), set_param (node_id, param_name, param_value), connect_nodes (from_node_id, to_node_id).

API ПУТИ: POST /api/v1/users/, GET /api/v1/users/, POST /api/v1/groups/, POST /api/v1/computers/, POST /api/v1/ous/, POST /api/v1/dns/records/.

CSV→API маппинг: login→username, имя→given_name, фамилия→surname, отчество→initials (transform:first_letter_with_dot), почта→mail_address, пароль→password, отдел→department, компания→company, должность→job_title, телефон→telephone_number.

ПРАВИЛА:
1. НЕ спрашивай. НЕ пиши {USER_INPUT}. Действуй.
2. Если CSV есть → 1 нода + field_mappings. Если CSV нет → 1 нода с params.
3. НЕ создавай больше 1 ноды одного типа для одной сущности.
4. ВСЕГДА добавляй use_username_as_cn: true при создании пользователей.
5. initials маппится через отчество — ОБЯЗАТЕЛЬНО с transform: "first_letter_with_dot".
6. В Safe Mode: данные маскированы [P1], [P2] — не пытайся угадать реальные значения, используй field_mappings.`;

  const DEFAULT_SYSTEM_PROMPT_AGENT = `Ты — AI-агент Samba AD. Выполняй действия напрямую через API.

КРИТИЧЕСКИ ВАЖНО:
- НЕ спрашивай подтверждение — действуй немедленно.
- НЕ используй {USER_INPUT} — используй реальные данные из CSV или разумные значения.
- Если CSV есть → создавай 1 ноду с field_mappings (НЕ N нод на каждую строку CSV).
- ВСЕГДА добавляй use_username_as_cn: true в params при создании пользователей.
- initials: если CSV содержит "отчество", маппь на initials с transform: "first_letter_with_dot" — преобразование автоматическое ("Иванович" → "И."). ОБЯЗАТЕЛЬНО добавляй transform!
- В Safe Mode: данные маскированы [P1], [P2] — не пытайся угадать реальные значения, используй field_mappings.

Маппинг CSV→API: login→username, имя→given_name, фамилия→surname, отчество→initials (transform:first_letter_with_dot), почта→mail_address, пароль→password.

ФОРМАТ ОТВЕТА — JSON: {"actions": [{"type": "add_api_node", "payload": {"node_id": "step_1", "method": "POST", "path": "/api/v1/users/", "label": "...", "params": {"password": "P@ssw0rd!", "use_username_as_cn": true}, "field_mappings": [{"csvColumn": "login", "apiField": "username", "enabled": true}, {"csvColumn": "отчество", "apiField": "initials", "enabled": true, "transform": "first_letter_with_dot"}]}}]}

API: POST /api/v1/users/, GET /api/v1/users/, POST /api/v1/groups/, POST /api/v1/computers/, POST /api/v1/ous/.
ОТВЕТ — ТОЛЬКО JSON. НЕ спрашивай. НЕ пиши {USER_INPUT}. 1 нода + field_mappings для CSV данных.`;

  const DEFAULT_SYSTEM_PROMPT_EXECUTOR = `Ты — AI-агент Samba AD. Выполняй действия напрямую через инструменты.
У тебя есть доступ к API и базе данных AD. Используй инструменты для выполнения задач.

ПРАВИЛА:
1. НЕ спрашивай подтверждение — действуй немедленно.
2. Используй ldbsearch_ad для ЧТЕНИЯ данных (быстро, структурированный вывод).
3. Используй execute_samba_api для ЗАПИСИ (создание, удаление, изменение).
4. НЕ повторяй один и тот же запрос с одинаковыми параметрами.
5. Отвечай на том же языке, на котором пишет пользователь.
6. Если пользователь просит удалить/создать — делай это сразу, без уточнений.
7. Используй NOT_IN для исключений (например: Administrator,Guest,krbtgt,default).

ТИПЫ СУЩНОСТВ:
- Users: /api/v1/users/ (создание, удаление, список, изменение)
- Groups: /api/v1/groups/ (создание, удаление, список, добавление участников)
- Computers: /api/v1/computers/
- OUs: /api/v1/ous/
- DNS: /api/v1/dns/zones/, /api/v1/dns/records/
- GPO: /api/v1/gpo/

ВАЖНО: Ты видишь историю чата. Если ранее в этой сессии создавались объекты, ты знаешь их имена.
Если просят удалить "то, что создали" — ищи по whenCreated или другим признакам.`;

  const DEFAULT_SYSTEM_PROMPT_SDB = `Ты — AI-ассистент для работы с базой данных SDB (SamDB) Samba AD.
Помогаешь пользователю выполнять SDB-запросы и СОЗДАВАТЬ ЛИСТЫ в DataForge с результатами.

ГЛАВНОЕ: ОТВЕТ — JSON с actions. Не пиши свободный текст, всегда возвращай JSON.

ФОРМАТ ОТВЕТА (СТРОГО):
\`\`\`json
{
  "actions": [
    {
      "type": "add_api_node",
      "payload": {
        "node_id": "node_1",
        "method": "POST",
        "path": "/api/v1/sdb/script",
        "operationId": "sdb_script_endpoint_api_v1_sdb_script_post",
        "label": "Описательное имя листа",
        "params": {
          "script": "USE sam;\\nFROM USERS;\\nSHOW AS json LIMIT 5;"
        }
      }
    }
  ]
}
\`\`\`

ТИП ДЕЙСТВИЯ: add_api_node (используй этот тип — система распознает SDB по path)
- path: один из SDB-эндпоинтов:
  • POST /api/v1/sdb/script — body: {script: "USE sam; FROM USERS; SHOW AS json LIMIT N;"} — самый мощный
  • POST /api/v1/sdb/select — body: {scope: "USERS", format: "json", limit: N, where: "adminCount = 1"}
  • POST /api/v1/sdb/query  — body: {query: "SELECT * FROM user LIMIT 5"} (LDB-синтаксис)
  • GET  /api/v1/sdb/full/{entity} — params: {fields: '*', limit: N} (нет where)
- method: "POST" для /script, /select, /query; "GET" для /full
- label: человекочитаемое имя листа в DataForge (ОБЯЗАТЕЛЬНО)
- params: тело запроса (для POST) или query-параметры (для GET)

ПРИМЕРЫ:
1. "показать 5 пользователей":
   {"actions":[{"type":"add_api_node","payload":{"node_id":"node_1","method":"POST","path":"/api/v1/sdb/script","operationId":"sdb_script_endpoint_api_v1_sdb_script_post","label":"Пользователи (5)","params":{"script":"USE sam;\\nFROM USERS;\\nSHOW AS json LIMIT 5;"}}}]

2. "показать admin пользователей":
   {"actions":[{"type":"add_api_node","payload":{"node_id":"node_1","method":"POST","path":"/api/v1/sdb/script","operationId":"sdb_script_endpoint_api_v1_sdb_script_post","label":"Admin пользователи","params":{"script":"USE sam;\\nFROM USERS WHERE adminCount = 1;\\nSHOW AS json LIMIT 100;"}}]}

3. "найти отключённых пользователей":
   {"actions":[{"type":"add_api_node","payload":{"node_id":"node_1","method":"POST","path":"/api/v1/sdb/script","operationId":"sdb_script_endpoint_api_v1_sdb_script_post","label":"Отключённые учётки","params":{"script":"USE sam;\\nFROM USERS WHERE userAccountControl = '2';\\nSHOW AS json LIMIT 500;"}}]}

4. "показать группы":
   {"actions":[{"type":"add_api_node","payload":{"node_id":"node_1","method":"POST","path":"/api/v1/sdb/script","operationId":"sdb_script_endpoint_api_v1_sdb_script_post","label":"Группы","params":{"script":"USE sam;\\nFROM GROUPS;\\nSHOW AS json LIMIT 1000;"}}]}

5. "компьютеры с Windows 10":
   {"actions":[{"type":"add_api_node","payload":{"node_id":"node_1","method":"POST","path":"/api/v1/sdb/script","operationId":"sdb_script_endpoint_api_v1_sdb_script_post","label":"Windows 10","params":{"script":"USE sam;\\nFROM COMPUTERS WHERE operatingSystem LIKE 'Windows 10%';\\nSHOW AS json LIMIT 500;"}}]}

ПРАВИЛА:
1. ВСЕГДА возвращай JSON с actions. НЕ пиши свободный текст.
2. Если у запроса нет фильтра — не указывай WHERE в скрипте.
3. Если пользователь указал количество (5, 10, 100) — поставь это в LIMIT.
4. ВСЕГДА указывай "label" — это станет именем листа в DataForge.
5. Используй /api/v1/sdb/script (POST) как основной эндпоинт — он поддерживает WHERE.
6. В Safe Mode значения чувствительных полей маскируются — НЕ пытайся угадать.
7. НЕ используй плейсхолдер {USER_INPUT}.

СУЩНОСТИ И SCOPE (для FROM):
- USERS — пользователи (sAMAccountName, cn, displayName, mail, userAccountControl, adminCount, memberOf, whenCreated)
- GROUPS — группы (sAMAccountName, cn, description, member, memberOf, adminCount)
- COMPUTERS — компьютеры (sAMAccountName, cn, dNSHostName, operatingSystem, operatingSystemVersion, memberOf, lastLogonTimestamp)
- OUS — подразделения (ou, description, gPLink, whenChanged)
- GPOS — групповые политики (cn, displayName, gPCFileSysPath, versionNumber, flags)
- CONTACTS — контакты (cn, displayName, mail)
- DNS_RECORDS — DNS записи (dc, dnsRecord, name, whenChanged)

ПОЛЕЗНЫЕ ЗНАЧЕНИЯ userAccountControl:
- 2 = ACCOUNTDISABLE (отключённая учётка)
- 512 = NORMAL_ACCOUNT (обычный пользователь)
- adminCount = 1 у административных учёток (Administrator, члены Domain Admins и т.д.)

СИСТЕМА АВТОМАТИЧЕСКИ:
- Выполнит SDB-запрос через указанный эндпоинт
- Создаст новый лист в DataForge с результатами (имя из "label")
- Переключит пользователя на DataForge
- Покажет toast с количеством записей
Пользователю НЕ нужно вручную открывать DataForge и нажимать кнопки — всё происходит автоматически.`;

  // Effective system prompt per mode.
  // - 'agent': ALWAYS uses the default executor prompt (custom prompt is ignored).
  // - 'sdb'/'ai'/'auto': custom per-mode prompt OR default for that mode.
  const effectiveSystemPrompt = useMemo(() => {
    // Agent mode is locked to its default — custom prompt is ignored
    if (chatMode === 'agent') return DEFAULT_SYSTEM_PROMPT_EXECUTOR;
    // Per-mode custom prompt (persisted separately for each mode)
    const custom = systemPromptByMode[chatMode]?.trim();
    if (custom) return custom;
    // Defaults
    if (chatMode === 'sdb') return DEFAULT_SYSTEM_PROMPT_SDB;
    if (chatMode === 'ai') return DEFAULT_SYSTEM_PROMPT_AGENT;
    return DEFAULT_SYSTEM_PROMPT_CONSTRUCTOR;
  }, [systemPromptByMode, chatMode]);

  // ─── Slash commands definition ─────────────────────────────────────────
  const SLASH_COMMANDS = useMemo(() => [
    { cmd: '/создать',      label: 'Создать пользователей',      desc: 'Создать из CSV',       icon: '➕', entity: 'пользователей' },
    { cmd: '/удалить',      label: 'Удалить пользователей',      desc: 'Удалить по username',  icon: '🗑️', entity: 'пользователей' },
    { cmd: '/список',       label: 'Список пользователей',       desc: 'GET все записи',        icon: '📋', entity: 'пользователей' },
    { cmd: '/показать',     label: 'Просмотр пользователя',      desc: 'GET по username',       icon: '👁️', entity: 'пользователей' },
    { cmd: '/изменить',     label: 'Редактировать пользователя', desc: 'PUT изменение',         icon: '✏️', entity: 'пользователей' },
    { cmd: '/включить',     label: 'Включить пользователя',      desc: 'Enable аккаунт',        icon: '✅', entity: 'пользователей' },
    { cmd: '/отключить',    label: 'Отключить пользователя',     desc: 'Disable аккаунт',       icon: '🚫', entity: 'пользователей' },
    { cmd: '/разблокировать', label: 'Разблокировать пользователя', desc: 'Unlock аккаунт',     icon: '🔓', entity: 'пользователей' },
    { cmd: '/пароль',       label: 'Установить пароль',          desc: 'SetPassword',           icon: '🔑', entity: 'пользователей' },
    { cmd: '/переместить',  label: 'Переместить пользователя',   desc: 'Move в другой OU',      icon: '📦', entity: 'пользователей' },
    { cmd: '/создать-группу',    label: 'Создать группу',        desc: 'POST группу',           icon: '➕', entity: 'группу' },
    { cmd: '/удалить-группу',    label: 'Удалить группу',        desc: 'DELETE группу',         icon: '🗑️', entity: 'группу' },
    { cmd: '/список-групп',      label: 'Список групп',          desc: 'GET все группы',        icon: '📋', entity: 'групп' },
    { cmd: '/создать-компьютер', label: 'Создать компьютер',     desc: 'POST компьютер',        icon: '➕', entity: 'компьютер' },
    { cmd: '/удалить-компьютер', label: 'Удалить компьютер',     desc: 'DELETE компьютер',      icon: '🗑️', entity: 'компьютер' },
    { cmd: '/создать-ou',        label: 'Создать OU',            desc: 'POST подразделение',    icon: '➕', entity: 'OU' },
    { cmd: '/список-dns',        label: 'Список DNS записей',    desc: 'GET DNS зоны',          icon: '📋', entity: 'DNS' },
    { cmd: '/поиск',             label: 'Поиск пользователей',   desc: 'Search по имени',       icon: '🔍', entity: 'пользователей' },
  ], []);

  // Filtered commands based on current input
  const filteredCommands = useMemo(() => {
    if (!input.startsWith('/')) return [];
    const query = input.toLowerCase().slice(1); // remove leading /
    if (!query) return SLASH_COMMANDS; // show all when just "/"
    return SLASH_COMMANDS.filter(c =>
      c.cmd.toLowerCase().includes(query) ||
      c.label.toLowerCase().includes(query) ||
      c.desc.toLowerCase().includes(query)
    );
  }, [input, SLASH_COMMANDS]);

  // ─── Session management state ──────────────────────────────────────
  const [sessions, setSessions] = useState<AIChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showSessionList, setShowSessionList] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(false);  // Локальный режим без бэкенда

  // ─── SSE streaming state ───────────────────────────────────────────
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingSteps, setStreamingSteps] = useState<Array<{ step: number; tool?: string; success?: boolean }>>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // ─── Panel position + size state ───────────────────────────────────
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);
  const [panelSize, setPanelSize] = useState<{ w: number; h: number }>({ w: 420, h: 600 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDir, setResizeDir] = useState<string | null>(null);
  const dragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 0, h: 0 });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // ─── Current session title ─────────────────────────────────────────
  const currentSession = useMemo(
    () => sessions.find(s => s.id === currentSessionId),
    [sessions, currentSessionId],
  );

  // ─── Load AI config on first open ──────────────────────────────────
  useEffect(() => {
    if (isOpen && !aiConfig) {
      aiAPI.getConfig().then(cfg => {
        setAiConfig(cfg);
        setIsOfflineMode(false);
      }).catch(() => {
        // Бэкенд недоступен — работаем в локальном режиме
        setAiConfig({ enabled: true, default_model: 'local', schema_endpoints: 0, max_tokens: 4096, temperature: 0.7 });
        setIsOfflineMode(true);
      });
    }
  }, [isOpen, aiConfig]);

  // ─── Load data schema on first open (v1.9-3-6) ──────────────────
  useEffect(() => {
    if (isOpen && !dataSchema) {
      aiAPI.getDataSchema().then(schema => {
        setDataSchema(schema);
      }).catch(() => {
        // Бэкенд недоступен — используем встроенную схему
        setDataSchema(buildFallbackDataSchema());
      });
    }
  }, [isOpen, dataSchema]);

  // ─── Load sessions when panel opens ────────────────────────────────
  useEffect(() => {
    if (isOpen && !isOfflineMode) {
      aiAPI.listChatSessions().then(data => {
        setSessions(data.chats || []);
      }).catch(() => {
        setIsOfflineMode(true);
      });
    }
  }, [isOpen, isOfflineMode]);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, streamingSteps]);

  // Focus on input when opened
  useEffect(() => {
    if (isOpen && !isMinimized) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen, isMinimized]);

  // ─── Slash command menu visibility & index reset ────────────────────────
  useEffect(() => {
    const shouldShow = filteredCommands.length > 0 && input.startsWith('/');
    setShowCommandMenu(shouldShow);
    setSelectedCommandIdx(0);
  }, [filteredCommands, input]);

  // Close command menu on click outside
  useEffect(() => {
    if (!showCommandMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (commandMenuRef.current && !commandMenuRef.current.contains(e.target as Node)) {
        setShowCommandMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showCommandMenu]);

  // ─── Drag handlers ───────────────────────────────────────────────────
  const handleDragMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragOffset.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    setIsDragging(true);
  }, []);

  // ─── Resize handlers ────────────────────────────────────────────────
  const handleResizeMouseDown = useCallback((dir: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    resizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      w: rect.width,
      h: rect.height,
    };
    setResizeDir(dir);
    setIsResizing(true);
  }, []);

  // ─── Mouse move/up for drag ────────────────────────────────────────
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - dragOffset.current.x;
      const newY = e.clientY - dragOffset.current.y;
      const clampedX = Math.max(0, Math.min(window.innerWidth - 100, newX));
      const clampedY = Math.max(0, Math.min(window.innerHeight - 50, newY));
      setPanelPos({ x: clampedX, y: clampedY });
    };

    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // ─── Mouse move/up for resize ──────────────────────────────────────
  useEffect(() => {
    if (!isResizing || !resizeDir) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - resizeStart.current.x;
      const dy = e.clientY - resizeStart.current.y;
      const maxW = window.innerWidth * MAX_WIDTH_RATIO;
      const maxH = window.innerHeight * MAX_HEIGHT_RATIO;

      let newW = resizeStart.current.w;
      let newH = resizeStart.current.h;

      if (resizeDir.includes('e')) {
        newW = Math.max(MIN_WIDTH, Math.min(maxW, resizeStart.current.w + dx));
      }
      if (resizeDir.includes('s')) {
        newH = Math.max(MIN_HEIGHT, Math.min(maxH, resizeStart.current.h + dy));
      }

      setPanelSize({ w: newW, h: newH });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      setResizeDir(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, resizeDir]);

  // ─── Create a new chat session ────────────────────────────────────
  const handleNewChat = useCallback(async () => {
    try {
      if (isOfflineMode) {
        // Локальный режим — создаём виртуальную сессию
        const localSession: AIChatSession = {
          id: `local_${Date.now()}`,
          title: t('ai.newChat'),
          created_at: new Date().toISOString(),
          message_count: 0,
        };
        setSessions(prev => [localSession, ...prev]);
        setCurrentSessionId(localSession.id);
        setMessages([]);
        setStreamingContent('');
        setStreamingSteps([]);
        return;
      }
      const session = await aiAPI.createChatSession(t('ai.newChat'));
      setSessions(prev => [session, ...prev]);
      setCurrentSessionId(session.id);
      setMessages([]);
      setStreamingContent('');
      setStreamingSteps([]);
      toast.success(t('ai.sessionCreated'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create session';
      // Fallback to offline mode
      setIsOfflineMode(true);
      const localSession: AIChatSession = {
        id: `local_${Date.now()}`,
        title: t('ai.newChat'),
        created_at: new Date().toISOString(),
        message_count: 0,
      };
      setSessions(prev => [localSession, ...prev]);
      setCurrentSessionId(localSession.id);
      setMessages([]);
      setStreamingContent('');
      setStreamingSteps([]);
      toast.warning('Offline mode: ' + msg);
    }
  }, [t, isOfflineMode]);

  // ─── Switch to a different session ──────────────────────────────────
  const handleSwitchSession = useCallback(async (sessionId: string) => {
    if (sessionId === currentSessionId) {
      setShowSessionList(false);
      return;
    }
    setCurrentSessionId(sessionId);
    setMessages([]);
    setStreamingContent('');
    setStreamingSteps([]);
    setShowSessionList(false);

    // Try to load history
    try {
      const history = await aiAPI.getChatHistory(sessionId, 50);
      if (history.messages && Array.isArray(history.messages)) {
        const loadedMsgs: AIChatMessage[] = history.messages.map((m: Record<string, unknown>, idx: number) => ({
          id: (m.id as string) || `hist_${idx}`,
          role: (m.role as 'user' | 'assistant' | 'system') || 'assistant',
          content: (m.content as string) || '',
          timestamp: (m.timestamp as string) || new Date().toISOString(),
          mode: (m.mode as AIChatMode) || undefined,
          model_used: (m.model_used as string) || undefined,
          tokens_used: (m.tokens_used as number) || undefined,
        }));
        setMessages(loadedMsgs);
      }
    } catch {
      // History may not be available
    }
  }, [currentSessionId]);

  // ─── Delete a chat session ──────────────────────────────────────────
  const handleDeleteSession = useCallback(async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await aiAPI.deleteChatSession(sessionId);
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
        setMessages([]);
      }
      toast.success(t('ai.sessionDeleted'));
    } catch {
      toast.error(t('common.error'));
    }
  }, [currentSessionId, t]);

  // ─── Ensure we have a session before sending ─────────────────────
  const ensureSession = useCallback(async (): Promise<string> => {
    if (currentSessionId) return currentSessionId;
    // Auto-create a session
    if (isOfflineMode) {
      const localSession: AIChatSession = {
        id: `local_${Date.now()}`,
        title: t('ai.newChat'),
        created_at: new Date().toISOString(),
        message_count: 0,
      };
      setSessions(prev => [localSession, ...prev]);
      setCurrentSessionId(localSession.id);
      return localSession.id;
    }
    try {
      const session = await aiAPI.createChatSession(t('ai.newChat'));
      setSessions(prev => [session, ...prev]);
      setCurrentSessionId(session.id);
      return session.id;
    } catch {
      setIsOfflineMode(true);
      const localSession: AIChatSession = {
        id: `local_${Date.now()}`,
        title: t('ai.newChat'),
        created_at: new Date().toISOString(),
        message_count: 0,
      };
      setSessions(prev => [localSession, ...prev]);
      setCurrentSessionId(localSession.id);
      return localSession.id;
    }
  }, [currentSessionId, t, isOfflineMode]);

  // ─── CSV→API mapping dictionary ────────────────────────────────────────
  // NOTE: 'отчество' maps to 'initials' BUT requires value transformation:
  //   "Иванович" → "И." (first letter + dot). AD rejects full patronymic as initials.
  //   This transformation is applied automatically in generateLocalActions.
  const CSV_API_MAPPING: Record<string, string> = {
    'login': 'username', 'логин': 'username', 'username': 'username',
    'имя': 'given_name', 'name': 'given_name', 'firstname': 'given_name', 'given_name': 'given_name',
    'фамилия': 'surname', 'surname': 'surname', 'lastname': 'surname',
    'отчество': 'initials', 'initials': 'initials', 'middlename': 'initials',
    'инициалы': 'initials',
    'почта': 'mail_address', 'email': 'mail_address', 'mail': 'mail_address', 'mail_address': 'mail_address',
    'пароль': 'password', 'password': 'password', 'pass': 'password',
    'отдел': 'department', 'department': 'department',
    'компания': 'company', 'company': 'company',
    'должность': 'job_title', 'job_title': 'job_title', 'title': 'job_title',
    'телефон': 'telephone_number', 'phone': 'telephone_number', 'telephone_number': 'telephone_number',
    'описание': 'description', 'description': 'description',
    'группа': 'groupname', 'groupname': 'groupname', 'group': 'groupname',
    'компьютер': 'computername', 'computername': 'computername', 'computer': 'computername',
    'ou': 'userou', 'подразделение': 'userou', 'userou': 'userou',
  };

  // ─── Transform patronymic (отчество) to AD initials format ─────────────
  // "Иванович" → "И.", "Петровна" → "П.", "Иван Иванович" → "И.И."
  function patronymicToInitials(value: string): string {
    if (!value) return '';
    const parts = value.trim().split(/\s+/);
    return parts.map(p => p.charAt(0).toUpperCase() + '.').join('');
  }

  // ─── Normalize AI actions: handle config vs payload, direct props, etc. ──
  function normalizeActions(actions: AIAction[]): AIAction[] {
    if (!actions || !Array.isArray(actions)) return [];
    return actions.map(action => {
      if (action.type === 'add_api_node') {
        // Case 1: AI used "config" instead of "payload" → remap
        if (!action.payload && (action as Record<string, unknown>).config) {
          const { type, ...rest } = action as Record<string, unknown>;
          const config = rest.config as Record<string, unknown>;
          const { config: _, ...otherRest } = rest;
          return { type, payload: { ...config, ...otherRest } } as AIAction;
        }
        // Case 2: Data directly on action object (no payload/config wrapper)
        if (!action.payload && !(action as Record<string, unknown>).config) {
          const { type, ...rest } = action as Record<string, unknown> & { type: string };
          // Check if rest looks like a payload (has method, path, field_mappings, etc.)
          const payloadKeys = ['method', 'path', 'node_id', 'field_mappings', 'params', 'label', 'operationId'];
          const hasPayloadKeys = Object.keys(rest).some(k => payloadKeys.includes(k));
          if (hasPayloadKeys) {
            return { type, payload: rest } as AIAction;
          }
        }
      }
      return action;
    });
  }

  // ─── Extract AI actions from response text (handles ```json blocks) ──
  function extractActionsFromText(text: string): AIAction[] {
    if (!text) return [];
    try {
      // Strip markdown code blocks: ```json ... ``` → just the inner content
      // Handle multi-occurrence: remove ALL ```json and ``` markers
      let cleanText = text
        .replace(/```json\s*\n?/gi, '')
        .replace(/```\s*\n?/g, '')
        .trim();
      let rawActions: AIAction[] | null = null;
      // Try direct parse first
      try {
        const parsed = JSON.parse(cleanText);
        if (parsed.actions && Array.isArray(parsed.actions)) rawActions = parsed.actions;
      } catch { /* not pure JSON — maybe extra text around it */ }
      // Try to find JSON object with "actions" key — extract from surrounding text
      if (!rawActions) {
        const jsonMatch = cleanText.match(/\{[\s\S]*?"actions"[\s\S]*?\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.actions && Array.isArray(parsed.actions)) rawActions = parsed.actions;
          } catch { /* partial match — try harder */ }
        }
      }
      // Last resort: find balanced braces around "actions"
      if (!rawActions) {
        const startIdx = cleanText.indexOf('{');
        if (startIdx !== -1) {
          let depth = 0;
          for (let i = startIdx; i < cleanText.length; i++) {
            if (cleanText[i] === '{') depth++;
            else if (cleanText[i] === '}') depth--;
            if (depth === 0) {
              try {
                const parsed = JSON.parse(cleanText.slice(startIdx, i + 1));
                if (parsed.actions && Array.isArray(parsed.actions)) rawActions = parsed.actions;
              } catch { /* nope */ }
              break;
            }
          }
        }
      }
      // Normalize actions before returning (fix config→payload, direct props, etc.)
      if (rawActions) {
        return normalizeActions(rawActions);
      }
    } catch { /* no valid JSON found */ }
    return [];
  }

  // ─── Post-process AI actions: ensure initials transform + use_username_as_cn ──
  function ensureActionsIntegrity(actions: AIAction[]): AIAction[] {
    if (!actions || actions.length === 0) return actions;
    return actions.map(action => {
      if (action.type === 'add_api_node') {
        // Safe payload access: handle undefined/null payload
        const payload = ((action.payload || (action as Record<string, unknown>).config || {}) as Record<string, unknown>);
        // Fix field_mappings: add transform for initials
        if (payload.field_mappings && Array.isArray(payload.field_mappings)) {
          payload.field_mappings = (payload.field_mappings as Array<Record<string, unknown>>).map(fm => {
            if (fm.apiField === 'initials' && !fm.transform) {
              return { ...fm, transform: 'first_letter_with_dot' };
            }
            return fm;
          });
        }
        // Fix params: ensure use_username_as_cn for user creation POST
        if (payload.method === 'POST' && typeof payload.path === 'string' && payload.path.includes('/users/')) {
          const params = (payload.params || {}) as Record<string, unknown>;
          if (!params.use_username_as_cn) {
            payload.params = { ...params, use_username_as_cn: true };
          }
        }
        // Ensure payload is set back on action if it was missing
        if (!action.payload) {
          (action as Record<string, unknown>).payload = payload;
        }
      }
      return action;
    });
  }

  // ─── Auto-execute batch on server and show results in chat ──────────
  async function executeBatchAndShowResults(chatId: string): Promise<void> {
    const currentSteps = useETLStore.getState().steps;
    const currentImportedData = useETLStore.getState().importedData;
    const batchActions: { id: string; method: string; params: Record<string, unknown>; timeout: number }[] = [];

    const isGetOp = currentSteps.some(s => s.method.includes('list') || s.method.includes('get') || s.method.includes('search'));

    for (let stepIdx = 0; stepIdx < currentSteps.length; stepIdx++) {
      const step = currentSteps[stepIdx];
      const enabledMappings = step.fieldMappings.filter(m => m.enabled !== false);
      if (currentImportedData.length > 0 && enabledMappings.length > 0) {
        for (let rowIdx = 0; rowIdx < currentImportedData.length; rowIdx++) {
          const row = currentImportedData[rowIdx];
          const params: Record<string, unknown> = { ...step.params };
          for (const mapping of enabledMappings) {
            let val = row[mapping.csvColumn];
            if (val !== undefined && val !== '') {
              // Apply transform if specified (e.g., initials → first_letter_with_dot)
              if (mapping.transform === 'first_letter_with_dot' && typeof val === 'string') {
                val = val.trim().split(/\s+/).map((p: string) => p.charAt(0).toUpperCase() + '.').join('');
              } else if (mapping.apiField === 'initials' && typeof val === 'string' && val.length > 3) {
                // Fallback: auto-transform long initials values even without explicit transform
                val = val.trim().split(/\s+/).map((p: string) => p.charAt(0).toUpperCase() + '.').join('');
              }
              params[mapping.apiField] = val;
            }
          }
          batchActions.push({ id: `step${stepIdx + 1}_row${rowIdx + 1}`, method: step.method, params, timeout: 60 });
        }
      } else {
        batchActions.push({ id: `step${stepIdx + 1}`, method: step.method, params: { ...step.params }, timeout: 60 });
      }
    }

    if (batchActions.length === 0) return;

    const response = await api.post('/batch/', { actions: batchActions, stop_on_failure: false, rollback_on_failure: false, default_timeout: 60 });
    const batchResult: BatchResponse = response.data;
    const successCount = batchResult.successful_steps;
    const failCount = batchResult.failed_steps;
    const total = batchResult.total_steps;

    let resultText = '';
    if (isGetOp) {
      resultText = `**Результаты (${successCount}/${total}):**\n\n`;
      for (const stepResult of batchResult.steps) {
        if (stepResult.status === 'error') { resultText += `❌ **${stepResult.id || `#${stepResult.step}`}** — ${stepResult.error}\n`; continue; }
        const output = stepResult.output;
        if (Array.isArray(output)) {
          if (output.length === 0) { resultText += `ℹ️ Записей не найдено.\n`; }
          else {
            const sampleItem = output[0];
            if (typeof sampleItem === 'object' && sampleItem !== null) {
              const priorityCols = ['username', 'given_name', 'surname', 'mail_address', 'department', 'company', 'groupname', 'description', 'computername', 'ip_address', 'operating_system', 'ouname', 'dn', 'name', 'record_type', 'data'];
              const allKeys = Object.keys(sampleItem as Record<string, unknown>);
              const displayCols = priorityCols.filter(c => allKeys.includes(c));
              for (const k of allKeys) { if (!displayCols.includes(k) && displayCols.length < 6) displayCols.push(k); }
              resultText += `| ${displayCols.join(' | ')} |\n| ${displayCols.map(() => '---').join(' | ')} |\n`;
              for (const item of output) {
                if (typeof item === 'object' && item !== null) {
                  const obj = item as Record<string, unknown>;
                  resultText += `| ${displayCols.map(col => { const val = obj[col]; if (val === undefined || val === null) return ''; if (Array.isArray(val)) return val.join(', '); return String(val); }).join(' | ')} |\n`; 
                }
              }
              resultText += `\n*${output.length} записей*\n`;
            } else { for (const item of output) { resultText += `- ${String(item)}\n`; } resultText += `\n*${output.length} записей*\n`; }
          }
        } else if (typeof output === 'object' && output !== null) {
          const obj = output as Record<string, unknown>;
          const labelField = obj.username || obj.groupname || obj.computername || obj.ouname || obj.name || stepResult.id || `#${stepResult.step}`;
          resultText += `**${String(labelField)}:**\n\n`;
          for (const [key, value] of Object.entries(obj)) {
            if (value === undefined || value === null || value === '') continue;
            const displayKey = key.replace(/_/g, ' ');
            resultText += Array.isArray(value) ? `- **${displayKey}:** ${value.join(', ')}\n` : `- **${displayKey}:** ${String(value)}\n`;
          }
          resultText += '\n';
        } else if (output) { resultText += `${String(output)}\n`; }
      }
    } else {
      resultText = `**Результаты (${successCount}/${total} успешно):**\n\n`;
      for (const stepResult of batchResult.steps) {
        const icon = stepResult.status === 'success' ? '✅' : '❌';
        const stepId = stepResult.id || `#${stepResult.step}`;
        if (stepResult.status === 'error') { resultText += `${icon} **${stepId}** — ${stepResult.error}\n`; continue; }
        let summary = '';
        if (stepResult.output && typeof stepResult.output === 'object' && stepResult.output !== null) {
          const output = stepResult.output as Record<string, unknown>;
          const summaryFields = ['username', 'given_name', 'surname', 'mail_address', 'dn', 'computername', 'groupname', 'ouname'];
          const summaryParts: string[] = [];
          for (const field of summaryFields) { if (output[field]) summaryParts.push(String(output[field])); }
          if (summaryParts.length > 0) summary = summaryParts.join(' ');
        }
        resultText += `${icon} **${stepId}**${summary ? ` — ${summary}` : ''}\n`;
      }
    }

    const serverResultMsg: AIChatMessage = {
      id: `msg_${Date.now()}_server`,
      role: 'assistant',
      content: resultText,
      timestamp: new Date().toISOString(),
      mode: 'ai',
      chatId,
    };
    setMessages(prev => [...prev, serverResultMsg]);
    if (failCount === 0) { toast.success(`Выполнено: ${successCount}/${total} успешно`); }
    else { toast.warning(`Выполнено: ${successCount}/${total} успешно, ${failCount} ошибок`); }
  }

  // ─── Local action generator (no AI needed) ───────────────────────────
  // Full CRUD templates: create, delete, list, show, edit, enable, disable, unlock, setpassword, move
  // When CSV data is present for create → 1 node with field_mappings
  const generateLocalActions = useCallback((userPrompt: string): AIAction[] | null => {
    const prompt = userPrompt.toLowerCase().trim();
    const csvColumns = importedData.length > 0 ? Object.keys(importedData[0]) : [];
    const actions: AIAction[] = [];
    let nodeCounter = steps.length + 1;

    // ── Detect OPERATION type from prompt ──────────────────────────────
    const isCreate = /созда[йют]|create|add|добав|новый|новая|новое/.test(prompt);
    const isDelete = /удал[иьяюе]|delete|remove|del|убр/.test(prompt);
    const isList   = /список|list|показать|show all|все|просмотр/.test(prompt) && !/созда|delete|удал|edit|измен/.test(prompt);
    const isShow   = /показать|show|просмотр|детал|инфо|info|detail/.test(prompt) && !/список|list|все|созда|delete|удал|edit|измен/.test(prompt);
    const isEdit   = /измен[иьяюе]|edit|update|modify|редакт|помен|обнов/.test(prompt);
    const isEnable = /включ[иьяюе]|enable|актив/.test(prompt) && !/отключ|disable/.test(prompt);
    const isDisable = /отключ[иьяюе]|disable|деактив|блокир/.test(prompt);
    const isUnlock = /разблок[иьяюе]|unlock|разблок/.test(prompt);
    const isSetPwd = /пароль|password|pwd|смен.*парол|set.*pass/.test(prompt) && !/созда/.test(prompt);
    const isMove   = /перемест[иьяюе]|move|перенес/.test(prompt);
    const isSearch = /поиск|search|find|найт/.test(prompt);

    // ── Detect ENTITY type from prompt ─────────────────────────────────
    const isUsers     = /пользовател|user/.test(prompt) && !/групп|компьют|ou|dns|gpo|запис|контакт|сервис/.test(prompt.replace(/пользовател/, ''));
    const isGroups    = /групп|group/.test(prompt) && !/пользовател/.test(prompt);
    const isComputers = /компьют|computer/.test(prompt);
    const isContacts  = /контакт|contact/.test(prompt);
    const isOUs       = /ou|подразделен/.test(prompt) && !/компьют/.test(prompt);
    const isDNS       = /dns|запис[ьи]|зон[аеыоу]/.test(prompt);
    const isSvcAcct   = /сервис.*аккаунт|service.?account/.test(prompt);

    // ── Determine default entity if only operation is specified ─────────
    // e.g. "удалей" without entity → default to users
    const hasEntity = isUsers || isGroups || isComputers || isContacts || isOUs || isDNS || isSvcAcct;
    const entityIsUsers = isUsers || (!hasEntity);

    // ── Helper: Build field_mappings from CSV columns → API fields ─────
    function buildFieldMappingsFromCSV(
      csvCols: string[],
      entityType: 'users' | 'groups' | 'computers' | 'ous' | 'dns',
    ): { fieldMappings: Array<{ csvColumn: string; apiField: string; enabled?: boolean; transform?: string }>; staticParams: Record<string, unknown> } {
      const fieldMappings: Array<{ csvColumn: string; apiField: string; enabled?: boolean; transform?: string }> = [];
      const staticParams: Record<string, unknown> = {};
      const mappedApiFields = new Set<string>();

      for (const col of csvCols) {
        const colLower = col.toLowerCase().trim();
        const apiField = CSV_API_MAPPING[colLower];
        if (!apiField) continue;

        // Special handling for 'отчество' → 'initials': add transform
        if (apiField === 'initials' && (colLower === 'отчество' || colLower === 'middlename' || colLower === 'patronymic')) {
          fieldMappings.push({ csvColumn: col, apiField: 'initials', enabled: true, transform: 'first_letter_with_dot' });
          mappedApiFields.add('initials');
          continue;
        }

        fieldMappings.push({ csvColumn: col, apiField, enabled: true });
        mappedApiFields.add(apiField);
      }

      // Add default static params based on entity type
      if (entityType === 'users') {
        if (!mappedApiFields.has('password') && !staticParams['password']) {
          staticParams['password'] = 'P@ssw0rd!';
        }
        staticParams['use_username_as_cn'] = true;
      }

      return { fieldMappings, staticParams };
    }

    // ── TEMPLATE: USERS ────────────────────────────────────────────────
    if (entityIsUsers) {
      // CREATE with CSV
      if (isCreate && csvColumns.length > 0 && importedData.length > 0) {
        const { fieldMappings, staticParams } = buildFieldMappingsFromCSV(csvColumns, 'users');
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'POST', path: '/api/v1/users/',
            operationId: 'create_user_api_v1_users__post',
            label: `Создать пользователей (${importedData.length} из CSV)`,
            params: staticParams, field_mappings: fieldMappings,
          },
        });
      }
      // CREATE single
      else if (isCreate) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'POST', path: '/api/v1/users/',
            operationId: 'create_user_api_v1_users__post', label: 'Создать пользователя',
            params: { username: 'new_user', given_name: 'Имя', surname: 'Фамилия', password: 'P@ssw0rd!', use_username_as_cn: true },
          },
        });
      }
      // DELETE with CSV
      else if (isDelete && csvColumns.length > 0 && importedData.length > 0) {
        const usernameCol = csvColumns.find(c => /login|username|логин|user/i.test(c));
        if (usernameCol) {
          actions.push({
            type: 'add_api_node',
            payload: {
              node_id: `step_${nodeCounter}`, method: 'DELETE', path: '/api/v1/users/{username}',
              operationId: 'delete_user_api_v1_users__username__delete',
              label: `Удалить пользователей (${importedData.length} из CSV)`,
              params: {},
              field_mappings: [{ csvColumn: usernameCol, apiField: 'username', enabled: true }],
            },
          });
        } else {
          actions.push({
            type: 'add_api_node',
            payload: {
              node_id: `step_${nodeCounter}`, method: 'DELETE', path: '/api/v1/users/{username}',
              operationId: 'delete_user_api_v1_users__username__delete', label: 'Удалить пользователя',
              params: { username: 'user_to_delete' },
            },
          });
        }
      }
      // DELETE single
      else if (isDelete) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'DELETE', path: '/api/v1/users/{username}',
            operationId: 'delete_user_api_v1_users__username__delete', label: 'Удалить пользователя',
            params: { username: 'user_to_delete' },
          },
        });
      }
      // LIST
      else if (isList) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'GET', path: '/api/v1/users/',
            operationId: 'list_users_api_v1_users__get', label: 'Список пользователей', params: {},
          },
        });
      }
      // SHOW
      else if (isShow) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'GET', path: '/api/v1/users/{username}',
            operationId: 'show_user_api_v1_users__username__get', label: 'Просмотр пользователя',
            params: { username: 'username' },
          },
        });
      }
      // EDIT
      else if (isEdit) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'PUT', path: '/api/v1/users/{username}',
            operationId: 'edit_user_api_v1_users__username__put', label: 'Редактировать пользователя',
            params: { username: 'username', given_name: 'Новое имя', surname: 'Новая фамилия' },
          },
        });
      }
      // ENABLE
      else if (isEnable) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'POST', path: '/api/v1/users/{username}/enable',
            operationId: 'enable_user_api_v1_users__username__enable_post', label: 'Включить пользователя',
            params: { username: 'username' },
          },
        });
      }
      // DISABLE
      else if (isDisable) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'POST', path: '/api/v1/users/{username}/disable',
            operationId: 'disable_user_api_v1_users__username__disable_post', label: 'Отключить пользователя',
            params: { username: 'username' },
          },
        });
      }
      // UNLOCK
      else if (isUnlock) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'POST', path: '/api/v1/users/{username}/unlock',
            operationId: 'unlock_user_api_v1_users__username__unlock_post', label: 'Разблокировать пользователя',
            params: { username: 'username' },
          },
        });
      }
      // SET PASSWORD
      else if (isSetPwd) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'POST', path: '/api/v1/users/{username}/setpassword',
            operationId: 'setpassword_user_api_v1_users__username__setpassword_post', label: 'Установить пароль',
            params: { username: 'username', new_password: 'NewP@ssw0rd!' },
          },
        });
      }
      // MOVE
      else if (isMove) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'POST', path: '/api/v1/users/{username}/move',
            operationId: 'move_user_api_v1_users__username__move_post', label: 'Переместить пользователя',
            params: { username: 'username', new_parent_dn: 'OU=Target,DC=domain,DC=local' },
          },
        });
      }
      // SEARCH
      else if (isSearch) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'GET', path: '/api/v1/users/search',
            operationId: 'search_users_api_v1_users_search_get', label: 'Поиск пользователей',
            params: { search: '' },
          },
        });
      }
    }

    // ── TEMPLATE: GROUPS ───────────────────────────────────────────────
    else if (isGroups) {
      if (isCreate && csvColumns.length > 0 && importedData.length > 0) {
        const { fieldMappings, staticParams } = buildFieldMappingsFromCSV(csvColumns, 'groups');
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'POST', path: '/api/v1/groups/',
            operationId: 'create_group_api_v1_groups__post',
            label: `Создать группы (${importedData.length} из CSV)`,
            params: staticParams, field_mappings: fieldMappings,
          },
        });
      } else if (isCreate) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'POST', path: '/api/v1/groups/',
            operationId: 'create_group_api_v1_groups__post', label: 'Создать группу',
            params: { groupname: 'new_group', description: 'Новая группа' },
          },
        });
      } else if (isDelete) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'DELETE', path: '/api/v1/groups/{groupname}',
            operationId: 'delete_group_api_v1_groups__groupname__delete', label: 'Удалить группу',
            params: { groupname: 'group_to_delete' },
          },
        });
      } else if (isList) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'GET', path: '/api/v1/groups/',
            operationId: 'list_groups_api_v1_groups__get', label: 'Список групп', params: {},
          },
        });
      } else if (isShow) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'GET', path: '/api/v1/groups/{groupname}',
            operationId: 'show_group_api_v1_groups__groupname__get', label: 'Просмотр группы',
            params: { groupname: 'groupname' },
          },
        });
      } else if (isEdit) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'PUT', path: '/api/v1/groups/{groupname}',
            operationId: 'edit_group_api_v1_groups__groupname__put', label: 'Редактировать группу',
            params: { groupname: 'groupname', description: 'Новое описание' },
          },
        });
      }
    }

    // ── TEMPLATE: COMPUTERS ────────────────────────────────────────────
    else if (isComputers) {
      if (isCreate && csvColumns.length > 0 && importedData.length > 0) {
        const { fieldMappings, staticParams } = buildFieldMappingsFromCSV(csvColumns, 'computers');
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'POST', path: '/api/v1/computers/',
            operationId: 'create_computer_api_v1_computers__post',
            label: `Создать компьютеры (${importedData.length} из CSV)`,
            params: staticParams, field_mappings: fieldMappings,
          },
        });
      } else if (isCreate) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'POST', path: '/api/v1/computers/',
            operationId: 'create_computer_api_v1_computers__post', label: 'Создать компьютер',
            params: { computername: 'NEW-PC', description: 'Новый компьютер' },
          },
        });
      } else if (isDelete) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'DELETE', path: '/api/v1/computers/{computername}',
            operationId: 'delete_computer_api_v1_computers__computername__delete', label: 'Удалить компьютер',
            params: { computername: 'COMPUTER-NAME' },
          },
        });
      } else if (isList) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'GET', path: '/api/v1/computers/',
            operationId: 'list_computers_api_v1_computers__get', label: 'Список компьютеров', params: {},
          },
        });
      } else if (isShow) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'GET', path: '/api/v1/computers/{computername}',
            operationId: 'show_computer_api_v1_computers__computername__get', label: 'Просмотр компьютера',
            params: { computername: 'COMPUTER-NAME' },
          },
        });
      }
    }

    // ── TEMPLATE: OUs ──────────────────────────────────────────────────
    else if (isOUs) {
      if (isCreate && csvColumns.length > 0 && importedData.length > 0) {
        const { fieldMappings, staticParams } = buildFieldMappingsFromCSV(csvColumns, 'ous');
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'POST', path: '/api/v1/ous/',
            operationId: 'create_ou_api_v1_ous__post',
            label: `Создать OU (${importedData.length} из CSV)`,
            params: staticParams, field_mappings: fieldMappings,
          },
        });
      } else if (isCreate) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'POST', path: '/api/v1/ous/',
            operationId: 'create_ou_api_v1_ous__post', label: 'Создать OU',
            params: { ouname: 'NewOU', description: 'Новое подразделение' },
          },
        });
      } else if (isDelete) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'DELETE', path: '/api/v1/ous/{ouname}',
            operationId: 'delete_ou_api_v1_ous__ouname__delete', label: 'Удалить OU',
            params: { ouname: 'OU-NAME' },
          },
        });
      } else if (isList) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'GET', path: '/api/v1/ous/',
            operationId: 'list_ous_api_v1_ous__get', label: 'Список OU', params: {},
          },
        });
      }
    }

    // ── TEMPLATE: DNS ──────────────────────────────────────────────────
    else if (isDNS) {
      if (isCreate) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'POST', path: '/api/v1/dns/zones/{zone}/records',
            operationId: 'create_record_api_v1_dns_zones__zone__records_post', label: 'Создать DNS запись',
            params: { zone: 'example.com', name: 'new', record_type: 'A', data: '192.168.1.1' },
          },
        });
      } else if (isDelete) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'DELETE', path: '/api/v1/dns/zones/{zone}/records',
            operationId: 'delete_record_api_v1_dns_zones__zone__records_delete', label: 'Удалить DNS запись',
            params: { zone: 'example.com', name: 'record', record_type: 'A', data: '192.168.1.1' },
          },
        });
      } else if (isList) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'GET', path: '/api/v1/dns/zones/',
            operationId: 'list_zones_api_v1_dns_zones__get', label: 'Список DNS зон', params: {},
          },
        });
      }
    }

    // ── TEMPLATE: CONTACTS ─────────────────────────────────────────────
    else if (isContacts) {
      if (isCreate) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'POST', path: '/api/v1/contacts/',
            operationId: 'create_contact_api_v1_contacts__post', label: 'Создать контакт',
            params: { contactname: 'new_contact', given_name: 'Имя', surname: 'Фамилия' },
          },
        });
      } else if (isDelete) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'DELETE', path: '/api/v1/contacts/{contactname}',
            operationId: 'delete_contact_api_v1_contacts__contactname__delete', label: 'Удалить контакт',
            params: { contactname: 'contact_to_delete' },
          },
        });
      } else if (isList) {
        actions.push({
          type: 'add_api_node',
          payload: {
            node_id: `step_${nodeCounter}`, method: 'GET', path: '/api/v1/contacts/',
            operationId: 'list_contacts_api_v1_contacts__get', label: 'Список контактов', params: {},
          },
        });
      }
    }

    return actions.length > 0 ? actions : null;
  }, [importedData, steps]);

  // ─── Local SDB action generator (no AI needed) ──────────────────────
  // Parses natural-language prompts and produces ready-to-execute SDB
  // add_api_node actions with a REAL script (no {USER_INPUT} placeholder).
  // This bypasses the backend AI entirely for SDB mode, which is critical
  // because the backend has a hardcoded "ETL Constructor" system prompt
  // that doesn't understand SDB script syntax.
  //
  // Supported patterns (RU/EN):
  //   "показать 5 пользователей"     → FROM USERS LIMIT 5
  //   "список групп"                 → FROM GROUPS LIMIT 1000
  //   "admin пользователи"           → FROM USERS WHERE adminCount = 1
  //   "отключённые пользователи"     → FROM USERS WHERE userAccountControl = '2'
  //   "компьютеры с Windows 10"      → FROM COMPUTERS WHERE operatingSystem LIKE 'Windows 10%'
  //   "показать DNS записи"          → FROM DNS_RECORDS
  //   "найти пользователя ivanov"    → FROM USERS WHERE sAMAccountName = 'ivanov'
  //   "группа Domain Admins"         → FROM GROUPS WHERE cn = 'Domain Admins'
  //
  // Returns null if no SDB pattern matches (then we fall back to AI).
  const generateSdbActions = useCallback((userPrompt: string): AIAction[] | null => {
    const p = userPrompt.toLowerCase().trim();
    if (!p) return null;

    // ── Detect entity from prompt ─────────────────────────────────────
    // Order matters: check 'dns' before 'users' (because 'dns' has 's' which could match 'users' partially)
    type EntityDef = { key: string; table: string; label: string; keywords: string[] };
    const ENTITIES: EntityDef[] = [
      { key: 'dnsNode', table: 'DNS_RECORDS', label: 'DNS записи', keywords: ['dns', 'запис', 'зон'] },
      { key: 'gpo', table: 'GPOS', label: 'GPO', keywords: ['gpo', 'группов.*политик', 'политик'] },
      { key: 'ou', table: 'OUS', label: 'Подразделения', keywords: ['ou', 'подразделен', 'организац.*единиц'] },
      { key: 'computer', table: 'COMPUTERS', label: 'Компьютеры', keywords: ['компьют', 'computer', 'pc', 'рабоч.*станц'] },
      { key: 'group', table: 'GROUPS', label: 'Группы', keywords: ['групп', 'group'] },
      { key: 'contact', table: 'CONTACTS', label: 'Контакты', keywords: ['контакт', 'contact'] },
      { key: 'user', table: 'USERS', label: 'Пользователи', keywords: ['пользовател', 'user', 'учетн', 'учётн', 'аккаунт', 'account', 'логин', 'login'] },
    ];

    let entity: EntityDef | null = null;
    for (const e of ENTITIES) {
      for (const kw of e.keywords) {
        const re = new RegExp(kw, 'i');
        if (re.test(p)) { entity = e; break; }
      }
      if (entity) break;
    }
    if (!entity) return null;

    // ── Detect limit (number in prompt) ───────────────────────────────
    let limit = 1000; // default
    const numMatch = p.match(/\b(\d{1,4})\b/);
    if (numMatch) {
      const n = parseInt(numMatch[1], 10);
      if (n > 0 && n <= 2000) limit = n;
    }

    // ── Detect WHERE filter from prompt ───────────────────────────────
    let where = '';
    let sheetName = entity.label;
    let description = '';

    // Check for "list all" patterns FIRST — these should NOT trigger name search.
    // Patterns: "показать", "список", "все", "list", "show", "all" + entity keyword
    const isListPattern = /(?:показать|список|все|всех|весь|list|show|all|display|вывед|выдай|дай)/i.test(p);

    // "admin" / "администратор"
    if (/admin|администратор|админск/.test(p)) {
      where = "adminCount = 1";
      sheetName = `Admin ${entity.label.toLowerCase()}`;
      description = `${entity.label} с adminCount = 1 (Administrator, члены Domain Admins)`;
    }
    // "отключённые" / "disabled" / "заблокированные"
    else if (/отключен|disable|заблокирован|деактив|неактив|blocked/.test(p)) {
      where = "userAccountControl = '2'";
      sheetName = `Отключённые ${entity.label.toLowerCase()}`;
      description = `${entity.label} с флагом ACCOUNTDISABLE (UAC=2)`;
    }
    // "включённые" / "active" / "активные"
    else if (/включен|активн|active|enabled/.test(p)) {
      where = "userAccountControl <> '2'";
      sheetName = `Активные ${entity.label.toLowerCase()}`;
      description = `${entity.label} без флага ACCOUNTDISABLE`;
    }
    // Windows version filter
    else if (entity.key === 'computer') {
      const winMatch = p.match(/windows\s*(\d+\.?\d*)/i) || p.match(/win\s*(\d+)/i);
      if (winMatch) {
        const ver = winMatch[1];
        where = `operatingSystem LIKE 'Windows ${ver}%'`;
        sheetName = `Windows ${ver}`;
        description = `Компьютеры под управлением Windows ${ver}`;
      }
    }

    // ── Name search: ONLY if NOT a list pattern ───────────────────────
    // Be very conservative — only match specific name patterns:
    //  1. Quoted name: "ivanov" or 'ivanov'
    //  2. After "имя"/"name"/"cn=" keyword: имя ivanov, name ivanov, cn=ivanov
    //  3. After "найти"/"find"/"search": найти ivanov, find ivanov
    // Do NOT match if the prompt contains list keywords (показать, список, все)
    if (!where && !isListPattern) {
      let matchedName: string | null = null;

      // 1. Quoted name
      const quotedMatch = p.match(/["']([a-zа-я0-9_\-\.]{2,40})["']/i);
      if (quotedMatch) {
        matchedName = quotedMatch[1];
      }

      // 2. After "имя"/"name"/"cn="
      if (!matchedName) {
        const nameKwMatch = p.match(/(?:имя|name|cn=|логин|login)\s*[:=]?\s*([a-zа-я0-9_\-\.]{2,30})/i);
        if (nameKwMatch) {
          matchedName = nameKwMatch[1];
        }
      }

      // 3. After "найти"/"find"/"search" — single word only (no spaces)
      if (!matchedName) {
        const findMatch = p.match(/(?:найти|find|search|искать)\s+([a-z0-9_\-\.]{2,30})/i);
        if (findMatch) {
          matchedName = findMatch[1];
        }
      }

      if (matchedName) {
        // Validate: name should NOT be an entity keyword or common word
        const lowerName = matchedName.toLowerCase();
        const entityWords = ['user', 'users', 'пользовател', 'group', 'groups', 'групп', 'computer', 'компьют', 'ou', 'gpo', 'contact', 'контакт', 'dns'];
        const isEntityWord = entityWords.some(w => lowerName.includes(w));
        if (!isEntityWord) {
          let field = 'cn';
          if (entity.key === 'user' || entity.key === 'computer') field = 'sAMAccountName';
          else if (entity.key === 'group') field = 'cn';
          else if (entity.key === 'ou') field = 'ou';
          where = `${field} = '${matchedName}'`;
          sheetName = `${entity.label}: ${matchedName}`;
          description = `${entity.label} где ${field} = '${matchedName}'`;
        }
      }
    }

    // If no WHERE filter → it's a simple list query
    if (!where) {
      if (isListPattern) {
        description = `${entity.label} (LIMIT ${limit})`;
      } else {
        description = `${entity.label} (LIMIT ${limit})`;
      }
    }

    // ── Build the SDB script ──────────────────────────────────────────
    const script = `USE sam;\nFROM ${entity.table}${where ? ` WHERE ${where}` : ''};\nSHOW AS json LIMIT ${limit};`;

    // ── Build the action ──────────────────────────────────────────────
    const action: AIAction = {
      type: 'add_api_node',
      payload: {
        node_id: 'node_1',
        method: 'POST',
        path: '/api/v1/sdb/script',
        operationId: 'sdb_script_endpoint_api_v1_sdb_script_post',
        label: sheetName,
        params: { script },
      },
    };

    return [action];
  }, []);

  // ─── Fix SDB actions returned by AI: replace {USER_INPUT} with real script ──
  // The backend AI has a hardcoded ETL Constructor system prompt that doesn't
  // understand SDB script syntax. It often returns params.script = "{USER_INPUT}"
  // or empty. We detect this and replace it with a real SDB script generated
  // from the user's original prompt.
  const fixSdbActionPlaceholders = useCallback((actions: AIAction[], userPrompt: string): AIAction[] => {
    if (!actions || actions.length === 0) return actions;
    // Generate a fallback SDB script from the user's prompt
    const fallbackActions = generateSdbActions(userPrompt);
    const fallbackScript = fallbackActions && fallbackActions.length > 0
      ? String((fallbackActions[0].payload as Record<string, unknown>).params
        ? ((fallbackActions[0].payload as Record<string, unknown>).params as Record<string, unknown>).script
        : '')
      : '';
    const fallbackLabel = fallbackActions && fallbackActions.length > 0
      ? String((fallbackActions[0].payload as Record<string, unknown>).label || 'SDB Query')
      : 'SDB Query';

    return actions.map(action => {
      if (action.type !== 'add_api_node') return action;
      const path = String((action.payload as Record<string, unknown>).path || '');
      if (!/\/api\/v1\/sdb\/(script|select|query|full|info|show)/i.test(path)) return action;

      const payload = action.payload as Record<string, unknown>;
      const params = (payload.params || {}) as Record<string, unknown>;

      // Check if script/query has {USER_INPUT} or is empty
      const scriptVal = String(params.script || params.query || '');
      const needsFix = !scriptVal || /\{USER_INPUT\}/i.test(scriptVal) || scriptVal.trim() === '';

      if (needsFix && fallbackScript) {
        // Replace the placeholder with the real script
        return {
          ...action,
          payload: {
            ...payload,
            label: String(payload.label || fallbackLabel),
            params: { ...params, script: fallbackScript },
          },
        };
      }
      return action;
    });
  }, [generateSdbActions]);

  // ─── Execute SDB query action: run SDB select/script + create DataForge sheet ──
  // Returns the result rows + status info so we can show it in chat.
  const executeSdbQuery = useCallback(async (
    payload: AISDBQueryPayload,
  ): Promise<{ rows: Record<string, unknown>[]; error?: string; queryDescription: string }> => {
    const entity = payload.entity || 'user';
    const scope = payload.scope || entity.toUpperCase();
    const limit = Math.min(Math.max(payload.limit || 1000, 1), 2000);
    const where = payload.where?.trim();
    const description = payload.description || `SDB query: ${scope}${where ? ` WHERE ${where}` : ''} LIMIT ${limit}`;

    // Build SDB script: USE sam; FROM <SCOPE> [WHERE ...]; SHOW AS json LIMIT <N>;
    const script = `USE sam;\nFROM ${scope}${where ? ` WHERE ${where}` : ''};\nSHOW AS json LIMIT ${limit};`;

    let rows: Record<string, unknown>[] = [];

    try {
      // 1st try: /sdb/script (full SDB script)
      try {
        const res = await api.post('/sdb/script', { script });
        const data = res.data;
        // New format: {success, data: [...], columns, rows: N, last_result: "JSON"}
        if (Array.isArray(data?.data)) rows = data.data;
        else if (Array.isArray(data)) rows = data;
        else if (Array.isArray(data?.rows) && typeof data.rows[0] === 'object') rows = data.rows;
        else if (data?.output) {
          try {
            const parsed = JSON.parse(data.output);
            rows = Array.isArray(parsed) ? parsed : [parsed];
          } catch { /* ignore */ }
        } else if (data?.last_result) {
          // New format fallback: last_result is JSON string
          try {
            const parsed = JSON.parse(data.last_result);
            rows = Array.isArray(parsed) ? parsed : [parsed];
          } catch { /* ignore */ }
        }
      } catch {
        // 2nd try: /sdb/select (SQL-like)
        try {
          const res = await api.post('/sdb/select', { scope, format: 'json', limit, ...(where ? { where } : {}) });
          const data = res.data;
          if (Array.isArray(data)) rows = data;
          else if (Array.isArray(data?.data)) rows = data.data;
          else if (Array.isArray(data?.rows)) rows = data.rows;
          else if (data?.output) {
            try {
              const parsed = JSON.parse(data.output);
              rows = Array.isArray(parsed) ? parsed : [parsed];
            } catch { /* ignore */ }
          }
        } catch {
          // 3rd try: /sdb/full/{entity} (no where support, just GET all)
          const urlPath = entity === 'dnsNode' ? 'dns' : `${entity}s`;
          const res = await api.get(`/sdb/full/${encodeURIComponent(urlPath)}`, { params: { fields: '*', limit } });
          const data = res.data;
          if (Array.isArray(data)) rows = data;
          else if (Array.isArray(data?.data)) rows = data.data;
          else if (Array.isArray(data?.rows)) rows = data.rows;
          // Apply where filter client-side (best effort)
          if (where && rows.length > 0) {
            // Simple equality filter: "field = value" or "field LIKE 'pattern%'"
            const m = where.match(/^(\w+)\s*=\s*'([^']*)'$/i) || where.match(/^(\w+)\s*=\s*(.+)$/i);
            if (m) {
              const [, field, value] = m;
              const isLike = /LIKE/i.test(where);
              if (isLike) {
                const pattern = value.replace(/%/g, '');
                rows = rows.filter(r => String(r[field] ?? '').includes(pattern));
              } else {
                rows = rows.filter(r => String(r[field] ?? '') === value);
              }
            }
          }
        }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'SDB query failed';
      return { rows: [], error: errMsg, queryDescription: description };
    }

    // Dispatch event to create a new sheet in DataForge with the result rows
    if (rows.length > 0) {
      const sheetName = payload.sheet_name || `${scope} (${rows.length})`;
      window.dispatchEvent(new CustomEvent('dataforge-create-sheet-from-query', {
        detail: {
          entity,
          sheetName,
          rows,
          description,
        },
      }));
    }

    return { rows, queryDescription: description };
  }, []);

  // ─── Execute an `add_api_node` action whose path is an SDB endpoint ──
  // The backend AI has its own ETL-Constructor system prompt and returns
  // `add_api_node` actions (not `sdb_query`) even in SDB mode. We detect
  // SDB API paths and execute them directly via axios, then create a
  // DataForge sheet with the result rows.
  //
  // Supported SDB paths:
  //   POST /api/v1/sdb/query       — body: {query: "SELECT * FROM user LIMIT 5"}
  //   POST /api/v1/sdb/select      — body: {scope, format, limit, where}
  //   POST /api/v1/sdb/script      — body: {script: "USE sam; FROM USERS; ..."}
  //   GET  /api/v1/sdb/full/{ent}  — params: {fields, limit}
  //   GET  /api/v1/sdb/info/{ent}  — params: {count, fields}
  //   POST /api/v1/sdb/show        — body: {dn, database}
  //
  // Returns {rows, entity, sheetName, error?, description}
  const executeAddApiNodeAsSdb = useCallback(async (
    action: AIAction,
  ): Promise<{
    rows: Record<string, unknown>[];
    entity: string;
    sheetName: string;
    description: string;
    error?: string;
  }> => {
    const payload = (action.payload || {}) as Record<string, unknown>;
    const method = String(payload.method || 'GET').toUpperCase();
    const path = String(payload.path || '');
    const params = (payload.params || {}) as Record<string, unknown>;
    const label = String(payload.label || 'SDB Query');

    // Determine entity from path or params
    let entity = 'user';
    const fullMatch = path.match(/\/sdb\/full\/([^/?]+)/i);
    const infoMatch = path.match(/\/sdb\/info\/([^/?]+)/i);
    if (fullMatch) entity = decodeURIComponent(fullMatch[1]).replace(/s$/, '').toLowerCase();
    else if (infoMatch) entity = decodeURIComponent(infoMatch[1]).replace(/s$/, '').toLowerCase();
    else if (typeof params.entity === 'string') entity = params.entity;
    else if (typeof params.scope === 'string') entity = params.scope.toLowerCase().replace(/s$/, '');
    else if (typeof params.table === 'string') entity = params.table.toLowerCase().replace(/s$/, '');

    // Normalize: 'users' → 'user', 'computers' → 'computer', etc.
    const ENTITY_NORMALIZE: Record<string, string> = {
      users: 'user', groups: 'group', computers: 'computer',
      ous: 'ou', gpos: 'gpo', contacts: 'contact',
      dns: 'dnsNode', dns_records: 'dnsNode', dnsnodes: 'dnsNode',
    };
    if (ENTITY_NORMALIZE[entity]) entity = ENTITY_NORMALIZE[entity];

    let rows: Record<string, unknown>[] = [];
    let description = label;

    // Strip /api/v1 prefix from path — axios baseURL already includes it.
    // AI and local generator return paths like '/api/v1/sdb/script',
    // but api.post('/api/v1/sdb/script') would become '/api/v1/api/v1/sdb/script' (double prefix).
    const cleanPath = path.replace(/^\/api\/v\d+\//, '/');

    try {
      let res: { data: unknown };
      if (method === 'GET') {
        res = await api.get(cleanPath, { params });
      } else {
        // POST/PUT — send params as JSON body
        res = await api.post(cleanPath, params);
      }
      const data = res.data as Record<string, unknown> | unknown[] | string;

      // Extract rows from various response shapes
      if (Array.isArray(data)) {
        rows = data as Record<string, unknown>[];
      } else if (data && typeof data === 'object') {
        const d = data as Record<string, unknown>;
        if (Array.isArray(d.data)) rows = d.data as Record<string, unknown>[];
        else if (Array.isArray(d.rows)) rows = d.rows as Record<string, unknown>[];
        else if (Array.isArray(d.items)) rows = d.items as Record<string, unknown>[];
        else if (Array.isArray(d.results)) rows = d.results as Record<string, unknown>[];
        else if (typeof d.output === 'string') {
          // SDB script/select returns {output: "..."} with JSON inside
          try {
            const parsed = JSON.parse(d.output);
            rows = Array.isArray(parsed) ? parsed : (Array.isArray((parsed as Record<string, unknown>).data) ? (parsed as Record<string, unknown>).data as Record<string, unknown>[] : [parsed as Record<string, unknown>]);
          } catch { /* ignore */ }
        } else if (typeof d.last_result === 'string') {
          // New /sdb/script format: {success: true, data: [...], last_result: "JSON string"}
          // last_result is the JSON-encoded result of the last query
          try {
            const parsed = JSON.parse(d.last_result);
            rows = Array.isArray(parsed) ? parsed : [parsed as Record<string, unknown>];
          } catch { /* ignore */ }
        } else if (Array.isArray((d as Record<string, unknown>).records)) {
          rows = (d as Record<string, unknown>).records as Record<string, unknown>[];
        }
      } else if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data);
          rows = Array.isArray(parsed) ? parsed : [parsed as Record<string, unknown>];
        } catch { /* ignore */ }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'SDB query failed';
      return { rows: [], entity, sheetName: label, description, error: errMsg };
    }

    return {
      rows,
      entity,
      sheetName: label,
      description,
    };
  }, []);

  // ─── Detect if an `add_api_node` action targets an SDB endpoint ──
  const isSdbApiNode = useCallback((action: AIAction): boolean => {
    if (action.type !== 'add_api_node') return false;
    const path = String((action.payload as Record<string, unknown>)?.path || '');
    return /\/api\/v1\/sdb\/(query|select|script|full|info|show)/i.test(path);
  }, []);

  // ─── Process all SDB-related actions from AI response (in SDB mode) ──
  // Handles both `sdb_query` actions (our preferred format) AND `add_api_node`
  // actions with SDB paths (the backend AI's actual format). Executes each,
  // creates a DataForge sheet, and shows toasts.
  const processSdbActions = useCallback(async (actions: AIAction[]) => {
    for (const action of actions) {
      try {
        if (action.type === 'sdb_query') {
          // Our preferred sdb_query action format
          const payload = action.payload as AISDBQueryPayload;
          const result = await executeSdbQuery(payload);
          if (result.error) {
            toast.error(`SDB: ${result.error}`);
          } else if (result.rows.length > 0) {
            // Dispatch event for DataForge to create a sheet
            const sheetName = payload.sheet_name || `${payload.entity} (${result.rows.length})`;
            window.dispatchEvent(new CustomEvent('dataforge-create-sheet-from-query', {
              detail: { entity: payload.entity, sheetName, rows: result.rows, description: result.queryDescription },
            }));
            window.dispatchEvent(new CustomEvent('navigate-to-page', { detail: { page: 'dataforge' } }));
            toast.success(t('ai.sdbSheetCreated', {
              count: result.rows.length,
              name: sheetName,
              defaultValue: `Создан лист «${sheetName}» с ${result.rows.length} записями`,
            }));
          } else {
            toast.warning(t('ai.sdbNoRows', { defaultValue: 'SDB-запрос вернул 0 строк' }));
          }
        } else if (isSdbApiNode(action)) {
          // Backend AI returned add_api_node with SDB path — execute directly
          const result = await executeAddApiNodeAsSdb(action);
          if (result.error) {
            toast.error(`SDB: ${result.error}`);
          } else if (result.rows.length > 0) {
            const sheetName = result.sheetName || `${result.entity} (${result.rows.length})`;
            window.dispatchEvent(new CustomEvent('dataforge-create-sheet-from-query', {
              detail: {
                entity: result.entity,
                sheetName,
                rows: result.rows,
                description: result.description,
              },
            }));
            window.dispatchEvent(new CustomEvent('navigate-to-page', { detail: { page: 'dataforge' } }));
            toast.success(t('ai.sdbSheetCreated', {
              count: result.rows.length,
              name: sheetName,
              defaultValue: `Создан лист «${sheetName}» с ${result.rows.length} записями`,
            }));
          } else {
            toast.warning(t('ai.sdbNoRows', { defaultValue: 'SDB-запрос вернул 0 строк' }));
          }
        } else if (action.type === 'info') {
          const infoPayload = action.payload as { message?: string };
          if (infoPayload?.message) toast.info(infoPayload.message);
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'SDB execution failed';
        toast.error(`SDB: ${errMsg}`);
      }
    }
  }, [executeSdbQuery, executeAddApiNodeAsSdb, isSdbApiNode, t]);

  // ─── Computed: API operation definitions for steps ──────────────────
  const stepOpDefs = useMemo(() => {
    const defs: Map<string, { method: string; label: string; inputParams: string[]; outputFields: string[] }> = new Map();
    for (const step of steps) {
      const op = API_OPERATIONS.find(o => o.method === step.method);
      if (op) {
        defs.set(step.id, {
          method: op.method,
          label: op.label,
          inputParams: op.params.map(p => p.name),
          outputFields: (op.outputFields || []).map(f => f.name),
        });
      }
    }
    return defs;
  }, [steps]);

  // ─── Build data context for AI from current ETL state (v1.9-3-6) ──
  const buildDataContext = useCallback((): string => {
    const parts: string[] = [];

    // Pipeline Steps
    if (steps.length > 0) {
      parts.push('### Pipeline Steps');
      steps.forEach((step, idx) => {
        const opDef = stepOpDefs.get(step.id);
        const inputParams = opDef?.inputParams || [];
        const outputFields = opDef?.outputFields || [];
        const enabledMappings = step.fieldMappings.filter(m => m.enabled !== false);
        const filledParams = Object.entries(step.params).filter(([, v]) => v !== undefined && v !== '').map(([k]) => k);
        parts.push(`  ${idx + 1}. **${step.label}** (${step.method})`);
        if (inputParams.length > 0) {
          parts.push(`     Inputs: ${inputParams.join(', ')}`);
        }
        if (outputFields.length > 0) {
          parts.push(`     Outputs: ${outputFields.join(', ')}`);
        }
        if (filledParams.length > 0) {
          parts.push(`     Filled: ${filledParams.join(', ')}`);
        }
        if (enabledMappings.length > 0) {
          parts.push(`     Mapped: ${enabledMappings.map(m => `${m.csvColumn}→${m.apiField}${m.transform ? ` (transform:${m.transform})` : ''}`).join(', ')}`);
        }
      });
    }

    // CSV Columns — always include sample data so AI can create actions
    const csvColumns = importedData.length > 0 ? Object.keys(importedData[0]) : [];
    if (csvColumns.length > 0) {
      parts.push(`### CSV Data (${importedData.length} rows, ${csvColumns.length} columns)`);
      // Column names
      parts.push(`Columns: ${csvColumns.join(', ')}`);

      if (safeMode) {
        // Safe Mode: mask PII values with [P1], [P2] tokens
        // The AI only needs column names and structure — not real data
        parts.push('Sample data (Safe Mode — PII masked):');
        // Show column→token mapping for first row
        const tokenMap = csvColumns.map((c, idx) => `${c}=[P${idx + 1}]`).join(', ');
        parts.push(`  Row 1: ${tokenMap}`);
        if (importedData.length > 1) {
          parts.push(`  ... ${importedData.length} rows total (all follow same structure)`);
        }
        parts.push('NOTE: [P1], [P2] etc. are PII placeholders. DO NOT try to guess real values. Use field_mappings to map CSV columns → API fields — real values will be applied at runtime.');
      } else {
        // Non-Safe Mode: show actual data (up to 10 rows)
        const sampleRows = importedData.slice(0, Math.min(10, importedData.length));
        parts.push('Sample data:');
        sampleRows.forEach((row, idx) => {
          const rowValues = csvColumns.map(c => `${c}="${row[c] || ''}"`).join(', ');
          parts.push(`  Row ${idx + 1}: ${rowValues}`);
        });
        if (importedData.length > 10) {
          parts.push(`  ... and ${importedData.length - 10} more rows`);
        }
      }
    }

    // API Fields — show ONLY relevant fields (not all 29)
    // Only show fields that are mapped or that are in the current step's operation
    const apiInputSet = new Set<string>();
    const apiOutputSet = new Set<string>();
    for (const step of steps) {
      const opDef = stepOpDefs.get(step.id);
      if (opDef) {
        // Only include fields that are actually used (mapped or filled)
        const filledParams = Object.keys(step.params).filter(k => step.params[k] !== undefined && step.params[k] !== '');
        filledParams.forEach(p => apiInputSet.add(p));
        opDef.outputFields.forEach(f => apiOutputSet.add(f));
      }
      // Also from fieldMappings
      if (step.fieldMappings && step.fieldMappings.length > 0) {
        for (const m of step.fieldMappings) {
          if (m.enabled !== false) apiInputSet.add(m.apiField);
        }
      }
    }
    // If no steps yet, show the suggested mapping API fields
    if (steps.length === 0 && csvColumns.length > 0) {
      for (const col of csvColumns) {
        const colLower = col.toLowerCase().trim();
        const apiField = CSV_API_MAPPING[colLower];
        if (apiField) apiInputSet.add(apiField);
      }
      // Also add required fields for user creation
      apiInputSet.add('password');
      apiInputSet.add('use_username_as_cn');
    }

    if (apiInputSet.size > 0 || apiOutputSet.size > 0) {
      parts.push('### Relevant API Fields');
      if (apiInputSet.size > 0) {
        parts.push(`  Inputs: ${Array.from(apiInputSet).join(', ')}`);
      }
      if (apiOutputSet.size > 0) {
        parts.push(`  Outputs: ${Array.from(apiOutputSet).join(', ')}`);
      }
    }

    // Active Mappings (CSV → API)
    for (const step of steps) {
      const enabled = step.fieldMappings.filter(m => m.enabled !== false);
      if (enabled.length > 0) {
        parts.push(`### Active Mappings (${step.label})`);
        parts.push(enabled.map(m => `  ${m.csvColumn} → ${m.apiField}${m.transform ? ` [${m.transform}]` : ''}`).join('\n'));
      }
    }

    // Auto-suggested CSV→API mapping (even without active mappings)
    if (csvColumns.length > 0 && steps.length === 0) {
      const suggestedMappings: string[] = [];
      for (const col of csvColumns) {
        const colLower = col.toLowerCase().trim();
        const apiField = CSV_API_MAPPING[colLower];
        if (apiField) {
          const needsTransform = apiField === 'initials' ? ' [first_letter_with_dot]' : '';
          suggestedMappings.push(`  ${col} → ${apiField}${needsTransform}`);
        }
      }
      if (suggestedMappings.length > 0) {
        parts.push('### Suggested CSV→API Mapping');
        parts.push(suggestedMappings.join('\n'));
        parts.push('IMPORTANT: Use these mappings as field_mappings in ONE add_api_node action. DO NOT create separate nodes per CSV row. DO NOT ask for clarification. CREATE 1 node with field_mappings immediately.');
        parts.push('NOTE: For "отчество" → "initials", you MUST include "transform": "first_letter_with_dot" in the mapping. Example: {"csvColumn": "отчество", "apiField": "initials", "enabled": true, "transform": "first_letter_with_dot"}. AD rejects full patronymic as initials — only first letter + dot (e.g., "Иванович" → "И.").');
      }
    }

    // Data schema entities — show only what's relevant (compact)
    const schemaToUse = dataSchema?.entities && Object.keys(dataSchema.entities).length > 0
      ? dataSchema.entities
      : buildFallbackDataSchema().entities;
    if (schemaToUse) {
      const entityNames = Object.keys(schemaToUse);
      if (entityNames.length > 0) {
        parts.push('### Data Entities');
        for (const [name, entity] of Object.entries(schemaToUse)) {
          const requiredFields = entity.fields?.filter((f: AIDataSchemaField) => f.required).map((f: AIDataSchemaField) => f.name) || [];
          const fieldCount = entity.fields?.length || 0;
          parts.push(`  ${name}: key=${entity.key_attr ?? '?'}, ${entity.count ?? '?'} records, ${fieldCount} fields (required: ${requiredFields.join(', ') || 'none'})`);
        }
      }
    }

    // ── SDB / DataForge context ────────────────────────────────────────
    // In SDB mode (or whenever DataForge has open sheets), include the real
    // data from DataForge so the AI can produce concrete SDB queries
    // instead of placeholders like {USER_INPUT}.
    const sdbContext = buildSdbContext(safeMode);
    if (sdbContext) {
      parts.push(sdbContext);

      // Add entity-specific SDB query examples based on the active sheet's entity
      const sheets = (() => {
        try {
          const raw = localStorage.getItem('dataforge-state');
          if (!raw) return [];
          const parsed = JSON.parse(raw) as { sheets?: Array<{ entity: string }> };
          return parsed.sheets || [];
        } catch {
          return [];
        }
      })();
      const entitiesInUse = [...new Set(sheets.map(s => s.entity))];
      const examples: string[] = [];
      for (const ent of entitiesInUse) {
        const ex = SDB_ENTITY_EXAMPLES[ent];
        if (ex && ex.length > 0) {
          examples.push(...ex.slice(0, 2));
        }
      }
      if (examples.length > 0) {
        parts.push('\n### Примеры SDB-запросов для открытых сущностей');
        parts.push(examples.map(e => `  ${e}`).join('\n'));
      }
    }

    return parts.length > 0 ? parts.join('\n\n') : '';
  }, [importedData, steps, safeMode, dataSchema, stepOpDefs]);

  // ─── Send message (with SSE streaming) ────────────────────────────
  const handleSend = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || loading || isStreaming) return;

    const chatId = await ensureSession();

    // ── STEP 1: Try local action generator for simple operations ──
    const localActions = generateLocalActions(prompt);
    if (localActions && localActions.length > 0 && chatMode === 'auto') {
      // Apply local actions directly — no AI needed
      const userMsg: AIChatMessage = {
        id: `msg_${Date.now()}_user`,
        role: 'user',
        content: prompt,
        timestamp: new Date().toISOString(),
        mode: chatMode,
        chatId,
      };
      setMessages(prev => [...prev, userMsg]);
      setInput('');

      // В авто-режиме — заменяем весь пайплайн (replace=true),
      // чтобы предыдущие шаги не накапливались
      applyAIActions(localActions, true);

      const aiMsg: AIChatMessage = {
        id: `msg_${Date.now()}_ai`,
        role: 'assistant',
        content: `Создано ${localActions.length} узел пайплайна${importedData.length > 0 ? ` (${importedData.length} из CSV)` : ''}. Выполняю на сервере...`,
        timestamp: new Date().toISOString(),
        actions: localActions,
        mode: 'auto',
        chatId,
      };
      setMessages(prev => [...prev, aiMsg]);

      // ── Авто-выполнение на сервере ──
      try {
        const currentSteps = useETLStore.getState().steps;
        const currentImportedData = useETLStore.getState().importedData;
        const batchActions: { id: string; method: string; params: Record<string, unknown>; timeout: number }[] = [];

        // Определяем тип операции для форматирования
        const isGetOperation = localActions.some(a => {
          const p = a.payload as Record<string, unknown>;
          return (p.method as string)?.toUpperCase() === 'GET';
        });

        for (let stepIdx = 0; stepIdx < currentSteps.length; stepIdx++) {
          const step = currentSteps[stepIdx];
          const enabledMappings = step.fieldMappings.filter(m => m.enabled !== false);

          if (currentImportedData.length > 0 && enabledMappings.length > 0) {
            for (let rowIdx = 0; rowIdx < currentImportedData.length; rowIdx++) {
              const row = currentImportedData[rowIdx];
              const params: Record<string, unknown> = { ...step.params };
              for (const mapping of enabledMappings) {
                let val = row[mapping.csvColumn];
                if (val !== undefined && val !== '') {
                  // Apply transform if specified (e.g., initials → first_letter_with_dot)
                  if (mapping.transform === 'first_letter_with_dot' && typeof val === 'string') {
                    val = val.trim().split(/\s+/).map((p: string) => p.charAt(0).toUpperCase() + '.').join('');
                  } else if (mapping.apiField === 'initials' && typeof val === 'string' && val.length > 3) {
                    val = val.trim().split(/\s+/).map((p: string) => p.charAt(0).toUpperCase() + '.').join('');
                  }
                  params[mapping.apiField] = val;
                }
              }
              batchActions.push({ id: `step${stepIdx + 1}_row${rowIdx + 1}`, method: step.method, params, timeout: 60 });
            }
          } else {
            batchActions.push({ id: `step${stepIdx + 1}`, method: step.method, params: { ...step.params }, timeout: 60 });
          }
        }

        if (batchActions.length > 0) {
          const response = await api.post('/batch/', {
            actions: batchActions,
            stop_on_failure: false,
            rollback_on_failure: false,
            default_timeout: 60,
          });
          const batchResult: BatchResponse = response.data;

          const successCount = batchResult.successful_steps;
          const failCount = batchResult.failed_steps;
          const total = batchResult.total_steps;

          let resultText = '';

          // ── Форматирование для GET-операций (список, показать, поиск) ──
          if (isGetOperation) {
            resultText = `**Результаты (${successCount}/${total}):**\n\n`;

            for (const stepResult of batchResult.steps) {
              if (stepResult.status === 'error') {
                resultText += `❌ **${stepResult.id || `#${stepResult.step}`}** — ${stepResult.error}\n`;
                continue;
              }

              const output = stepResult.output;

              // Массив объектов → таблица
              if (Array.isArray(output)) {
                if (output.length === 0) {
                  resultText += `ℹ️ Записей не найдено.\n`;
                } else {
                  // Определяем колонки для таблицы
                  const sampleItem = output[0];
                  if (typeof sampleItem === 'object' && sampleItem !== null) {
                    const priorityCols = ['username', 'given_name', 'surname', 'mail_address', 'department', 'company',
                      'groupname', 'description', 'computername', 'ip_address', 'operating_system',
                      'ouname', 'dn', 'name', 'record_type', 'data'];
                    const allKeys = Object.keys(sampleItem as Record<string, unknown>);
                    const displayCols = priorityCols.filter(c => allKeys.includes(c));
                    // Добавляем остальные ключи, если не в приоритетных
                    for (const k of allKeys) {
                      if (!displayCols.includes(k) && displayCols.length < 6) displayCols.push(k);
                    }

                    resultText += `| ${displayCols.join(' | ')} |\n`;
                    resultText += `| ${displayCols.map(() => '---').join(' | ')} |\n`;

                    for (const item of output) {
                      if (typeof item === 'object' && item !== null) {
                        const obj = item as Record<string, unknown>;
                        const row = displayCols.map(col => {
                          const val = obj[col];
                          if (val === undefined || val === null) return '';
                          if (Array.isArray(val)) return val.join(', ');
                          return String(val);
                        });
                        resultText += `| ${row.join(' | ')} |\n`;
                      }
                    }
                    resultText += `\n*${output.length} записей*\n`;
                  } else {
                    // Массив простых значений
                    for (const item of output) {
                      resultText += `- ${String(item)}\n`;
                    }
                    resultText += `\n*${output.length} записей*\n`;
                  }
                }
              }
              // Объект → детали
              else if (typeof output === 'object' && output !== null) {
                const obj = output as Record<string, unknown>;
                const labelField = obj.username || obj.groupname || obj.computername || obj.ouname || obj.name || stepResult.id || `#${stepResult.step}`;
                resultText += `**${String(labelField)}:**\n\n`;
                for (const [key, value] of Object.entries(obj)) {
                  if (value === undefined || value === null || value === '') continue;
                  const displayKey = key.replace(/_/g, ' ');
                  if (Array.isArray(value)) {
                    resultText += `- **${displayKey}:** ${value.join(', ')}\n`;
                  } else {
                    resultText += `- **${displayKey}:** ${String(value)}\n`;
                  }
                }
                resultText += '\n';
              }
              // Строка
              else if (output) {
                resultText += `${String(output)}\n`;
              }
            }
          }
          // ── Форматирование для POST/DELETE/PUT операций ──
          else {
            resultText = `**Результаты (${successCount}/${total} успешно):**\n\n`;
            for (const stepResult of batchResult.steps) {
              const icon = stepResult.status === 'success' ? '✅' : '❌';
              const stepId = stepResult.id || `#${stepResult.step}`;

              if (stepResult.status === 'error') {
                resultText += `${icon} **${stepId}** — ${stepResult.error}\n`;
                continue;
              }

              // Краткая сводка из output
              let summary = '';
              if (stepResult.output && typeof stepResult.output === 'object' && stepResult.output !== null) {
                const output = stepResult.output as Record<string, unknown>;
                const summaryFields = ['username', 'given_name', 'surname', 'mail_address', 'dn',
                  'computername', 'groupname', 'ouname'];
                const summaryParts: string[] = [];
                for (const field of summaryFields) {
                  if (output[field]) summaryParts.push(String(output[field]));
                }
                if (summaryParts.length > 0) summary = summaryParts.join(' ');
              }
              resultText += `${icon} **${stepId}**${summary ? ` — ${summary}` : ''}\n`;
            }
          }

          const serverResultMsg: AIChatMessage = {
            id: `msg_${Date.now()}_server`,
            role: 'assistant',
            content: resultText,
            timestamp: new Date().toISOString(),
            mode: 'auto',
            chatId,
          };
          setMessages(prev => [...prev, serverResultMsg]);

          if (failCount === 0) {
            toast.success(`Выполнено: ${successCount}/${total} успешно`);
          } else {
            toast.warning(`Выполнено: ${successCount}/${total} успешно, ${failCount} ошибок`);
          }
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Ошибка выполнения';
        const errorMsg: AIChatMessage = {
          id: `msg_${Date.now()}_error`,
          role: 'assistant',
          content: `❌ Ошибка выполнения: ${errMsg}\n\nНоды добавлены в пайплайн — нажмите "Выполнить" для повторной попытки.`,
          timestamp: new Date().toISOString(),
          mode: 'auto',
          chatId,
        };
        setMessages(prev => [...prev, errorMsg]);
        toast.error('Ошибка выполнения на сервере');
      }

      return;
    }

    // ── STEP 1b: SDB mode — try local SDB script generator first ──────
    // The backend AI has a hardcoded "ETL Constructor" system prompt that
    // doesn't understand SDB script syntax, so it returns {USER_INPUT}
    // placeholders. We bypass the AI entirely for common SDB patterns
    // (show N users, admin users, disabled accounts, etc.) and generate
    // the SDB script locally. Falls through to AI for complex prompts.
    if (chatMode === 'sdb') {
      const sdbActions = generateSdbActions(prompt);
      if (sdbActions && sdbActions.length > 0) {
        const userMsg: AIChatMessage = {
          id: `msg_${Date.now()}_user`,
          role: 'user',
          content: prompt,
          timestamp: new Date().toISOString(),
          mode: 'sdb',
          chatId,
        };
        setMessages(prev => [...prev, userMsg]);
        setInput('');

        // Extract description for the AI message content
        const actionPayload = sdbActions[0].payload as Record<string, unknown>;
        const script = String((actionPayload.params as Record<string, unknown>).script || '');
        const label = String(actionPayload.label || 'SDB Query');

        const aiMsg: AIChatMessage = {
          id: `msg_${Date.now()}_ai`,
          role: 'assistant',
          content: `Выполняю SDB-запрос:\n\n\`\`\`sql\n${script}\n\`\`\``,
          timestamp: new Date().toISOString(),
          actions: sdbActions,
          mode: 'sdb',
          chatId,
        };
        setMessages(prev => [...prev, aiMsg]);

        // Execute the SDB action directly (creates DataForge sheet)
        await processSdbActions(sdbActions);
        return;
      }
    }

    // ── STEP 2: Build augmented prompt with context injected directly ──
    const dataContext = buildDataContext();
    // Constructor mode: inject context + strong instructions for JSON actions format
    // Agent mode: inject context only (AI will use tools directly)
    // SDB mode: inject DataForge context only — the JSON-action instructions live
    //           in DEFAULT_SYSTEM_PROMPT_SDB (effectiveSystemPrompt), so we don't
    //           need to repeat them here. We just provide real data context.
    const isAgentMode = chatMode === 'agent';
    const isSdbMode = chatMode === 'sdb';
    const augmentedPrompt = dataContext
      ? isAgentMode
        ? `${prompt}\n\n[DATA CONTEXT]:\n${dataContext}`
        : isSdbMode
          ? `${prompt}\n\n[DATA CONTEXT]:\n${dataContext}\n\n[INSTRUCTION]: Верни JSON с actions типа add_api_node. Используй /api/v1/sdb/script (POST) с SDB-скриптом в params.script. УКАЖИ label (имя листа). Не пиши свободный текст.`
          : `${prompt}\n\n[CONTEXT]:\n${dataContext}\n\n[INSTRUCTION]: Создай ОДНУ ноду пайплайна с field_mappings для CSV данных. НЕ создавай отдельную ноду для каждой строки CSV. Используй field_mappings для маппинга CSV→API. Для поля initials ОБЯЗАТЕЛЬНО добавляй "transform": "first_letter_with_dot" (полное отчество → первая буква + точка). ВСЕГДА добавляй "use_username_as_cn": true в params. Ответ — ТОЛЬКО JSON с actions.`
      : isSdbMode
        ? `${prompt}\n\n[INSTRUCTION]: Верни JSON с actions типа add_api_node. Используй /api/v1/sdb/script (POST) с SDB-скриптом в params.script. УКАЖИ label (имя листа). Не пиши свободный текст.`
        : prompt;

    const userMsg: AIChatMessage = {
      id: `msg_${Date.now()}_user`,
      role: 'user',
      content: prompt,
      timestamp: new Date().toISOString(),
      mode: chatMode,
      chatId,
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setIsStreaming(true);
    setStreamingContent('');
    setStreamingSteps([]);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      // Try SSE streaming first (skip in offline mode — use legacy endpoints)
      let fullContent = '';
      let stepsArr: Array<{ step: number; tool?: string; success?: boolean }> = [];
      let modelUsed = '';
      let tokensUsed = 0;
      let costRub = 0;

      // In offline mode, skip SSE streaming and go directly to legacy endpoints
      if (isOfflineMode || chatId.startsWith('local_')) {
        // Use legacy /ai/assistant or /ai/agent endpoints (no chat session)
        if (isAgentMode) {
          // Agent mode: AI executes actions directly via tool calling
          const response = await aiAPI.sendAgentPrompt(augmentedPrompt, steps, undefined, maxSteps, effectiveSystemPrompt || undefined, dataContext || undefined);
          if (response.error) throw new Error(response.error);
          const aiMsg: AIChatMessage = {
            id: `msg_${Date.now()}_ai`,
            role: 'assistant',
            content: response.message || t('ai.noResponse'),
            timestamp: new Date().toISOString(),
            agentSteps: response.steps || [],
            totalSteps: response.total_steps,
            model_used: response.model_used,
            tokens_used: response.tokens_used,
            mode: 'agent',
            chatId,
          };
          setMessages(prev => [...prev, aiMsg]);
        } else if (chatMode === 'ai') {
          const response = await aiAPI.sendAgentPrompt(augmentedPrompt, steps, undefined, maxSteps, effectiveSystemPrompt || undefined, dataContext || undefined);
          if (response.error) throw new Error(response.error);
          // Extract pipeline actions from the AI message (handles ```json blocks)
          let parsedActions = ensureActionsIntegrity(extractActionsFromText(response.message || ''));
          let finalContent = response.message || t('ai.noResponse');

          if (parsedActions.length > 0) {
            const rowCount = importedData.length > 0 ? ` (${importedData.length} из CSV)` : '';
            finalContent = `Создано ${parsedActions.length} узел пайплайна${rowCount}. Выполняю на сервере...`;
          }

          // Fallback to local actions if AI returned {USER_INPUT} or no actions parsed
          if (parsedActions.length === 0 && (finalContent.includes('{USER_INPUT}') || finalContent.includes('Уточните'))) {
            const fallbackActions = generateLocalActions(prompt);
            if (fallbackActions && fallbackActions.length > 0) {
              finalContent = `Создано ${fallbackActions.length} нод (автоматическая генерация)`;
              parsedActions = fallbackActions;
            }
          }
          const aiMsg: AIChatMessage = {
            id: `msg_${Date.now()}_ai`,
            role: 'assistant',
            content: finalContent,
            timestamp: new Date().toISOString(),
            actions: parsedActions.length > 0 ? parsedActions : undefined,
            agentSteps: response.steps || [],
            totalSteps: response.total_steps,
            model_used: response.model_used,
            tokens_used: response.tokens_used,
            mode: 'ai',
            chatId,
          };
          setMessages(prev => [...prev, aiMsg]);

          // Apply parsed actions to pipeline + auto-execute on server
          if (parsedActions.length > 0) {
            applyAIActions(parsedActions, true);
            toast.success(t('ai.actionsApplied', { count: parsedActions.length }));
            // Auto-execute on server and show results in chat
            try {
              await executeBatchAndShowResults(chatId);
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : 'Ошибка выполнения';
              const errorMsg: AIChatMessage = {
                id: `msg_${Date.now()}_error`,
                role: 'assistant',
                content: `❌ Ошибка выполнения: ${errMsg}`,
                timestamp: new Date().toISOString(),
                mode: 'ai',
                chatId,
              };
              setMessages(prev => [...prev, errorMsg]);
            }
          } else if (response.steps && response.steps.length > 0) {
            const successCount = response.steps.filter(s => s.success).length;
            const failCount = response.steps.length - successCount;
            const summaryMsg: AIChatMessage = {
              id: `msg_${Date.now()}_result`,
              role: 'system',
              content: t('ai.agentTotalSteps', { count: response.total_steps }) +
                (failCount > 0 ? ` (${failCount} ${t('ai.agentFailed').toLowerCase()})` : ''),
              timestamp: new Date().toISOString(),
              mode: 'ai',
              chatId,
            };
            setMessages(prev => [...prev, summaryMsg]);
            toast.success(t('ai.agentTotalSteps', { count: response.total_steps }));
          }
        } else if (isSdbMode) {
          // SDB mode: sendPrompt with safeMode + SDB system prompt.
          // SDB mode: use the new /ai/sdb endpoint (backend has dedicated
          // SDB system prompt that knows SDB script syntax). Falls back to
          // sendPrompt if /ai/sdb is not available (older backend).
          let response: AIResponse;
          try {
            response = await aiAPI.aiSdbRequest(augmentedPrompt, safeMode, effectiveSystemPrompt || undefined, dataContext || undefined);
          } catch (sdbErr: unknown) {
            // Fallback to /ai/assistant if /ai/sdb endpoint not available (404)
            const errMsg = sdbErr instanceof Error ? sdbErr.message : String(sdbErr);
            if (errMsg.includes('404') || errMsg.includes('not found') || errMsg.includes('Not Found')) {
              response = await aiAPI.sendPrompt(augmentedPrompt, steps, safeMode, undefined, effectiveSystemPrompt || undefined, dataContext || undefined);
            } else {
              throw sdbErr;
            }
          }
          if (response.error) throw new Error(response.error);

          // Collect SDB-relevant actions from response (both formats):
          //  - Our preferred: {type: 'sdb_query', payload: {...}}
          //  - Backend AI format: {type: 'add_api_node', payload: {path: '/api/v1/sdb/...'}}
          //  - Info actions: {type: 'info', payload: {message: '...'}}
          const rawActions = response.actions && response.actions.length > 0
            ? response.actions
            : extractActionsFromText(response.message || '');
          // Fix {USER_INPUT} placeholders in SDB scripts (backend AI doesn't know SDB syntax)
          const fixedActions = fixSdbActionPlaceholders(rawActions, prompt);
          const sdbActions = fixedActions.filter(a =>
            a.type === 'sdb_query' ||
            a.type === 'info' ||
            isSdbApiNode(a)
          );

          let finalContent = response.message || '';
          if (sdbActions.length === 0) {
            // AI didn't return SDB actions — show the raw message as fallback
            finalContent = finalContent || t('ai.noResponse');
          }

          const aiMsg: AIChatMessage = {
            id: `msg_${Date.now()}_ai`,
            role: 'assistant',
            content: finalContent,
            timestamp: new Date().toISOString(),
            actions: sdbActions.length > 0 ? sdbActions : undefined,
            model_used: response.model_used,
            tokens_used: response.tokens_used,
            mode: 'sdb',
            chatId,
          };
          setMessages(prev => [...prev, aiMsg]);

          // Execute all SDB-relevant actions (creates DataForge sheets)
          await processSdbActions(sdbActions);
        } else {
          const response = await aiAPI.sendPrompt(augmentedPrompt, steps, safeMode, undefined, effectiveSystemPrompt || undefined, dataContext || undefined);
          if (response.error) throw new Error(response.error);
          // Also try extracting actions from message text (handles ```json blocks)
          let finalActions = response.actions && response.actions.length > 0
            ? ensureActionsIntegrity(response.actions)
            : ensureActionsIntegrity(extractActionsFromText(response.message || ''));
          let finalContent = response.message || t('ai.noResponse');
          if (finalActions.length > 0) {
            const rowCount = importedData.length > 0 ? ` (${importedData.length} из CSV)` : '';
            finalContent = `Создано ${finalActions.length} узел пайплайна${rowCount}. Выполняю на сервере...`;
          }
          if (finalContent.includes('{USER_INPUT}') || finalContent.includes('Уточните') || finalContent.includes('уточните')) {
            const fallbackActions = generateLocalActions(prompt);
            if (fallbackActions && fallbackActions.length > 0) {
              finalContent = `Создано ${fallbackActions.length} нод (автоматическая генерация вместо уточнения)`;
              finalActions = fallbackActions;
            }
          }
          const aiMsg: AIChatMessage = {
            id: `msg_${Date.now()}_ai`,
            role: 'assistant',
            content: finalContent,
            timestamp: new Date().toISOString(),
            actions: finalActions.length > 0 ? finalActions : undefined,
            model_used: response.model_used,
            tokens_used: response.tokens_used,
            mode: 'ai',
            chatId,
          };
          setMessages(prev => [...prev, aiMsg]);
          if (finalActions && finalActions.length > 0) {
            applyAIActions(finalActions, true);
            toast.success(t('ai.actionsApplied', { count: finalActions.length }));
            // Auto-execute on server and show results in chat
            try {
              await executeBatchAndShowResults(chatId);
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : 'Ошибка выполнения';
              const errorMsg: AIChatMessage = {
                id: `msg_${Date.now()}_error`,
                role: 'assistant',
                content: `❌ Ошибка выполнения: ${errMsg}`,
                timestamp: new Date().toISOString(),
                mode: 'ai',
                chatId,
              };
              setMessages(prev => [...prev, errorMsg]);
            }
          }
        }
      } else {
      try {
        for await (const event of aiAPI.streamChatMessage(chatId, augmentedPrompt, isAgentMode, isAgentMode ? maxSteps : undefined, effectiveSystemPrompt || undefined, dataContext || undefined)) {
          if (abortController.signal.aborted) break;

          switch (event.type) {
            case 'start':
              modelUsed = event.model || modelUsed;
              break;
            case 'step_start':
              stepsArr = [...stepsArr, { step: event.step || stepsArr.length + 1, tool: event.tool }];
              setStreamingSteps([...stepsArr]);
              break;
            case 'step_result':
              stepsArr = stepsArr.map(s =>
                s.step === event.step ? { ...s, success: event.success } : s
              );
              setStreamingSteps([...stepsArr]);
              break;
            case 'content':
              if (event.content) {
                fullContent += event.content;
                setStreamingContent(fullContent);
              }
              break;
            case 'done':
              tokensUsed = event.tokens || tokensUsed;
              costRub = event.cost_rub || costRub;
              break;
            case 'fallback':
              // Fallback means streaming is not supported, will be handled below
              break;
            case 'error': {
              const errMsg = typeof event.error === 'object' && event.error?.message
                ? event.error.message
                : typeof event.error === 'string'
                  ? event.error
                  : t('ai.error');
              throw new Error(errMsg);
            }
          }
        }

        // Streaming complete — add final AI message
        // In agent mode: display text response directly (AI already executed via tools)
        // In constructor mode: parse JSON actions from response
        const aiMsg: AIChatMessage = {
          id: `msg_${Date.now()}_ai`,
          role: 'assistant',
          content: fullContent || t('ai.noResponse'),
          timestamp: new Date().toISOString(),
          mode: chatMode,
          model_used: modelUsed || undefined,
          tokens_used: tokensUsed || undefined,
          cost_rub: costRub || undefined,
          chatId,
          ...(isAgentMode && stepsArr.length > 0 ? {
            agentSteps: stepsArr.map(s => ({
              step: s.step,
              tool_name: s.tool || 'unknown',
              tool_args: {},
              result_preview: s.success ? 'OK' : 'Failed',
              success: s.success ?? true,
            })),
            totalSteps: stepsArr.length,
          } : {}),
        };

        // In constructor mode (not agent, not sdb): parse JSON actions for pipeline nodes.
        // In SDB mode: parse sdb_query actions and execute them (creates DataForge sheets).
        if (!isAgentMode && !isSdbMode) {
          const parsedActions = ensureActionsIntegrity(extractActionsFromText(fullContent));
          if (parsedActions.length > 0) {
            const rowCount = importedData.length > 0 ? ` (${importedData.length} из CSV)` : '';
            aiMsg.content = `Создано ${parsedActions.length} узел пайплайна${rowCount}. Выполняю на сервере...`;
            aiMsg.actions = parsedActions;
          }
        } else if (isSdbMode) {
          // SDB mode: extract SDB-relevant actions from streamed content
          // Accept both `sdb_query` (our format) and `add_api_node` with SDB paths (backend AI's format)
          const streamedActions = extractActionsFromText(fullContent);
          // Fix {USER_INPUT} placeholders in SDB scripts (backend AI doesn't know SDB syntax)
          const fixedStreamedActions = fixSdbActionPlaceholders(streamedActions, prompt);
          const sdbActions = fixedStreamedActions.filter(a =>
            a.type === 'sdb_query' ||
            a.type === 'info' ||
            isSdbApiNode(a)
          );
          if (sdbActions.length > 0) {
            aiMsg.actions = sdbActions;
            // Keep original content (might have description + JSON block)
          }
        }

        setMessages(prev => [...prev, aiMsg]);

        // Apply parsed actions to pipeline + auto-execute on server (constructor mode only)
        if (!isAgentMode && !isSdbMode && aiMsg.actions && aiMsg.actions.length > 0) {
          applyAIActions(aiMsg.actions, true);
          toast.success(t('ai.actionsApplied', { count: aiMsg.actions.length }));
          // Auto-execute on server and show results in chat
          try {
            await executeBatchAndShowResults(chatId);
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : 'Ошибка выполнения';
            const errorMsg: AIChatMessage = {
              id: `msg_${Date.now()}_error`,
              role: 'assistant',
              content: `❌ Ошибка выполнения: ${errMsg}`,
              timestamp: new Date().toISOString(),
              mode: chatMode,
              chatId,
            };
            setMessages(prev => [...prev, errorMsg]);
          }
        }

        // SDB mode: execute all SDB-relevant actions (creates DataForge sheets)
        if (isSdbMode && aiMsg.actions && aiMsg.actions.length > 0) {
          await processSdbActions(aiMsg.actions);
        }
      } catch (streamErr: unknown) {
        // If streaming fails (not supported, network error), fall back to regular API call
        const errMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);

        // If it's a 404 or "Not Found", the streaming endpoint may not exist — try non-streaming
        if (errMsg.includes('404') || errMsg.includes('not found') || errMsg.includes('Not Found')) {
          // Fall back to regular sendChatMessage or legacy endpoints
          if (isAgentMode) {
            // Agent mode: AI executes actions directly via tool calling
            const response = await aiAPI.sendAgentPrompt(augmentedPrompt, steps, undefined, maxSteps, effectiveSystemPrompt || undefined, dataContext || undefined);
            if (response.error) {
              throw new Error(response.error);
            }
            const aiMsg: AIChatMessage = {
              id: `msg_${Date.now()}_ai`,
              role: 'assistant',
              content: response.message || t('ai.noResponse'),
              timestamp: new Date().toISOString(),
              agentSteps: response.steps || [],
              totalSteps: response.total_steps,
              model_used: response.model_used,
              tokens_used: response.tokens_used,
              mode: 'agent',
              chatId,
            };
            setMessages(prev => [...prev, aiMsg]);
          } else if (chatMode === 'ai') {
            const response = await aiAPI.sendAgentPrompt(augmentedPrompt, steps, undefined, maxSteps, effectiveSystemPrompt || undefined, dataContext || undefined);
            if (response.error) {
              throw new Error(response.error);
            }
            // Extract pipeline actions from AI message (handles ```json blocks)
            let fallbackParsed = ensureActionsIntegrity(extractActionsFromText(response.message || ''));
            let fallbackContent = response.message || t('ai.noResponse');

            if (fallbackParsed.length > 0) {
              const rc = importedData.length > 0 ? ` (${importedData.length} из CSV)` : '';
              fallbackContent = `Создано ${fallbackParsed.length} узел пайплайна${rc}. Выполняю на сервере...`;
            }

            if (fallbackParsed.length === 0 && (fallbackContent.includes('{USER_INPUT}') || fallbackContent.includes('Уточните'))) {
              const fallbackActions = generateLocalActions(prompt);
              if (fallbackActions && fallbackActions.length > 0) {
                fallbackContent = `Создано ${fallbackActions.length} нод (автоматическая генерация)`;
                fallbackParsed = fallbackActions;
              }
            }
            const aiMsg: AIChatMessage = {
              id: `msg_${Date.now()}_ai`,
              role: 'assistant',
              content: fallbackContent,
              timestamp: new Date().toISOString(),
              actions: fallbackParsed.length > 0 ? fallbackParsed : undefined,
              agentSteps: response.steps || [],
              totalSteps: response.total_steps,
              model_used: response.model_used,
              tokens_used: response.tokens_used,
              mode: 'ai',
              chatId,
            };
            setMessages(prev => [...prev, aiMsg]);

            // Apply parsed actions to pipeline + auto-execute on server
            if (fallbackParsed.length > 0) {
              applyAIActions(fallbackParsed, true);
              toast.success(t('ai.actionsApplied', { count: fallbackParsed.length }));
              // Auto-execute on server and show results in chat
              try {
                await executeBatchAndShowResults(chatId);
              } catch (err: unknown) {
                const errMsg = err instanceof Error ? err.message : 'Ошибка выполнения';
                const errorMsg: AIChatMessage = {
                  id: `msg_${Date.now()}_error`,
                  role: 'assistant',
                  content: `❌ Ошибка выполнения: ${errMsg}`,
                  timestamp: new Date().toISOString(),
                  mode: 'ai',
                  chatId,
                };
                setMessages(prev => [...prev, errorMsg]);
              }
            } else if (response.steps && response.steps.length > 0) {
              const successCount = response.steps.filter(s => s.success).length;
              const failCount = response.steps.length - successCount;
              const summaryMsg: AIChatMessage = {
                id: `msg_${Date.now()}_result`,
                role: 'system',
                content: t('ai.agentTotalSteps', { count: response.total_steps }) +
                  (failCount > 0 ? ` (${failCount} ${t('ai.agentFailed').toLowerCase()})` : ''),
                timestamp: new Date().toISOString(),
                mode: 'ai',
                chatId,
              };
              setMessages(prev => [...prev, summaryMsg]);
              toast.success(t('ai.agentTotalSteps', { count: response.total_steps }));
            }
          } else if (isSdbMode) {
            // SDB mode fallback (after streaming failed): use /ai/sdb if available, fallback to /ai/assistant
            let response: AIResponse;
            try {
              response = await aiAPI.aiSdbRequest(augmentedPrompt, safeMode, effectiveSystemPrompt || undefined, dataContext || undefined);
            } catch (sdbErr: unknown) {
              const errMsg = sdbErr instanceof Error ? sdbErr.message : String(sdbErr);
              if (errMsg.includes('404') || errMsg.includes('not found') || errMsg.includes('Not Found')) {
                response = await aiAPI.sendPrompt(augmentedPrompt, steps, safeMode, undefined, effectiveSystemPrompt || undefined, dataContext || undefined);
              } else {
                throw sdbErr;
              }
            }
            if (response.error) {
              throw new Error(response.error);
            }

            // Accept both sdb_query (our format) and add_api_node with SDB paths (backend AI format)
            const rawActions = response.actions && response.actions.length > 0
              ? response.actions
              : extractActionsFromText(response.message || '');
            // Fix {USER_INPUT} placeholders in SDB scripts (backend AI doesn't know SDB syntax)
            const fixedActions = fixSdbActionPlaceholders(rawActions, prompt);
            const sdbActions = fixedActions.filter(a =>
              a.type === 'sdb_query' ||
              a.type === 'info' ||
              isSdbApiNode(a)
            );

            let sdbContent = response.message || '';
            if (sdbActions.length === 0) {
              sdbContent = sdbContent || t('ai.noResponse');
            }

            const aiMsg: AIChatMessage = {
              id: `msg_${Date.now()}_ai`,
              role: 'assistant',
              content: sdbContent,
              timestamp: new Date().toISOString(),
              actions: sdbActions.length > 0 ? sdbActions : undefined,
              model_used: response.model_used,
              tokens_used: response.tokens_used,
              mode: 'sdb',
              chatId,
            };
            setMessages(prev => [...prev, aiMsg]);

            // Execute all SDB-relevant actions
            await processSdbActions(sdbActions);
          } else {
            const response = await aiAPI.sendPrompt(augmentedPrompt, steps, safeMode, undefined, effectiveSystemPrompt || undefined, dataContext || undefined);
            if (response.error) {
              throw new Error(response.error);
            }
            // Post-process: try extracting actions from message text too
            let fbActions = response.actions && response.actions.length > 0
              ? ensureActionsIntegrity(response.actions)
              : ensureActionsIntegrity(extractActionsFromText(response.message || ''));
            let fbContent = response.message || t('ai.noResponse');
            if (fbActions.length > 0) {
              const rc = importedData.length > 0 ? ` (${importedData.length} из CSV)` : '';
              fbContent = `Создано ${fbActions.length} узел пайплайна${rc}. Выполняю на сервере...`;
            }
            if (fbContent.includes('{USER_INPUT}') || fbContent.includes('Уточните') || fbContent.includes('уточните')) {
              const fallbackActions = generateLocalActions(prompt);
              if (fallbackActions && fallbackActions.length > 0) {
                fbContent = `Создано ${fallbackActions.length} нод (автоматическая генерация вместо уточнения)`;
                fbActions = fallbackActions;
              }
            }
            const aiMsg: AIChatMessage = {
              id: `msg_${Date.now()}_ai`,
              role: 'assistant',
              content: fbContent,
              timestamp: new Date().toISOString(),
              actions: fbActions.length > 0 ? fbActions : undefined,
              model_used: response.model_used,
              tokens_used: response.tokens_used,
              mode: 'ai',
              chatId,
            };
            setMessages(prev => [...prev, aiMsg]);

            if (fbActions && fbActions.length > 0) {
              applyAIActions(fbActions, true);
              toast.success(t('ai.actionsApplied', { count: fbActions.length }));

              // Auto-execute on server and show results in chat
              try {
                await executeBatchAndShowResults(chatId);
              } catch (err: unknown) {
                const errMsg = err instanceof Error ? err.message : 'Ошибка выполнения';
                const errorMsg: AIChatMessage = {
                  id: `msg_${Date.now()}_error`,
                  role: 'assistant',
                  content: `❌ Ошибка выполнения: ${errMsg}`,
                  timestamp: new Date().toISOString(),
                  mode: 'ai',
                  chatId,
                };
                setMessages(prev => [...prev, errorMsg]);
              }
            }
          }
        } else if (errMsg.includes('timeout') || errMsg.includes('Timeout') || errMsg.includes('ECONNREFUSED') || errMsg.includes('Network Error')) {
          // Network/timeout error — switch to offline mode and retry with legacy endpoints
          setIsOfflineMode(true);
          throw new Error('Backend unavailable. Switched to offline mode — will use legacy endpoints on next request.');
        } else {
          throw streamErr;
        }
      }
      } // end else (non-offline mode)
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } }; message?: string };
      const errMsg = error?.response?.data?.detail || error?.message || 'Network error';

      const sysMsg: AIChatMessage = {
        id: `msg_${Date.now()}_sys`,
        role: 'system',
        content: `${t('ai.error')}: ${errMsg}`,
        timestamp: new Date().toISOString(),
        error: errMsg,
        mode: chatMode,
        chatId,
      };
      setMessages(prev => [...prev, sysMsg]);
      toast.error(errMsg);
    } finally {
      setLoading(false);
      setIsStreaming(false);
      setStreamingContent('');
      setStreamingSteps([]);
      abortControllerRef.current = null;
      inputRef.current?.focus();
    }
  }, [input, loading, isStreaming, steps, importedData, safeMode, chatMode, maxSteps, effectiveSystemPrompt, applyAIActions, t, ensureSession, buildDataContext, generateLocalActions, generateSdbActions, fixSdbActionPlaceholders, executeSdbQuery, executeAddApiNodeAsSdb, isSdbApiNode, processSdbActions]);

  // ─── Quick prompts ─────────────────────────────────────────────────────
  const quickPrompts = [
    { label: t('ai.quick.users'), prompt: 'показать всех пользователей' },
    { label: t('ai.quick.groups'), prompt: 'показать все группы' },
    { label: t('ai.quick.computers'), prompt: 'показать все компьютеры' },
    { label: t('ai.quick.createUser'), prompt: 'создать нового пользователя' },
    { label: t('ai.quick.dns'), prompt: 'показать DNS зоны' },
    { label: t('ai.quick.domain'), prompt: 'показать информацию о домене' },
    ...(importedData.length > 0 ? [
      { label: t('ai.quick.importCsv') || 'Импорт CSV', prompt: `создать ${importedData.length} пользователей из CSV данных` },
    ] : []),
  ];

  // ─── Clear chat ────────────────────────────────────────────────────────
  const handleClearChat = useCallback(() => {
    setMessages([]);
  }, []);

  // ─── Toggle fullscreen ──────────────────────────────────────────────
  const handleToggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      setIsFullscreen(false);
      setPanelSize({ w: 420, h: 600 });
    } else {
      setIsFullscreen(true);
      setPanelSize({
        w: window.innerWidth * MAX_WIDTH_RATIO,
        h: window.innerHeight * MAX_HEIGHT_RATIO,
      });
      // Center the panel
      setPanelPos({
        x: (window.innerWidth - window.innerWidth * MAX_WIDTH_RATIO) / 2,
        y: (window.innerHeight - window.innerHeight * MAX_HEIGHT_RATIO) / 2,
      });
    }
  }, [isFullscreen]);

  // ─── Render agent steps ──────────────────────────────────────────────
  const renderAgentSteps = (agentSteps: AIAgentStep[]) => {
    const successCount = agentSteps.filter(s => s.success).length;
    const failCount = agentSteps.length - successCount;

    return (
      <div className="mt-2 space-y-1">
        <div className="flex items-center gap-1.5">
          <ListChecks className="w-3 h-3 text-blue-400" />
          <span className="text-[10px] text-muted-foreground font-medium">
            {t('ai.agentTotalSteps', { count: agentSteps.length })}
          </span>
          {successCount > 0 && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
              {successCount} OK
            </Badge>
          )}
          {failCount > 0 && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 border-red-500/30 text-red-400 bg-red-500/10">
              {failCount} fail
            </Badge>
          )}
        </div>
        <div className="space-y-0.5 max-h-64 overflow-y-auto">
          {agentSteps.map((step, idx) => (
            <AgentStepCard key={`${step.step}_${step.tool_name}_${idx}`} step={step} t={t} />
          ))}
        </div>
      </div>
    );
  };

  // ─── Render single message ─────────────────────────────────────────────
  const renderMessage = (msg: AIChatMessage) => {
    const isUser = msg.role === 'user';
    const isSystem = msg.role === 'system';
    const isResult = isSystem && ((msg.actions && msg.actions.length > 0) || (msg.agentSteps && msg.agentSteps.length > 0));
    const isAgent = msg.mode === 'ai';
    const isAutoMode = msg.mode === 'auto';
    const isSdbMode = msg.mode === 'sdb';
    const isAgentExecMode = msg.mode === 'agent';
    const isAssistant = msg.role === 'assistant';

    return (
      <div
        key={msg.id}
        className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}
      >
        {!isUser && (
          <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
            isResult
              ? 'bg-emerald-500/20 text-emerald-400'
              : isSystem && msg.error
                ? 'bg-red-500/20 text-red-400'
                : isAgent
                  ? 'bg-purple-500/20 text-purple-400'
                  : isSdbMode
                    ? 'bg-blue-500/20 text-blue-400'
                    : isAgentExecMode
                      ? 'bg-orange-500/20 text-orange-400'
                      : isAutoMode
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-blue-500/20 text-blue-400'
          }`}>
            {isResult ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : isSystem && msg.error ? (
              <AlertCircle className="w-3.5 h-3.5" />
            ) : isAgent ? (
              <Cpu className="w-3.5 h-3.5" />
            ) : isSdbMode ? (
              <Database className="w-3.5 h-3.5" />
            ) : isAgentExecMode ? (
              <Terminal className="w-3.5 h-3.5" />
            ) : isAutoMode ? (
              <Zap className="w-3.5 h-3.5" />
            ) : (
              <Bot className="w-3.5 h-3.5" />
            )}
          </div>
        )}

        <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : isResult
              ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
              : isSystem && msg.error
                ? 'bg-red-500/10 text-red-300 border border-red-500/20'
                : 'bg-muted'
        }`}>
          {/* Mode badge for assistant messages.
              Only two modes exist in the UI now: Конструктор (ai) and Агент (agent).
              Historical messages with mode='auto' or 'sdb' are mapped to
              'Конструктор' for display, since those modes were removed. */}
          {isAssistant && msg.mode && (
            <div className="mb-1">
              <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${
                msg.mode === 'agent'
                  ? 'border-orange-500/30 text-orange-400 bg-orange-500/10'
                  : 'border-purple-500/30 text-purple-400 bg-purple-500/10'
              }`}>
                {msg.mode === 'agent' ? 'Агент' : 'Конструктор'}
              </Badge>
            </div>
          )}

          {/* Message content */}
          {isAssistant ? (
            <div className="prose prose-xs dark:prose-invert max-w-none text-xs leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words">{msg.content}</p>
          )}

          {/* Agent steps */}
          {msg.agentSteps && msg.agentSteps.length > 0 && renderAgentSteps(msg.agentSteps)}

          {/* Assistant actions */}
          {msg.actions && msg.actions.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-[10px] text-muted-foreground font-medium">
                {t('ai.actions')}
              </p>
              <div className="flex flex-wrap gap-1">
                {msg.actions.map((action, idx) => (
                  <ActionBadge key={idx} action={action} t={t} />
                ))}
              </div>
            </div>
          )}

          {/* SDB mode: action buttons — "Open in DataForge" for each detected entity */}
          {isSdbMode && isAssistant && msg.content && (() => {
            // Detect entity references in the SDB query (FROM USERS, FROM GROUPS, etc.)
            const SDB_ENTITY_MAP: Record<string, string> = {
              USERS: 'user', GROUPS: 'group', COMPUTERS: 'computer',
              OUS: 'ou', GPOS: 'gpo', CONTACTS: 'contact', DNS_RECORDS: 'dnsNode',
            };
            const entities: string[] = [];
            for (const [table, entity] of Object.entries(SDB_ENTITY_MAP)) {
              const re = new RegExp(`\\bFROM\\s+${table}\\b`, 'i');
              if (re.test(msg.content) && !entities.includes(entity)) {
                entities.push(entity);
              }
            }
            if (entities.length === 0) return null;
            const ENTITY_LABELS: Record<string, string> = {
              user: 'Пользователи', group: 'Группы', computer: 'Компьютеры',
              ou: 'Подразделения', gpo: 'GPO', contact: 'Контакты', dnsNode: 'DNS записи',
            };
            return (
              <div className="mt-2 space-y-1">
                <p className="text-[10px] text-muted-foreground font-medium">
                  {t('ai.sdbOpenInDataforge', 'Открыть данные в DataForge:')}
                </p>
                <div className="flex flex-wrap gap-1">
                  {entities.map(entity => (
                    <button
                      key={entity}
                      onClick={() => {
                        // Try to navigate to DataForge page first (via global event the app shell can listen to)
                        window.dispatchEvent(new CustomEvent('navigate-to-page', { detail: { page: 'dataforge' } }));
                        // Then dispatch the load-entity event which DataForge listens for
                        setTimeout(() => {
                          window.dispatchEvent(new CustomEvent('dataforge-load-entity', { detail: { entity } }));
                        }, 300);
                        toast.info(t('ai.sdbOpeningDataforge', { entity: ENTITY_LABELS[entity] || entity, defaultValue: `Открываю «${ENTITY_LABELS[entity] || entity}» в DataForge...` }));
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20 transition-colors"
                      title={t('ai.sdbOpenHint', 'Открыть лист с этой сущностью в DataForge')}
                    >
                      <Database className="w-3 h-3" />
                      {ENTITY_LABELS[entity] || entity}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Metadata */}
          {isAssistant && (msg.model_used || msg.tokens_used) && (
            <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground/60">
              {msg.model_used && <span>{msg.model_used}</span>}
              {msg.tokens_used !== undefined && msg.tokens_used > 0 && (
                <span>{msg.tokens_used} {t('ai.tokens')}</span>
              )}
              {msg.cost_rub !== undefined && msg.cost_rub > 0 && (
                <span>{msg.cost_rub.toFixed(2)} ₽</span>
              )}
              {msg.totalSteps !== undefined && msg.totalSteps > 0 && (
                <span>{msg.totalSteps} steps</span>
              )}
            </div>
          )}
        </div>

        {isUser && (
          <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0 mt-0.5">
            <User className="w-3.5 h-3.5" />
          </div>
        )}
      </div>
    );
  };

  // ─── Computed panel styles ──────────────────────────────────────────
  const panelStyle = useMemo(() => {
    if (isFullscreen) {
      return {
        left: panelPos?.x ?? (window.innerWidth - window.innerWidth * MAX_WIDTH_RATIO) / 2,
        top: panelPos?.y ?? (window.innerHeight - window.innerHeight * MAX_HEIGHT_RATIO) / 2,
        width: panelSize.w,
        height: panelSize.h,
      };
    }
    if (panelPos) {
      return {
        left: panelPos.x,
        top: panelPos.y,
        width: panelSize.w,
        height: isMinimized ? 48 : panelSize.h,
      };
    }
    return {
      bottom: 24,
      right: 24,
      width: panelSize.w,
      height: isMinimized ? 48 : panelSize.h,
    };
  }, [panelPos, panelSize, isMinimized, isFullscreen]);

  return (
    <>
      {/* ─── Floating toggle button (when panel is closed) ──────────────── */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/25 flex items-center justify-center text-white transition-colors"
          >
            <Sparkles className="w-5 h-5" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* ─── AI Chat Panel ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            style={panelStyle}
            className={`fixed z-50 flex flex-col bg-background border border-border shadow-2xl shadow-black/40 rounded-xl overflow-hidden ${
              isDragging ? 'cursor-grabbing select-none' : ''
            } ${isResizing ? 'select-none' : ''}`}
          >
            {/* ─── Resize handles ──────────────────────────────────────── */}
            {/* Right edge */}
            <div
              onMouseDown={handleResizeMouseDown('e')}
              className="absolute top-0 right-0 w-1.5 h-full cursor-e-resize hover:bg-blue-500/20 transition-colors z-10"
            />
            {/* Bottom edge */}
            <div
              onMouseDown={handleResizeMouseDown('s')}
              className="absolute bottom-0 left-0 w-full h-1.5 cursor-s-resize hover:bg-blue-500/20 transition-colors z-10"
            />
            {/* Bottom-right corner */}
            <div
              onMouseDown={handleResizeMouseDown('se')}
              className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize hover:bg-blue-500/30 transition-colors z-10 rounded-tl"
            >
              <svg className="w-3 h-3 absolute bottom-0.5 right-0.5 text-muted-foreground/30" viewBox="0 0 6 6">
                <path d="M5 0v5H0" fill="none" stroke="currentColor" strokeWidth="1" />
              </svg>
            </div>

            {/* ─── Header bar (draggable) ────────────────────────────────── */}
            <div
              className={`h-11 px-3 border-b bg-muted/30 flex items-center justify-between shrink-0 ${
                isDragging ? 'cursor-grabbing' : 'cursor-grab'
              }`}
              onMouseDown={handleDragMouseDown}
            >
              <div className="flex items-center gap-2 min-w-0">
                <GripHorizontal className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                  <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                </div>
                <span className="font-semibold text-sm truncate">{t('ai.title')}</span>
                {currentSession && (
                  <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                    — {currentSession.title}
                  </span>
                )}
                {aiConfig?.enabled ? (
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-emerald-500/30 text-emerald-400 bg-emerald-500/10 shrink-0">
                    {t('ai.on')}
                  </Badge>
                ) : aiConfig && !aiConfig.enabled ? (
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-gray-500/30 text-gray-400 shrink-0">
                    {t('ai.off')}
                  </Badge>
                ) : null}
                {isOfflineMode && (
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-amber-500/30 text-amber-400 bg-amber-500/10 shrink-0">
                    offline
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                {/* New Chat button */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => { e.stopPropagation(); handleNewChat(); }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {t('ai.newChat')}
                  </TooltipContent>
                </Tooltip>

                {/* Session list toggle */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => { e.stopPropagation(); setShowSessionList(!showSessionList); }}
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {t('ai.chatSessions')}
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => { e.stopPropagation(); setShowConfig(!showConfig); }}
                    >
                      <Settings2 className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {t('ai.config')}
                  </TooltipContent>
                </Tooltip>

                {/* Data Sources toggle (v1.9-3-6) */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`h-7 w-7 ${showDataSources ? 'text-amber-400 bg-amber-500/10' : ''}`}
                      onClick={(e) => { e.stopPropagation(); setShowDataSources(!showDataSources); }}
                    >
                      <Database className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {t('ai.dataSources')}
                  </TooltipContent>
                </Tooltip>

                {/* Fullscreen toggle */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(e) => { e.stopPropagation(); handleToggleFullscreen(); }}
                >
                  {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized); }}
                >
                  {isMinimized ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </Button>

                {panelPos && !isFullscreen && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={(e) => { e.stopPropagation(); setPanelPos(null); }}
                    title={t('ai.resetPosition') || 'Reset position'}
                  >
                    <Eye className="w-3 h-3" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(e) => { e.stopPropagation(); setIsOpen(false); setPanelPos(null); setIsFullscreen(false); }}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* ─── Session list dropdown ─────────────────────────────── */}
            {!isMinimized && showSessionList && (
              <div className="border-b bg-background/50 max-h-48 overflow-y-auto shrink-0">
                <div className="p-2 space-y-0.5">
                  {sessions.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground text-center py-2">
                      {t('ai.noSessions')}
                    </p>
                  ) : (
                    sessions.map(session => (
                      <div
                        key={session.id}
                        onClick={() => handleSwitchSession(session.id)}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs transition-colors ${
                          session.id === currentSessionId
                            ? 'bg-primary/10 text-primary border border-primary/20'
                            : 'hover:bg-muted text-foreground'
                        }`}
                      >
                        <MessageSquare className="w-3 h-3 shrink-0 text-muted-foreground" />
                        <span className="truncate flex-1">{session.title}</span>
                        {session.message_count !== undefined && (
                          <span className="text-[9px] text-muted-foreground shrink-0">{session.message_count}</span>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 hover:opacity-100 hover:text-red-400"
                          onClick={(e) => handleDeleteSession(session.id, e)}
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </Button>
                      </div>
                    ))
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full h-7 text-[10px] justify-start gap-1.5"
                    onClick={handleNewChat}
                  >
                    <Plus className="w-3 h-3" />
                    {t('ai.createSession')}
                  </Button>
                </div>
              </div>
            )}

            {/* ─── Config panel (collapsible) ─────────────────────────── */}
            {!isMinimized && showConfig && aiConfig && (
              <div className="px-3 py-2 border-b bg-background/50 text-[10px] font-mono space-y-0.5 shrink-0">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('ai.model')}:</span>
                  <span>{aiConfig.default_model}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('ai.endpoints')}:</span>
                  <span>{aiConfig.schema_endpoints}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('ai.maxTokens')}:</span>
                  <span>{aiConfig.max_tokens}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('ai.temperature')}:</span>
                  <span>{aiConfig.temperature}</span>
                </div>
                {/* System Prompt (v1.9-3-6) — per-mode, disabled for Agent */}
                <Separator className="my-1.5" />
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Code2 className="w-3 h-3" />
                      <span>{t('ai.systemPrompt')}:</span>
                      {/* Mode badge showing which mode's prompt is being edited */}
                      <Badge variant="outline" className={`text-[9px] px-1 py-0 ml-1 ${
                        chatMode === 'agent' ? 'border-orange-500/30 text-orange-400 bg-orange-500/10'
                          : 'border-purple-500/30 text-purple-400 bg-purple-500/10'
                      }`}>
                        {chatMode === 'agent' ? 'Агент' : 'Конструктор'}
                      </Badge>
                    </div>
                    {/* Reset to default button (only for non-agent modes) */}
                    {chatMode !== 'agent' && systemPrompt.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSystemPrompt('')}
                        className="text-[10px] text-muted-foreground hover:text-red-400 transition-colors"
                        title={t('ai.systemPromptReset', 'Сбросить к умолчанию')}
                      >
                        ↺ {t('ai.systemPromptReset', 'Сбросить')}
                      </button>
                    )}
                  </div>
                  {chatMode === 'agent' ? (
                    // Agent mode: locked to default, show read-only info
                    <div className="text-[10px] text-muted-foreground/70 italic bg-muted/30 rounded px-2 py-1.5 border border-dashed border-border/50">
                      {t('ai.systemPromptAgentLocked', 'В режиме Агента используется системный промпт по умолчанию. Кастомизация недоступна — для безопасности агент не меняет своё поведение через пользовательский промпт.')}
                    </div>
                  ) : (
                    <>
                      <Textarea
                        value={systemPrompt}
                        onChange={(e) => setSystemPrompt(e.target.value.slice(0, 8000))}
                        placeholder={t('ai.systemPromptPlaceholder')}
                        className="h-16 text-[10px] bg-background/50 resize-none font-mono"
                      />
                      <div className="flex justify-between text-muted-foreground/50">
                        <span>{t('ai.systemPromptHint')}</span>
                        <span>{systemPrompt.length}/8000</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ─── Data Sources panel (v1.9-3-6) ────────────────────────── */}
            {!isMinimized && showDataSources && (
              <div className="px-3 py-2 border-b bg-background/50 shrink-0 max-h-80 overflow-y-auto">
                <div className="space-y-2">
                  {/* CSV Columns — 10 rows preview with Safe Mode masking */}
                  <Collapsible defaultOpen={importedData.length > 0}>
                    <CollapsibleTrigger className="flex items-center gap-1.5 w-full text-left hover:bg-muted/50 rounded px-1 py-0.5 transition-colors">
                      <FileSpreadsheet className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span className="text-[10px] font-medium text-foreground">{t('ai.csvColumns')}</span>
                      {importedData.length > 0 && (
                        <Badge variant="outline" className="text-[8px] px-1 py-0 border-emerald-500/30 text-emerald-400 bg-emerald-500/10 shrink-0">
                          {Object.keys(importedData[0] || {}).length}
                        </Badge>
                      )}
                      {importedData.length > 0 && (
                        <span className="text-[8px] text-muted-foreground/50 ml-0.5">{importedData.length} rows</span>
                      )}
                      <ChevronDown className="w-3 h-3 text-muted-foreground ml-auto shrink-0" />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      {importedData.length > 0 ? (
                        <div className="mt-1 pl-3">
                          {/* Column headers */}
                          <div className="overflow-x-auto max-h-48">
                            <table className="text-[9px] font-mono w-full border-collapse">
                              <thead>
                                <tr className="border-b border-border/30">
                                  <th className="text-left text-muted-foreground/50 pr-1.5 py-0.5 w-6">#</th>
                                  {Object.keys(importedData[0]).map(col => (
                                    <th key={col} className="text-left text-emerald-400 pr-2 py-0.5 whitespace-nowrap max-w-[100px] truncate">
                                      {col}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {importedData.slice(0, 10).map((row, rowIdx) => (
                                  <tr key={rowIdx} className="border-b border-border/10 hover:bg-muted/20">
                                    <td className="text-muted-foreground/30 pr-1.5 py-0.5">{rowIdx + 1}</td>
                                    {Object.keys(importedData[0]).map(col => (
                                      <td key={col} className="pr-2 py-0.5 whitespace-nowrap max-w-[100px] truncate">
                                        {safeMode ? (
                                          <span className="text-muted-foreground/30 italic">{'***'}</span>
                                        ) : (
                                          <span className="text-muted-foreground/60 truncate max-w-[90px] inline-block">{String(row[col] || '')}</span>
                                        )}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <p className="text-[9px] text-muted-foreground/50 pt-0.5">
                            {importedData.length > 10 ? `Showing 10 of ${importedData.length} rows. ` : `${importedData.length} rows. `}
                            {safeMode ? `(Safe Mode: values hidden)` : `(Sample data visible)`}
                          </p>
                        </div>
                      ) : (
                        <p className="text-[10px] text-muted-foreground/50 pl-5 mt-1">{t('ai.noCsvData')}</p>
                      )}
                    </CollapsibleContent>
                  </Collapsible>

                  {/* API Fields — visual with Inputs / Outputs from operation definitions + suggested from data schema */}
                  <Collapsible defaultOpen={steps.length > 0 || importedData.length > 0 || !!(dataSchema?.entities && Object.keys(dataSchema.entities).length > 0)}>
                    <CollapsibleTrigger className="flex items-center gap-1.5 w-full text-left hover:bg-muted/50 rounded px-1 py-0.5 transition-colors">
                      <Code2 className="w-3 h-3 text-blue-400 shrink-0" />
                      <span className="text-[10px] font-medium text-foreground">{t('ai.apiFields')}</span>
                      {(() => {
                        const inputSet = new Set<string>();
                        const outputSet = new Set<string>();
                        // From pipeline steps
                        steps.forEach(s => {
                          const op = API_OPERATIONS.find(o => o.method === s.method);
                          if (op) {
                            op.params.forEach(p => inputSet.add(p.name));
                            (op.outputFields || []).forEach(f => outputSet.add(f.name));
                          }
                          s.fieldMappings.forEach(m => inputSet.add(m.apiField));
                        });
                        // From data schema (suggested)
                        const schemaToUseForBadge = dataSchema?.entities && Object.keys(dataSchema.entities).length > 0
                          ? dataSchema.entities
                          : buildFallbackDataSchema().entities;
                        if (steps.length === 0 && schemaToUseForBadge) {
                          for (const entity of Object.values(schemaToUseForBadge)) {
                            (entity.fields || []).forEach(f => inputSet.add(f.name));
                          }
                        }
                        // From CSV→API mapping suggestions
                        if (steps.length === 0 && importedData.length > 0) {
                          const csvCols = Object.keys(importedData[0]);
                          csvCols.forEach(col => {
                            const mapped = CSV_API_MAPPING[col.toLowerCase().trim()];
                            if (mapped) inputSet.add(mapped);
                          });
                        }
                        const total = inputSet.size + outputSet.size;
                        return total > 0 ? (
                          <Badge variant="outline" className="text-[8px] px-1 py-0 border-blue-500/30 text-blue-400 bg-blue-500/10 shrink-0">
                            {total}
                          </Badge>
                        ) : null;
                      })()}
                      <ChevronDown className="w-3 h-3 text-muted-foreground ml-auto shrink-0" />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      {(() => {
                        // Build per-step input/output fields from API_OPERATIONS definitions
                        const stepsWithOps = steps.map(step => {
                          const op = API_OPERATIONS.find(o => o.method === step.method);
                          const inputParams = op?.params || [];
                          const outputFields = op?.outputFields || [];
                          const mappingFields = step.fieldMappings.map(m => m.apiField);
                          return { step, op, inputParams, outputFields, mappingFields };
                        }).filter(s => s.op);

                        // When no pipeline steps, show suggested fields from data schema
                        const schemaEntities = dataSchema?.entities && Object.keys(dataSchema.entities).length > 0
                          ? dataSchema.entities
                          : buildFallbackDataSchema().entities;
                        const csvCols = importedData.length > 0 ? Object.keys(importedData[0]) : [];

                        return stepsWithOps.length > 0 ? (
                          <div className="mt-1 space-y-2 pl-5">
                            {stepsWithOps.map(({ step: s, op, inputParams, outputFields, mappingFields }) => (
                              <div key={s.id} className="space-y-1">
                                <span className="text-[9px] text-muted-foreground font-semibold">{op!.label}</span>
                                {/* Inputs */}
                                {inputParams.length > 0 && (
                                  <div className="space-y-0.5">
                                    <div className="flex items-center gap-1 text-[9px] text-blue-400/70">
                                      <LogIn className="w-2.5 h-2.5" />
                                      <span>{t('ai.inputFields')}</span>
                                      <Badge variant="outline" className="text-[7px] px-0.5 py-0 border-blue-500/20 text-blue-400/60 shrink-0">{inputParams.length}</Badge>
                                    </div>
                                    <div className="flex flex-wrap gap-0.5 pl-4">
                                      {inputParams.map(p => {
                                        const isFilled = s.params[p.name] !== undefined && s.params[p.name] !== '';
                                        const isMapped = mappingFields.includes(p.name);
                                        return (
                                          <span key={p.name} className={`text-[8px] px-1 rounded font-mono ${
                                            isMapped ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20' :
                                            isFilled ? 'bg-blue-500/15 text-blue-400 border border-blue-500/20' :
                                            p.required ? 'bg-red-500/10 text-red-400/70 border border-red-500/20' :
                                            'bg-muted/30 text-muted-foreground/50'
                                          }`}>
                                            {p.name}{p.required ? '*' : ''}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                                {/* Outputs */}
                                {outputFields.length > 0 && (
                                  <div className="space-y-0.5">
                                    <div className="flex items-center gap-1 text-[9px] text-emerald-400/70">
                                      <LogOut className="w-2.5 h-2.5" />
                                      <span>{t('ai.outputFields')}</span>
                                      <Badge variant="outline" className="text-[7px] px-0.5 py-0 border-emerald-500/20 text-emerald-400/60 shrink-0">{outputFields.length}</Badge>
                                    </div>
                                    <div className="flex flex-wrap gap-0.5 pl-4">
                                      {outputFields.map(f => (
                                        <span key={f.name} className="text-[8px] bg-emerald-500/10 text-emerald-400/60 px-1 rounded font-mono border border-emerald-500/15">
                                          {f.name}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : schemaEntities && Object.keys(schemaEntities).length > 0 ? (
                          // Show suggested API fields from data schema when no pipeline steps
                          <div className="mt-1 space-y-1.5 pl-5">
                            {Object.entries(schemaEntities).map(([entityName, entity]) => (
                              <div key={entityName} className="space-y-0.5">
                                <div className="flex items-center gap-1 text-[9px] text-blue-400/70">
                                  <LogIn className="w-2.5 h-2.5" />
                                  <span className="font-semibold">{entityName}</span>
                                  <span className="text-muted-foreground/40">API params</span>
                                </div>
                                <div className="flex flex-wrap gap-0.5 pl-4">
                                  {(entity.fields || []).slice(0, 15).map(f => (
                                    <span key={f.name} className={`text-[8px] px-1 rounded font-mono ${
                                      f.required ? 'bg-blue-500/10 text-blue-400/70 border border-blue-500/20' : 'bg-muted/30 text-muted-foreground/50'
                                    }`}>
                                      {f.name}{f.required ? '*' : ''}
                                    </span>
                                  ))}
                                  {(entity.fields || []).length > 15 && (
                                    <span className="text-[8px] text-muted-foreground/30">+{(entity.fields || []).length - 15}</span>
                                  )}
                                </div>
                              </div>
                            ))}
                            <p className="text-[8px] text-muted-foreground/30 italic">Поля будут привязаны к нодам при создании</p>
                          </div>
                        ) : (
                          <p className="text-[10px] text-muted-foreground/50 pl-5 mt-1">{t('ai.noApiFields')}</p>
                        );
                      })()}
                    </CollapsibleContent>
                  </Collapsible>

                  {/* Active Mappings — show suggested CSV→API mappings when no pipeline steps */}
                  <Collapsible defaultOpen={steps.some(s => s.fieldMappings.filter(m => m.enabled !== false).length > 0) || importedData.length > 0}>
                    <CollapsibleTrigger className="flex items-center gap-1.5 w-full text-left hover:bg-muted/50 rounded px-1 py-0.5 transition-colors">
                      <ArrowRightLeft className="w-3 h-3 text-amber-400 shrink-0" />
                      <span className="text-[10px] font-medium text-foreground">{t('ai.activeMappings')}</span>
                      {(() => {
                        const activeCount = steps.reduce((acc, s) => acc + s.fieldMappings.filter(m => m.enabled !== false).length, 0);
                        // Also count suggested mappings from CSV
                        let suggestedCount = 0;
                        if (activeCount === 0 && importedData.length > 0) {
                          const csvCols = Object.keys(importedData[0]);
                          csvCols.forEach(col => {
                            if (CSV_API_MAPPING[col.toLowerCase().trim()]) suggestedCount++;
                          });
                        }
                        const total = activeCount + suggestedCount;
                        return total > 0 ? (
                          <Badge variant="outline" className="text-[8px] px-1 py-0 border-amber-500/30 text-amber-400 bg-amber-500/10 shrink-0">
                            {total}
                          </Badge>
                        ) : null;
                      })()}
                      <ChevronDown className="w-3 h-3 text-muted-foreground ml-auto shrink-0" />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      {(() => {
                        const stepsWithMappings = steps.filter(s => s.fieldMappings.filter(m => m.enabled !== false).length > 0);
                        // When no active mappings, show suggested CSV→API mappings
                        const csvCols = importedData.length > 0 ? Object.keys(importedData[0]) : [];

                        return stepsWithMappings.length > 0 ? (
                          <div className="mt-1 space-y-1 pl-5">
                            {stepsWithMappings.map(step => (
                              <div key={step.id} className="space-y-0.5">
                                <span className="text-[9px] text-muted-foreground font-medium">{step.label}</span>
                                {step.fieldMappings.filter(m => m.enabled !== false).map((m, idx) => (
                                  <div key={idx} className="flex items-center gap-1 text-[10px] pl-2">
                                    <span className="text-emerald-400 font-mono">{m.csvColumn}</span>
                                    <ArrowRightLeft className="w-2.5 h-2.5 text-amber-400/60" />
                                    <span className="text-blue-400 font-mono">{m.apiField}</span>
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        ) : csvCols.length > 0 ? (
                          // Show suggested CSV→API mappings
                          <div className="mt-1 space-y-1 pl-5">
                            <div className="flex items-center gap-1 text-[9px] text-amber-400/70">
                              <span className="font-semibold">CSV → API</span>
                              <span className="text-muted-foreground/40 italic">(автомаппинг)</span>
                            </div>
                            {csvCols.map(col => {
                              const apiField = CSV_API_MAPPING[col.toLowerCase().trim()];
                              return apiField ? (
                                <div key={col} className="flex items-center gap-1 text-[10px] pl-2">
                                  <span className="text-emerald-400 font-mono">{col}</span>
                                  <ArrowRightLeft className="w-2.5 h-2.5 text-amber-400/60" />
                                  <span className="text-blue-400 font-mono">{apiField}</span>
                                </div>
                              ) : (
                                <div key={col} className="flex items-center gap-1 text-[10px] pl-2">
                                  <span className="text-muted-foreground/40 font-mono">{col}</span>
                                  <span className="text-muted-foreground/20">→ ?</span>
                                  <span className="text-muted-foreground/20 italic text-[8px]">не маппится</span>
                                </div>
                              );
                            })}
                            <p className="text-[8px] text-muted-foreground/30 italic">Маппинги применятся автоматически при создании нод</p>
                          </div>
                        ) : (
                          <p className="text-[10px] text-muted-foreground/50 pl-5 mt-1">{t('ai.noMappings')}</p>
                        );
                      })()}
                    </CollapsibleContent>
                  </Collapsible>

                  {/* Data Entities — always visible, uses fallback when backend unavailable */}
                  <Collapsible defaultOpen={true}>
                    <CollapsibleTrigger className="flex items-center gap-1.5 w-full text-left hover:bg-muted/50 rounded px-1 py-0.5 transition-colors">
                      <Database className="w-3 h-3 text-purple-400 shrink-0" />
                      <span className="text-[10px] font-medium text-foreground">{t('ai.dataEntities')}</span>
                      {(() => {
                        const entityCount = dataSchema?.entities ? Object.keys(dataSchema.entities).length : 0;
                        return entityCount > 0 ? (
                          <Badge variant="outline" className="text-[8px] px-1 py-0 border-purple-500/30 text-purple-400 bg-purple-500/10 shrink-0">
                            {entityCount}
                          </Badge>
                        ) : null;
                      })()}
                      {isOfflineMode && (
                        <Badge variant="outline" className="text-[7px] px-1 py-0 border-amber-500/30 text-amber-400 bg-amber-500/10 shrink-0">
                          local
                        </Badge>
                      )}
                      <ChevronDown className="w-3 h-3 text-muted-foreground ml-auto shrink-0" />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      {(() => {
                        const entities = dataSchema?.entities;
                        if (!entities || Object.keys(entities).length === 0) {
                          return <p className="text-[10px] text-muted-foreground/50 pl-5 mt-1">{t('ai.noDataEntities') || 'Нет сущностей'}</p>;
                        }
                        return (
                          <div className="mt-1 space-y-0.5 pl-5">
                            {Object.entries(entities).map(([name, entity]) => (
                              <div key={name} className="text-[10px]">
                                <span className="text-purple-400 font-mono font-medium">{name}</span>
                                <span className="text-muted-foreground/60"> ({entity.count ?? '?'} recs, key: {entity.key_attr ?? '?'})</span>
                                {entity.fields && entity.fields.length > 0 && (
                                  <div className="flex flex-wrap gap-0.5 pl-2 mt-0.5">
                                    {entity.fields.slice(0, 12).map(f => (
                                      <span key={f.name} className={`text-[8px] px-1 rounded font-mono ${
                                        f.required ? 'bg-purple-500/15 text-purple-300 border border-purple-500/20' : 'bg-muted/30 text-muted-foreground/50'
                                      }`}>
                                        {f.name}{f.required ? '*' : ''}
                                      </span>
                                    ))}
                                    {entity.fields.length > 12 && (
                                      <span className="text-[8px] text-muted-foreground/30">+{entity.fields.length - 12}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              </div>
            )}

            {/* ─── Mode toggle + Safe Mode bar ────────────────────────── */}
            {!isMinimized && (
              <div className="px-3 py-1.5 border-b shrink-0 flex items-center justify-between bg-background/30 gap-2">
                {/* Mode toggle: Чат / Конструктор / Агент.
                    "Чат" navigates to the full Chat page (separate from AI).
                    "Конструктор" and "Агент" are AI modes within this panel. */}
                <div className="flex items-center gap-1 bg-muted/50 rounded-md p-0.5">
                  <button
                    onClick={() => {
                      // Navigate to the Chat page
                      window.dispatchEvent(new CustomEvent('navigate-to-page', { detail: { page: 'chat' } }));
                      setIsOpen(false);
                    }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
                    title="Открыть чат"
                  >
                    <MessageCircle className="w-3 h-3" />
                    Чат
                  </button>
                  <button
                    onClick={() => setChatMode('ai')}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                      chatMode === 'ai'
                        ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Cpu className="w-3 h-3" />
                    Конструктор
                  </button>
                  <button
                    onClick={() => setChatMode('agent')}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                      chatMode === 'agent'
                        ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Terminal className="w-3 h-3" />
                    Агент
                  </button>
                </div>

                {/* Safe mode toggle (in AI/Constructor mode — masks data) */}
                {chatMode === 'ai' && (
                  <div className="flex items-center gap-1.5">
                    {safeMode ? (
                      <ShieldCheck className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <ShieldOff className="w-3 h-3 text-amber-400" />
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {t('ai.safeMode')}
                    </span>
                    <Switch
                      checked={safeMode}
                      onCheckedChange={setSafeMode}
                      disabled={loading}
                      className="scale-75"
                    />
                  </div>
                )}

                {/* Max steps (in AI or Agent mode) */}
                {(chatMode === 'ai' || chatMode === 'agent') && (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">{t('ai.maxSteps')}:</span>
                    <input
                      type="number"
                      value={maxSteps}
                      onChange={(e) => setMaxSteps(Math.max(1, parseInt(e.target.value) || 50))}
                      className="w-12 h-5 text-[10px] bg-background/50 border border-border/50 rounded px-1 text-center"
                      min={1}
                      max={200}
                    />
                  </div>
                )}
              </div>
            )}

            {/* ─── Messages area ──────────────────────────────────────── */}
            {!isMinimized && (
              <ScrollArea className="flex-1 min-h-0">
                <div className="px-3 py-2 space-y-3">
                  {/* SDB mode: development banner */}
                  {chatMode === 'sdb' && (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 space-y-1.5">
                      <div className="flex items-start gap-2">
                        <Wrench className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 space-y-1">
                          <p className="text-[11px] font-semibold text-amber-400">
                            {t('ai.sdbDevTitle', { defaultValue: '⚠️ Режим SDB — в разработке' })}
                          </p>
                          <p className="text-[10px] text-amber-300/80 leading-relaxed">
                            {t('ai.sdbDevDesc', { defaultValue: 'Режим SDB находится в активной разработке и может работать нестабильно. В настоящее время поддерживаются базовые запросы: показать N пользователей/групп/компьютеров, admin пользователи, отключённые учётки. Сложные запросы (агрегации, множественные условия, JOIN) могут не работать корректно. Для полной функциональности требуется обновление backend AI-сервера.' })}
                          </p>
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              ✓ {t('ai.sdbDevWorks', { defaultValue: 'Работает: показать N, admin, отключённые' })}
                            </span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                              ✗ {t('ai.sdbDevNotWorks', { defaultValue: 'Не работает: сложные фильтры, агрегации' })}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Welcome message */}
                  {messages.length === 0 && !isStreaming && (
                    <div className="text-center py-6 space-y-4">
                      <div className="w-12 h-12 rounded-full bg-blue-500/15 flex items-center justify-center mx-auto">
                        <Bot className="w-6 h-6 text-blue-400" />
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed px-2">
                        {t('ai.welcome')}
                      </p>
                      <div className="flex items-center justify-center flex-wrap gap-2 text-[10px] text-muted-foreground/60">
                        <span className={chatMode === 'ai' ? 'text-purple-400 font-medium' : ''}>
                          Конструктор: AI пайплайн
                        </span>
                        <span>|</span>
                        <span className={chatMode === 'agent' ? 'text-orange-400 font-medium' : ''}>
                          Агент: прямое выполнение
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Messages */}
                  {messages.map(renderMessage)}

                  {/* Streaming content (live) */}
                  {isStreaming && streamingContent && (
                    <div className="flex gap-2 justify-start">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                        chatMode === 'agent'
                          ? 'bg-orange-500/20 text-orange-400'
                          : 'bg-purple-500/20 text-purple-400'
                      }`}>
                        {chatMode === 'agent'
                          ? <Terminal className="w-3.5 h-3.5" />
                          : <Cpu className="w-3.5 h-3.5" />}
                      </div>
                      <div className="max-w-[85%] bg-muted rounded-lg px-3 py-2">
                        <Badge variant="outline" className={`text-[9px] px-1.5 py-0 mb-1 ${
                          chatMode === 'agent'
                            ? 'border-orange-500/30 text-orange-400 bg-orange-500/10'
                            : 'border-purple-500/30 text-purple-400 bg-purple-500/10'
                        }`}>
                          {chatMode === 'agent' ? 'Агент' : 'Конструктор'}
                        </Badge>
                        <div className="prose prose-xs dark:prose-invert max-w-none text-xs leading-relaxed">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingContent}</ReactMarkdown>
                        </div>
                        {streamingSteps.length > 0 && (
                          <div className="mt-2 space-y-0.5">
                            {streamingSteps.map((s, idx) => (
                              <StreamingStepCard key={idx} step={s.step} tool={s.tool} success={s.success} t={t} />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Loading indicator (when not streaming content yet) */}
                  {(loading || isStreaming) && !streamingContent && (
                    <div className="flex gap-2 justify-start">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                        chatMode === 'agent'
                          ? 'bg-orange-500/20'
                          : 'bg-purple-500/20'
                      }`}>
                        {chatMode === 'agent' ? (
                          <Terminal className="w-3.5 h-3.5 text-orange-400" />
                        ) : (
                          <Cpu className="w-3.5 h-3.5 text-purple-400" />
                        )}
                      </div>
                      <div className="bg-muted rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          {isStreaming ? t('ai.streaming') : t('ai.thinking')}
                          {(chatMode === 'ai' || chatMode === 'agent') && maxSteps > 0 && (
                            <span className="text-[10px] text-muted-foreground/50">
                              (до {maxSteps} {t('ai.maxSteps').toLowerCase()})
                            </span>
                          )}
                        </div>
                        {/* Live step progress */}
                        {streamingSteps.length > 0 && (
                          <div className="mt-2 space-y-0.5">
                            <p className="text-[10px] text-muted-foreground font-medium">
                              {t('ai.stepProgress', { current: streamingSteps.length, total: maxSteps })}
                            </p>
                            {streamingSteps.map((s, idx) => (
                              <StreamingStepIndicator key={idx} step={s.step} tool={s.tool} success={s.success} t={t} />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>
            )}

            {/* ─── Bottom panel: pipeline status + quick actions + input ── */}
            {!isMinimized && (
              <div className="border-t shrink-0 bg-background">
                {/* Pipeline status */}
                {steps.length > 0 && (
                  <div className="px-3 py-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Zap className="w-3 h-3 text-amber-400" />
                    <span>{steps.length} {t('ai.pipeline')}</span>
                  </div>
                )}

                {/* Quick action buttons (show when no messages or few) */}
                {messages.length <= 2 && !isStreaming && (
                  <div className="px-3 py-1.5 flex flex-wrap gap-1">
                    {quickPrompts.map((qp, idx) => (
                      <Button
                        key={idx}
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px] px-2"
                        onClick={() => {
                          setInput(qp.prompt);
                          inputRef.current?.focus();
                        }}
                      >
                        {qp.label}
                      </Button>
                    ))}
                  </div>
                )}

                {/* Message count + clear */}
                {messages.length > 0 && (
                  <div className="px-3 pt-1 flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">
                      {messages.length} {t('ai.messages')}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 text-[10px] px-1.5 text-muted-foreground hover:text-red-400"
                      onClick={handleClearChat}
                    >
                      <Trash2 className="w-3 h-3 mr-1" />
                      {t('ai.clearChat')}
                    </Button>
                  </div>
                )}

                {/* Input field + slash command menu */}
                <div className="px-3 py-2 flex gap-1.5 relative">
                  {showCommandMenu && filteredCommands.length > 0 && (
                    <div
                      ref={commandMenuRef}
                      className="absolute bottom-full left-3 right-12 mb-1 bg-popover border border-border rounded-md shadow-lg max-h-52 overflow-y-auto z-50"
                    >
                      <div className="px-2 py-1 text-[10px] text-muted-foreground border-b border-border/50 font-medium">
                        Команды — Tab/↑↓ для выбора, Enter для применения
                      </div>
                      {filteredCommands.map((c, idx) => (
                        <button
                          key={c.cmd}
                          className={`w-full px-2 py-1.5 flex items-center gap-2 text-xs text-left transition-colors ${
                            idx === selectedCommandIdx
                              ? 'bg-accent text-accent-foreground'
                              : 'hover:bg-accent/50'
                          }`}
                          onClick={() => {
                            setInput(c.cmd + ' ');
                            setShowCommandMenu(false);
                            inputRef.current?.focus();
                          }}
                          onMouseEnter={() => setSelectedCommandIdx(idx)}
                        >
                          <span className="text-sm shrink-0">{c.icon}</span>
                          <div className="flex-1 min-w-0">
                            <span className="font-mono font-medium text-foreground">{c.cmd}</span>
                            <span className="text-muted-foreground ml-1.5">{c.desc}</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground/60 shrink-0">{c.entity}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <Input
                    ref={inputRef}
                    placeholder={t('ai.placeholder')}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      // ── Slash command navigation ──
                      if (showCommandMenu && filteredCommands.length > 0) {
                        if (e.key === 'Tab' || e.key === 'ArrowDown') {
                          e.preventDefault();
                          setSelectedCommandIdx(prev =>
                            prev < filteredCommands.length - 1 ? prev + 1 : 0
                          );
                          return;
                        }
                        if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setSelectedCommandIdx(prev =>
                            prev > 0 ? prev - 1 : filteredCommands.length - 1
                          );
                          return;
                        }
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          const selected = filteredCommands[selectedCommandIdx];
                          if (selected) {
                            setInput(selected.cmd + ' ');
                            setShowCommandMenu(false);
                            inputRef.current?.focus();
                            return;
                          }
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setShowCommandMenu(false);
                          return;
                        }
                      }

                      // Normal Enter to send
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    disabled={loading && !isStreaming}
                    className="h-8 text-xs flex-1"
                  />
                  <Button
                    size="icon"
                    className={`h-8 w-8 shrink-0 ${
                      chatMode === 'agent'
                        ? 'bg-orange-600 hover:bg-orange-700'
                        : chatMode === 'ai'
                        ? 'bg-purple-600 hover:bg-purple-700'
                        : 'bg-primary hover:bg-primary/90'
                    }`}
                    onClick={handleSend}
                    disabled={(loading && !isStreaming) || !input.trim()}
                  >
                    {loading || isStreaming ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Streaming Step Card (in-progress) ──────────────────────────────────
function StreamingStepCard({
  step, tool, success, t,
}: {
  step: number;
  tool?: string;
  success?: boolean;
  t: (key: string) => string;
}) {
  return (
    <div className={`rounded border text-[10px] ${
      success === true
        ? 'border-emerald-500/20 bg-emerald-500/5'
        : success === false
          ? 'border-red-500/20 bg-red-500/5'
          : 'border-purple-500/20 bg-purple-500/5'
    }`}>
      <div className="px-2 py-1 flex items-center gap-1.5">
        {success === true ? (
          <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
        ) : success === false ? (
          <XCircle className="w-3 h-3 text-red-400 shrink-0" />
        ) : (
          <Loader2 className="w-3 h-3 text-purple-400 shrink-0 animate-spin" />
        )}
        <span className="font-semibold text-muted-foreground">#{step}</span>
        {tool && <span className="font-mono text-foreground truncate">{tool}</span>}
        {success === undefined && (
          <span className="text-[9px] text-muted-foreground/50 ml-auto">{t('ai.streaming')}</span>
        )}
      </div>
    </div>
  );
}
