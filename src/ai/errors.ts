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
export type NetworkReason = 'offline' | 'timeout' | 'busy';
/** Retryable transport problem: no connection, too slow, or the AI server is busy (5xx). */
export class NetworkError extends Error {
  name = 'NetworkError';
  constructor(message: string, public reason: NetworkReason = 'offline') {
    super(message);
  }
}
/** One bad reply; asking the learner to repeat may help. */
export class BadResponseError extends Error {
  name = 'BadResponseError';
}
/** The request can never succeed as configured (model gone, bad request shape). */
export class FatalApiError extends Error {
  name = 'FatalApiError';
}
