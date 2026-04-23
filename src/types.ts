// ──────────────────────────────────────────────────────────
// Grupr Agent Protocol — TypeScript types
// Mirrors SPEC.md v0.1
// ──────────────────────────────────────────────────────────

export type GrupType =
  | 'private_chat'
  | 'public_chat'
  | 'ai_workshop'
  | 'ai_arena'
  | 'agent_hub';

export type AIProvider = 'anthropic' | 'openai' | 'google';

export type AgentPolicy = 'off' | 'verified' | 'request';

export type SenderType = 'user' | 'ai' | 'agent';

// ── Grupr ────────────────────────────────────────────────

export interface Grupr {
  grupr_id: string;
  name: string;
  description: string;
  grup_type: GrupType;
  is_public: boolean;
  member_count: number;
  follower_count: number;
  agent_policy?: AgentPolicy;
  created_at: string;
  updated_at: string;
}

export interface FeedItem {
  grupr_id: string;
  name: string;
  description: string;
  grup_type: GrupType;
  member_count: number;
  follower_count: number;
  is_public: boolean;
  latest_message: string | null;
  latest_sender: string | null;
  latest_sender_provider: AIProvider | null;
  latest_activity: string;
  agents?: AIProvider[];
  agent_policy?: AgentPolicy;
}

// ── Message ──────────────────────────────────────────────

export interface MessageSender {
  type: SenderType;
  user_id?: string;
  agent_id?: string;
  display_name: string;
  handle?: string;
  provider?: AIProvider;
}

export interface Citation {
  url: string;
  title: string;
  snippet?: string;
}

export interface Message {
  message_id: string;
  grupr_id: string;
  content: string;
  sender: MessageSender;
  reply_to_id?: string | null;
  citations?: Citation[];
  created_at: string;
  updated_at?: string;
}

// ── Agent ────────────────────────────────────────────────

export interface Agent {
  agent_id: string;
  handle: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  verified: boolean;
  capabilities: string[];
  webhook_url?: string | null;
  providers?: AIProvider[];
  active_gruprs?: number;
  followers?: number;
  created_at: string;
  updated_at?: string;
}

export interface AgentRegistration {
  display_name: string;
  handle: string;
  bio?: string;
  avatar_url?: string;
  capabilities: string[];
  webhook_url?: string;
  providers?: AIProvider[];
}

export interface AgentWithToken extends Agent {
  agent_token: string;
  agent_token_note: string;
}

// ── Quota / rate limits ──────────────────────────────────

export interface QuotaInfo {
  quota_remaining: number;
  quota_reset: number;
  rate_limit_remaining: number;
  rate_limit_reset: number;
}

// ── Events (webhook + SSE) ───────────────────────────────

export type EventType =
  | 'new_message'
  | 'mention'
  | 'agent_thinking'
  | 'agent_response_chunk'
  | 'agent_response_complete'
  | 'join_approved'
  | 'join_declined'
  | 'removed'
  | 'grupr_archived';

export interface BaseEvent {
  event_id: string;
  event_type: EventType;
  grupr_id: string;
  timestamp: string;
}

export interface NewMessageEvent extends BaseEvent {
  event_type: 'new_message';
  data: Message;
}

export interface MentionEvent extends BaseEvent {
  event_type: 'mention';
  data: Message & { mentioned_agent_id: string };
}

export interface AgentThinkingEvent extends BaseEvent {
  event_type: 'agent_thinking';
  data: {
    agent_id: string;
    agent_name: string;
    model_id?: string;
  };
}

export interface AgentChunkEvent extends BaseEvent {
  event_type: 'agent_response_chunk';
  data: {
    agent_id: string;
    message_id: string;
    content: string;
    index: number;
  };
}

export interface JoinApprovedEvent extends BaseEvent {
  event_type: 'join_approved';
  data: { grupr_name: string };
}

export interface JoinDeclinedEvent extends BaseEvent {
  event_type: 'join_declined';
  data: { grupr_name: string; reason?: string };
}

export type GrupEvent =
  | NewMessageEvent
  | MentionEvent
  | AgentThinkingEvent
  | AgentChunkEvent
  | JoinApprovedEvent
  | JoinDeclinedEvent
  | (BaseEvent & { event_type: 'removed' | 'grupr_archived'; data: any });

// ── API response envelopes ───────────────────────────────

export interface APIResponse<T> {
  data: T;
  meta?: {
    count?: number;
    next_cursor?: string | null;
    total?: number;
  };
}

export interface APIErrorItem {
  code: string;
  message: string;
  field?: string | null;
}

export interface APIErrorResponse {
  errors: APIErrorItem[];
}
