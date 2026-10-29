/**
 * Shared AI denylist (T011, FR-041).
 *
 * Which files must never enter AI context: instruction files, secret-bearing
 * files, credential material, and generated/vendor artifacts. The human diff
 * viewer still shows every file (FR-040); exclusion here only governs what
 * the AI reviewer may receive.
 *
 * Matching is path-based using Git forward-slash form and is intentionally
 * conservative: the denylist is fail-closed, so anything that pattern-doubts
 * matches and gets excluded.
 */

export type DenylistKind = 'instruction' | 'secret' | 'generated';

export interface DenylistMatch {
  readonly kind: DenylistKind;
  /** The pattern that matched, for diagnostics and UI warnings. */
  readonly rule: string;
}

/**
 * Full-path globs. Defaults are documented in the spec and configurable only
 * by a trusted local setting; code treats them as immutable.
 */
const PATH_RULES: readonly { pattern: string; kind: DenylistKind }[] = [
  // Repository instruction files (FR-041 minimum)
  { pattern: 'AGENTS.md', kind: 'instruction' },
  { pattern: 'CLAUDE.md', kind: 'instruction' },
  { pattern: '.github/copilot-instructions.md', kind: 'instruction' },
  { pattern: '.cursorrules', kind: 'instruction' },
  { pattern: '.cursor/rules/**', kind: 'instruction' },

  // Local agent state that must never be shipped to a model
  { pattern: '.git/**', kind: 'generated' },
  { pattern: '.opencode/**', kind: 'generated' },
  { pattern: 'opencode.json', kind: 'instruction' },
  { pattern: 'opencode.jsonc', kind: 'instruction' },

  // Common credential / private-key material
  { pattern: '.aws/credentials', kind: 'secret' },
  { pattern: '.netrc', kind: 'secret' },
  { pattern: '.npmrc', kind: 'secret' },

  // Generated and vendor artifacts
  { pattern: 'package-lock.json', kind: 'generated' },
  { pattern: 'pnpm-lock.yaml', kind: 'generated' },
  { pattern: 'yarn.lock', kind: 'generated' },
  { pattern: 'bun.lockb', kind: 'generated' },
];

/**
 * Vendor/generated directory names that match at any depth, like
 * `docs/node_modules/x.js`. Matched as a path segment, never as substring.
 */
const CONTAINS_DIR_RULES: readonly { segment: string; kind: DenylistKind }[] = [
  { segment: 'node_modules', kind: 'generated' },
  { segment: 'vendor', kind: 'generated' },
  { segment: 'dist', kind: 'generated' },
  { segment: 'build', kind: 'generated' },
  { segment: 'coverage', kind: 'generated' },
];

/**
 * Basename globs tested against the last path segment in any directory.
 * Credential-bearing files are usually treated as a drop alongside whatever
 * folder they live in, and also duplicates nothing — a duplicated TOML key
 * stays out of the model regardless of nesting depth.
 */
const BASENAME_RULES: readonly { pattern: string; kind: DenylistKind }[] = [
  { pattern: '.env', kind: 'secret' },
  { pattern: '.env.*', kind: 'secret' },
  { pattern: '*.pem', kind: 'secret' },
  { pattern: '*.key', kind: 'secret' },
  { pattern: '*.p12', kind: 'secret' },
  { pattern: '*.pfx', kind: 'secret' },
  { pattern: '*.pkcs12', kind: 'secret' },
  { pattern: 'id_rsa', kind: 'secret' },
  { pattern: 'id_dsa', kind: 'secret' },
  { pattern: 'id_ecdsa', kind: 'secret' },
  { pattern: 'id_ed25519', kind: 'secret' },
  { pattern: '*.min.js', kind: 'generated' },
  { pattern: '*.min.css', kind: 'generated' },
];

/** Public view of the effective rules, for disclosure and debugging output. */
export const AI_DENYLIST_RULES: readonly string[] = [
  ...PATH_RULES.map((rule) => rule.pattern),
  ...CONTAINS_DIR_RULES.map((rule) => `**/${rule.segment}/**`),
  ...BASENAME_RULES.map((rule) => rule.pattern),
];

