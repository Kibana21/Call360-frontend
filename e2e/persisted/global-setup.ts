import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// FI-1 — the isolated TEST schema only: standard reset and accounts, plus synthetic people with survey permissions.
export default function globalSetup(): void {
  execFileSync('uv', ['run', 'python', 'scripts/e2e_survey_setup.py', resolve(here, '../.auth/accounts.json')], {
    cwd: resolve(here, '../../../Call360-backend'),
    env: { ...process.env, CALL360_ENV_FILE: '.env.test' },
    stdio: 'inherit',
  });
}
