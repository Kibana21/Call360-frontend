// Survey Studio prototype (SS-02C) — validation readiness and the SIMULATED maker-checker lifecycle.
//
// Everything here is a demonstration held in memory. A "submission", an "approval" and a "publication" made here are
// NOT governance acts: nothing is sent to Call360, no survey becomes operational, and no wording is approved by anyone.
// The functions are pure — (state, …) → state — and refuse, with a plain reason, anything the rules do not allow:
//   * a draft with blockers or unacknowledged warnings cannot be submitted;
//   * the person who submitted a candidate cannot approve it (maker ≠ checker);
//   * submitting FREEZES a candidate: an immutable copy with its own ID, revision number, content fingerprint and
//     pinned dependency manifest. The author's draft is a separate thing and may go on changing;
//   * a review, an approval and a publication are bound to that candidate BY ITS ID. Nothing done to the draft —
//     editing it, undoing an edit, making it identical to some earlier candidate — can move an approval onto it;
//   * publishing needs the separate Publisher permission and a different person from the one who submitted;
//   * a publication is the approved candidate itself, with its manifest. It never changes.
import { canonical } from './canonical';
import { PROFILES, playback } from './demo';
import { describeAst } from './engine';
import { validateSurvey } from './flow';
import { activationOf, eligibilityOf, findCondition, findModule, findQuestion } from './ops';
import { OUTCOME_LABEL } from './sample';
import type { TerminalState } from './sim';
import { isQuestion, mKey, type Binding, type Issue, type Module, type Survey, type Workspace } from './types';

// ---- the exact thing that is validated, reviewed and published ---------------------------------------------------------
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const fnv = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
};

/** The survey with exactly the module, question and condition versions it uses — nothing else from the workspace. */
export function closure(ws: Workspace, survey: Survey): Workspace {
  const mods = new Map<string, Module>();
  for (const inst of survey.sequence) { const m = findModule(ws, mKey(inst.module)); if (m) mods.set(mKey(m), m); }
  const qs = new Set<string>();
  const cs = new Set<string>();
  const cond = (b: Binding | null | undefined) => { if (b?.condition.code) cs.add(`${b.condition.code}@${b.condition.version}`); };
  for (const inst of survey.sequence) cond(eligibilityOf(inst));
  for (const m of mods.values()) for (const n of m.nodes) { if (isQuestion(n)) qs.add(`${n.q.code}@${n.q.version}`); else cond(n.binding); }
  for (const c of ws.conditions) if (cs.has(`${c.code}@${c.version}`)) for (const d of Object.values(c.inputs ?? {})) qs.add(`${d.question.code}@${d.question.version}`);
  return clone({
    questions: ws.questions.filter((q) => qs.has(`${q.code}@${q.version}`)), conditions: ws.conditions.filter((c) => cs.has(`${c.code}@${c.version}`)),
    modules: ws.modules.filter((m) => mods.has(mKey(m))), surveys: [survey], seq: 0,
  });
}
/** An immutable copy of one survey revision. `fingerprint` identifies its exact content: equal content, equal value. */
export interface Snapshot { ws: Workspace; surveyId: string; fingerprint: string }
export function snapshot(ws: Workspace, survey: Survey): Snapshot {
  const c = closure(ws, survey);
  return { ws: c, surveyId: survey.id, fingerprint: fnv(canonical(c)) };
}
export const surveyFingerprint = (ws: Workspace, survey: Survey): string => snapshot(ws, survey).fingerprint;
export const surveyOf = (s: Snapshot): Survey => s.ws.surveys[0]!;

