# Call360 frontend

React + TypeScript + Vite SPA reproducing the approved mockup (`docs/design/reference/`).
**Current checkpoint: CP0.1A** — login, session expiry, unauthorized, application shell, session landing,
ADMIN Users and Audit (Call360-specs `docs/acceptance/CP0.1A.md`).

```bash
npm install
npm run dev            # http://127.0.0.1:5173 — proxies /api and /health to the backend on :8000
npm run api:generate   # pin ../Call360-backend/contracts/generated/openapi.json and regenerate types
npm run api:check      # fail on contract drift
npm run lint && npm run typecheck && npm test
npm run build && npm run secret-scan
npm run e2e            # Playwright against a REAL test backend (:8001, schema call360_test) + Vite (:5174)
```

Tokens are held only in HttpOnly cookies; the SPA never reads or stores them. Intentional differences from
the mockup are listed in `docs/design/DEVIATIONS.md`.
