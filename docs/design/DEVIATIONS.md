# Intentional deviations from the approved HTML mockup

Source of the list: Call360-specs `docs/product/S0_SCREEN_SPEC.md` §4. Items marked **CP0.1A** are
implemented; the rest apply when their screens are built.

| # | Mockup | Implementation | Reason | Status |
|---|---|---|---|---|
| DV-01 | Passwordless "Continue as administrator / operations user" | Username + password only; provider badge "Local demo identity — Not SSO" | C-6: no passwordless role switching | **CP0.1A** |
| DV-02 | Nav labels Policy & Sales, Risk Assessment, Callback Queue, Compliance Reviews, Universal Search, Analytics & Reports, Data Integrations | Policy Explorer, SBQ Risk Workbench, Work Queues, Review Workbench, Search, Analytics, Data Intake; Voice Studio and Campaigns added; unbuilt items disabled with a compact right-aligned indicator — a clock icon for "later in Stage 0" and an "S4" chip — with the full stage text in the tooltip and for screen readers (UI-2: labels are never truncated) | C-1, EXC-003 | **CP0.1A** |
| DV-03 | Numeric risk score | Score only when stored with its synthetic rule set | C-17 | later |
| DV-04 | Pass / Discrepancy verdicts | "Seeded rule outcome — needs review" | C-18 | later |
| DV-05 | Simulated player, voice animation | NOT_AVAILABLE panels | C-10, D-10 | later |
| DV-06 | Editable script draft | Read-only version view | D-4 | later |
| DV-07 | "Simulate API sync" | Real mock HTTP import | ING-001 | later |
| DV-08 | Export / evidence bundle / create review | Disabled with stage chip | S0-A6 | later |
| DV-09 | Survey completion = completed / connected | Completed / started | D-12 | later |
| DV-10 | Illustrative KPI numbers | Live SQL values; until CP0.5 the Overview route shows the real authenticated session only | APP-002 | **CP0.1A** (interim landing) |
| DV-11 | Light-surface greys (`--muted`, crumb, table headers, role text, amber/gray badges, login copy, brand accent on white) at 2.5–4.3:1 contrast | Minimally darkened to ≥ 4.5:1 (`src/styles/app.css`, DV-11 block); layout, sizes and hierarchy unchanged | WCAG 2.2 AA (S0_SCREEN_SPEC §1.8); verified by axe in E2E | **CP0.1A** |
| DV-12 | Topbar global search, notification bell and audit shortcut | Omitted until functional (search arrives CP0.3; no notification feature in S0) | No inert controls (S0-A6) | **CP0.1A** |
