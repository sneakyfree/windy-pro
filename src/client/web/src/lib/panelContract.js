// windy.panel.v1 — mirror of DASHBOARD_API_CONTRACT.md §2.3/§2.8. Do not edit locally.
// (JS mirror of the canonical TS block — this app is plain JSX. Shapes verbatim:)
//
//   export const PANEL_BASE = 'https://chat.windychat.ai/api/v1/agent/panel';
//   export type PanelCapability = 'sliders' | 'personality.history' | 'identity'
//     | 'memory' | 'skills' | 'costs' | 'personality.versioning'; // future growth
//   export interface PanelSummary {
//     contract: 'windy.panel.v1';
//     kind: 'cloud' | 'local';
//     capabilities: PanelCapability[];
//     agent: { agent_matrix_id: string; agent_name: string; passport_number: string | null;
//              hatched_at: string; status: 'alive' | 'sleeping' | 'unknown';
//              last_event_at: string | null; replies_sent: number };
//     personality: { sliders: Record<string, number>; preset: string };
//   }
//   export interface SliderInfo { label: string; description: string; impact_low: string;
//     impact_high: string; value: number; cost_per_point: number; }
//   export type SlidersResponse    = { sliders: Record<string, number> };
//   export type SliderInfoResponse = { sliders: Record<string, SliderInfo> };
//   export interface HistoryRow { id: number; key: string; soul_id: string;
//     old_value: string | null; new_value: string | null; changed_by: string; created_at: string; }

export const PANEL_BASE = import.meta.env.VITE_PANEL_BASE
    || 'https://chat.windychat.ai/api/v1/agent/panel'

// The gateway backend's real 8 presets (windy-agent control_panel.py
// PRESETS), restricted to the 8 supported cloud sliders (§2.5). Applied
// client-side as sequential PUT /sliders/:name calls — no preset endpoint.
export const PRESETS = {
    buddy:      { personality: 8, humor: 7, warmth: 7, formality: 4, verbosity: 6, proactivity: 7, creativity: 6, response_length: 5 },
    engineer:   { personality: 3, humor: 1, warmth: 3, formality: 5, verbosity: 4, proactivity: 3, creativity: 3, response_length: 7 },
    powerhouse: { personality: 9, humor: 7, warmth: 7, formality: 5, verbosity: 7, proactivity: 8, creativity: 7, response_length: 9 },
    coder:      { personality: 1, humor: 0, warmth: 1, formality: 2, verbosity: 3, proactivity: 3, creativity: 4, response_length: 10 },
    friend:     { personality: 10, humor: 3, warmth: 10, formality: 2, verbosity: 7, proactivity: 8, creativity: 5, response_length: 6 },
    writer:     { personality: 7, humor: 5, warmth: 6, formality: 5, verbosity: 9, proactivity: 6, creativity: 10, response_length: 9 },
    researcher: { personality: 2, humor: 0, warmth: 2, formality: 7, verbosity: 7, proactivity: 5, creativity: 3, response_length: 8 },
    silent:     { personality: 1, humor: 0, warmth: 3, formality: 5, verbosity: 1, proactivity: 1, creativity: 3, response_length: 2 },
}

// Honest empty-state copy (§2.6) for capabilities the cloud agent doesn't
// have yet. Rendered whenever a capability is absent from summary.capabilities.
export const EMPTY_STATES = {
    memory: "Your agent's deep memory is coming. Today it remembers your recent conversation — its long-term memory arrives with the soul-memory upgrade.",
    skills: 'Skills live on self-hosted agents today. Cloud agents will learn skills in a future update.',
    costs: 'Included in your plan — your cloud agent’s thinking is on the house.',
    local_only: 'Your agent lives on your own machine. Manage it there with `windy start` → localhost:3000 for now — remote control from here is coming.',
}