// ---- pinned dependencies ----------------------------------------------------------------------------------------------
export interface Lock {
  modules: Array<{ code: string; revision: number; name: string; shared: boolean; placements: number; newer: number | null }>;
  questions: Array<{ code: string; version: number; text: string; usedIn: string[]; newer: number | null }>;
  conditions: Array<{ code: string; version: number; name: string; shared: boolean; usedIn: string[]; newer: number | null }>;
}
/** Every reusable version this survey pins. `newer` = a later approved version exists in the library (never applied silently). */
export function lockOf(ws: Workspace, survey: Survey): Lock {
  const c = closure(ws, survey);
  const usedQ = new Map<string, string[]>();
  const usedC = new Map<string, string[]>();
  const note = (map: Map<string, string[]>, key: string, where: string) => map.set(key, [...new Set([...(map.get(key) ?? []), where])]);
  for (const inst of survey.sequence) {
    const m = findModule(ws, mKey(inst.module));
    if (!m) continue;
    const e = eligibilityOf(inst);
    if (e?.condition.code) note(usedC, `${e.condition.code}@${e.condition.version}`, `${m.name} (eligibility)`);
    for (const n of m.nodes) {
      if (isQuestion(n)) note(usedQ, `${n.q.code}@${n.q.version}`, m.name);
      else if (n.binding?.condition.code) note(usedC, `${n.binding.condition.code}@${n.binding.condition.version}`, m.name);
    }
  }
  const newerQ = (code: string, v: number) => { const n = Math.max(0, ...ws.questions.filter((x) => x.code === code && x.published && x.version > v).map((x) => x.version)); return n || null; };
  const newerC = (code: string, v: number) => { const n = Math.max(0, ...ws.conditions.filter((x) => x.code === code && x.shared && x.version > v).map((x) => x.version)); return n || null; };
  const newerM = (code: string, v: number) => { const n = Math.max(0, ...ws.modules.filter((x) => x.code === code && x.published && x.revision > v).map((x) => x.revision)); return n || null; };
  return {
    modules: c.modules.map((m) => ({ code: m.code, revision: m.revision, name: m.name, shared: m.published, placements: survey.sequence.filter((i) => mKey(i.module) === mKey(m)).length, newer: newerM(m.code, m.revision) })),
    questions: c.questions.filter((q) => usedQ.has(`${q.code}@${q.version}`)).map((q) => ({ code: q.code, version: q.version, text: q.wording.text.trim() || 'Untitled question', usedIn: usedQ.get(`${q.code}@${q.version}`) ?? [], newer: newerQ(q.code, q.version) })),
    conditions: c.conditions.map((x) => ({ code: x.code, version: x.version, name: x.name, shared: x.shared, usedIn: usedC.get(`${x.code}@${x.version}`) ?? [], newer: newerC(x.code, x.version) })),
  };
}

// ---- people and state ---------------------------------------------------------------------------------------------------
/** What a person is permitted to do. Three separate permissions: holding one never implies another. */
export type Capability = 'AUTHOR' | 'CHECKER' | 'PUBLISHER';
export interface Person { id: string; name: string; can: Capability[]; title: string }
/** Invented people for the demonstration. A permission here is a label in the prototype, not a Call360 permission. */
export const PEOPLE: Person[] = [
  { id: 'p-author', name: 'Mei Ling Tan', can: ['AUTHOR'], title: 'Survey author (maker)' },
  { id: 'p-checker', name: 'Arjun Menon', can: ['CHECKER'], title: 'Reviewer (checker)' },
  { id: 'p-publisher', name: 'Devi Krishnan', can: ['PUBLISHER'], title: 'Release manager (publisher)' },
  // holds all three permissions — and still may never approve or publish her own submission: a permission is not
  // enough, the identities must differ
  { id: 'p-lead', name: 'Farah Ismail', can: ['AUTHOR', 'CHECKER', 'PUBLISHER'], title: 'Team lead (author, checker and publisher)' },
];
export const person = (id: string): Person => PEOPLE.find((p) => p.id === id) ?? { id, name: id, can: [], title: '' };
export const canAuthor = (id: string): boolean => person(id).can.includes('AUTHOR');
export const canCheck = (id: string): boolean => person(id).can.includes('CHECKER');
export const canPublish = (id: string): boolean => person(id).can.includes('PUBLISHER');

/**
 * A submitted CANDIDATE. Everything about it is fixed at submission: its ID, its revision number, the frozen copy of the
 * survey, the content fingerprint, the pinned dependency manifest and that manifest's own hash, the wording put to the
 * checker, and the acknowledged warnings. Only its `status` and `decision` are ever added to.
 */
export interface Submission {
  /** Candidate ID, e.g. "C-3". The thing a review, an approval and a publication refer to. */
  id: string;
  /** Revision number of the survey: 1, 2, 3 … one per submitted candidate. */
  n: number;
  by: string; at: number; note: string;
  candidate: Snapshot;
  manifest: Lock;
  manifestHash: string;
  wording: Readiness['wording']['toApprove'];
  /** The warnings the author acknowledged, with their notes, as they stood at submission. */
  acknowledged: Array<{ title: string; note: string; by: string }>;
  /** SUPERSEDED = a later candidate was submitted while this one was still open. It can no longer be approved or published. */
  status: 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'SUPERSEDED' | 'PUBLISHED';
  decision?: { by: string; at: number; comment: string; wordingConfirmed: number };
}
export interface Publication {
  version: number; label: string; at: number;
  /** The candidate that was published: its ID, revision and manifest hash. */
  candidate: string; revision: number; manifestHash: string;
  submittedBy: string; approvedBy: string; publishedBy: string;
  snapshot: Snapshot; lock: Lock; note: string; seeded?: boolean;
}
export interface AuditEvent { n: number; at: number; actor: string; action: string; detail: string; candidate?: string; fingerprint?: string }
export interface SurveyGov {
  acks: Record<string, { by: string; note: string }>;
  submissions: Submission[];
  publications: Publication[];
  audit: AuditEvent[];
}
export interface GovState { actor: string; surveys: Record<string, SurveyGov> }
export const emptyGov = (): GovState => ({ actor: 'p-author', surveys: {} });
const EMPTY: SurveyGov = { acks: {}, submissions: [], publications: [], audit: [] };
export const govOf = (g: GovState, surveyId: string): SurveyGov => g.surveys[surveyId] ?? EMPTY;
const put = (g: GovState, surveyId: string, sg: SurveyGov): GovState => ({ ...g, surveys: { ...g.surveys, [surveyId]: sg } });
const log = (sg: SurveyGov, at: number, actor: string, action: string, detail: string, c?: Submission): AuditEvent[] =>
  [...sg.audit, { n: sg.audit.length + 1, at, actor, action, detail, ...(c ? { candidate: c.id, fingerprint: c.candidate.fingerprint } : {}) }];
