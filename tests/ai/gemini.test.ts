import { sendTurn, resetModelChoice } from '../../src/ai/gemini';
import { AuthError, QuotaError, NetworkError, BadResponseError, RateLimitError, FatalApiError } from '../../src/ai/errors';
import { SCENARIOS } from '../../src/scenarios';
import { CONFIG } from '../../src/config';
import type { TurnRequest } from '../../src/ai/prompt';

const req: TurnRequest = { scenario: SCENARIOS[0], mode: 'car', level: 3, history: [], weakPhrases: [], audioWav: new Uint8Array([1]) };
const ok = (obj: unknown) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status: 200 });
const status = (s: number, body = '{}') => vi.fn(async () => new Response(body, { status: s }));

test('posts to model endpoint with x-goog-api-key header', async () => {
  const f = vi.fn().mockResolvedValue(ok({ transcript: 'a', aiLine: 'b' }));
  await sendTurn(req, 'KEY', f);
  const [url, init] = f.mock.calls[0];
  expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.models[0]}:generateContent`);
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

test('uses a current model and JSON schema field, no thinking config', async () => {
  expect(CONFIG.models[0]).toBe('gemini-3.5-flash-lite');
  const f = vi.fn().mockResolvedValue(ok({ transcript: 'a', aiLine: 'b' }));
  await sendTurn(req, 'K', f);
  const gc = JSON.parse(f.mock.calls[0][1].body).generationConfig;
  expect(gc.thinkingConfig).toBeUndefined();
  expect(gc.responseSchema).toBeUndefined();
  expect(gc.responseJsonSchema.type).toBe('object');
});

test('falls back to the next model when one is gone, and remembers it', async () => {
  resetModelChoice();
  const f = vi.fn((url: string) =>
    Promise.resolve(url.includes(CONFIG.models[0]) ? new Response('{"error":{"message":"not found"}}', { status: 404 }) : ok({ transcript: 'a', aiLine: 'b' })),
  );
  const r = await sendTurn(req, 'K', f as unknown as typeof fetch);
  expect(r.aiLine).toBe('b');
  expect(f.mock.calls[1][0]).toContain(CONFIG.models[1]);
  await sendTurn(req, 'K', f as unknown as typeof fetch);
  expect(f.mock.calls[2][0]).toContain(CONFIG.models[1]);
  resetModelChoice();
});

test('fatal error message includes the API message when all models fail', async () => {
  resetModelChoice();
  const err = await sendTurn(req, 'K', status(400, '{"error":{"status":"INVALID_ARGUMENT","message":"Unknown name responseJsonSchema"}}')).catch((e) => e);
  expect(err).toBeInstanceOf(FatalApiError);
  expect(err.message).toContain('Unknown name responseJsonSchema');
  resetModelChoice();
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

test('server busy (503) on one model falls back to the next model', async () => {
  resetModelChoice();
  const f = vi.fn(async (url: string) =>
    url.includes(CONFIG.models[0]) ? new Response('{"error":{"message":"overloaded"}}', { status: 503 }) : ok({ transcript: 'a', aiLine: 'b' }),
  );
  const r = await sendTurn(req, 'K', f as unknown as typeof fetch);
  expect(r.aiLine).toBe('b');
  resetModelChoice();
});

test('server busy on every model is a NetworkError saying the server is busy', async () => {
  resetModelChoice();
  const err = await sendTurn(req, 'K', status(503)).catch((e) => e);
  expect(err).toBeInstanceOf(NetworkError);
  expect(err.reason).toBe('busy');
  resetModelChoice();
});

test('timeouts and fetch failures carry a reason', async () => {
  const t = await sendTurn(req, 'K', vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError'))).catch((e) => e);
  expect(t.reason).toBe('timeout');
  const o = await sendTurn(req, 'K', vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))).catch((e) => e);
  expect(o.reason).toBe('offline');
});
