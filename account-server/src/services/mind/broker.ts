/**
 * Windy Mind V1 — provider broker.
 *
 * Looks up the right adapter for a given model ID, falls back gracefully
 * when the requested adapter is unconfigured (per ADR-010 §8 BYOM
 * invariant: every LLM call brokered through Mind, never direct).
 *
 * V1 fallback logic:
 * 1. If requested model's provider is configured → use it
 * 2. Else if Anthropic is configured → fall back to claude-sonnet-4-6
 * 3. Else if Groq is configured → fall back to llama-3.3-70b-versatile
 * 4. Else throw 503 — no providers wired up
 *
 * V2 will add per-user model preferences + BYOK pulled from Secrets Manager.
 */
import { AnthropicAdapter } from './providers/anthropic';
import { GroqAdapter } from './providers/groq';
import {
    MODEL_LINEUP,
    defaultModel,
    type MindChatRequest,
    type MindChatResponse,
    type ModelId,
    type Provider,
    type ProviderAdapter,
} from './types';

const ADAPTERS: ProviderAdapter[] = [
    new AnthropicAdapter(),
    new GroqAdapter(),
    // OpenAI, xAI, Mistral adapters land in V1 M2 — for V1 M1 we ship with
    // the two providers that have working keys in the lockbox today.
];

function adapterFor(provider: Provider): ProviderAdapter | null {
    return ADAPTERS.find(a => a.provider === provider && a.isConfigured()) || null;
}

export interface BrokerCallResult {
    response: MindChatResponse;
    actualModel: ModelId;
    fellBackFrom?: ModelId;
}

export async function brokerChat(req: MindChatRequest): Promise<BrokerCallResult> {
    const requested = req.model || defaultModel();
    const requestedMeta = MODEL_LINEUP.find(m => m.id === requested);
    if (!requestedMeta) {
        throw new Error(`Unknown model: ${requested}`);
    }

    // Try the requested provider first.
    let adapter = adapterFor(requestedMeta.provider);
    let actualMeta = requestedMeta;
    let fellBackFrom: ModelId | undefined;

    if (!adapter) {
        // Fallback chain: Anthropic Sonnet 4.6 → Groq Llama 3.3.
        const fallbackOrder: ModelId[] = ['claude-sonnet-4-6', 'llama-3.3-70b-versatile'];
        for (const fbId of fallbackOrder) {
            const fbMeta = MODEL_LINEUP.find(m => m.id === fbId);
            if (!fbMeta) continue;
            const fbAdapter = adapterFor(fbMeta.provider);
            if (fbAdapter) {
                adapter = fbAdapter;
                actualMeta = fbMeta;
                fellBackFrom = requested;
                break;
            }
        }
    }

    if (!adapter) {
        const err: any = new Error('No LLM providers configured (set ANTHROPIC_API_KEY or GROQ_API_KEY)');
        err.statusCode = 503;
        throw err;
    }

    const response = await adapter.chat(req, actualMeta);
    return {
        response,
        actualModel: actualMeta.id,
        fellBackFrom,
    };
}

/**
 * Diagnostic — which providers are wired up right now.
 */
export function brokerStatus(): { provider: Provider; configured: boolean }[] {
    return ADAPTERS.map(a => ({
        provider: a.provider,
        configured: a.isConfigured(),
    }));
}