/** The hash of a dependency manifest: every pinned module, question and condition version, and nothing else. */
export const manifestHashOf = (lock: Lock): string => fnv(JSON.stringify([
  lock.modules.map((m) => `${m.code}@${m.revision}`), lock.questions.map((q) => `${q.code}@${q.version}`), lock.conditions.map((c) => `${c.code}@${c.version}`),
]));

// ---- validation readiness -----------------------------------------------------------------------------------------------
export type Severity = 'BLOCKER' | 'WARNING' | 'INFO';
export type Area = 'STRUCTURE' | 'ROUTING' | 'CONDITIONS' | 'ESCALATION' | 'QUESTIONS' | 'DEPENDENCIES' | 'WORDING' | 'GOVERNANCE' | 'COVERAGE';
export const AREAS: Array<{ id: Area; label: string; about: string }> = [
  { id: 'STRUCTURE', label: 'Structure', about: 'Every module has a start, every question can be reached, and nothing loops.' },
  { id: 'ROUTING', label: 'Routes', about: 'Every answer and every module outcome leads somewhere, forwards.' },
  { id: 'CONDITIONS', label: 'Activation and eligibility', about: 'Every condition is complete and says what happens when information is missing or it does not apply.' },
  { id: 'ESCALATION', label: 'Mandatory escalation', about: 'A mandatory escalation always ends the call with Escalate. Nothing may weaken or re-route it.' },
  { id: 'QUESTIONS', label: 'Questions and options', about: 'Every question has its text, its answers and workable selection limits.' },
  { id: 'DEPENDENCIES', label: 'Reusable versions', about: 'Which exact module, question and condition versions this survey pins.' },
  { id: 'WORDING', label: 'Wording approval', about: 'Which customer-facing wording is new or changed and must be approved in review.' },
  { id: 'GOVERNANCE', label: 'Governance decisions', about: 'Decisions the survey depends on that are still open.' },
  { id: 'COVERAGE', label: 'Journey coverage', about: 'What the synthetic customers reach. Evidence, never proof of validity.' },
];
export interface Finding {
  id: string; severity: Severity; area: Area; title: string; why: string; fix: string;
  /** Where it is: the module and, when it is inside one, the question or decision. */
  module?: string; item?: string;
  /** Where "Go to it" leads. Absent = nothing to open (an informational line). */
  where?: Issue['where'];
  acknowledged?: { by: string; note: string };
}
export interface CoverageLine { profile: string; name: string; state: TerminalState | 'PENDING'; ending: string; ran: string[] }
export interface Readiness {
  fingerprint: string;
  findings: Finding[];
  blockers: number; warnings: number; open: number;
  areas: Record<Area, { blockers: number; warnings: number; open: number; info: number; state: 'BLOCKED' | 'ATTENTION' | 'OK' }>;
  /** True only when there is no blocker and every warning has been acknowledged. Coverage alone can never make it true. */
  ready: boolean;
  reasons: string[];
  lock: Lock;
  coverage: CoverageLine[];
  wording: { total: number; toApprove: Array<{ code: string; version: number; text: string; usedIn: string[]; why: string }> };
}

