"""
Pydantic models for the AI Assistant API (v1.6.8-6).

Provides structured request/response models for:
    - Task Builder AI (AIRequest/AIResponse) — returns structured actions
    - Agent AI (AIAgentRequest/AIAgentResponse) — executes actions directly

Safe Mode: When enabled, real data values are stripped from the context
sent to the LLM — only keys and types are visible. The AI uses
``{{USER_INPUT}}`` placeholders for values that must be filled in manually.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator


# ── Request ──────────────────────────────────────────────────────────────


class AIRequest(BaseModel):
    """User request to the AI assistant."""

    prompt: str = Field(
        ...,
        min_length=1,
        max_length=4000,
        description=(
            "Natural-language request from the user. "
            "Example: 'Disable user ivanov and remove from group admins'"
        ),
    )
    context: Optional[Dict[str, Any]] = Field(
        None,
        description=(
            "Current task graph from the frontend constructor. "
            "In Safe Mode, all values are replaced with type placeholders "
            "before sending to the LLM."
        ),
    )
    safe_mode: bool = Field(
        True,
        description=(
            "When True (default), real data values are stripped from the "
            "context. The AI only sees keys and types, and must use "
            "{{USER_INPUT}} placeholders for any specific values."
        ),
    )
    model_override: Optional[str] = Field(
        None,
        description=(
            "Override the default LLM model for this request. "
            "Example: 'openai/gpt-4o-mini', 'anthropic/claude-3-haiku'. "
            "If None, uses the server default (DEFAULT_MODEL). "
            "NOTE: Do NOT send type names like 'string' as the value — "
            "they will be rejected and the default model will be used."
        ),
    )
    # v2.1.1: Caller-supplied system prompt. When provided, replaces the
    # hardcoded ETL-Constructor system prompt entirely (per
    # API_SERVER_SDB_FIX.md Variant 1). This is what enables the frontend
    # SDB mode to send its own SDB_SYSTEM_PROMPT and have the backend
    # actually use it instead of discarding it.
    system: Optional[str] = Field(
        None,
        description=(
            "Optional caller-supplied system prompt. When provided, "
            "the backend uses this INSTEAD OF the hardcoded ETL "
            "Constructor system prompt. Used by the frontend SDB mode "
            "to inject SDB-specific instructions. (v2.1.1 — "
            "API_SERVER_SDB_FIX.md Variant 1)"
        ),
    )
    data: Optional[str] = Field(
        None,
        description=(
            "Optional extra data context appended to the user message "
            "as a [DATA CONTEXT] block. Used by the frontend to feed "
            "structured data (e.g. current task state) to the LLM."
        ),
    )
    # v2.1.1: Mode selector (API_SERVER_SDB_FIX.md Variant 3).
    # 'constructor' = ETL Constructor (default, existing behavior)
    # 'agent'       = Agent system prompt
    # 'sdb'         = SDB query generator prompt
    # If `system` is also supplied, it takes precedence over the
    # mode-selected prompt.
    mode: Optional[str] = Field(
        None,
        description=(
            "Optional prompt-mode selector: 'constructor' (default), "
            "'agent', or 'sdb'. Selects which built-in system prompt "
            # pylint: disable=line-too-long
            "to use. Ignored when `system` is provided explicitly. "
            "(v2.1.1 — API_SERVER_SDB_FIX.md Variant 3)"
        ),
    )

    # v1.6.8-3 fix #2: Reject type-name strings like "string" in model_override
    @field_validator("model_override", mode="before")
    @classmethod
    def _validate_model_override(cls, v: Any) -> Any:
        """Reject obviously invalid model names like 'string', 'str', etc.

        These can appear when the OpenAPI schema type hint 'string' is
        mistakenly used as the actual value by frontend code generators.
        """
        if v is not None and isinstance(v, str):
            invalid_names = {"string", "str", "int", "float", "bool", "none", "null", ""}
            if v.lower().strip() in invalid_names:
                # Return None so the server default model is used instead
                return None
        return v

    @field_validator("mode", mode="before")
    @classmethod
    def _validate_mode(cls, v: Any) -> Any:
        """Normalize and validate the `mode` field."""
        if v is None:
            return None
        if not isinstance(v, str):
            return None
        v_norm = v.strip().lower()
        if v_norm in ("", "constructor", "etl", "task_builder"):
            return "constructor" if v_norm not in ("",) else None
        if v_norm in ("agent", "sdb"):
            return v_norm
        # Unknown mode — fall back to default (None) rather than rejecting
        return None


# ── Actions (returned by AI) ────────────────────────────────────────────


class AIAction(BaseModel):
    """A single action suggested by the AI assistant.

    Supported action types:

    - ``add_api_node``: Add a new API call node to the task graph.
      Payload: ``{"node_id", "method", "path", "operationId", "label", "params"}``

    - ``connect_nodes``: Connect two nodes in sequence.
      Payload: ``{"from_node_id", "to_node_id"}``

    - ``set_param``: Set a parameter value on an existing node.
      Payload: ``{"node_id", "key", "value"}``

    - ``add_comment``: Add a comment/annotation node.
      Payload: ``{"node_id", "text"}``

    - ``add_condition``: Add a conditional branch node.
      Payload: ``{"node_id", "condition", "true_node_id", "false_node_id"}``
    """

    type: str = Field(
        ...,
        description=(
            "Action type: add_api_node, connect_nodes, set_param, "
            "add_comment, add_condition"
        ),
    )
    payload: Dict[str, Any] = Field(
        ...,
        description="Action-specific data (see AIAction docstring for details).",
    )


# ── Response ─────────────────────────────────────────────────────────────


class AIResponse(BaseModel):
    """Structured response from the AI assistant."""

    status: str = Field(
        default="success",
        description="Response status: 'success' or 'error'.",
    )
    message: Optional[str] = Field(
        None,
        description=(
            "Human-readable message from the AI explaining what it did. "
            "Mentions {{USER_INPUT}} placeholders when Safe Mode is active."
        ),
    )
    actions: Optional[List[AIAction]] = Field(
        None,
        description="List of suggested actions for the frontend constructor.",
    )
    model_used: Optional[str] = Field(
        None,
        description="The LLM model that was actually used for this request.",
    )
    tokens_used: Optional[int] = Field(
        None,
        description="Total tokens consumed by this request (prompt + completion).",
    )
    error: Optional[str] = Field(
        None,
        description="Error message if status is 'error'.",
    )
    retries: Optional[int] = Field(
        None,
        description=(
            "Number of 429 rate-limit retries that were needed before "
            "getting a successful response. None if no retries occurred. "
            "(v1.6.8-4)"
        ),
    )
    usage: Optional[AIUsageInfo] = Field(
        default=None,
        description=(
            "Detailed usage and cost info from the LLM response (v1.8.4). "
            "Includes token counts, reasoning tokens, and cost in RUB."
        ),
    )


# ── OpenAPI Schema Info ─────────────────────────────────────────────────


class AIEndpointInfo(BaseModel):
    """Brief info about a single API endpoint (for /ai/schema)."""

    method: str
    path: str
    operation_id: Optional[str] = None
    summary: Optional[str] = None
    parameters: List[str] = Field(default_factory=list)


class AISchemaResponse(BaseModel):
    """Response for the /ai/schema endpoint — compressed OpenAPI summary."""

    total_endpoints: int
    schema_version: Optional[str] = None
    endpoints: List[AIEndpointInfo]


# ── AI Config ────────────────────────────────────────────────────────────


class AIConfigResponse(BaseModel):
    """Current AI configuration (non-sensitive)."""

    enabled: bool
    default_model: str
    safe_mode_default: bool
    temperature: float
    max_tokens: int
    schema_loaded: bool
    schema_endpoints: int
    rate_limit_retries: int = Field(
        default=3,
        description="Max retry attempts on 429 rate limit per model.",
    )
    rate_limit_max_wait: int = Field(
        default=30,
        description="Max wait seconds per 429 retry.",
    )
    fallback_models: List[str] = Field(
        default_factory=list,
        description="List of fallback model IDs if primary is rate-limited.",
    )
    max_schema_chars: int = Field(
        default=12000,
        description="Max compressed schema size in chars sent to LLM.",
    )
    # v1.8.3: Polza.ai provider info in config response
    active_provider: str = Field(
        default="polza",
        description="Active AI provider: 'polza'.",
    )
    polza_configured: bool = Field(
        default=False,
        description="Whether Polza.ai is configured (URL + key set).",
    )
    polza_url: Optional[str] = Field(
        default=None,
        description="Polza.ai API URL (only shown if configured).",
    )
    polza_model: Optional[str] = Field(
        default=None,
        description="Polza.ai default model name (only shown if configured).",
    )
    # v1.8.3: Structured provider/reasoning/sampling/web_search objects
    polza_provider: Optional[Dict[str, Any]] = Field(
        default=None,
        description=(
            "Polza.ai provider routing config. "
            "Keys: only, order, ignore, allow_fallbacks, sort, max_price."
        ),
    )
    polza_reasoning: Optional[Dict[str, Any]] = Field(
        default=None,
        description=(
            "Polza.ai reasoning config. "
            "Keys: effort, summary, enabled, max_tokens, exclude."
        ),
    )
    polza_sampling: Optional[Dict[str, Any]] = Field(
        default=None,
        description=(
            "Polza.ai sampling/generation params. "
            "Keys: top_k, repetition_penalty, top_p, frequency_penalty, presence_penalty, seed."
        ),
    )
    polza_web_search: Optional[Dict[str, Any]] = Field(
        default=None,
        description=(
            "Polza.ai web search config. "
            "Keys: enabled, context_size."
        ),
    )
    polza_extra_body: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Polza.ai full extra_body sent with each request (preview).",
    )
    # v1.8.4: Polza.ai balance info
    polza_balance: Optional[Dict[str, Any]] = Field(
        default=None,
        description=(
            "Polza.ai account balance. "
            "Keys: amount, reserved_amount, spent_amount, updated_at."
        ),
    )


# ── AI Balance (v1.8.4) ─────────────────────────────────────────────────


class AIBalanceResponse(BaseModel):
    """Polza.ai account balance and usage summary."""

    provider: str = Field(
        default="polza",
        description="AI provider name.",
    )
    balance: Optional[Dict[str, Any]] = Field(
        default=None,
        description=(
            "Account balance from Polza.ai API. "
            "Keys: amount, reserved_amount, spent_amount, updated_at."
        ),
    )
    configured: bool = Field(
        default=False,
        description="Whether Polza.ai is configured.",
    )
    error: Optional[str] = Field(
        default=None,
        description="Error message if balance request failed.",
    )


class AIUsageInfo(BaseModel):
    """Detailed usage and cost information from an LLM API response.

    Polza.ai returns cost_rub in the usage object, which is extracted
    and displayed per-request. This gives visibility into spending.
    """

    prompt_tokens: Optional[int] = Field(
        default=None,
        description="Number of tokens in the prompt.",
    )
    completion_tokens: Optional[int] = Field(
        default=None,
        description="Number of tokens in the completion.",
    )
    total_tokens: Optional[int] = Field(
        default=None,
        description="Total tokens (prompt + completion).",
    )
    reasoning_tokens: Optional[int] = Field(
        default=None,
        description="Tokens used for reasoning (Polza.ai only).",
    )
    cached_tokens: Optional[int] = Field(
        default=None,
        description="Cached prompt tokens (Polza.ai only).",
    )
    cost_rub: Optional[float] = Field(
        default=None,
        description="Cost of this request in RUB (Polza.ai only).",
    )
    provider: Optional[str] = Field(
        default=None,
        description="AI provider: 'polza'.",
    )


class AIInfoResponse(BaseModel):
    """General AI info endpoint response (v1.8.4).

    Provides a single place to check everything about the AI setup:
    - Which provider is active (Polza.ai)
    - Current account balance (Polza.ai)
    - Total spent across all chat sessions
    - Per-session cost breakdown
    This is the 'dashboard' endpoint for AI usage visibility.
    """

    provider: str = Field(
        default="polza",
        description="Active AI provider: 'polza'.",
    )
    configured: bool = Field(
        default=False,
        description="Whether AI is configured (API key set).",
    )
    default_model: Optional[str] = Field(
        default=None,
        description="Default model name.",
    )
    balance: Optional[Dict[str, Any]] = Field(
        default=None,
        description=(
            "Account balance from Polza.ai API. "
            "Keys: amount, reserved_amount, spent_amount, updated_at."
        ),
    )
    total_chats: int = Field(
        default=0,
        description="Total number of chat sessions.",
    )
    total_cost_rub: float = Field(
        default=0.0,
        description="Total cost of all AI requests across all chats in RUB.",
    )
    total_tokens: int = Field(
        default=0,
        description="Total tokens consumed across all chats.",
    )
    chat_costs: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description=(
            "Per-chat cost breakdown. Each entry has: "
            "chat_id, title, message_count, total_cost_rub, total_tokens."
        ),
    )


# ── Agent Mode (v1.6.8-6) ───────────────────────────────────────────────


class AIAgentRequest(BaseModel):
    """Request for the AI Agent mode (direct execution with tool calling).

    Unlike AIRequest (Task Builder) which returns structured suggestions,
    the Agent mode executes actions directly on the server using Polza.ai
    tool calling. The AI has access to:
    - execute_samba_api — call any API endpoint
    - execute_shell_command — run shell commands
    - save_file — save/export data to files
    - read_file — read files from server
    """

    prompt: str = Field(
        ...,
        min_length=1,
        max_length=8000,
        description=(
            "Natural-language request. The AI will execute the necessary "
            "actions to fulfill it. Example: 'List all domain users and "
            "export to CSV'"
        ),
    )
    context: Optional[Dict[str, Any]] = Field(
        None,
        description=(
            "Optional context data to include in the AI's conversation. "
            "For example, previously loaded file contents."
        ),
    )
    model_override: Optional[str] = Field(
        None,
        description=(
            "Override the default LLM model for this request. "
            "Agent mode works best with models that support tool calling: "
            "'openai/gpt-4o-mini', 'anthropic/claude-3-haiku', "
            "'meta-llama/llama-3.1-8b-instruct:free'."
        ),
    )
    max_steps: Optional[int] = Field(
        None,
        description=(
            "Override the max agent loop iterations for this request. "
            "If None, uses the server default (AI_AGENT_MAX_STEPS)."
        ),
    )
    # v1.9-3-6: system and data parameters for per-request AI control
    system: Optional[str] = Field(
        None,
        max_length=8000,
        description=(
            "Custom system prompt injected as role='system' message. "
            "Overrides or extends the default agent system prompt. "
            "Use to customize AI behavior: add parameters, fields, "
            "pipeline nodes, tool restrictions, etc."
        ),
    )
    data: Optional[str] = Field(
        None,
        max_length=32000,
        description=(
            "Contextual data injected as a separate message before the "
            "user's prompt. Appears as role='user' with [DATA CONTEXT] "
            "prefix. Use to pass structured data, query results, "
            "pipeline configurations, or any context."
        ),
    )

    @field_validator("model_override", mode="before")
    @classmethod
    def _validate_model_override(cls, v: Any) -> Any:
        """Reject obviously invalid model names."""
        if v is not None and isinstance(v, str):
            invalid_names = {"string", "str", "int", "float", "bool", "none", "null", ""}
            if v.lower().strip() in invalid_names:
                return None
        return v


class AIAgentStep(BaseModel):
    """A single step in the agent execution chain.

    Each step represents one tool call by the AI agent, including
    the tool name, arguments, and a preview of the result.
    """

    step: int = Field(description="Step number (1-based).")
    tool_name: str = Field(description="Name of the tool that was called.")
    tool_args: Dict[str, Any] = Field(description="Arguments passed to the tool.")
    result_preview: str = Field(
        description="First 500 chars of the tool execution result.",
    )
    success: bool = Field(
        default=True,
        description="Whether the tool call succeeded.",
    )


class AIAgentResponse(BaseModel):
    """Response from the AI Agent mode."""

    status: str = Field(
        default="success",
        description=(
            "Response status: 'success' (completed), 'partial' (hit max steps), "
            "or 'error'."
        ),
    )
    message: Optional[str] = Field(
        None,
        description="Final answer from the AI agent.",
    )
    steps: List[AIAgentStep] = Field(
        default_factory=list,
        description="List of tool call steps executed by the agent.",
    )
    total_steps: int = Field(
        default=0,
        description="Total number of tool calls executed.",
    )
    model_used: Optional[str] = Field(
        None,
        description="The LLM model that was used for this request.",
    )
    tokens_used: Optional[int] = Field(
        None,
        description="Total tokens consumed (cumulative across all agent loop iterations).",
    )
    error: Optional[str] = Field(
        None,
        description="Error message if status is 'error'.",
    )
    # v1.8.4: Detailed usage and cost info
    cost_rub: Optional[float] = Field(
        default=None,
        description="Total cost of this request in RUB (Polza.ai only, cumulative).",
    )
    usage: Optional[AIUsageInfo] = Field(
        default=None,
        description=(
            "Detailed usage and cost info from the last LLM response (v1.8.4). "
            "Includes per-step token counts, reasoning tokens, and cost in RUB."
        ),
    )
    balance: Optional[Dict[str, Any]] = Field(
        default=None,
        description=(
            "Current AI provider balance after this request (v1.8.4). "
            "Keys: amount, reserved_amount, spent_amount, updated_at."
        ),
    )


# ── AI System & Data Configuration (v1.9-3-6) ──────────────────────────


class AISystemPromptConfig(BaseModel):
    """Configuration for the AI system prompt and data parameters.

    v1.9-3-6: Allows web UI to view and modify the AI system prompt,
    data sources, pipeline nodes, parameters and fields.
    """

    system_prompt: Optional[str] = Field(
        default=None,
        description=(
            "Custom system prompt for AI. If set, overrides the default "
            "agent system prompt. Use this to customize AI behavior, "
            "add domain-specific instructions, or restrict AI actions."
        ),
    )
    data_sources: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description=(
            "Configured data sources for AI queries. Each source has: "
            "name, type (sdb/ldbsearch/api/postgresql), database, "
            "default_filter, default_attrs, description."
        ),
    )
    tools_enabled: Optional[Dict[str, bool]] = Field(
        default=None,
        description=(
            "Enabled/disabled state for each AI tool. "
            "Keys: execute_samba_api, execute_shell_command, save_file, "
            "read_file, ldbsearch_ad, sdb_execute, data_import, "
            "data_export, data_transform, data_diagram, manage_samba_share, "
            "manage_samba_config, system_admin, network_admin, etc."
        ),
    )
    pipeline_nodes: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description=(
            "Pipeline configuration nodes. Each node has: "
            "id, type (source/transform/output), tool_name, "
            "params, fields, enabled, description."
        ),
    )


class AISystemPromptUpdateRequest(BaseModel):
    """Request to update AI system prompt configuration."""

    system_prompt: Optional[str] = Field(
        default=None,
        description="New system prompt text (replaces existing).",
    )
    data_sources: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description="Updated data sources configuration.",
    )
    tools_enabled: Optional[Dict[str, bool]] = Field(
        default=None,
        description="Updated tool enabled/disabled state.",
    )
    pipeline_nodes: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description="Updated pipeline nodes configuration.",
    )


class AIPipelineNode(BaseModel):
    """A single node in the AI processing pipeline.

    v1.9-3-6: Enables visual pipeline construction in the web UI.
    Each node represents a step in the data processing workflow.
    """

    id: str = Field(
        description="Unique node identifier (e.g. 'node_1', 'source_users').",
    )
    type: str = Field(
        description=(
            "Node type: 'source' (data input), 'transform' (filter/modify), "
            "'output' (export/display), 'condition' (branching), "
            "'ai_action' (AI-driven operation)."
        ),
    )
    tool_name: Optional[str] = Field(
        default=None,
        description=(
            "AI tool to execute (e.g. 'sdb_execute', 'ldbsearch_ad', "
            "'data_export', 'data_transform')."
        ),
    )
    label: Optional[str] = Field(
        default=None,
        description="Human-readable label for the node in the UI.",
    )
    params: Optional[Dict[str, Any]] = Field(
        default=None,
        description=(
            "Tool parameters as key-value pairs. "
            "Example: {'action': 'select', 'fields': 'cn,mail', 'scope': 'USERS'}"
        ),
    )
    fields: Optional[List[str]] = Field(
        default=None,
        description=(
            "Selected fields/columns for this node. "
            "Example: ['sAMAccountName', 'cn', 'department']"
        ),
    )
    enabled: bool = Field(
        default=True,
        description="Whether this node is active in the pipeline.",
    )
    description: Optional[str] = Field(
        default=None,
        description="Description of what this node does.",
    )
    connections: Optional[List[str]] = Field(
        default=None,
        description=(
            "IDs of nodes that this node connects to (downstream). "
            "Example: ['node_2', 'node_3']"
        ),
    )


class AIPipelineConfig(BaseModel):
    """Full pipeline configuration with nodes and connections.

    v1.9-3-6: Represents a complete data processing pipeline
    that can be constructed and modified in the web UI.
    """

    name: str = Field(
        description="Pipeline name.",
    )
    description: Optional[str] = Field(
        default=None,
        description="Pipeline description.",
    )
    nodes: List[AIPipelineNode] = Field(
        default_factory=list,
        description="Pipeline nodes in order.",
    )
    global_params: Optional[Dict[str, Any]] = Field(
        default=None,
        description=(
            "Global parameters available to all nodes. "
            "Example: {'domain': 'DC1', 'exclude': 'Administrator,Guest'}"
        ),
    )


class AIDataSchemaResponse(BaseModel):
    """Response with available data entities and their fields.

    v1.9-3-6: Enables the web UI to display field pickers,
    entity browsers, and auto-complete for data operations.
    """

    entities: Dict[str, Dict[str, Any]] = Field(
        default_factory=dict,
        description=(
            "Available data entities (tables). "
            "Keys: entity name (USERS, GROUPS, etc.). "
            "Values: {count, key_attr, fields: [{name, type, description}]}."
        ),
    )
    relations: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Relationships between entities (foreign keys, many-to-many).",
    )
    tools: Dict[str, Dict[str, Any]] = Field(
        default_factory=dict,
        description=(
            "Available AI tools with their parameters. "
            "Keys: tool name. Values: {description, parameters: {name, type, required, default}}."
        ),
    )
    formats: List[str] = Field(
        default_factory=lambda: ["json", "csv", "tsv", "xlsx", "ldif", "table"],
        description="Available output formats for data operations.",
    )


# ── SDB AI Mode (v2.1.1 — API_SERVER_SDB_FIX.md) ────────────────────────


class AISdbRequest(BaseModel):
    """Request body for ``POST /api/v1/ai/sdb``.

    The frontend SDB mode uses this dedicated endpoint instead of
    ``/ai/assistant`` so that:

    1. The backend uses the SDB-specific system prompt (``SDB_SYSTEM_PROMPT``)
       by default — the frontend no longer has to send it.
    2. If the frontend *does* supply ``system``, it overrides the default
       SDB prompt (Variant 1 from API_SERVER_SDB_FIX.md).
    3. The response is the same ``AIResponse`` shape the existing
       Task Builder endpoint returns (``actions: [...]``), so the
       frontend constructor code path is reused unchanged.
    """

    prompt: str = Field(
        ...,
        min_length=1,
        max_length=4000,
        description=(
            "Natural-language SDB request from the user. "
            "Examples: 'show 5 users', 'admin users', "
            "'disabled accounts', 'computers with Windows 10'."
        ),
    )
    context: Optional[Dict[str, Any]] = Field(
        None,
        description=(
            "Optional task-graph context from the frontend constructor. "
            "Passed through to the LLM as [CURRENT TASK CONTEXT]."
        ),
    )
    safe_mode: bool = Field(
        True,
        description=(
            "When True (default), real data values in `context` are "
            "masked before being sent to the LLM."
        ),
    )
    model_override: Optional[str] = Field(
        None,
        description=(
            "Override the default LLM model for this request. "
            "If None, uses ``SAMBA_POLZA_AI_MODEL`` (or "
            "``SAMBA_AI_DEFAULT_MODEL``)."
        ),
    )
    system: Optional[str] = Field(
        None,
        description=(
            "Optional caller-supplied system prompt. When provided, "
            "REPLACES the built-in ``SDB_SYSTEM_PROMPT``. Use this to "
            "tweak SDB behavior without forking the backend. "
            "(API_SERVER_SDB_FIX.md Variant 1)"
        ),
    )
    data: Optional[str] = Field(
        None,
        description=(
            "Optional extra data context appended to the user message "
            "as a [DATA CONTEXT] block."
        ),
    )

    @field_validator("model_override", mode="before")
    @classmethod
    def _validate_model_override(cls, v: Any) -> Any:
        """Reject obviously invalid model names (same rule as AIRequest)."""
        if v is not None and isinstance(v, str):
            invalid_names = {"string", "str", "int", "float", "bool", "none", "null", ""}
            if v.lower().strip() in invalid_names:
                return None
        return v


class AISdbResponse(AIResponse):
    """Response for ``POST /api/v1/ai/sdb``.

    Identical shape to :class:`AIResponse` — declared as a separate
    subclass so the OpenAPI schema documents the SDB endpoint
    independently and the frontend can keep its typed client.
    """

    mode: str = Field(
        default="sdb",
        description="Always 'sdb' for this endpoint — helps the frontend branch.",
    )