function escapeRegExp(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\$]/g, '\\$&');
}

/**
 * Compile one of the globs above into a regex.
 * `**` matches any characters including `/`; `*` matches any run that does
 * not contain `/`.
 */
function globToRegExp(glob: string): RegExp {
  let source = '';
  let index = 0;
  while (index < glob.length) {
    const current = glob[index];
    if (current === undefined) break; // unreachable; keeps control flow verified
    if (glob.startsWith('**', index)) {
      source += '.*';
      index += 2;
      continue;
    }
    if (current === '*') {
      source += '[^/]*';
      index += 1;
      continue;
    }
    source += escapeRegExp(current);
    index += 1;
  }
  return new RegExp(`^${source}$`);
}

const FULL_PATH_MATCHERS: readonly { regexp: RegExp; kind: DenylistKind; rule: string }[] =
  PATH_RULES.map((rule) => ({
    regexp: globToRegExp(rule.pattern.toLowerCase()),
    kind: rule.kind,
    rule: rule.pattern,
  }));

const BASENAME_MATCHERS: readonly { regexp: RegExp; kind: DenylistKind; rule: string }[] =
  BASENAME_RULES.map((rule) => ({
    regexp: globToRegExp(rule.pattern.toLowerCase()),
    kind: rule.kind,
    rule: rule.pattern,
  }));

/** Normalize a Git-style path for matching: forward slashes, no leading `./`, no trailing `/`. */
export function normalizePath(path: string): string {
  const normalized = path
    .replace(/\\/g, '/')
    .replace(/^\.?\/+/, '')
    .replace(/\/+$/, '');
  return normalized;
}

function basenameOf(normalizedPath: string): string {
  const lastSlash = normalizedPath.lastIndexOf('/');
  return lastSlash === -1 ? normalizedPath : normalizedPath.slice(lastSlash + 1);
}

/** Return the matching denylist entry for a path, or null when the path is eligible. */
export function denylistMatch(path: string): DenylistMatch | null {
  const fullPath = normalizePath(path);
  if (fullPath === '') return { kind: 'generated', rule: '(empty path)' };

  const normalized = fullPath.toLowerCase();
  const basename = basenameOf(normalized);

  for (const matcher of FULL_PATH_MATCHERS) {
    if (matcher.regexp.test(normalized) || matcher.regexp.test(`${normalized}/`)) {
      return { kind: matcher.kind, rule: matcher.rule };
    }
  }
  for (const dirRule of CONTAINS_DIR_RULES) {
    const segment = `/${dirRule.segment}/`;
    if (normalized.startsWith(`${dirRule.segment}/`) || normalized.includes(segment)) {
      return { kind: dirRule.kind, rule: `**/${dirRule.segment}/**` };
    }
  }
  for (const matcher of BASENAME_MATCHERS) {
    if (matcher.regexp.test(basename)) {
      return { kind: matcher.kind, rule: matcher.rule };
    }
  }
  return null;
}

/** True when the path must never be sent to the AI reviewer (FR-041). */
export function isDenylistedPath(path: string): boolean {
  return denylistMatch(path) !== null;
}

/**
 * Content-level credential detection for the second safety net. Path
 * exclusion is primary; if an eligible file still contains a high-signal
 * credential shape, the caller may exclude or redact the content.
 */
const CREDENTIAL_CONTENT_PATTERNS: readonly RegExp[] = [
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9]{36}/,
  /github_pat_[A-Za-z0-9_]{22,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /sk-(?:proj-|svcacct-)?[A-Za-z0-9-]{20,}/,
  /AIza[0-9A-Za-z_-]{35}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
];

/** True when the text contains a recognizable credential or key shape. */
export function containsCredentialPattern(text: string): boolean {
  return CREDENTIAL_CONTENT_PATTERNS.some((pattern) => pattern.test(text));
}