const areaOf = (i: Issue): Area => {
  const m = i.message;
  if (i.where.part === 'empty' || i.where.part === 'cycle' || i.where.part === 'orphan' || /has no questions yet|has no first question|Nothing leads to|contains a loop/.test(m)) return 'STRUCTURE';
  if (i.where.part === 'mandatory' || /must escalate|must stop and escalate|is not allowed to do this|mandatory escalation/.test(m)) return 'ESCALATION';
  if (i.where.part === 'entry' || i.where.on?.startsWith('@SKIP') || /condition|earlier answer|reads the answer|is bound to|information is missing|waits for a module|activates it/.test(m)) return 'CONDITIONS';
  if (/has no question text|at least two answer options|option without a label|selection limits|answers, but only/.test(m)) return 'QUESTIONS';
  return 'ROUTING';
};
const WHY: Record<Area, string> = {
  STRUCTURE: 'A call could not be carried out as designed: part of the survey can never be reached, or never ends.',
  ROUTING: 'A call that reaches this point would have nowhere to go. Nothing is guessed, so the survey cannot be reviewed until it is decided.',
  CONDITIONS: 'Whether a module or a branch applies to a customer would be undefined. Missing information must never silently count as “no”.',
  ESCALATION: 'A mandatory escalation protects the customer. It must end the call with Escalate in every case, whatever else is configured.',
  QUESTIONS: 'The customer could not be asked this question properly, or could not answer it.',
  DEPENDENCIES: '', WORDING: '', GOVERNANCE: '', COVERAGE: '',
};
const ENDING: Record<TerminalState, string> = {
  COMPLETED: 'Completed', ENDED_WITH_OUTCOME: 'Ended with an outcome', MANDATORY_ESCALATION: 'Mandatory escalation', REVIEW_REQUIRED: 'Halted — review required',
  MISSING_INFORMATION_HALT: 'Halted — information missing', DRAFT_INVALID: 'Cannot run — the draft is invalid',
};

/**
 * Everything that stands between this draft and review, grouped and explained. Structural validity is decided by the
 * rules alone: a synthetic customer completing the survey never offsets a blocker (owner requirement, SS-02C Part B).
 */
