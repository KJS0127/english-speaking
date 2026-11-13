import { CONFIG } from '../config';
import { AuthError, BadResponseError, FatalApiError, NetworkError, QuotaError, RateLimitError } from './errors';
import { buildBody, type TurnRequest } from './prompt';
import { parseTurnResult, type TurnResult } from './schema';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

function retryDelayMs(text: string): number | null {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(text);
  return m ? Math.round(Number(m[1]) * 1000) : null;
}

/** Caller signal + timeout, without relying on AbortSignal.any (missing on older iOS). */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), ms);
  const onAbort = () => ctrl.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  ctrl.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return ctrl.signal;
}

export async function sendTurn(
  req: TurnRequest,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<TurnResult> {
  const combined = withTimeout(signal, CONFIG.requestTimeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(`${ENDPOINT}/${CONFIG.model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(buildBody(req)),
      signal: combined,
    });
  } catch (e) {
    throw new NetworkError(String(e));
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) throw new AuthError(text);
    if (res.status === 400 && /API_KEY_INVALID|API key not valid|API key expired/i.test(text)) throw new AuthError(text);
    if (res.status === 429) {
      if (/PerDay/i.test(text)) throw new QuotaError(text);
      throw new RateLimitError(text, retryDelayMs(text));
    }
    if (res.status >= 500) throw new NetworkError(`HTTP ${res.status}`);
    if (res.status === 404 || /INVALID_ARGUMENT|FAILED_PRECONDITION/.test(text)) throw new FatalApiError(`HTTP ${res.status}: ${text}`);
    throw new BadResponseError(`HTTP ${res.status}: ${text}`);
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new BadResponseError('response body is not JSON');
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') throw new BadResponseError('no candidate text');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BadResponseError('candidate text is not JSON');
  }
  return parseTurnResult(parsed);
}
