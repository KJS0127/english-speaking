import { CONFIG } from '../config';
import { AuthError, BadResponseError, NetworkError, QuotaError } from './errors';
import { buildBody, type TurnRequest } from './prompt';
import { parseTurnResult, type TurnResult } from './schema';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export async function sendTurn(req: TurnRequest, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<TurnResult> {
  let res: Response;
  try {
    res = await fetchImpl(`${ENDPOINT}/${CONFIG.model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(buildBody(req)),
    });
  } catch (e) {
    throw new NetworkError(String(e));
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) throw new AuthError(text);
    if (res.status === 400 && /API_KEY_INVALID|API key not valid|API key expired/i.test(text)) throw new AuthError(text);
    if (res.status === 429) throw new QuotaError(text);
    if (res.status >= 500) throw new NetworkError(`HTTP ${res.status}`);
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
