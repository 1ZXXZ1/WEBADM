/**
 * TypeScript API Typing Model for Samba AD DC Management API v1.1.13-3
 *
 * This model provides strict type definitions for all API requests and responses.
 * Use the type guards and validators to check data at runtime and identify errors.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Base API Response Types
// ═══════════════════════════════════════════════════════════════════════════

export interface APIResponse<T = unknown> {
  status: 'ok' | 'error' | 'pending';
  message?: string;
  data?: T;
  output?: string;
  rc?: number;
  task_id?: string;
}

export interface APIErrorResponse {
  status: 'error';
  detail: string;
  message?: string;
  error_code?: string;
  rc?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Auth Types
// ═══════════════════════════════════════════════════════════════════════════

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  user: APIUser;
}

export interface APIKeyCheckResponse {
  valid: boolean;
  role: string;
  user_id: number;
  permissions: string[];
}

export interface APIUser {
  id: number;
  username: string;
  role: 'admin' | 'operator' | 'auditor' | 'viewer';
  permissions: string[];
  is_active: boolean;
  created_at?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// User Types
// ═══════════════════════════════════════════════════════════════════════════

export interface SambaUser {
  username: string;
  dn?: string;
  sn?: string;
  givenName?: string;
  mail?: string;
  department?: string;
  title?: string;
  company?: string;
  description?: string;
  telephoneNumber?: string;
  sAMAccountName?: string;
  userAccountControl?: number;
  whenCreated?: string;
  whenChanged?: string;
  lastLogonTimestamp?: string;
  pwdLastSet?: string;
  memberOf?: string[];
  [key: string]: unknown;
}

export interface CreateUserRequest {
  username: string;
  password?: string;
  given_name?: string;
  surname?: string;
  mail_address?: string;
  department?: string;
  job_title?: string;
  company?: string;
  description?: string;
  telephone_number?: string;
  userou?: string;
  random_password?: boolean;
  must_change_at_next_login?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Group Types
// ═══════════════════════════════════════════════════════════════════════════

export interface SambaGroup {
  groupname: string;
  dn?: string;
  description?: string;
  group_scope?: 'DomainLocal' | 'Global' | 'Universal';
  group_type?: 'Security' | 'Distribution';
  memberOf?: string[];
  [key: string]: unknown;
}

export interface CreateGroupRequest {
  groupname: string;
  description?: string;
  group_scope?: 'DomainLocal' | 'Global' | 'Universal';
  group_type?: 'Security' | 'Distribution';
  gid_number?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Computer Types
// ═══════════════════════════════════════════════════════════════════════════

export interface SambaComputer {
  computername: string;
  dn?: string;
  description?: string;
  operatingSystem?: string;
  operatingSystemVersion?: string;
  lastLogonTimestamp?: string;
  [key: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// DNS Types
// ═══════════════════════════════════════════════════════════════════════════

export interface DNSZone {
  name: string;
  zone_type?: string;
  [key: string]: unknown;
}

export interface DNSRecord {
  name: string;
  type: string;
  data: string;
  record_type?: string;
  value?: string;
  record?: string;
  ttl?: number;
  [key: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// GPO Types
// ═══════════════════════════════════════════════════════════════════════════

export interface GpoEntry {
  gpo_id: string;
  displayname: string;
  dn?: string;
  path?: string;
  version?: number;
  [key: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// Domain Types
// ═══════════════════════════════════════════════════════════════════════════

export interface DomainInfo {
  forest?: string;
  domain?: string;
  netbios_name?: string;
  realm?: string;
  server?: string;
  [key: string]: unknown;
}

export interface DomainLevel {
  forest_function_level?: string;
  domain_function_level?: string;
  lowest_function_level?: string;
  [key: string]: unknown;
}

export interface PasswordPolicy {
  password_complexity?: string;
  store_plaintext?: string;
  password_history_length?: number;
  minimum_password_length?: number;
  minimum_password_age?: number;
  maximum_password_age?: number;
  account_lockout_duration?: number;
  account_lockout_threshold?: number;
  reset_account_lockout_after?: number;
  [key: string]: unknown;
}

export interface FsmoRoles {
  schema_master?: string;
  infrastructure_master?: string;
  rid_allocator_master?: string;
  pdc_emulator?: string;
  domain_naming_master?: string;
  [key: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// Shell Types (v1.1.13-3 — updated)
// ═══════════════════════════════════════════════════════════════════════════

export interface ShellInfo {
  name: string;
  available: boolean;
  path?: string;
  description?: string;
}

export interface ShellListResponse {
  status: 'ok' | 'error';
  message?: string;
  shells: ShellInfo[];
}

export interface ShellExecRequest {
  shell: 'bash' | 'python3';
  sudo?: boolean;
  cmd: string;
  timeout?: number;
  env?: Record<string, string>;
}

export interface ShellExecResult {
  stdout: string;
  stderr: string;
  returncode: number;
  timed_out?: boolean;
}

export interface ShellExecResponse {
  status: 'ok' | 'error';
  message?: string;
  shell: string;
  sudo: boolean;
  cmd: string;
  data: ShellExecResult;
}

export interface ShellScriptRequest {
  shell: 'bash' | 'python3';
  sudo?: boolean;
  lines: string[];
  timeout?: number;
  env?: Record<string, string>;
}

export interface ShellScriptFileResponse {
  status: 'ok' | 'error';
  message?: string;
  shell: string;
  sudo: boolean;
  filename: string;
  data: ShellExecResult;
  workspace_path?: string;
  workspace_deleted?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Shell Project Types (v1.1.13-3 — new)
// ═══════════════════════════════════════════════════════════════════════════

export interface ShellProjectCreateRequest {
  name: string;
  archive?: string;
  run_command?: string;
  run_args?: string[];
  auto_delete?: boolean;
  sudo?: boolean;
  timeout?: number;
  env?: Record<string, string>;
  owner?: string;
  permissions?: string;
  pre_commands?: string[];
  post_commands?: string[];
  tags?: string[];
  labels?: Record<string, string>;
  ttl_seconds?: number;
  callback_url?: string;
  wait_for_completion?: boolean;
  dry_run?: boolean;
  volumes?: string[];
  resource_limits?: Record<string, unknown>;
  encrypted_env?: Record<string, string>;
  depends_on?: string[];
  template_id?: string;
}

export interface ShellProjectCreateResponse {
  status: 'ok' | 'error';
  message?: string;
  projet_id: string;
  name: string;
  workspace_path: string;
  auto_delete?: boolean;
  ws_url?: string;
  run_result?: Record<string, unknown>;
  dry_run_result?: Record<string, unknown>;
}

export interface ShellProjectWorkspaceInfo {
  projet_id: string;
  name: string;
  workspace_path: string;
  owner?: string;
  status: 'creating' | 'ready' | 'running' | 'completed' | 'failed' | 'aborted' | 'deleting';
  created_at?: string;
  completed_at?: string;
  auto_delete?: boolean;
  archive?: string;
  last_command?: string;
  last_returncode?: number;
  directory_size?: number;
  file_count?: number;
  tags?: string[];
  labels?: Record<string, string>;
  ttl_seconds?: number;
  ttl_expires_at?: string;
  execution_history?: ShellProjectExecHistoryEntry[];
  callback_url?: string;
  volumes?: string[];
  resource_limits?: Record<string, unknown>;
  depends_on?: string[];
  template_id?: string;
}

export interface ShellProjectExecHistoryEntry {
  command: string;
  rc: number;
  elapsed: number;
  at: string;
  timed_out?: boolean;
}

export interface ShellProjectRunRequest {
  run_command: string;
  run_args?: string[];
  sudo?: boolean;
  timeout?: number;
  env?: Record<string, string>;
  auto_delete?: boolean;
  pre_commands?: string[];
  post_commands?: string[];
  callback_url?: string;
  dry_run?: boolean;
  resource_limits?: Record<string, unknown>;
}

export interface ShellProjectRunResponse {
  status: 'ok' | 'error';
  message?: string;
  projet_id: string;
  run_command: string;
  returncode?: number;
  stdout?: string;
  stderr?: string;
  timed_out?: boolean;
  elapsed?: number;
  workspace_deleted?: boolean;
  output_truncated?: boolean;
  output_total_bytes?: number;
  dry_run_result?: Record<string, unknown>;
}

export interface ShellProjectListResponse {
  status: 'ok' | 'error';
  message?: string;
  count?: number;
  projects: ShellProjectWorkspaceInfo[];
}

export interface ShellProjectHealthResponse {
  status: 'ok' | 'error';
  total_projects: number;
  running: number;
  ready: number;
  completed: number;
  failed: number;
  disk_usage_mb?: number;
  pool_active: number;
  pool_max: number;
  max_projects: number;
  max_workspace_size_mb: number;
  max_output_size_mb: number;
  pg_host?: string;
  pg_port?: number;
  pg_dbname?: string;
  pg_connected?: boolean;
  orphan_workspaces?: number;
}

export interface ShellProjectShowResponse {
  status: 'ok' | 'error';
  projet_id: string;
  workspace: ShellProjectWorkspaceInfo;
  files?: Array<Record<string, unknown>>;
  logs_available?: boolean;
}

export interface ShellProjectUploadResponse {
  status: 'ok' | 'error';
  message?: string;
  projet_id: string;
  filename: string;
  size?: number;
  extracted?: boolean;
  extracted_files?: string[];
}

export interface ShellProjectOwnerChangeRequest {
  new_owner: string;
}

export interface ShellProjectTagsUpdateRequest {
  tags?: string[];
  labels?: Record<string, string>;
}

export interface ShellProjectSchedule {
  schedule_id: number;
  cron_expr: string;
  run_command: string;
  [key: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// Batch Types
// ═══════════════════════════════════════════════════════════════════════════

export interface BatchAction {
  id: string;
  method: string;
  params: Record<string, unknown>;
  timeout?: number;
}

export interface BatchRequest {
  actions: BatchAction[];
  stop_on_failure?: boolean;
  rollback_on_failure?: boolean;
  default_timeout?: number;
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

// ═══════════════════════════════════════════════════════════════════════════
// Management Types
// ═══════════════════════════════════════════════════════════════════════════

export interface MgmtUser {
  id: number;
  username: string;
  role: string;
  is_active: boolean;
  created_at?: string;
}

export interface APIKeyEntry {
  id: number;
  name: string;
  user_id: number;
  role: string;
  is_active: boolean;
  key_prefix?: string;
  created_at?: string;
}

export interface CreateAPIKeyResponse {
  key: string;
  key_id: number;
}

export interface RoleInfo {
  name: string;
  role_name?: string;
  description?: string;
  permissions: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Health / System Types
// ═══════════════════════════════════════════════════════════════════════════

export interface HealthResponse {
  status: 'ok' | 'error';
  version?: string;
  server_role?: string;
  ip_address?: string;
  server_ip?: string;
  uptime?: number;
}

export interface SystemStats {
  system?: {
    cpu_percent?: number;
    memory_percent?: number;
    uptime?: number;
    disk_usage?: number;
  };
  samba?: {
    domain?: string;
    realm?: string;
    netbios_name?: string;
    server_role?: string;
    user_count?: number;
    group_count?: number;
    computer_count?: number;
    server?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Type Guards & Runtime Validators
// ═══════════════════════════════════════════════════════════════════════════

/** Check if a value is a non-null object */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Check if a response is an API error */
export function isAPIError(value: unknown): value is APIErrorResponse {
  return isObject(value) && value.status === 'error' && typeof value.detail === 'string';
}

