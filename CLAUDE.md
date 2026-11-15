# Claude Code instructions — Call360-frontend

**Product:** Call360 | **Investigation screen:** Call Detail | **Current stage:** S0

This is a **separate Git repository**, sibling to `../Call360-specs` and `../Call360-backend`. It owns React UI and browser media transport. Read first:

- `../Call360-specs/docs/spec/01_MASTER_BRD.md`
- `../Call360-specs/docs/spec/02_CLAUDE_CODE_EXECUTION_PLAN.md`
- `../Call360-specs/docs/product/SCREEN_NAMING_AND_ROUTES.md`
- `../Call360-specs/docs/engineering/MULTI_REPO_ARCHITECTURE.md`
- `../Call360-specs/docs/contracts/API_CONTRACT_POLICY.md`

## UX and client responsibilities

- React/TypeScript Vite SPA; polished high-fidelity enterprise UI with persistent navigation and meaningful states: Overview, Call Explorer, **Call Detail**, Voice Studio, Survey Studio, Review Workbench, Live Monitor, Campaigns, Analytics and Administration (stage-gated).
- **Call Detail** canonical URL `/cases/:caseId`; show case + all attempts/sessions, evidence, question status, findings, audit events. Preserve explorer filters and deep links to attempt/session.
- Typed API client generated from the **backend's OpenAPI** at `../Call360-backend/contracts/generated/openapi.json`; never define divergent backend DTOs by hand.
- Data from real authenticated FastAPI/Postgres responses; synthetic seeded fixtures in dev. No frontend-only compliance decisions or fake KPI totals.
- Stage 1: browser WebRTC, media permission and audio controls, transcripts/events, recording evidence statuses. Genesys is a distinct **backend** adapter in S6, not reused browser media code.

## Non-negotiables

1. Implement only approved stage; S0 Voice Studio is a truthful preflight/unavailable state, not a pretending-to-work AI call.
2. All visible controls are functional, appropriately disabled with explanation, or removed. Test loading, empty, error, partial-data and permission-denied states.
3. No provider secret in browser, frontend bundle, debug logs or local fixtures.
4. Accessibility: keyboard interaction, correct headings/labels, adequate contrast, audio alternatives and readable evidence without relying on color alone.
5. Use the product brand **Call360**; the detail page heading, breadcrumbs, navigation labels and test names use **Call Detail** (not “Call 360”).
6. Generated client must match current backend OpenAPI; run drift checks and integration against real backend/Postgres, not mock-only E2E.
7. Each PR must report linked requirement IDs, screen captures from synthetic data, type/lint/test results and integrated Playwright evidence.
8. Contribute stage acceptance data to a separate `Call360-specs` PR, including exact frontend SHA and backend OpenAPI checksum.

Before any change inspect current branch/status and verify sibling spec paths. Do not copy BRD into this repo or move backend business logic into React.

## v0.3 expansion — mandatory context

**v0.3 expansion (237 requirements, 55 business tests):** Read `Call360-specs/docs/process/SBQ_AS_IS_TO_BE_AND_DECISIONS.md`, `docs/data/CANONICAL_GRAIN_AND_RELATIONSHIPS.md`, `docs/product/SCRIPT_GOVERNANCE_AND_ASSIGNMENT.md`, `docs/product/SEARCH_WORKSPACE_AND_POLICY_VIEWS.md`, `docs/integrations/POLICY_PARTY_RISK_INTAKE.md`, and `docs/security/IDENTITY_AUTHORIZATION_AND_AUDIT.md` (paths relative to specs repository; use `../Call360-specs` from implementation repos). The existing AIA SBQ workflow is a working hypothesis, not an approved SOP. Keep sale-selection risk distinct from customer investment risk tolerance and compliance finding severity.

At S0 build persistent synthetic policy/sale/risk/party data, mock and manual intake, accessible secured search and local login with ADMIN/USER role mapping; enforce server-side access and audit from the start. Do not implement Genesys, real customer interfaces or real call scripts before approval. Never promise zero security defects.

## UI/UX Design Reference

The approved Call360 interactive HTML mockup is located at:

docs/design/reference/Call360_Portal_Mockup.html

Before implementing any frontend module:

1. Review the corresponding screen in the HTML mockup.
2. Follow its navigation, visual hierarchy, layout and interaction patterns.
3. Use the mockup as the UI/UX baseline, not as production code.
4. Implement actual functionality using React and TypeScript.
5. Integrate with real FastAPI backend contracts.
6. Do not copy simulated authentication, mock data or prototype business logic into production.
7. Ensure responsiveness, accessibility and consistent components.
8. If the mockup conflicts with business requirements, follow the specifications in the sibling Call360-specs repository.

Avoid replacing the approved design with generic dashboard templates.

Document intentional UI deviations and their rationale.