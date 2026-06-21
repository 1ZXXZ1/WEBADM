// ─── AI API Service ───────────────────────────────────────────────────────
// Функции для общения с AI-бэкендом (/api/v1/ai/*)

import api from '@/lib/api';
import type {
  AIRequest, AIResponse, AIConfig, AISchema,
  AIAgentRequest, AIAgentResponse,
  AIChatSession, AIChatSessionList, AIStreamEvent, AIBalance,
  AIDataSchemaResponse, AISystemPromptConfig, AISystemPromptUpdateRequest,
} from '@/types/ai';
import type { ETLStep } from '@/types';

// ─── Санитизация контекста (Safe Mode на стороне фронтенда) ───────────────
// В Safe Mode затираем значения параметров, оставляем только структуру,
// чтобы реальные пароли/имена не уходили на AI-бэкенд
const sanitizeContext = (steps: ETLStep[]): Record<string, unknown> => {
  return {
    steps: steps.map(step => ({
      id: step.id,
      method: step.method,
      category: step.category,
      label: step.label,
      linkedFrom: step.linkedFrom ? {
        stepId: step.linkedFrom.stepId,
        fieldMap: step.linkedFrom.fieldMap,
      } : undefined,
      params: Object.keys(step.params || {}).reduce((acc, key) => {
        const val = step.params[key];
        // Булевы значения оставляем как есть — они не чувствительны
        if (typeof val === 'boolean') {
          acc[key] = val;
        } else if (typeof val === 'number') {
          acc[key] = val;
        } else {
          // Все строковые значения заменяем на плейсхолдер
          acc[key] = '<string>';
        }
        return acc;
      }, {} as Record<string, unknown>),
      fieldMappingsCount: step.fieldMappings?.length || 0,
    })),
  };
};

// ─── Контекст для агента (без санитизации — агент выполняет реальные действия) ──
const buildAgentContext = (steps: ETLStep[]): Record<string, unknown> => {
  return {
    pipeline_steps: steps.length,
    pipeline_summary: steps.map(s => `${s.method} ${s.label}`).join(', '),
  };
};

// ─── Таймауты для AI-запросов ────────────────────────────────────────────
// AI-ассистент может думать до 5 минут
// AI-агент: 1 шаг = 1 минута, 50 шагов = до 50 минут
const AI_ASSISTANT_TIMEOUT = 5 * 60 * 1000;   // 5 минут
const AI_AGENT_STEP_TIMEOUT = 60 * 1000;      // 1 минута на шаг
const AI_AGENT_DEFAULT_STEPS = 50;            // дефолтное кол-во шагов

// ─── Helper: get auth headers for native fetch (SSE streaming) ────────────
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
  };
  if (typeof window !== 'undefined') {
    const authMethod = localStorage.getItem('samba-auth-method');
    if (authMethod === 'jwt') {
      const token = localStorage.getItem('samba-access-token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } else if (authMethod === 'apikey') {
      const apiKey = localStorage.getItem('samba-api-key');
      if (apiKey) headers['X-API-Key'] = apiKey;
    }
  }
  return headers;
}

// ─── Helper: resolve API base URL ─────────────────────────────────────────
function getBaseURL(): string {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('samba-api-url');
    if (stored) return stored;
  }
  return '/api/v1';
}

// ─── API методы ──────────────────────────────────────────────────────────