/** Check if a value is a valid string (not empty/undefined) */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Safely get a string from an object */
export function safeString(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(v => safeString(v)).join(', ');
  return fallback;
}

/** Safely get a number from an object */
export function safeNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const num = Number(value);
    return isNaN(num) ? fallback : num;
  }
  return fallback;
}

/** Safely get an array from an object */
export function safeArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return [];
}

/** Parse text output (from samba-tool) into lines */
export function parseTextOutput(output: unknown): string[] {
  if (typeof output === 'string') return output.split('\n').filter(l => l.trim());
  if (isObject(output)) {
    const outStr = output.output;
    if (typeof outStr === 'string') return outStr.split('\n').filter(l => l.trim());
  }
  return [];
}

// ═══════════════════════════════════════════════════════════════════════════
// API Response Validator
// ═══════════════════════════════════════════════════════════════════════════

export interface ValidationError {
  path: string;
  expected: string;
  received: string;
  message: string;
}

/**
 * Validate an API response and return any type errors found.
 * Use this to debug "Failed to load" errors and identify where the response
 * format doesn't match the expected type.
 */
export function validateAPIResponse(
  data: unknown,
  expectedType: 'array' | 'object' | 'string' | 'paginated',
  context = 'response'
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (data === null || data === undefined) {
    errors.push({
      path: context,
      expected: expectedType,
      received: 'null/undefined',
      message: `${context}: expected ${expectedType}, got ${data === null ? 'null' : 'undefined'}`,
    });
    return errors;
  }

  switch (expectedType) {
    case 'array':
      if (!Array.isArray(data)) {
        if (isObject(data)) {
          if (Array.isArray(data.data)) {
            // OK - data is wrapped
          } else if (typeof data.output === 'string') {
            // OK - text output
          } else {
            errors.push({
              path: `${context}.data`,
              expected: 'array',
              received: typeof data.data,
              message: `${context}: expected array at .data, got ${typeof data.data}. Keys: ${Object.keys(data).join(', ')}`,
            });
          }
        } else {
          errors.push({
            path: context,
            expected: 'array',
            received: typeof data,
            message: `${context}: expected array, got ${typeof data}`,
          });
        }
      }
      break;

    case 'object':
      if (!isObject(data)) {
        errors.push({
          path: context,
          expected: 'object',
          received: typeof data,
          message: `${context}: expected object, got ${typeof data}`,
        });
      }
      break;

    case 'string':
      if (typeof data !== 'string') {
        errors.push({
          path: context,
          expected: 'string',
          received: typeof data,
          message: `${context}: expected string, got ${typeof data}`,
        });
      }
      break;

    case 'paginated':
      if (isObject(data)) {
        if (!Array.isArray(data.data)) {
          errors.push({
            path: `${context}.data`,
            expected: 'array',
            received: typeof data.data,
            message: `${context}.data: expected array for paginated data`,
          });
        }
        if (typeof data.total !== 'number') {
          errors.push({
            path: `${context}.total`,
            expected: 'number',
            received: typeof data.total,
            message: `${context}.total: expected number for paginated total`,
          });
        }
      } else {
        errors.push({
          path: context,
          expected: 'paginated object',
          received: typeof data,
          message: `${context}: expected paginated object {data, total, page, page_size}`,
        });
      }
      break;
  }

  return errors;
}

