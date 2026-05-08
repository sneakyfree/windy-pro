/**
 * Groq provider adapter — for Llama 3.3 70B Versatile.
 *
 * Groq exposes an OpenAI-compatible chat-completions API at
 * https://api.groq.com/openai/v1/chat/completions, so this adapter is
 * a near-pass-through. Auth via GROQ_API_KEY (gsk_...).
 */
import { v4 as uuidv4 } from 'uuid';
import type {
    MindChatRequest,
    MindChatResponse,
    ModelMetadata,
    ProviderAdapter,
} from '../types';

export class GroqAdapter implements ProviderAdapter {
    readonly provider = 'groq' as const;

    isConfigured(): boolean {
        return !!process.env.GROQ_API_KEY;
    }

    async chat(req: MindChatRequest, model: ModelMetadata): Promise<MindChatResponse> {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            throw new Error('GROQ_API_KEY not configured');
        }

        const body = {
            model: model.id,
            messages: req.messages,
            max_tokens: req.max_tokens ?? model.max_tokens,
            temperature: req.temperature,
        };

        const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`Groq API ${resp.status}: ${errText.slice(0, 500)}`);
        }

        const data: any = await resp.json();
        const choice = data.choices?.[0];
        const text = choice?.message?.content || '';

        return {
            id: data.id || uuidv4(),
            model: model.id,
            choices: [{
                message: { role: 'assistant', content: text },
                finish_reason: choice?.finish_reason || 'stop',
            }],
            usage: data.usage,
            _provider: 'groq',
        };
    }
}
