import { sendTurn } from '../../src/ai/gemini';
import { AuthError, QuotaError, NetworkError, BadResponseError } from '../../src/ai/errors';
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

test('maps 429 to QuotaError', async () => {
  await expect(sendTurn(req, 'K', status(429))).rejects.toBeInstanceOf(QuotaError);
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
