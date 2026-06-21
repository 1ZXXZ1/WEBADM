export interface User {
  id?: number;
  username: string;
  role: string;
  permissions: string[];
}

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  authMethod: 'jwt' | 'apikey' | null;
  accessToken: string | null;
  refreshToken: string | null;
  apiKey: string | null;
}

export interface ThemeState {
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

export interface StepLink {
  stepId: string;
  fieldMap: Record<string, string>; // sourceField → targetParam
}

export interface ETLStep {
  id: string;
  method: string;
  category: string;
  label: string;
  params: Record<string, unknown>;
  fieldMappings: FieldMapping[];
  importedData?: Record<string, string>[];
  linkedFrom?: StepLink;
}

export interface FieldMapping {
  csvColumn: string;
  apiField: string;
  enabled?: boolean; // default true — toggle mapping on/off
  transform?: 'first_letter_with_dot' | 'uppercase' | 'lowercase' | 'trim'; // value transformation at runtime
}

export interface ETLRecipe {
  name: string;
  steps: ETLStep[];
  createdAt: string;
}

export interface ShellScript {
  id: string;
  name: string;
  content: string;
  shell: 'bash' | 'python3';
  sudo: boolean;
  createdAt: string;
  env?: Record<string, string>;
}

export interface ShellProject {
  projet_id: string;
  name: string;
  workspace_path: string;
  owner?: string;
  status: 'creating' | 'ready' | 'running' | 'completed' | 'failed' | 'aborted' | 'deleting';
  created_at?: string;
  completed_at?: string;
  auto_delete?: boolean;
  last_command?: string;
  last_returncode?: number;
  tags?: string[];
  labels?: Record<string, string>;
  ttl_seconds?: number;
  ttl_expires_at?: string;
}

export interface EnvEntry {
  key: string;
  value: string;
}

export interface BatchStepResult {
  id?: string;
  method: string;
  status: 'success' | 'error';
  output?: unknown;
  error?: string;
  step: number;
}

export interface BatchResponse {
  batch_id: string;
  status: 'completed' | 'partial_failure' | 'failed';
  steps: BatchStepResult[];
  total_steps: number;
  successful_steps: number;
  failed_steps: number;
  rollback_performed: boolean;
}

// API operation definitions for ETL palette
export interface APIOperation {
  method: string;
  label: string;
  category: string;
  icon: string;
  params: ParamDef[];
  outputFields?: { name: string; label: string }[];
}

export interface ParamDef {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  required?: boolean;
  default?: unknown;
  options?: { label: string; value: string }[];
  description?: string;
}

// ─── Error & Validation Types ─────────────────────────────────────────────

/** Typed API error from backend */
export interface APIError {
  status: 'error';
  detail: string;
  message?: string;
  error_code?: string;
  rc?: number;
}

/** Validation error for a specific field */
export interface FieldValidationError {
  field: string;
  message: string;
  value?: unknown;
}

/** Result type for operations that can fail */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; errors?: FieldValidationError[] };

/** Helper to create a success result */
export function okResult<T>(data: T): Result<T> {
  return { ok: true, data };
}

/** Helper to create an error result */
export function errResult<T>(error: string, errors?: FieldValidationError[]): Result<T> {
  return { ok: false, error, errors };
}

/** Check if a value is a string (type guard) */
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** Check if a value is a non-null object */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Safely extract error message from caught error */
export function extractErrorMessage(err: unknown): string {
  if (err === null || err === undefined) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (isRecord(err)) {
    const resp = err.response as Record<string, unknown> | undefined;
    if (resp && isRecord(resp)) {
      const data = resp.data as Record<string, unknown> | undefined;
      if (data) {
        return String(data.detail || data.message || resp.status || 'Request failed');
      }
    }
    return String(err.message || err.detail || 'Unknown error');
  }
  return String(err);
}
