/**
 * Typed error hierarchy. Every service throws these; web surfaces them cleanly.
 */

export class NexusError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, statusCode = 500, details?: Record<string, unknown>) {
    super(message);
    this.name = "NexusError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export class ValidationError extends NexusError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("VALIDATION_ERROR", message, 400, details);
  }
}

export class NotFoundError extends NexusError {
  constructor(resource: string, id: string) {
    super("NOT_FOUND", `${resource} not found: ${id}`, 404, { resource, id });
  }
}

export class UnauthorizedError extends NexusError {
  constructor(message = "Unauthorized") {
    super("UNAUTHORIZED", message, 401);
  }
}

export class RateLimitError extends NexusError {
  constructor(retryAfterSec: number) {
    super("RATE_LIMIT", "Rate limit exceeded", 429, { retryAfterSec });
  }
}

export class ToolExecutionError extends NexusError {
  constructor(tool: string, reason: string) {
    super("TOOL_EXECUTION_FAILED", `Tool ${tool} failed: ${reason}`, 500, { tool, reason });
  }
}

export class LlmProviderError extends NexusError {
  constructor(provider: string, reason: string) {
    super("LLM_PROVIDER_ERROR", `${provider}: ${reason}`, 502, { provider, reason });
  }
}

export class SafetyViolationError extends NexusError {
  constructor(policy: string, details?: Record<string, unknown>) {
    super("SAFETY_VIOLATION", `Policy violation: ${policy}`, 403, details);
  }
}
