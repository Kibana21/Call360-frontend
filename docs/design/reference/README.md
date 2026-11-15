# Call360 — Interactive HTML Portal Mockup

**Purpose:** A high-fidelity, interactive front-end concept for the AIA Standards & Compliance client callback assurance use case.  This is a **standalone browser prototype**, not a production application, and uses **synthetic data only**.

> **Where to put these files:** Extract this ZIP at the root of the existing `Call360-frontend` repository. It creates `docs/design/reference/` and does not replace source files or `CLAUDE.md`.

> **Design reference only:** Business requirements in the sibling `Call360-specs` repository remain authoritative. The HTML uses synthetic data and does not implement authentication, AI calling, actual recording or persisted audit evidence.

## Open it

Open `Call360_Portal_Mockup.html` in Chrome, Edge, Safari, or Firefox. No server, installation, npm, or external libraries are required.

On macOS, double-click the file or run:

```bash
open Call360_Portal_Mockup.html
```

The portal opens directly on the **Command Centre**. To preview login, click the user profile at top right → **Sign out / login preview** → continue as Admin or User. Login is simulated; no password, authentication server or real token is involved.

## Interactive screens

| Portal area | Mockup interactions |
|---|---|
| Command Centre | KPIs, case drill-down, priority attention, activity, risk distribution, synthetic CSV report |
| Call Explorer | Search by case/policy/customer/product/FSC, filter risk/status, open **Call Detail** |
| Policy & Sales | Policyholder/contact/FSC details, sale channels, premium data, policy-risk drawer, sample intake |
| Risk Assessment | Illustrative SBQ factors, scoring, source provenance, demo override reason logging |
| Callback Queue | Prioritized follow-ups, scheduled attempts, launch **simulated** browser voice session |
| Live Monitor | Sample active sessions, voice activity animation, session event feed |
| Script Studio | Product-specific question bank, expected answer and branch conditions, create editable draft, add question, submit for checker |
| Assignment Rules | Priority/conditions, assigned script, rule toggles and explainable script assignment |
| Compliance Reviews | Findings queue, evidence summary, reviewer notes, submit a simulated checker-required decision |
| Universal Search | Cross-object search of policies, cases, risk, scripts, narrative answers, transcript segments and findings |
| Analytics & Reports | Product-by-outcome comparisons, exceptions, quality metrics and synthetic export |
| Data Integrations | Mock API cards, payload validation, manual JSON injection and lineage representation |
| Administration | Identity groups, role switcher, conditional admin access, audit events and security-control requirements |
| Call Detail | All contact attempts, pinned script version, recording timeline illustration, synchronized sample transcript, question results, structured JSON, review links and audit history |

## Canonical business grain

The product must distinguish **Customer/Party → Policy/Proposal → Sale Event → SBQ Risk Assessment → Callback Case → Contact Attempt → Conversation Session → Survey Run → Question Execution/Response Evidence → Rule Evaluation → Finding/Review/Disposition**.

Multiple policies can be associated with a customer. Multiple sale events may exist for a policy. Each callback case may have several attempts; only connected attempts have conversations. Exact script/question/rule versions must be immutable per applicable session/run.

## Critical design decisions

1. **Call360** is the product name. **Call Detail** is the investigation screen. **Call Explorer** is the case register.
2. Start with a browser-based test conversation; later add a **Genesys-specific adapter** while retaining the survey, compliance and evidence domains.
3. The voice model handles conversational audio; **Python/FastAPI** is the authority for mandatory question progression, product facts, validation and escalation.
4. Maintain both original utterances and their structured interpretation; store answer-to-evidence pointers with question/version IDs, rules and human decisions.
5. Risk of a *sale*, suitability risk of a *customer* and severity of a *compliance finding* are distinct dimensions.
6. Scripts need lifecycle `Draft → Submitted → Approved → Published → Superseded`, plus maker-checker, effective date, source/reason, and frozen previous versions.
7. Use local demo auth only for prototyping. The production system should use OIDC with server-side enforcement, short-lived access tokens, refresh-token rotation, audit logs, least privilege and granular audio/PII access policies.
8. Do not imply any actual MAS-mandated question or AIA internal procedure is represented by synthetic script content; business owners must supply and approve source wording and controls.

## Recommended use with Claude Code

- Commit **only reviewed UI/mockup references** in `Call360-frontend/docs/design/reference/`, or place this HTML file there as a visual implementation reference.
- Maintain authoritative business requirements in the separate `Call360-specs` repository.
- Implement the real UI in `Call360-frontend` using React/TypeScript. Keep the existing HTML mockup read-only.
- Implement real FastAPI APIs, policy/risk/script/attempt/evidence data persistence, and security in `Call360-backend`.
- Define API contracts and acceptance tests in `Call360-specs` first, then implement front/backend against those contracts.

## Boundaries and limitations

- **No real audio, recording, transcript generation or GPT-Live integration** occurs in this HTML file. A simulated voice survey is included to illustrate the UX.
- **No real authentication, Active Directory/Okta integration, or server-side authorization** occurs here. Role switching is illustrative.
- **No database persistence.** New cases, draft scripts and audit events live in memory and reset on refresh.
- **No real policy API, outbound calling, Genesys connection, or compliance decision** occurs here.
- **All metrics, customer records, policy profiles, and scripts are synthetic design examples** and must not be treated as AIA internal facts or regulatory advice.
- Client-side demonstrations cannot replace technical security testing or enterprise control review.

## Included visual previews

`screenshots/Call360_Portal_Overview.png`, `screenshots/Call360_Portal_Call_Detail.png`, `screenshots/Call360_Portal_Script_Studio.png`, `screenshots/Call360_Portal_Script_Draft.png`, `screenshots/Call360_Portal_Policy_Profile.png`, `screenshots/Call360_Portal_Voice_Demo.png`, and `screenshots/Call360_Portal_Login.png`.

## Suggested `CLAUDE.md` addition

Add the following to the existing `Call360-frontend/CLAUDE.md` (do **not** replace that file):

```md
### UI design baseline
The interactive reference is `docs/design/reference/Call360_Portal_Mockup.html` and companion screenshots live under `docs/design/reference/screenshots/`.
Inspect relevant screens before implementing UI. Reproduce the visual hierarchy and functional intent, but not prototype-only state, sample data, simulated authentication or mock logic. Implement real React/TypeScript interfaces connected to the FastAPI backend.
The authoritative business specifications and API contracts live in the sibling `Call360-specs` repository. If they conflict with the HTML, follow the specifications and document any deliberate design changes.
```

## Git setup

From your local `Call360-frontend` repository root:

```bash
unzip ~/Downloads/Call360_UI_Reference_For_Frontend.zip
git add docs/design/reference
git commit -m 'docs: add Call360 UI reference baseline'
```
