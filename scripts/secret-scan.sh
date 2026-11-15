#!/usr/bin/env bash
# SCAN-01 (committable files) + SCAN-02 (built bundle in dist/). Fails on any finding.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v gitleaks >/dev/null || { echo "BLOCKED: gitleaks not installed"; exit 2; }
# Self-test this repo's rules with the shared synthetic-fixture harness (sibling Call360-backend).
[ -f ../Call360-backend/scripts/secret_scan_selftest.py ] || { echo "BLOCKED: ../Call360-backend self-test not found"; exit 2; }
(cd ../Call360-backend && uv run python scripts/secret_scan_selftest.py --config "$OLDPWD/.gitleaks.toml")
stage=$(mktemp -d); trap 'rm -rf "$stage"' EXIT
git ls-files -z --cached --others --exclude-standard | rsync -a --from0 --files-from=- ./ "$stage/"
echo "Scanning $(git ls-files --cached --others --exclude-standard | wc -l | tr -d ' ') committable files"
gitleaks dir "$stage" --config .gitleaks.toml --no-banner --redact --exit-code 1
if [ -d dist ]; then
  echo "Scanning built bundle dist/"
  gitleaks dir dist --config .gitleaks.toml --no-banner --redact --exit-code 1
  if grep -rEl 'BEGIN [A-Z ]*PRIVATE KEY|c360_rt=|REFRESH_TOKEN_PEPPER|CSRF_SECRET|postgresql\+psycopg://' dist; then
    echo "FAIL: secret-like material in bundle"; exit 1
  fi
else
  echo "dist/ not built; run npm run build first for SCAN-02"; exit 2
fi
[ -e e2e/.auth ] && ! git check-ignore -q e2e/.auth && { echo "FAIL: e2e/.auth not ignored"; exit 1; }
echo "Secret scan clean"
