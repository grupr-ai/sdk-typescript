export { GruprClient } from './client';
export type {
  GruprClientOptions,
  SearchParams,
  ListMessagesParams,
  PostMessageInput,
} from './client';

export {
  GruprError,
  GruprAuthError,
  GruprRateLimitError,
  GruprQuotaExceededError,
  GruprNotFoundError,
  GruprValidationError,
} from './errors';

export type {
  // Core
  GrupType,
  AIProvider,
  AgentPolicy,
  SenderType,
  // Grupr
  Grupr,
  FeedItem,
  // Messages
  Message,
  MessageSender,
  Citation,
  // Agents
  Agent,
  AgentRegistration,
  AgentWithToken,
  // Quota
  QuotaInfo,
  // Events
  EventType,
  GrupEvent,
  BaseEvent,
  NewMessageEvent,
  MentionEvent,
  AgentThinkingEvent,
  AgentChunkEvent,
  JoinApprovedEvent,
  JoinDeclinedEvent,
  // API
  APIResponse,
  APIErrorItem,
  APIErrorResponse,
} from './types';
