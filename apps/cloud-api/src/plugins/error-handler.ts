import type { FastifyPluginAsync, FastifyInstance, FastifyRequest, FastifyReply, FastifyError } from 'fastify';

/**
 * Standard base API error class following CAPS Master Plan §5.4.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuthError extends ApiError {
  constructor(
    statusCode: 401 | 403,
    code: 'UNAUTHORIZED' | 'TOKEN_EXPIRED' | 'INVALID_TOKEN' | 'FORBIDDEN' | 'FORBIDDEN_ROLE',
    message: string,
    details?: unknown
  ) {
    super(statusCode, code, message, details);
    this.name = 'AuthError';
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(400, 'INVALID_PAYLOAD', message, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Resource not found', details?: unknown) {
    super(404, 'NOT_FOUND', message, details);
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends ApiError {
  constructor(message = 'Rate limit exceeded. Please try again later.', details?: unknown) {
    super(429, 'RATE_LIMIT_EXCEEDED', message, details);
    this.name = 'RateLimitError';
  }
}

export class InternalServerError extends ApiError {
  constructor(message = 'Internal server error occurred.', details?: unknown) {
    super(500, 'INTERNAL_ERROR', message, details);
    this.name = 'InternalServerError';
  }
}

export function registerErrorHandlers(fastify: FastifyInstance): void {
  // Global 404 Handler
  fastify.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const requestId =
      request.requestId ||
      (typeof request.headers['x-request-id'] === 'string'
        ? request.headers['x-request-id']
        : 'unknown-request');

    return reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method}:${request.url} not found`,
        request_id: requestId
      }
    });
  });

  // Global Error Handler
  fastify.setErrorHandler((error: FastifyError | ApiError | Error, request: FastifyRequest, reply: FastifyReply) => {
    const requestId =
      request.requestId ||
      (typeof request.headers['x-request-id'] === 'string'
        ? request.headers['x-request-id']
        : 'unknown-request');

    // 1. Explicit ApiError or derived instance
    if (error instanceof ApiError) {
      const responsePayload: {
        error: {
          code: string;
          message: string;
          request_id: string;
          details?: unknown;
        };
      } = {
        error: {
          code: error.code,
          message: error.message,
          request_id: requestId,
          ...(error.details !== undefined ? { details: error.details } : {})
        }
      };
      return reply.status(error.statusCode).send(responsePayload);
    }

    // 2. Fastify Validation Error
    const fastifyErr = error as FastifyError;
    if (fastifyErr.validation || fastifyErr.statusCode === 400) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PAYLOAD',
          message: fastifyErr.message || 'Validation failed for request.',
          request_id: requestId,
          ...(fastifyErr.validation ? { details: fastifyErr.validation } : {})
        }
      });
    }

    // 3. Fastify Not Found error (status 404)
    if (fastifyErr.statusCode === 404) {
      return reply.status(404).send({
        error: {
          code: 'NOT_FOUND',
          message: fastifyErr.message || 'Resource not found',
          request_id: requestId
        }
      });
    }

    // 4. Custom module errors with code/statusCode
    const customErr = error as { statusCode?: number; code?: string; message?: string; details?: unknown };
    if (customErr.statusCode && customErr.code) {
      return reply.status(customErr.statusCode).send({
        error: {
          code: customErr.code,
          message: customErr.message || 'Error processing request',
          request_id: requestId,
          ...(customErr.details !== undefined ? { details: customErr.details } : {})
        }
      });
    }

    // 5. Unhandled / 500 internal errors
    request.log.error(error);
    const statusCode = typeof fastifyErr.statusCode === 'number' && fastifyErr.statusCode >= 400 ? fastifyErr.statusCode : 500;
    const code = statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';

    return reply.status(statusCode).send({
      error: {
        code,
        message: statusCode >= 500 ? 'An unexpected internal error occurred.' : (error.message || 'An error occurred.'),
        request_id: requestId
      }
    });
  });
}

export const errorHandlerPlugin: FastifyPluginAsync = async fastify => {
  registerErrorHandlers(fastify);
};

(errorHandlerPlugin as unknown as Record<symbol, boolean>)[Symbol.for('skip-override')] = true;
