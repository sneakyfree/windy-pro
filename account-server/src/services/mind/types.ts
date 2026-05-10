/**
 * ⚠️  HISTORICAL WIRE-PROTOCOL SPIKE — NOT THE CANONICAL V1 (per ADR-013, 2026-05-10).
 *
 * The canonical V1 of Windy Mind is being rebuilt in Python + FastAPI at
 * `~/windy-mind/api/`. This Node.js broker is preserved as historical
 * reference — it proved the OpenAI-compatible request shape, OAuth flow
 * for Anthropic Max-sub quota, Groq adapter, and provider fallback chain.
 * Those lessons carry forward to the Python rebuild.
 *
 * Internal Windy products that still call this broker should migrate to
 * `https://api.windymind.ai/v1/chat` once the Python V1 ships. This
 * Node.js code will be deprecated (return 301 redirect) and eventually
 * deleted.
 *
 * See:
 * - kit-army-config/docs/adr-013-marathon-stack-2026-05-10.md
 * - kit-army-config/docs/windy-mind-master-plan-2026-05-10.md
 * - kit-army-config/docs/windy-mind-v1-design-2026-05-08.md
 *
 * ─────────────────────────────────────────────────────────────────────
 *
 * Windy Mind V1 — shared types for the multi-model broker (HISTORICAL).
 *
 * V1 supports 6 models across 5 providers. The broker normalizes the
 * OpenAI-compatible chat-completions shape to provider-specific calls.
 *
 * Wire protocol (matches what most LLM SDK clients already speak):
 *   POST /api/v1/mind/chat
 *   {
 *     "model": "claude-opus-4-7" | "claude-sonnet-4-6" | "grok-4" | ...,
 *     "messages": [{"role": "user|assistant|system", "content": "..."}],
 *     "max_tokens": 4096,
 *     "stream": false  // V1 = non-streaming; V2 adds SSE
 *   }
 *   →
 *   {
 *     "id": "<uuid>",
 *     "model": "claude-opus-4-7",
 *     "choices": [{"message": {"role": "assistant", "content": "..."}, "finish_reason": "stop"}],
 *     "usage": {"prompt_tokens": N, "completion_tokens": N, "total_tokens": N},
 *     "_provider": "anthropic"
 *   }
 */

export type ModelId =
    | 'claude-opus-4-7'
    | 'claude-sonnet-4-6'
    | 'grok-4'
    | 'gpt-5'
    | 'mistral-large-3'
    | 'llama-3.3-70b-versatile'; // Groq

export type Provider = 'anthropic' | 'xai' | 'openai' | 'mistral' | 'groq';

export interface ModelMetadata {
    id: ModelId;
    provider: Provider;
    label: string;          // human-readable (e.g., "Claude Opus 4.7")
    persona: string;        // "Smartest" / "Fastest" / etc.
    persona_emoji: string;  // for SPA settings panel
    max_tokens: number;     // provider's per-request output ceiling
    devTest: boolean;       // marked as dev/test default
    productionDefault: boolean;
}

/**
 * V1 model lineup per the design doc. Every product in the ecosystem that
 * needs LLM access calls /api/v1/mind/chat with one of these IDs (or omits
 * the model field, in which case the broker picks a default per env).
 */
export const MODEL_LINEUP: ModelMetadata[] = [
    {
        id: 'claude-opus-4-7',
        provider: 'anthropic',
        label: 'Claude Opus 4.7',
        persona: 'Smartest',
        persona_emoji: '⭐',
        max_tokens: 4096,
        devTest: false,
        productionDefault: true,
    },
    {
        id: 'claude-sonnet-4-6',
        provider: 'anthropic',
        label: 'Claude Sonnet 4.6',
        persona: 'Fast + smart',
        persona_emoji: '🚀',
        max_tokens: 4096,
        devTest: true, // dev/test default
        productionDefault: false,
    },
    {
        id: 'grok-4',
        provider: 'xai',
        label: 'Grok 4',
        persona: 'Fastest',
        persona_emoji: '⚡',
        max_tokens: 4096,
        devTest: false,
        productionDefault: false,
    },
    {
        id: 'gpt-5',
        provider: 'openai',
        label: 'GPT-5',
        persona: 'Most popular',
        persona_emoji: '🌐',
        max_tokens: 4096,
        devTest: false,
        productionDefault: false,
    },
    {
        id: 'mistral-large-3',
        provider: 'mistral',
        label: 'Mistral Large 3',
        persona: 'Most private',
        persona_emoji: '🔒',
        max_tokens: 4096,
        devTest: false,
        productionDefault: false,
    },
    {
        id: 'llama-3.3-70b-versatile',
        provider: 'groq',
        label: 'Llama 3.3 (Groq)',
        persona: 'Most affordable',
        persona_emoji: '💸',
        max_tokens: 4096,
        devTest: false,
        productionDefault: false,
    },
];

/**
 * Default model selection logic. Per the design doc's dev/prod
 * model-default distinction:
 *
 * - NODE_ENV=production → production default (Opus 4.7)
 * - Otherwise → dev/test default (Sonnet 4.6)
 *
 * Caller can always override by passing model in the request body.
 */
export function defaultModel(): ModelId {
    const isProd = process.env.NODE_ENV === 'production';
    const target = MODEL_LINEUP.find(m =>
        isProd ? m.productionDefault : m.devTest,
    );
    return target?.id ?? 'claude-sonnet-4-6';
}

/**
 * Standard chat-completion message format (OpenAI-compatible).
 * Mind's API speaks this shape to clients; provider adapters translate.
 */
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface MindChatRequest {
    model?: ModelId;
    messages: ChatMessage[];
    max_tokens?: number;
    temperature?: number;
}

export interface MindChatResponse {
    id: string;
    model: ModelId;
    choices: {
        message: ChatMessage;
        finish_reason: 'stop' | 'length' | 'tool_use' | 'error';
    }[];
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    };
    _provider: Provider; // diagnostic only — clients shouldn't depend on this
}

export interface ProviderAdapter {
    /** Provider this adapter handles. */
    readonly provider: Provider;

    /** Whether the adapter has credentials configured. */
    isConfigured(): boolean;

    /**
     * Make the actual API call to the provider. Adapters translate the
     * shared MindChatRequest shape to provider-specific payloads + back.
     */
    chat(req: MindChatRequest, model: ModelMetadata): Promise<MindChatResponse>;
}
