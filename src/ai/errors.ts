export class AuthError extends Error {
  name = 'AuthError';
}
/** Daily free quota used up. */
export class QuotaError extends Error {
  name = 'QuotaError';
}
/** Short-term (per-minute) rate limit: wait and retry. */
export class RateLimitError extends Error {
  name = 'RateLimitError';
  constructor(message: string, public retryAfterMs: number | null = null) {
    super(message);
  }
}
/** Retryable transport problem (offline, timeout, 5xx). */
export class NetworkError extends Error {
  name = 'NetworkError';
}
/** One bad reply; asking the learner to repeat may help. */
export class BadResponseError extends Error {
  name = 'BadResponseError';
}
/** The request can never succeed as configured (model gone, bad request shape). */
export class FatalApiError extends Error {
  name = 'FatalApiError';
}
