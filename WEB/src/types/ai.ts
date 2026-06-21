// ─── AI Assistant Types ───────────────────────────────────────────────────
// Типы для работы с AI-ассистентом бэкенда (/api/v1/ai/*)

/** Пайлоуд действия добавления API-ноды на канвас */
export interface AIAddAPINodePayload {
  node_id: string;
  method: string;
  path: string;
  operationId: string;
  label: string;
  params: Record<string, unknown>;
  /** CSV→API field mappings for bulk operations (1 node + mappings instead of N nodes) */
  field_mappings?: Array<{
    csvColumn: string;
    apiField: string;
    enabled?: boolean;
    transform?: 'first_letter_with_dot' | 'uppercase' | 'lowercase' | 'trim';
  }>;
}

/** Пайлоуд действия соединения двух нод */
export interface AIConnectNodesPayload {
  from_node_id: string;
  to_node_id: string;
  label?: string;
}

/** Пайлоуд действия установки параметра ноды */
export interface AISetParamPayload {
  node_id: string;
  param_name: string;
  param_value: unknown;
}

/** Действие, возвращаемое AI-ассистентом */
export interface AIAction {
  type: 'add_api_node' | 'connect_nodes' | 'set_param' | 'remove_node' | 'info' | 'sdb_query';
  payload: AIAddAPINodePayload | AIConnectNodesPayload | AISetParamPayload | AISDBQueryPayload | Record<string, unknown>;
}

/** SDB-запрос (режим SDB): AI предлагает выполнить скрипт/запрос и создать лист в DataForge */
export interface AISDBQueryPayload {
  /** Имя листа в DataForge (например: "Admin пользователи") */
  sheet_name?: string;
  /** Сущность (singular): user, group, computer, ou, gpo, contact, dnsNode */
  entity: string;
  /** SDB-скрипт для выполнения через /api/v1/sdb/script (опционально) */
  script?: string;
  /** SQL-like scope для /api/v1/sdb/select (опционально, напр. "USERS") */
  scope?: string;
  /** WHERE-фильтр для SDB (опционально, напр. "adminCount = 1") */
  where?: string;
  /** Лимит строк */
  limit?: number;
  /** Человекочитаемое описание запроса */
  description?: string;
}

/** Запрос к AI-ассистенту (режим конструктора) */
export interface AIRequest {
  prompt: string;
  context: Record<string, unknown>;
  safe_mode: boolean;
  model_override?: string;
}

/** Ответ AI-ассистента (режим конструктора) */
export interface AIResponse {
  status: 'success' | 'error' | 'partial';
  message: string | null;
  actions: AIAction[] | null;
  model_used: string;
  tokens_used: number;
  error: string | null;
  retries: number | null;
}

// ─── AI Agent Types (новый /ai/agent endpoint) ───────────────────────────

/** Один шаг выполнения AI-агента */
export interface AIAgentStep {
  step: number;
  tool_name: string;
  tool_args: {
    method?: string;
    path?: string;
    body_params?: Record<string, unknown>;
    query_params?: Record<string, unknown>;
    [key: string]: unknown;
  };
  result_preview: string;
  success: boolean;
}

/** Запрос к AI-агенту (режим выполнения) */
export interface AIAgentRequest {
  prompt: string;
  context: Record<string, unknown>;
  model_override?: string;
  max_steps?: number;
  /** Custom system prompt (v1.9-3-6) — max 8000 chars */
  system?: string;
  /** Contextual data for AI (v1.9-3-6) — max 32000 chars, sent as [DATA CONTEXT] prefix */
  data?: string;
}

/** Ответ AI-агента (режим выполнения) */
export interface AIAgentResponse {
  status: 'success' | 'error' | 'partial';
  message: string | null;
  steps: AIAgentStep[] | null;
  total_steps: number;
  model_used: string;
  tokens_used: number;
  error: string | null;
}

// ─── Общие типы ─────────────────────────────────────────────────────────

