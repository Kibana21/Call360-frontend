import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backend = resolve(here, '../../../Call360-backend');
const accounts = resolve(here, '../.auth/accounts.json');

// APPL-X1R — the isolated TEST schema only. The standard reset and synthetic people, then the "Applicability Showcase"
// surveys created and published through Survey Studio's governed HTTP API by three different test identities
// (scripts/appl_showcase_setup.py) — the same script, with the same result, as in local development.
export default function globalSetup(): void {
  const env = { ...process.env, CALL360_ENV_FILE: '.env.test' };
  execFileSync('uv', ['run', 'python', 'scripts/e2e_survey_setup.py', accounts], { cwd: backend, env, stdio: 'inherit' });
  execFileSync('uv', ['run', 'python', 'scripts/appl_showcase_setup.py', '--base-url', 'http://127.0.0.1:8001', '--origin', 'http://127.0.0.1:5174', '--accounts', accounts,
    '--author', 'survey_author', '--checker', 'survey_checker', '--publisher', 'survey_publisher'], { cwd: backend, env, stdio: ['ignore', 'ignore', 'inherit'] });
  // APPL-X2 — the showcase applicability LIBRARY (variables, profiles, conditions), published through the governed
  // library API by three people who each hold only their own applicability permission (scripts/appl_library_setup.py).
  execFileSync('uv', ['run', 'python', 'scripts/appl_library_setup.py', '--base-url', 'http://127.0.0.1:8001', '--origin', 'http://127.0.0.1:5174', '--accounts', accounts,
    '--author', 'survey_applauthor', '--checker', 'survey_applchecker', '--publisher', 'survey_applpublisher'], { cwd: backend, env, stdio: ['ignore', 'ignore', 'inherit'] });
  // A TEST FIXTURE survey of its own, published as version 1; a journey publishes its version 2 to show the deliberate
  // adoption of a newer published version. The showcase surveys are never changed for this.
  fixtureSurvey(1);
}
export function fixtureSurvey(version: 1 | 2): void {
  execFileSync('uv', ['run', 'python', 'scripts/appl_fixture_survey.py', '--base-url', 'http://127.0.0.1:8001', '--origin', 'http://127.0.0.1:5174', '--accounts', accounts,
    '--author', 'survey_author', '--checker', 'survey_checker', '--publisher', 'survey_publisher', '--version', String(version)], { cwd: backend, env: { ...process.env, CALL360_ENV_FILE: '.env.test' }, stdio: ['ignore', 'ignore', 'inherit'] });
}
