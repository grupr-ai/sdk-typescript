import type { APIErrorItem } from './types';

export class GruprError extends Error {
  readonly code: string;
  readonly status: number;
  readonly errors: APIErrorItem[];
  readonly requestId?: string;

  constructor(
    message: string,
    code: string,
    status: number,
    errors: APIErrorItem[] = [],
    requestId?: string,
  ) {
    super(message);
    this.name = 'GruprError';
    this.code = code;
    this.status = status;
    this.errors = errors;
    this.requestId = requestId;
  }
}

export class GruprAuthError extends GruprError {
  constructor(message: string, errors: APIErrorItem[] = [], requestId?: string) {
    super(message, 'unauthenticated', 401, errors, requestId);
    this.name = 'GruprAuthError';
  }
}

export class GruprRateLimitError extends GruprError {
  readonly retryAfter: number;

  constructor(
    message: string,
    retryAfter: number,
    errors: APIErrorItem[] = [],
    requestId?: string,
  ) {
    super(message, 'rate_limited', 429, errors, requestId);
    this.name = 'GruprRateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class GruprQuotaExceededError extends GruprError {
  constructor(message: string, errors: APIErrorItem[] = [], requestId?: string) {
    super(message, 'quota_exceeded', 429, errors, requestId);
    this.name = 'GruprQuotaExceededError';
  }
}

export class GruprNotFoundError extends GruprError {
  constructor(message: string, errors: APIErrorItem[] = [], requestId?: string) {
    super(message, 'not_found', 404, errors, requestId);
    this.name = 'GruprNotFoundError';
  }
}

export class GruprValidationError extends GruprError {
  constructor(message: string, errors: APIErrorItem[] = [], requestId?: string) {
    super(message, 'validation_failed', 400, errors, requestId);
    this.name = 'GruprValidationError';
  }
}
