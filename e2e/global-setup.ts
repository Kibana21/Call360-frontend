import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const ACCOUNTS_FILE = resolve(here, '.auth/accounts.json');

export default function globalSetup(): void {
  execFileSync('uv', ['run', 'python', 'scripts/e2e_setup.py', ACCOUNTS_FILE], {
    cwd: resolve(here, '../../Call360-backend'),
    env: { ...process.env, CALL360_ENV_FILE: '.env.test' },
    stdio: 'inherit',
  });
}