export const aiAPI = {
  /** Получение конфига AI с бэкенда */
  getConfig: async (): Promise<AIConfig> => {
    const res = await api.get('/ai/config');
    return res.data;
  },

  /** Получение схемы API */
  getSchema: async (): Promise<AISchema> => {
    const res = await api.get('/ai/schema');
    return res.data;
  },

  /** Отправка промпта AI-ассистенту (режим конструктора — добавляет ноды в пайплайн) */
  sendPrompt: async (
    prompt: string,
    currentSteps: ETLStep[],
    safeMode: boolean,
    modelOverride?: string,
    system?: string,
    data?: string,
  ): Promise<AIResponse> => {
    // В Safe Mode — контекст без чувствительных данных
    const context = safeMode
      ? sanitizeContext(currentSteps)
      : { steps: currentSteps };

    const body: AIRequest & { system?: string; data?: string } = {
      prompt,
      context,
      safe_mode: safeMode,
      ...(modelOverride ? { model_override: modelOverride } : {}),
      ...(system ? { system } : {}),
      ...(data ? { data } : {}),
    };

    const res = await api.post('/ai/assistant', body, {
      timeout: AI_ASSISTANT_TIMEOUT,
    });
    return res.data;
  },

  /** Отправка промпта AI-агенту (режим выполнения — агент сам выполняет API-запросы) */
  sendAgentPrompt: async (
    prompt: string,
    currentSteps: ETLStep[],
    modelOverride?: string,
    maxSteps?: number,
    system?: string,
    data?: string,
  ): Promise<AIAgentResponse> => {
    const context = buildAgentContext(currentSteps);

    const body: AIAgentRequest = {
      prompt,
      context,
      ...(modelOverride ? { model_override: modelOverride } : {}),
      ...(maxSteps ? { max_steps: maxSteps } : {}),
      ...(system ? { system } : {}),
      ...(data ? { data } : {}),
    };

    // 1 шаг = 1 минута. 50 шагов = 50 минут.
    const steps = maxSteps || AI_AGENT_DEFAULT_STEPS;
    const dynamicTimeout = steps * AI_AGENT_STEP_TIMEOUT;

    const res = await api.post('/ai/agent', body, {
      timeout: dynamicTimeout,
    });
    return res.data;
  },

  /** Отправка промпта AI SDB-ассистенту (новый режим SDB — backend v1.9-3-7+)
   *  Backend имеет отдельный SDB system prompt, который корректно генерирует
   *  SDB-скрипты (USE sam; FROM USERS; SHOW AS json LIMIT N;).
   *  Эндпоинт: POST /api/v1/ai/sdb
   *  Возвращает тот же формат AIResponse, что и /ai/assistant.
   */
  aiSdbRequest: async (
    prompt: string,
    safeMode: boolean,
    system?: string,
    data?: string,
  ): Promise<AIResponse> => {
    const body: Record<string, unknown> = {
      prompt,
      safe_mode: safeMode,
      ...(system ? { system } : {}),
      ...(data ? { data } : {}),
    };

    const res = await api.post('/ai/sdb', body, {
      timeout: AI_ASSISTANT_TIMEOUT,
    });
    return res.data;
  },

  // ─── Chat Session API ────────────────────────────────────────────────

  /** Создание новой сессии чата */
  createChatSession: async (title: string, modelOverride?: string): Promise<AIChatSession> => {
    const body: Record<string, unknown> = { title };
    if (modelOverride) body.model_override = modelOverride;
    const res = await api.post('/ai/chat/', body, {
      timeout: AI_ASSISTANT_TIMEOUT,  // 5 минут — создание сессии может быть медленным
    });
    return res.data;
  },

  /** Получение списка сессий чата */
  listChatSessions: async (): Promise<AIChatSessionList> => {
    const res = await api.get('/ai/chat/list', {
      timeout: 15000,  // 15 секунд — список сессий не должен быть медленным
    });
    return res.data;
  },

  /** Получение истории чата */
  getChatHistory: async (chatId: string, limit?: number): Promise<{ messages: unknown[]; total: number }> => {
    const params = limit ? { limit } : {};
    const res = await api.get(`/ai/chat/${chatId}/history`, { params, timeout: 15000 });
    return res.data;
  },

  /** Отправка сообщения в чат (без стриминга) */
  sendChatMessage: async (
    chatId: string,
    message: string,
    useAgent: boolean,
    maxSteps?: number,
  ): Promise<unknown> => {
    const body: Record<string, unknown> = {
      message,
      use_agent: useAgent,
      ...(maxSteps ? { max_steps: maxSteps } : {}),
    };
    const res = await api.post(`/ai/chat/${chatId}/send`, body, {
      timeout: useAgent ? (maxSteps || AI_AGENT_DEFAULT_STEPS) * AI_AGENT_STEP_TIMEOUT : AI_ASSISTANT_TIMEOUT,
    });
    return res.data;
  },

  /** Удаление сессии чата */
  deleteChatSession: async (chatId: string): Promise<void> => {
    await api.delete(`/ai/chat/${chatId}`);
  },

  // ─── AI System & Data Schema API (v1.9-3-6) ──────────────────────────

  /** Получение конфигурации системного промпта AI */
  getSystemConfig: async (): Promise<AISystemPromptConfig> => {
    const res = await api.get('/ai/system', { timeout: 15000 });
    return res.data;
  },

  /** Обновление конфигурации системного промпта AI */
  updateSystemConfig: async (update: AISystemPromptUpdateRequest): Promise<AISystemPromptConfig> => {
    const res = await api.put('/ai/system', update);
    return res.data;
  },

  /** Получение схемы данных для UI */
  getDataSchema: async (): Promise<AIDataSchemaResponse> => {
    const res = await api.get('/ai/data-schema', { timeout: 15000 });
    return res.data;
  },

  /** Обновление сессии чата */
  updateChatSession: async (chatId: string, title?: string, systemPrompt?: string): Promise<AIChatSession> => {
    const body: Record<string, unknown> = {};
    if (title !== undefined) body.title = title;
    if (systemPrompt !== undefined) body.system_prompt = systemPrompt;
    const res = await api.put(`/ai/chat/${chatId}`, body, { timeout: 15000 });
    return res.data;
  },

  /** Получение информации о сессии чата */
  getChatInfo: async (chatId: string): Promise<AIChatSession> => {
    const res = await api.get(`/ai/chat/${chatId}/info`, { timeout: 15000 });
    return res.data;
  },

  /** Получение баланса AI */
  getAIBalance: async (): Promise<AIBalance> => {
    const res = await api.get('/ai/balance', { timeout: 15000 });
    return res.data;
  },

  // ─── SSE Streaming ──────────────────────────────────────────────────

  /**
   * Stream a chat message via SSE (Server-Sent Events).
   * Returns an async generator that yields AIStreamEvent objects as they arrive.
   */
  streamChatMessage: async function* (
    chatId: string,
    message: string,
    useAgent: boolean,
    maxSteps?: number,
    system?: string,
    data?: string,
  ): AsyncGenerator<AIStreamEvent> {
    const baseURL = getBaseURL();
    const headers = getAuthHeaders();

    const body: Record<string, unknown> = {
      message,
      use_agent: useAgent,
      ...(maxSteps ? { max_steps: maxSteps } : {}),
      ...(system ? { system } : {}),
      ...(data ? { data } : {}),
    };

    const response = await fetch(`${baseURL}/ai/chat/${chatId}/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let errorDetail = `HTTP ${response.status}`;
      try {
        const errData = await response.json();
        errorDetail = errData?.detail || errData?.error || errorDetail;
      } catch {
        // ignore parse error
      }
      throw new Error(errorDetail);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body for SSE stream');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (!data || data === '[DONE]') continue;
            try {
              const event = JSON.parse(data);
              yield event as AIStreamEvent;
            } catch {
              // skip malformed JSON
            }
          }
        }
      }
      // Process remaining buffer
      if (buffer.startsWith('data: ')) {
        const data = buffer.slice(6).trim();
        if (data && data !== '[DONE]') {
          try {
            const event = JSON.parse(data);
            yield event as AIStreamEvent;
          } catch {
            // skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },
};
