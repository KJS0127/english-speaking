import { sendTurn } from '../../src/ai/gemini';
import { AuthError, QuotaError, NetworkError, BadResponseError, RateLimitError, FatalApiError } from '../../src/ai/errors';
import { SCENARIOS } from '../../src/scenarios';
import { CONFIG } from '../../src/config';
import type { TurnRequest } from '../../src/ai/prompt';

const req: TurnRequest = { scenario: SCENARIOS[0], mode: 'car', level: 3, history: [], weakPhrases: [], audioWav: new Uint8Array([1]) };
const ok = (obj: unknown) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status: 200 });
const status = (s: number, body = '{}') => vi.fn().mockResolvedValue(new Response(body, { status: s }));

test('posts to model endpoint with x-goog-api-key header', async () => {
  const f = vi.fn().mockResolvedValue(ok({ transcript: 'a', aiLine: 'b' }));
  await sendTurn(req, 'KEY', f);
  const [url, init] = f.mock.calls[0];
  expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.model}:generateContent`);
  expect(init.method).toBe('POST');
  expect(init.headers['x-goog-api-key']).toBe('KEY');
});

test('returns parsed result from candidates[0].content.parts[0].text', async () => {
  const r = await sendTurn(req, 'KEY', vi.fn().mockResolvedValue(ok({ transcript: 'a', aiLine: 'b', command: 'repeat' })));
  expect(r.aiLine).toBe('b');
  expect(r.command).toBe('repeat');
});

test('maps 400 API_KEY_INVALID and 401/403 to AuthError', async () => {
  const bad = JSON.stringify({ error: { message: 'API key not valid', details: [{ reason: 'API_KEY_INVALID' }] } });
  await expect(sendTurn(req, 'K', status(400, bad))).rejects.toBeInstanceOf(AuthError);
  await expect(sendTurn(req, 'K', status(401))).rejects.toBeInstanceOf(AuthError);
  await expect(sendTurn(req, 'K', status(403))).rejects.toBeInstanceOf(AuthError);
});

test('maps other 400 to BadResponseError', async () => {
  await expect(sendTurn(req, 'K', status(400, '{"error":{"message":"bad audio"}}'))).rejects.toBeInstanceOf(BadResponseError);
});

test('maps daily 429 to QuotaError', async () => {
  const body = JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } });
  await expect(sendTurn(req, 'K', status(429, body))).rejects.toBeInstanceOf(QuotaError);
});

test('maps per-minute 429 to RateLimitError with retry delay', async () => {
  const body = JSON.stringify({ error: { details: [
    { violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] },
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '17s' },
  ] } });
  const err = await sendTurn(req, 'K', status(429, body)).catch((e) => e);
  expect(err).toBeInstanceOf(RateLimitError);
  expect(err.retryAfterMs).toBe(17000);
});

test('maps unknown 429 to RateLimitError', async () => {
  await expect(sendTurn(req, 'K', status(429))).rejects.toBeInstanceOf(RateLimitError);
});

test('maps 404 (model gone) to FatalApiError', async () => {
  await expect(sendTurn(req, 'K', status(404, '{"error":{"message":"models/x is not found"}}'))).rejects.toBeInstanceOf(FatalApiError);
});

test('passes an abort signal with a timeout to fetch', async () => {
  const f = vi.fn().mockResolvedValue(ok({ transcript: 'a', aiLine: 'b' }));
  await sendTurn(req, 'K', f);
  expect(f.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});

test('aborting the caller signal rejects with NetworkError', async () => {
  const ctrl = new AbortController();
  const f = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_r, rej) => {
    init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
  }));
  const p = sendTurn(req, 'K', f as unknown as typeof fetch, ctrl.signal);
  ctrl.abort();
  await expect(p).rejects.toBeInstanceOf(NetworkError);
});

test('disables thinking to keep latency low', async () => {
  const f = vi.fn().mockResolvedValue(ok({ transcript: 'a', aiLine: 'b' }));
  await sendTurn(req, 'K', f);
  expect(JSON.parse(f.mock.calls[0][1].body).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
});

test('maps 5xx to NetworkError (retryable)', async () => {
  await expect(sendTurn(req, 'K', status(503))).rejects.toBeInstanceOf(NetworkError);
});

test('maps fetch rejection to NetworkError', async () => {
  await expect(sendTurn(req, 'K', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))).rejects.toBeInstanceOf(NetworkError);
});

test('maps non-JSON text to BadResponseError', async () => {
  const r = new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }), { status: 200 });
  await expect(sendTurn(req, 'K', vi.fn().mockResolvedValue(r))).rejects.toBeInstanceOf(BadResponseError);
});

test('maps missing candidates to BadResponseError', async () => {
  await expect(sendTurn(req, 'K', status(200))).rejects.toBeInstanceOf(BadResponseError);
});
