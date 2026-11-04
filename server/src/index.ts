/**
 * Entry point (T028): validate configuration, then hand off to startup().
 * Any pre-listen failure (config validation, migration) exits non-zero with
 * a secret-free message on stderr.
 */
import { ConfigError, loadConfig } from './config/index.js';
import { startup } from './startup.js';

try {
  const config = loadConfig();
  const running = await startup(config);
  process.stdout.write(`PR Review Dashboard running at ${running.url}\n`);
} catch (error) {
  if (error instanceof ConfigError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
  process.stderr.write(
    `Startup failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
