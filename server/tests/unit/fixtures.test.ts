import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createBareRepoWithPullRequests } from '../fixtures/git.js';
import { createGithubFixtureServer, GITHUB_ORIGIN } from '../fixtures/github.js';
import { DEFAULT_REVIEW_CONTENT, startFakeAiServer } from '../fixtures/ai.js';

const execFileP = promisify(execFile);

describe('git fixture: bare repository with PR heads', () => {
  it('pushes one ref per pull request and records each head SHA', async () => {
    const fixture = await createBareRepoWithPullRequests([
      {
        number: 1,
        files: { 'src/a.js': 'let x = 1;\n' },
        baseFiles: { 'src/a.js': 'let x = 0;\n' },
      },
      { number: 2, files: { 'src/b.js': 'const y = 2;\n' } },
    ]);
    try {
      const ref1 = await execFileP('git', ['rev-parse', 'refs/pull/1/head'], {
        cwd: fixture.barePath,
      });
      const ref2 = await execFileP('git', ['rev-parse', 'refs/pull/2/head'], {
        cwd: fixture.barePath,
      });
      expect(ref1.stdout.trim()).toBe(fixture.heads[1]);
      expect(ref2.stdout.trim()).toBe(fixture.heads[2]);
      // The base branch diverges from each head (the merge-base source).
      const base = await execFileP('git', ['rev-parse', 'main'], { cwd: fixture.barePath });
      expect(base.stdout.trim()).toBe(fixture.baseSha);
      expect(fixture.heads[1]).not.toBe(fixture.baseSha);
    } finally {
      await fixture.dispose();
    }
  });

  it('removes the whole temporary root on dispose', async () => {
    const fixture = await createBareRepoWithPullRequests([
      { number: 3, files: { 'c.txt': 'hi\n' } },
    ]);
    const root = fixture.root;
    await fixture.dispose();
    const list = await execFileP(
      'node',
      ['-e', `require('fs').existsSync(process.argv[1]) ? process.exit(1) : ''`, root],
      {
        windowsHide: true,
      },
    );
    expect(list.stdout).toBe('');
  });
});

describe('MSW GitHub fixture', () => {
  const fixture = createGithubFixtureServer({
    viewerLogin: 'fixture-viewer',
    pullRequest: {
      owner: 'fixture-org',
      name: 'fixture-repo',
      number: 7,
      headRefOid: 'a'.repeat(40),
      state: 'OPEN',
      isDraft: false,
      viewerPermission: 'WRITE',
    },
  });

  beforeAll(() => fixture.start());
  afterAll(() => fixture.close());

  it('answers the viewer validation query', async () => {
    const response = await fetch(`${GITHUB_ORIGIN}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'query ViewerLogin { viewer { login } }' }),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { viewer: { login: string } } };
    expect(payload.data.viewer.login).toBe('fixture-viewer');
  });

  it('answers the HeadVerification operation with the configured PR', async () => {
    const response = await fetch(`${GITHUB_ORIGIN}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query:
          'query HeadVerification($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { headRefOid state isDraft viewerPermission } } }',
        variables: { owner: 'fixture-org', name: 'fixture-repo', number: 7 },
      }),
    });
    const payload = (await response.json()) as {
      data: { repository: { pullRequest: { headRefOid: string; state: string } | null } | null };
    };
    expect(payload.data.repository?.pullRequest?.state).toBe('OPEN');
    expect(payload.data.repository?.pullRequest?.viewerPermission).toBe('WRITE');
  });
});

describe('fake AI server fixture', () => {
  it('serves an OpenAI-shaped completion and records the request', async () => {
    const ai = await startFakeAiServer();
    try {
      const response = await fetch(`${ai.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-key' },
        body: JSON.stringify({
          model: 'fixture-model',
          messages: [{ role: 'user', content: 'review the diff' }],
        }),
      });
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
        usage: { prompt_tokens: number };
      };
      const reviewed = JSON.parse(
        payload.choices[0]?.message.content ?? '',
      ) as typeof DEFAULT_REVIEW_CONTENT;
      expect(reviewed.verdict).toBe('comment');
      expect(reviewed.findings).toHaveLength(1);
      expect(payload.usage.prompt_tokens).toBe(321);
      expect(ai.requests).toHaveLength(1);
      const recorded = ai.requests[0];
      expect(recorded?.path).toBe('/v1/chat/completions');
      expect(recorded?.authorizationWasPresent).toBe(true);
      expect(recorded?.body.messages[0]?.content).toBe('review the diff');
    } finally {
      await ai.close();
    }
  });

  it('can force provider failures and hangs', async () => {
    const failing = await startFakeAiServer({ status: 503 });
    try {
      const response = await fetch(`${failing.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'm', messages: [] }),
      });
      expect(response.status).toBe(503);
    } finally {
      await failing.close();
    }
    const hanging = await startFakeAiServer({ hang: true });
    // The socket is left open; close() drops it without a response.
    await hanging.close();
    expect(hanging.requests).toHaveLength(0);
  });
});
