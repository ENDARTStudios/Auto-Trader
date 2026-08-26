// src/lib/auth/errors.ts

export class UnauthorizedError extends Error {
  status = 401;
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  status = 403;
  permission?: string;
  constructor(permissionOrMessage?: string) {
    const msg = permissionOrMessage ? `Forbidden: ${permissionOrMessage}` : 'Forbidden';
    super(msg);
    this.name = 'ForbiddenError';
    this.permission = permissionOrMessage;
  }
}

export class RateLimitedError extends Error {
  status = 429;
  retryAfter: number;
  constructor(retryAfter = 60, message = 'Too Many Requests') {
    super(message);
    this.name = 'RateLimitedError';
    this.retryAfter = retryAfter;
  }
}
