/**
 * Fake OpenAI-compatible chat-completions server (T029).
 *
 * One `node:http` server speaking the exact `POST {base}/chat/completions`
 * surface the provider adapter (T076) will use: no SDK, no streaming, no
 * tools. Defaults to a contract-valid review payload so validation tests
 * stay short; callers override `content` for malformed-JSON, tool-call
 * escapes, or schema violations.
 */
import http, { type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';

const FAKE_MODEL = 'fixture-model';
const FAKE_USAGE = { prompt_tokens: 321, completion_tokens: 87 };

export interface FindingFixture {
  readonly path: string;
  readonly side: 'LEFT' | 'RIGHT';
  readonly line: number;
  readonly severity: 'critical' | 'high' | 'medium' | 'low' | 'nit';
  readonly category:
    | 'bug'
    | 'security'
    | 'performance'
    | 'concurrency'
    | 'error_handling'
    | 'api_contract'
    | 'tests'
    | 'maintainability'
    | 'style';
  readonly title: string;
  readonly explanation: string;
  readonly confidence: number;
  readonly quoted_code?: string;
  readonly suggestion?: string;
}

export const DEFAULT_REVIEW_CONTENT = {
  verdict: 'comment',
  summary: 'Fixture review: a small change with one injected finding.',
  findings: [
    {
      path: 'src/index.js',
      side: 'RIGHT',
      line: 1,
      severity: 'high',
      category: 'bug',
      title: 'Fixture finding',
      explanation: 'Deterministic explanation emitted by the fake provider.',
      confidence: 0.9,
    },
  ] satisfies FindingFixture[],
  tests_missing: ['fixture: add a test'],
  files_reviewed: ['src/index.js'],
  files_skipped: [],
};

export interface ChatCompletionRequest {
  readonly model: string;
  readonly messages: ReadonlyArray<{ role: string; content: string }>;
  readonly responseFormat: unknown;
}

export interface FakeAiRequestRecord {
  readonly path: string;
  readonly authorizationWasPresent: boolean;
  readonly body: ChatCompletionRequest;
}

export interface FakeAiServer {
  /** Base URL ending in `/v1`, ready for AI_BASE_URL. */
  readonly baseUrl: string;
  readonly requests: ReadonlyArray<FakeAiRequestRecord>;
  readonly close: () => Promise<void>;
}

export interface FakeAiOptions {
  /** Chat content string; defaults to the contract-valid fixture above. */
  readonly content?: string;
  /** Non-200 status for provider-failure paths; body becomes OpenAI-style error. */
  readonly status?: number;
  /** When true, no response body is written (client timeout path). */
  readonly hang?: boolean;
  /** Extra delay before responding. */
  readonly latencyMs?: number;
}

export async function startFakeAiServer(options: FakeAiOptions = {}): Promise<FakeAiServer> {
  const requests: FakeAiRequestRecord[] = [];

  const listener: RequestListener = (request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      let parsed: ChatCompletionRequest = { model: FAKE_MODEL, messages: [], responseFormat: null };
      try {
        parsed = JSON.parse(rawBody) as ChatCompletionRequest;
      } catch {
        // Provider tolerates junk bodies with a 400; adapter must surface it.
        response.statusCode = 400;
        response.end(JSON.stringify({ error: { message: 'fixture: invalid JSON body' } }));
        return;
      }
      requests.push({
        path: request.url ?? '',
        authorizationWasPresent: (request.headers.authorization ?? '') !== '',
        body: parsed,
      });

      if (options.hang === true) {
        return; // never responds; the adapter timeout produces the failure
      }
      const respond = (): void => {
        if (options.status !== undefined && options.status !== 200) {
          response.statusCode = options.status;
          response.end(
            JSON.stringify({
              error: { message: `fixture: forced provider failure (${options.status})` },
            }),
          );
          return;
        }
        const content = options.content ?? JSON.stringify(DEFAULT_REVIEW_CONTENT);
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            id: `chatcmpl-fixture-${requests.length}`,
            object: 'chat.completions',
            created: Math.floor(Date.now() / 1000),
            model: parsed.model,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content },
                finish_reason: 'stop',
              },
            ],
            usage: { ...FAKE_USAGE },
          }),
        );
      };
      if ((options.latencyMs ?? 0) > 0) {
        setTimeout(respond, options.latencyMs);
      } else {
        respond();
      }
    });
  };

  const server = http.createServer(listener);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  return {
    baseUrl,
    requests,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    },
  };
}
