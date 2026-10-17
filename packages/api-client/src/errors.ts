export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    request_id?: string;
    details?: Record<string, unknown>;
  };
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly requestId?: string | undefined;
  public readonly details?: Record<string, unknown> | undefined;

  constructor(
    message: string,
    status: number,
    code = 'UNKNOWN_ERROR',
    requestId?: string | undefined,
    details?: Record<string, unknown> | undefined
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ApiAuthError extends ApiClientError {
  constructor(
    message: string,
    status: 401 | 403,
    code: string,
    requestId?: string | undefined,
    details?: Record<string, unknown> | undefined
  ) {
    super(message, status, code, requestId, details);
    this.name = 'ApiAuthError';
  }
}

export class ApiValidationError extends ApiClientError {
  constructor(
    message: string,
    status: 400 | 422,
    code: string,
    requestId?: string | undefined,
    details?: Record<string, unknown> | undefined
  ) {
    super(message, status, code, requestId, details);
    this.name = 'ApiValidationError';
  }
}

export class ApiNotFoundError extends ApiClientError {
  constructor(
    message: string,
    requestId?: string | undefined,
    details?: Record<string, unknown> | undefined
  ) {
    super(message, 404, 'NOT_FOUND', requestId, details);
    this.name = 'ApiNotFoundError';
  }
}

export class ApiConflictError extends ApiClientError {
  constructor(
    message: string,
    code: string,
    requestId?: string | undefined,
    details?: Record<string, unknown> | undefined
  ) {
    super(message, 409, code, requestId, details);
    this.name = 'ApiConflictError';
  }
}

export class ApiServerError extends ApiClientError {
  constructor(
    message: string,
    status: number,
    code: string,
    requestId?: string | undefined,
    details?: Record<string, unknown> | undefined
  ) {
    super(message, status, code, requestId, details);
    this.name = 'ApiServerError';
  }
}

export class ApiNetworkError extends ApiClientError {
  public readonly originalError?: Error | undefined;

  constructor(message: string, originalError?: Error | undefined) {
    super(message, 0, 'NETWORK_ERROR');
    this.name = 'ApiNetworkError';
    this.originalError = originalError;
  }
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

export function parseApiError(status: number, body: unknown): ApiClientError {
  let code = 'UNKNOWN_ERROR';
  let message = `Request failed with HTTP status ${status}`;
  let requestId: string | undefined;
  let details: Record<string, unknown> | undefined;

  if (body && typeof body === 'object' && 'error' in body) {
    const errorObj = (body as ApiErrorPayload).error;
    if (errorObj && typeof errorObj === 'object') {
      if (typeof errorObj.message === 'string') message = errorObj.message;
      if (typeof errorObj.code === 'string') code = errorObj.code;
      if (typeof errorObj.request_id === 'string') requestId = errorObj.request_id;
      if (errorObj.details && typeof errorObj.details === 'object') details = errorObj.details;
    }
  }

  if (status === 401 || status === 403) {
    return new ApiAuthError(message, status, code, requestId, details);
  }
  if (status === 400 || status === 422) {
    return new ApiValidationError(message, status, code, requestId, details);
  }
  if (status === 404) {
    return new ApiNotFoundError(message, requestId, details);
  }
  if (status === 409) {
    return new ApiConflictError(message, code, requestId, details);
  }
  if (status >= 500) {
    return new ApiServerError(message, status, code, requestId, details);
  }

  return new ApiClientError(message, status, code, requestId, details);
}
