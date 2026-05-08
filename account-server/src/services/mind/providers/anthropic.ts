/**
 * Anthropic provider adapter for Windy Mind.
 *
 * Supports both auth methods (auto-detected by token prefix):
 * - sk-ant-api03-* (regular API key) → x-api-key header, plain string system
 * - sk-ant-oat01-* (OAuth from Claude Pro/Max) → Bearer auth + oauth-2025-04-20
 *   beta header + system as content-block array with first block exactly
 *   "You are Claude Code, Anthropic's official CLI for Claude."
 *   (per memory reference_anthropic_oauth_gate.md)
 *
 * Used by Phase A M1 spike pattern; mirrored here so /api/v1/mind/chat
 * can broker for Claude models.
 */
import { v4 as uuidv4 } from 'uuid';
import type {
    ChatMessage,
    MindChatRequest,
    MindChatResponse,
    ModelMetadata,
    ProviderAdapter,
} from '../types';

interface AnthropicMessage {
    role: 'user' | 'assistant';
    content: string;
}

export class AnthropicAdapter implements ProviderAdapter {
    readonly provider = 'anthropic' as const;

    isConfigured(): boolean {
        return !!process.env.ANTHROPIC_API_KEY;
    }

    async chat(req: MindChatRequest, model: ModelMetadata): Promise<MindChatResponse> {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            throw new Error('ANTHROPIC_API_KEY not configured');
        }

        const isOAuth = apiKey.startsWith('sk-ant-oat01');

        // Anthropic doesn't allow 'system' messages in the messages array;
        // they go in the top-level system field. Split.
        const systemPrompts = req.messages.filter(m => m.role === 'system');
        const conversation: AnthropicMessage[] = req.messages
            .filter(m => m.role !== 'system')
            .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

        const userSystemPrompt = systemPrompts.map(m => m.content).join('\n\n').trim();

        let systemField: string | { type: 'text'; text: string }[];
        const headers: Record<string, string> = {
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        };

        if (isOAuth) {
            // OAuth gate: first system block must be EXACTLY this string.
            const blocks: { type: 'text'; text: string }[] = [
                { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." },
            ];
            if (userSystemPrompt) blocks.push({ type: 'text', text: userSystemPrompt });
            systemField = blocks;
            headers['Authorization'] = `Bearer ${apiKey}`;
            headers['anthropic-beta'] = 'oauth-2025-04-20';
        } else {
            systemField = userSystemPrompt;
            headers['x-api-key'] = apiKey;
        }

        const body = {
            model: model.id,
            max_tokens: req.max_tokens ?? model.max_tokens,
            temperature: req.temperature,
            system: systemField,
            messages: conversation,
        };

        const resp = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`Anthropic API ${resp.status}: ${errText.slice(0, 500)}`);
        }

        const data: any = await resp.json();
        const contentBlocks: { type: string; text?: string }[] = data.content || [];
        const text = contentBlocks
            .filter(b => b.type === 'text')
            .map(b => b.text || '')
            .join('');

        const finishReason = data.stop_reason === 'end_turn' ? 'stop'
            : data.stop_reason === 'max_tokens' ? 'length'
            : data.stop_reason === 'tool_use' ? 'tool_use'
            : 'stop';

        return {
            id: data.id || uuidv4(),
            model: model.id,
            choices: [{
                message: { role: 'assistant', content: text },
                finish_reason: finishReason,
            }],
            usage: data.usage ? {
                prompt_tokens: data.usage.input_tokens,
                completion_tokens: data.usage.output_tokens,
                total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
            } : undefined,
            _provider: 'anthropic',
        };
    }
}
