/**
 * Temporary bare Git repositories with PR heads (T029).
 *
 * Mirror of the production sync layout: the dashboard clones a repository
 * bare and reads specific commits — never branches a user checkout. Each
 * "pull request" here is an isolated head pushed to `refs/pull/N/head` so
 * diff preparation (T032+) and tests exercise exact-commit fetches.
 *
 * Generated per test run in a temporary directory; dispose() removes it.
 */
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const GIT_IDENTITY = ['-c', 'user.name=fixture', '-c', 'user.email=fixture@local'];

async function git(args: readonly string[], options: { cwd?: string } = {}): Promise<string> {
  const { stdout } = await execFileP('git', args, {
    cwd: options.cwd,
    timeout: 30_000,
    windowsHide: true,
  });
  return stdout.trim();
}

export interface PrHeadSpec {
  /** Pull request number; pushed to `refs/pull/<number>/head`. */
  readonly number: number;
  /** File contents committed at this head; paths use forward slashes. */
  readonly files: Readonly<Record<string, string>>;
  readonly message?: string;
  /** Content of the base file so the base and head differ by default. */
  readonly baseFiles?: Readonly<Record<string, string>>;
}

export interface BareRepoFixture {
  readonly root: string;
  readonly barePath: string;
  /** First commit on the base branch (merge-base source). */
  readonly baseSha: string;
  /** Head SHA per pull request number. */
  readonly heads: Readonly<Record<number, string>>;
  readonly dispose: () => Promise<void>;
}

async function writeAndCommit(
  workDir: string,
  files: Readonly<Record<string, string>>,
  message: string,
): Promise<string> {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(workDir, ...file.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    // UTF-8 write; Git normalizes line endings for the object DB anyway.
    await execFileP(
      'node',
      ['-e', `require('fs').writeFileSync(process.argv[1], process.argv[2])`, target, content],
      {
        windowsHide: true,
      },
    );
  }
  await git(['add', '-A'], { cwd: workDir });
  await git([...GIT_IDENTITY, 'commit', '-m', message], { cwd: workDir });
  return git(['rev-parse', 'HEAD'], { cwd: workDir });
}

/**
 * Create one bare repository seeded with a base branch plus one head per
 * pull request. Sequential on purpose: Git index churn is not the thing
 * under test.
 */
export async function createBareRepoWithPullRequests(
  prs: readonly PrHeadSpec[],
): Promise<BareRepoFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prrev-git-fixture-'));
  const barePath = path.join(root, 'fixture.git');
  const workDir = path.join(root, 'work');

  try {
    await git(['init', '--bare', '--initial-branch', 'main', barePath]);
    await git(['init', '--initial-branch', 'main', workDir]);
    await git(['remote', 'add', 'origin', barePath], { cwd: workDir });

    // A shared, file-backed alternative avoids a network round trip per push.
    const baseFiles = prs[0]?.baseFiles ?? { 'README.md': '# fixture\n' };
    const baseSha = await writeAndCommit(workDir, baseFiles, 'base: fixture seed');
    await git(['push', 'origin', 'main'], { cwd: workDir });

    const heads: Record<number, string> = {};
    for (const pr of prs) {
      await git(['checkout', '-B', `pr-${pr.number}`, baseSha], { cwd: workDir });
      const headSha = await writeAndCommit(workDir, pr.files, pr.message ?? `pr ${pr.number}`);
      await git(['push', 'origin', `HEAD:refs/pull/${pr.number}/head`], { cwd: workDir });
      heads[pr.number] = headSha;
    }

    return {
      root,
      barePath,
      baseSha,
      heads,
      dispose: async () => {
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