/** Конфигурация AI на бэкенде */
export interface AIConfig {
  enabled: boolean;
  default_model: string;
  safe_mode_default: boolean;
  temperature: number;
  max_tokens: number;
  schema_loaded: boolean;
  schema_endpoints: number;
  rate_limit_retries: number;
  rate_limit_max_wait: number;
  fallback_models: string[];
  max_schema_chars: number;
}

/** Схема эндпоинта API (из /ai/schema) */
export interface AISchemaEndpoint {
  method: string;
  path: string;
  operation_id: string;
  summary: string;
  parameters: unknown[];
}

/** Полная схема API */
export interface AISchema {
  total_endpoints: number;
  schema_version: string;
  endpoints: AISchemaEndpoint[];
}

/** Режим чата AI:
 *  - auto = локальные шаблоны + конструктор пайплайна
 *  - ai = конструктор (JSON actions, добавляет ноды в пайплайн)
 *  - agent = агент (прямое выполнение через tool calling)
 *  - sdb = SDB-режим (генерация запросов к базе SDB с маскированием данных)
 */
export type AIChatMode = 'auto' | 'ai' | 'agent' | 'sdb';

/** Сообщение в истории чата AI */
export interface AIChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  actions?: AIAction[];
  agentSteps?: AIAgentStep[];
  totalSteps?: number;
  model_used?: string;
  tokens_used?: number;
  cost_rub?: number;
  error?: string | null;
  mode?: AIChatMode;
  /** Session chat ID this message belongs to */
  chatId?: string;
}

// ─── AI Chat Session Types ────────────────────────────────────────────────

/** Chat session returned by /ai/chat/list */
export interface AIChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
  is_archived?: boolean;
}

/** List of chat sessions */
export interface AIChatSessionList {
  chats: AIChatSession[];
  total: number;
}

/** SSE event from /ai/chat/{chat_id}/stream */
export interface AIStreamEvent {
  type: 'start' | 'step_start' | 'step_result' | 'content' | 'done' | 'fallback' | 'error';
  model?: string;
  step?: number;
  tool?: string;
  args?: Record<string, unknown>;
  success?: boolean;
  result_preview?: string;
  content?: string;
  tokens?: number;
  cost_rub?: number;
  reason?: string;
  error?: string | { message: string };
}

// ─── AI Data Schema Types (v1.9-3-6) ──────────────────────────────────────

/** Field in an entity from /ai/data-schema */
export interface AIDataSchemaField {
  name: string;
  type: string;
  label?: string;
  required?: boolean;
  description?: string;
}

/** Entity from /ai/data-schema */
export interface AIDataSchemaEntity {
  count?: number;
  key_attr?: string;
  fields: AIDataSchemaField[];
}

/** Tool parameter from /ai/data-schema */
export interface AIDataSchemaToolParam {
  name: string;
  type: string;
  required?: boolean;
  default?: unknown;
}

/** Tool from /ai/data-schema */
export interface AIDataSchemaTool {
  description: string;
  parameters: AIDataSchemaToolParam[];
}

/** Response from /ai/data-schema */
export interface AIDataSchemaResponse {
  entities: Record<string, AIDataSchemaEntity>;
  relations?: unknown[];
  tools: Record<string, AIDataSchemaTool>;
  formats?: string[];
}

/** System prompt config from /ai/system */
export interface AISystemPromptConfig {
  system_prompt?: string | null;
  data_sources?: Array<{
    name: string;
    type: string;
    database?: string;
    default_filter?: string;
    default_attrs?: string[];
    description?: string;
  }> | null;
  tools_enabled?: Record<string, boolean> | null;
  pipeline_nodes?: Array<{
    id: string;
    type: string;
    tool_name: string;
    params: Record<string, unknown>;
    fields?: unknown[];
    enabled: boolean;
  }> | null;
}

/** Update request for /ai/system */
export interface AISystemPromptUpdateRequest {
  system_prompt?: string;
  data_sources?: unknown[];
  tools_enabled?: Record<string, boolean>;
  pipeline_nodes?: unknown[];
}

/** AI balance info from /ai/balance */
export interface AIBalance {
  balance: number;
  currency?: string;
  used_today?: number;
  limit_daily?: number;
}