/**
 * Extract data from various API response wrappers.
 * Handles: direct data, {data: ...}, {output: "..."}, {result: ...}
 */
export function extractResponseData<T>(response: unknown, parser?: (raw: unknown) => T[]): T[] {
  if (Array.isArray(response)) return response as T[];

  if (!isObject(response)) return [];

  // { data: [...] }
  if (Array.isArray(response.data)) return response.data as T[];

  // { output: "..." }
  if (typeof response.output === 'string') {
    const lines = response.output.split('\n').filter(l => l.trim());
    if (parser) return parser(lines);
    return lines.map(l => ({ name: l.trim() } as unknown as T));
  }

  // { result: [...] }
  if (Array.isArray(response.result)) return response.result as T[];

  // { data: { output: "..." } }
  if (isObject(response.data)) {
    if (typeof (response.data as Record<string, unknown>).output === 'string') {
      const lines = ((response.data as Record<string, unknown>).output as string).split('\n').filter(l => l.trim());
      if (parser) return parser(lines);
      return lines.map(l => ({ name: l.trim() } as unknown as T));
    }
  }

  return [];
}

/**
 * Format validation errors for display
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  return errors.map(e => `[${e.path}] ${e.message}`).join('\n');
}

/**
 * Diagnose an API error from a catch block
 */
export function diagnoseAPIError(err: unknown): { message: string; code?: string; statusCode?: number } {
  if (isAPIError(err)) {
    return { message: err.detail, code: err.error_code, statusCode: err.rc };
  }

  if (isObject(err)) {
    const response = (err as Record<string, unknown>).response as Record<string, unknown> | undefined;
    if (response) {
      const data = response.data as Record<string, unknown> | undefined;
      const status = typeof response.status === 'number' ? response.status : undefined;
      const msg = data?.detail || data?.message || (typeof data === 'string' ? data : 'Unknown error');
      return { message: String(msg), statusCode: status };
    }
    const message = (err as Record<string, unknown>).message || (err as Error).message || 'Unknown error';
    return { message: String(message) };
  }

  if (err instanceof Error) {
    return { message: err.message };
  }

  return { message: String(err) };
}