export function assess(ws: Workspace, survey: Survey, sg: SurveyGov = EMPTY): Readiness {
  const findings: Finding[] = [];
  const names = new Map(survey.sequence.map((i) => [i.id, findModule(ws, mKey(i.module))?.name ?? i.id]));
  for (const i of validateSurvey(ws, survey)) {
    const area = areaOf(i);
    const [head, ...rest] = i.message.split(': ');
    findings.push({
      id: `V|${i.id}`, severity: i.severity === 'ERROR' ? 'BLOCKER' : 'WARNING', area, title: i.message, why: WHY[area], fix: i.fix,
      module: i.where.instanceId ? names.get(i.where.instanceId) : undefined, item: i.where.nodeId && rest.length ? head : i.where.nodeId ? i.message.split(' ')[0] : undefined, where: i.where,
    });
  }
  const lock = lockOf(ws, survey);
  for (const m of lock.modules) {
    const inst = survey.sequence.find((x) => x.module.code === m.code && x.module.revision === m.revision);
    if (m.newer) findings.push({ id: `D|M|${m.code}@${m.revision}>${m.newer}`, severity: 'WARNING', area: 'DEPENDENCIES', title: `${m.name} is pinned at v${m.revision}; v${m.newer} is now approved`, why: 'A pinned version never changes under a survey. Staying on the older version is allowed, but it must be a decision, not an oversight.', fix: 'Move to the newer version in the Composer, or acknowledge that this survey stays on the pinned one.', module: m.name, where: { surveyId: survey.id, instanceId: inst?.id } });
    if (!m.shared) findings.push({ id: `D|MD|${m.code}@${m.revision}`, severity: 'INFO', area: 'DEPENDENCIES', title: `${m.name} uses a draft revision (v${m.revision}) made for this survey`, why: 'It is reviewed as part of this survey and frozen with it at publication. The shared library version is not changed.', fix: '', module: m.name, where: { surveyId: survey.id, instanceId: inst?.id } });
  }
  for (const q of lock.questions) if (q.newer) findings.push({ id: `D|Q|${q.code}@${q.version}>${q.newer}`, severity: 'WARNING', area: 'DEPENDENCIES', title: `A question is pinned at v${q.version}; v${q.newer} is now approved`, why: `“${q.text}” — used in ${q.usedIn.join(', ')}. The survey keeps the wording it pinned until someone chooses otherwise.`, fix: 'Move to the newer version where it is used, or acknowledge that this survey keeps the pinned wording.', module: q.usedIn[0] });
  for (const c of lock.conditions) if (c.newer) findings.push({ id: `D|C|${c.code}@${c.version}>${c.newer}`, severity: 'WARNING', area: 'DEPENDENCIES', title: `The condition “${c.name}” is pinned at v${c.version}; v${c.newer} is now approved`, why: `Used in ${c.usedIn.join(', ')}. A newer version of a condition is never applied silently (D-129).`, fix: 'Choose the newer version where it is used, or acknowledge that this survey keeps the pinned one.', module: c.usedIn[0] });

  // wording: what was approved (in simulation) with the last published version stays approved; anything else is reviewed now
  const last = sg.publications[sg.publications.length - 1];
  const before = new Map((last?.lock.questions ?? []).map((q) => [q.code, q.version]));
  const toApprove = lock.questions.filter((q) => before.get(q.code) !== q.version).map((q) => ({
    code: q.code, version: q.version, text: q.text, usedIn: q.usedIn,
    why: before.has(q.code) ? `Changed since version ${last!.label} (was v${before.get(q.code)})` : last ? `New since version ${last.label}` : 'First submission: all wording is reviewed',
  }));
  if (toApprove.length) findings.push({ id: `W|${toApprove.length}`, severity: 'INFO', area: 'WORDING', title: `${toApprove.length} question wording${toApprove.length === 1 ? '' : 's'} must be approved in review`, why: last ? `New or changed since version ${last.label}. Wording approved with an earlier version stays approved only while it is unchanged.` : 'Nothing has been published yet, so every wording is reviewed.', fix: 'The checker reads each one and confirms it before approving.' });

  if (!survey.purpose.trim()) findings.push({ id: 'G|PURPOSE', severity: 'WARNING', area: 'GOVERNANCE', title: 'The survey has no stated purpose', why: 'A reviewer needs to know what the survey is for to judge whether it is complete.', fix: 'Acknowledge, or recreate the survey with a purpose.' });
  findings.push({ id: 'G|NO-ANSWER', severity: 'WARNING', area: 'GOVERNANCE', title: 'What happens when a customer does not answer is not decided yet', why: 'Silence, refusal, a dropped call, and how often a question may be repeated are open business and compliance decisions (contract §5.5). No survey can define them yet, and nothing is assumed.', fix: 'Acknowledge that this is outstanding. It must be decided before any survey is used on real calls.' });
  const halts = survey.sequence.filter((i) => eligibilityOf(i)?.unknownPolicy === 'SKIP_WITH_REASON');
  if (halts.length) findings.push({ id: `G|SKIP-UNKNOWN|${halts.map((x) => x.id).join(',')}`, severity: 'WARNING', area: 'GOVERNANCE', title: `${halts.length} module${halts.length === 1 ? ' is' : 's are'} skipped when information is missing`, why: `${halts.map((x) => names.get(x.id)).join(', ')}: when the record lacks what the condition needs, the module is skipped and the reason recorded, instead of stopping for review. That is a deliberate choice a reviewer should see.`, fix: 'Acknowledge, or set the module to stop for review instead.', module: names.get(halts[0]!.id), where: { surveyId: survey.id, instanceId: halts[0]!.id, part: 'entry' } });

  // coverage: what the synthetic customers reach. It can add findings; it can never remove one.
  const coverage: CoverageLine[] = [];
  const reached = new Set<string>();
  for (const p of survey.sequence.length ? PROFILES : []) {
    const r = playback(ws, survey, p);
    const state = r.terminal?.state ?? 'PENDING';
    const ran = r.modules.filter((m) => m.status === 'ACTIVATED').map((m) => m.name);
    r.modules.filter((m) => m.status === 'ACTIVATED').forEach((m) => reached.add(m.instance));
    coverage.push({ profile: p.id, name: p.name, state, ending: state === 'PENDING' ? 'Stopped at a question' : `${ENDING[state]}${r.terminal?.surveyOutcome && state !== 'COMPLETED' ? ` · ${OUTCOME_LABEL[r.terminal.surveyOutcome]}` : ''}`, ran });
    if (state === 'DRAFT_INVALID') findings.push({ id: `C|INVALID|${p.id}|${r.terminal?.reason}`, severity: 'BLOCKER', area: 'COVERAGE', title: `The draft cannot run for “${p.name}”`, why: r.end?.why ?? 'The draft is incomplete at a point this customer reaches.', fix: 'Fix the blocker it runs into; it is listed in its own group.', where: { surveyId: survey.id, instanceId: survey.sequence.find((x) => (r.terminal?.at ?? '').startsWith(x.id))?.id } });
  }
  for (const inst of survey.sequence) if (coverage.length && !reached.has(inst.id)) findings.push({ id: `C|UNREACHED|${inst.id}`, severity: 'WARNING', area: 'COVERAGE', title: `No synthetic customer reaches ${names.get(inst.id)}`, why: 'None of the demonstration customers runs this module, so its questions and routes were not exercised by the simulator. It may still be correct.', fix: 'Acknowledge, or check its activation and eligibility.', module: names.get(inst.id), where: { surveyId: survey.id, instanceId: inst.id } });

  for (const f of findings) if (f.severity === 'WARNING' && sg.acks[f.id]) f.acknowledged = sg.acks[f.id];
  const order: Record<Severity, number> = { BLOCKER: 0, WARNING: 1, INFO: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const areas = Object.fromEntries(AREAS.map((a) => {
    const mine = findings.filter((f) => f.area === a.id);
    const blockers = mine.filter((f) => f.severity === 'BLOCKER').length, warnings = mine.filter((f) => f.severity === 'WARNING').length;
    const open = mine.filter((f) => f.severity === 'WARNING' && !f.acknowledged).length;
    return [a.id, { blockers, warnings, open, info: mine.filter((f) => f.severity === 'INFO').length, state: blockers ? 'BLOCKED' : open ? 'ATTENTION' : 'OK' }];
  })) as Readiness['areas'];
  const blockers = findings.filter((f) => f.severity === 'BLOCKER').length;
  const warnings = findings.filter((f) => f.severity === 'WARNING').length;
  const open = findings.filter((f) => f.severity === 'WARNING' && !f.acknowledged).length;
  const reasons = [
    ...(blockers ? [`${blockers} blocker${blockers === 1 ? '' : 's'} must be fixed`] : []),
    ...(open ? [`${open} warning${open === 1 ? '' : 's'} must be acknowledged`] : []),
  ];
  return { fingerprint: surveyFingerprint(ws, survey), findings, blockers, warnings, open, areas, ready: !blockers && !open, reasons, lock, coverage, wording: { total: lock.questions.length, toApprove } };
}

// ---- lifecycle -----------------------------------------------------------------------------------------------------------
export type Stage = 'DRAFT' | 'IN_REVIEW' | 'REJECTED' | 'APPROVED' | 'PUBLISHED';
export interface Standing {
  stage: Stage;
  /** Content fingerprint of the DRAFT as it is now. */
  fingerprint: string;
  /** The candidate the stage refers to (open, sent back, or published), or null when there is none. */
  candidate: Submission | null;
  published: Publication | null;
  /** The draft is not the same content as that candidate: it has work the candidate does not contain. */
  draftDiffers: boolean;
  text: string;
}
const OPEN = (s: Submission | null | undefined): boolean => !!s && (s.status === 'IN_REVIEW' || s.status === 'APPROVED');
/**
 * Where things stand. The stage is the stage of a CANDIDATE, looked up by ID in the record — never inferred from what the
 * draft currently looks like. An open candidate stays in review or approved whatever happens to the draft; the draft is
 * reported separately (`draftDiffers`). Editing or undoing therefore cannot give, remove or move an approval.
 */
export function standing(ws: Workspace, survey: Survey, sg: SurveyGov = EMPTY): Standing {
  const fingerprint = surveyFingerprint(ws, survey);
  const latest = sg.submissions[sg.submissions.length - 1] ?? null;
  const published = sg.publications[sg.publications.length - 1] ?? null;
  const same = latest?.candidate.fingerprint === fingerprint;
  const base = { fingerprint, published };
  const name = latest ? `Candidate ${latest.id} (revision ${latest.n})` : '';
  const later = same ? '' : '. The draft has later changes that are not part of it';
  if (latest && OPEN(latest)) return { ...base, candidate: latest, draftDiffers: !same, stage: latest.status as Stage, text: `${name} ${latest.status === 'IN_REVIEW' ? 'is waiting for a checker' : 'is approved and waiting for a publisher'}${later}` };
  if (latest?.status === 'REJECTED' && same) return { ...base, candidate: latest, draftDiffers: false, stage: 'REJECTED', text: `${name} was sent back for changes` };
  if (latest?.status === 'PUBLISHED' && same) return { ...base, candidate: latest, draftDiffers: false, stage: 'PUBLISHED', text: `Identical to published version ${published!.label}` };
  return { ...base, candidate: null, draftDiffers: true, stage: 'DRAFT', text: published ? `Draft with changes since version ${published.label}` : 'Draft, never submitted' };
}

export const setActor = (g: GovState, id: string): GovState => ({ ...g, actor: id });

export function acknowledge(g: GovState, surveyId: string, finding: Finding, note: string, at: number): GovState {
  if (finding.severity !== 'WARNING') throw new Error(finding.severity === 'BLOCKER' ? 'A blocker cannot be acknowledged. It has to be fixed.' : 'There is nothing to acknowledge here.');
  if (!note.trim()) throw new Error('Say why this is acceptable. The reviewer will read it.');
  const sg = govOf(g, surveyId);
  return put(g, surveyId, { ...sg, acks: { ...sg.acks, [finding.id]: { by: g.actor, note: note.trim() } }, audit: log(sg, at, g.actor, 'Acknowledged a warning', `${finding.title} — “${note.trim()}”`) });
}
export function unacknowledge(g: GovState, surveyId: string, finding: Finding, at: number): GovState {
  const sg = govOf(g, surveyId);
  const acks = { ...sg.acks };
  delete acks[finding.id];
  return put(g, surveyId, { ...sg, acks, audit: log(sg, at, g.actor, 'Withdrew an acknowledgement', finding.title) });
}

/** Why the current actor cannot submit this draft as a new candidate, or null. */
export function submitProblem(g: GovState, ws: Workspace, survey: Survey): string | null {
  const sg = govOf(g, survey.id);
  const st = standing(ws, survey, sg);
  if (!canAuthor(g.actor)) return 'Only an author submits a draft for review.';
  if (st.stage === 'IN_REVIEW' && !st.draftDiffers) return `This exact draft is already candidate ${st.candidate!.id}, waiting for a checker.`;
  if (st.stage === 'APPROVED' && !st.draftDiffers) return `This exact draft is already candidate ${st.candidate!.id}, which is approved.`;
  if (st.stage === 'PUBLISHED') return `Nothing has changed since version ${st.published!.label}.`;
  if (st.stage === 'REJECTED') return `This exact draft was sent back as candidate ${st.candidate!.id}. Change it before submitting again.`;
  const r = assess(ws, survey, sg);
  return r.ready ? null : `Not ready for review: ${r.reasons.join('; ')}.`;
}
/**
 * Freezes the draft as a NEW candidate with the next revision number. A candidate still open from an earlier submission
 * is superseded: it keeps its record, but can no longer be approved or published. Its approval, if it had one, is not
 * carried over — the new candidate starts in review.
 */
export function submit(g: GovState, ws: Workspace, survey: Survey, note: string, at: number): GovState {
  const problem = submitProblem(g, ws, survey);
  if (problem) throw new Error(problem);
  if (!note.trim()) throw new Error('Describe what changed and why. The reviewer and the audit trail need it.');
  const sg = govOf(g, survey.id);
  const r = assess(ws, survey, sg);
  const candidate = snapshot(ws, survey);
  const manifest = lockOf(candidate.ws, surveyOf(candidate));
  const n = sg.submissions.length + 1;
  const sub: Submission = {
    id: `C-${n}`, n, by: g.actor, at, note: note.trim(), candidate, manifest, manifestHash: manifestHashOf(manifest), wording: r.wording.toApprove, status: 'IN_REVIEW',
    acknowledged: r.findings.filter((f) => f.acknowledged).map((f) => ({ title: f.title, ...f.acknowledged! })),
  };
  let audit = sg.audit;
  const earlier = sg.submissions.map((s) => {
    if (!OPEN(s)) return s;
    audit = log({ ...sg, audit }, at, g.actor, 'Superseded a candidate', `Candidate ${s.id} (${s.status === 'APPROVED' ? 'approved, not published' : 'in review'}) is closed by the submission of ${sub.id}. Its ${s.status === 'APPROVED' ? 'approval is' : 'review is'} not carried over`, s);
    return { ...s, status: 'SUPERSEDED' as const };
  });
  audit = log({ ...sg, audit }, at, g.actor, 'Submitted for review', `Candidate ${sub.id}, revision ${n}, manifest ${sub.manifestHash} — “${note.trim()}”`, sub);
  return put(g, survey.id, { ...sg, submissions: [...earlier, sub], audit });
}

const openCandidate = (sg: SurveyGov, status: 'IN_REVIEW' | 'APPROVED'): Submission | null => { const s = sg.submissions[sg.submissions.length - 1]; return s && s.status === status ? s : null; };

/** Why the current actor cannot decide the candidate in review, or null. The draft plays no part: the candidate is frozen. */
export function decideProblem(g: GovState, survey: Survey): string | null {
  const sub = openCandidate(govOf(g, survey.id), 'IN_REVIEW');
  if (!sub) return 'There is no candidate waiting for a decision.';
  if (!canCheck(g.actor)) return 'Only a checker approves or rejects.';
  if (sub.by === g.actor) return 'You submitted this. Holding the checker permission is not enough: the maker and the checker must be different people.';
  return null;
}
export function decide(g: GovState, survey: Survey, verdict: 'APPROVE' | 'REJECT', comment: string, wordingConfirmed: boolean, at: number): GovState {
  const problem = decideProblem(g, survey);
  if (problem) throw new Error(problem);
  const sg = govOf(g, survey.id);
  const sub = openCandidate(sg, 'IN_REVIEW')!;
  const toApprove = sub.wording.length;
  if (verdict === 'REJECT' && !comment.trim()) throw new Error('Say what must change. The author needs it to act.');
  if (verdict === 'APPROVE' && toApprove && !wordingConfirmed) throw new Error(`Confirm that you have read the ${toApprove} wording${toApprove === 1 ? '' : 's'} to approve.`);
  const done: Submission = { ...sub, status: verdict === 'APPROVE' ? 'APPROVED' : 'REJECTED', decision: { by: g.actor, at, comment: comment.trim(), wordingConfirmed: verdict === 'APPROVE' ? toApprove : 0 } };
  return put(g, survey.id, {
    ...sg, submissions: [...sg.submissions.slice(0, -1), done],
    audit: log(sg, at, g.actor, verdict === 'APPROVE' ? 'Approved (simulated)' : 'Rejected (simulated)', `Candidate ${sub.id}, revision ${sub.n}, manifest ${sub.manifestHash}${comment.trim() ? ` — “${comment.trim()}”` : ''}${verdict === 'APPROVE' && toApprove ? ` · ${toApprove} wording${toApprove === 1 ? '' : 's'} confirmed` : ''}`, sub),
  });
}

/**
 * Why the current actor cannot publish, or null. Publishing is its own permission: being an author or a checker does not
 * grant it. And the person who submitted a candidate may not publish it, whatever permissions they hold.
 */
export function publishProblem(g: GovState, survey: Survey): string | null {
  const sub = openCandidate(govOf(g, survey.id), 'APPROVED');
  if (!sub) return 'Only an approved candidate can be published.';
  if (!canPublish(g.actor)) return `Publishing needs the Publisher permission. ${person(g.actor).name} does not hold it: being ${canCheck(g.actor) ? 'a checker' : 'an author'} does not grant the right to publish.`;
  if (sub.by === g.actor) return 'You submitted this candidate. Holding the Publisher permission is not enough: the person who submits a candidate may not publish it.';
  return null;
}
/** Publishes the approved CANDIDATE — the frozen copy and its manifest — as the next version. The draft is not consulted. */
export function publish(g: GovState, survey: Survey, at: number): GovState {
  const problem = publishProblem(g, survey);
  if (problem) throw new Error(problem);
  const sg = govOf(g, survey.id);
  const sub = openCandidate(sg, 'APPROVED')!;
  const version = sg.publications.length + 1;
  const pub: Publication = { version, label: `${version}.0`, at, candidate: sub.id, revision: sub.n, manifestHash: sub.manifestHash, submittedBy: sub.by, approvedBy: sub.decision!.by, publishedBy: g.actor, snapshot: sub.candidate, lock: sub.manifest, note: sub.note };
  return put(g, survey.id, {
    ...sg, acks: {}, submissions: [...sg.submissions.slice(0, -1), { ...sub, status: 'PUBLISHED' }], publications: [...sg.publications, pub],
    audit: log(sg, at, g.actor, 'Published (simulated)', `Version ${pub.label} = candidate ${sub.id}, revision ${sub.n}, manifest ${sub.manifestHash}: ${pub.lock.modules.length} module, ${pub.lock.questions.length} question and ${pub.lock.conditions.length} condition versions pinned`, sub),
  });
}
export function withdraw(g: GovState, survey: Survey, at: number): GovState {
  const sg = govOf(g, survey.id);
  const sub = sg.submissions[sg.submissions.length - 1];
  if (!sub || sub.status !== 'IN_REVIEW') throw new Error('There is no candidate in review to withdraw.');
  if (sub.by !== g.actor) throw new Error('Only the person who submitted it can withdraw it.');
  return put(g, survey.id, { ...sg, submissions: [...sg.submissions.slice(0, -1), { ...sub, status: 'WITHDRAWN' }], audit: log(sg, at, g.actor, 'Withdrew the candidate', `Candidate ${sub.id}`, sub) });
}

/** A seeded, clearly labelled earlier publication so that a comparison can be shown at once (demonstration survey only). */
export function seedPublication(g: GovState, baseline: Snapshot, at: number): GovState {
  const sg = govOf(g, baseline.surveyId);
  if (sg.publications.length) return g;
  const manifest = lockOf(baseline.ws, surveyOf(baseline));
  const sub: Submission = { id: 'C-1', n: 1, by: 'p-author', at, note: 'First version of the new business callback survey.', candidate: baseline, manifest, manifestHash: manifestHashOf(manifest), wording: [], acknowledged: [], status: 'PUBLISHED', decision: { by: 'p-checker', at: at + 1, comment: 'Reviewed against the storyboard.', wordingConfirmed: manifest.questions.length } };
  const pub: Publication = { version: 1, label: '1.0', at: at + 2, candidate: 'C-1', revision: 1, manifestHash: sub.manifestHash, submittedBy: 'p-author', approvedBy: 'p-checker', publishedBy: 'p-publisher', snapshot: baseline, lock: manifest, note: sub.note, seeded: true };
  const ev = (n: number, t: number, actor: string, action: string, detail: string): AuditEvent => ({ n, at: t, actor, action, detail, candidate: 'C-1', fingerprint: baseline.fingerprint });
  const audit = [
    ev(1, at, 'p-author', 'Submitted for review', 'Candidate C-1 — seeded with the demonstration survey'),
    ev(2, at + 1, 'p-checker', 'Approved (simulated)', 'Candidate C-1 — seeded with the demonstration survey'),
    ev(3, at + 2, 'p-publisher', 'Published (simulated)', 'Version 1.0 = candidate C-1 — seeded with the demonstration survey so that a comparison can be shown'),
  ];
  return put(g, baseline.surveyId, { acks: {}, submissions: [sub], publications: [pub], audit });
}

/** A one-line description of a condition binding, for lists (no placement context). */
export function bindingText(ws: Workspace, b: Binding | null | undefined): string {
  const c = b?.condition.code ? findCondition(ws, b.condition) : undefined;
  return c && b ? describeAst(c.ast, c, b, false) : 'no condition';
}
export { activationOf, findQuestion };
