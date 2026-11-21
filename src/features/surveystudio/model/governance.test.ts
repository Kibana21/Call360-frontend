// SS-02C — validation readiness, the simulated maker-checker lifecycle, and the comparison of two revisions.
import { describe, expect, it } from 'vitest';
import { PROFILES, addDemoSurvey, demoBaseline, playback } from './demo';
import { compare } from './diff';
import { validateSurvey } from './flow';
import {
  acknowledge, assess, closure, decide, decideProblem, emptyGov, govOf, lockOf, manifestHashOf, publish, publishProblem, seedPublication, setActor, snapshot, standing, submit, submitProblem,
  surveyFingerprint, withdraw, type GovState,
} from './governance';
import { large } from './large.test-helper';
import { deriveModule, insertQuestion, newQuestionVersion, setRoute, updateQuestion } from './ops';
import { sampleWorkspace } from './sample';
import { canonical } from './canonical';
import type { Workspace } from './types';

const [ws, id] = addDemoSurvey(sampleWorkspace());
const sv = (w: Workspace) => w.surveys.find((x) => x.id === id)!;
const AT = 1_800_000_000_000;
/** Acknowledge every open warning, as the author. */
const ackAll = (g: GovState, w: Workspace): GovState => assess(w, sv(w), govOf(g, id)).findings.filter((f) => f.severity === 'WARNING' && !f.acknowledged).reduce((acc, f) => acknowledge(acc, id, f, 'Accepted for the demonstration.', AT), g);
const as = (g: GovState, who: string) => setActor(g, who);

describe('the candidate: exactly what is validated, reviewed and published', () => {
  it('contains only what the survey uses, and its fingerprint ignores everything else in the workspace', () => {
    const c = closure(ws, sv(ws));
    expect(c.surveys).toHaveLength(1);
    expect(c.modules.map((m) => m.code).sort()).toEqual([...new Set(sv(ws).sequence.map((i) => i.module.code))].sort());
    const other = large(ws); // an unrelated module added to the library
    expect(surveyFingerprint(other, sv(other))).toBe(surveyFingerprint(ws, sv(ws)));
  });
  it('changes with any change to the survey, and returns to the same value when the change is undone', () => {
    const inst = sv(ws).sequence[0]!;
    const changed = setRoute(ws, id, inst.id, 'UNABLE_TO_VERIFY', '@CONTINUE');
    expect(surveyFingerprint(changed, sv(changed))).not.toBe(surveyFingerprint(ws, sv(ws)));
    const back = setRoute(changed, id, inst.id, 'UNABLE_TO_VERIFY', inst.routes.UNABLE_TO_VERIFY!);
    expect(surveyFingerprint(back, sv(back))).toBe(surveyFingerprint(ws, sv(ws)));
  });
  it('lists every pinned version, and reports a newer approved version without applying it', () => {
    const lock = lockOf(ws, sv(ws));
    expect(lock.modules).toHaveLength(8);
    expect(lock.modules.every((m) => m.shared && m.newer === null)).toBe(true);
    expect(lock.conditions.map((c) => c.code)).toEqual(expect.arrayContaining(['C-IS-ILP', 'C-HIGH-VALUE', 'C-OLDER-CUSTOMER']));
    // publish a second version of a condition in the library: the survey stays pinned, validation raises an acknowledgable warning
    const newer: Workspace = { ...ws, conditions: [...ws.conditions, { ...ws.conditions.find((c) => c.code === 'C-IS-ILP')!, version: 2 }] };
    expect(lockOf(newer, sv(newer)).conditions.find((c) => c.code === 'C-IS-ILP')).toMatchObject({ version: 1, newer: 2 });
    const f = assess(newer, sv(newer)).findings.find((x) => x.id.startsWith('D|C|C-IS-ILP'))!;
    expect(f).toMatchObject({ severity: 'WARNING', area: 'DEPENDENCIES' });
  });
});

describe('validation readiness', () => {
  it('the demonstration survey has no blockers; its warnings must be acknowledged before it is ready', () => {
    const r = assess(ws, sv(ws));
    expect(r.blockers).toBe(0);
    expect(r.findings.filter((f) => f.severity === 'WARNING').map((f) => f.id)).toEqual(expect.arrayContaining(['G|NO-ANSWER']));
    expect(r.ready).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/warnings? must be acknowledged/);
    const g = ackAll(emptyGov(), ws);
    expect(assess(ws, sv(ws), govOf(g, id))).toMatchObject({ ready: true, open: 0 });
  });

  it('groups each blocker in its own area with where it is and what to do', () => {
    let bad = setRoute(ws, id, sv(ws).sequence[0]!.id, 'UNABLE_TO_VERIFY', null);
    const clar = sv(ws).sequence.find((x) => x.module.code === 'M-CLARIFICATIONS')!;
    bad = setRoute(bad, id, clar.id, 'ESCALATE', '@CONTINUE');
    const r = assess(bad, sv(bad));
    expect(r.areas.ROUTING).toMatchObject({ state: 'BLOCKED', blockers: 1 });
    expect(r.areas.ESCALATION).toMatchObject({ state: 'BLOCKED', blockers: 1 });
    const esc = r.findings.find((f) => f.area === 'ESCALATION')!;
    expect(esc).toMatchObject({ severity: 'BLOCKER', module: 'Clarifications' });
    expect(esc.fix).toMatch(/cannot override a mandatory escalation/);
    expect(esc.where).toMatchObject({ instanceId: clar.id, on: 'ESCALATE' });
  });

  it('a structurally invalid survey is NOT ready merely because a synthetic customer completes it', () => {
    const bad = setRoute(ws, id, sv(ws).sequence[0]!.id, 'UNABLE_TO_VERIFY', null);
    // the ordinary customer never takes that route, so the journey still completes…
    expect(playback(bad, sv(bad), PROFILES.find((p) => p.id === 'NORMAL')!).terminal).toMatchObject({ state: 'COMPLETED' });
    // …and the survey is still not ready, even with every warning acknowledged
    const g = ackAll(emptyGov(), bad);
    const r = assess(bad, sv(bad), govOf(g, id));
    expect(r).toMatchObject({ ready: false, open: 0, blockers: 1 });
    expect(submitProblem(g, bad, sv(bad))).toMatch(/Not ready for review: 1 blocker must be fixed/);
    expect(() => submit(g, bad, sv(bad), 'Please review', AT)).toThrow(/Not ready for review/);
  });

  it('a blocker cannot be acknowledged away', () => {
    const bad = setRoute(ws, id, sv(ws).sequence[0]!.id, 'UNABLE_TO_VERIFY', null);
    const blocker = assess(bad, sv(bad)).findings.find((f) => f.severity === 'BLOCKER')!;
    expect(() => acknowledge(emptyGov(), id, blocker, 'It is fine', AT)).toThrow(/cannot be acknowledged/);
    const warning = assess(ws, sv(ws)).findings.find((f) => f.severity === 'WARNING')!;
    expect(() => acknowledge(emptyGov(), id, warning, '  ', AT)).toThrow(/Say why/);
  });

  it('reports a draft that cannot run for a synthetic customer, and a module no customer reaches', () => {
    const noSkip = { ...ws, surveys: ws.surveys.map((s) => (s.id !== id ? s : { ...s, sequence: s.sequence.map((i) => (i.module.code === 'M-ESCALATION' ? { ...i, ifIneligible: null } : i)) })) };
    const r = assess(noSkip, sv(noSkip));
    expect(r.findings.some((f) => f.area === 'COVERAGE' && f.severity === 'BLOCKER' && /cannot run for “Uneasy younger customer”/.test(f.title))).toBe(true);
    expect(r.coverage.find((c) => c.profile === 'UNEASY_YOUNGER')).toMatchObject({ state: 'DRAFT_INVALID' });
    expect(assess(ws, sv(ws)).coverage).toHaveLength(PROFILES.length);
  });
});

describe('the simulated maker-checker-publisher lifecycle', () => {
  const ready = ackAll(emptyGov(), ws);
  const edited = setRoute(ws, id, sv(ws).sequence[0]!.id, 'UNABLE_TO_VERIFY', { surveyOutcome: 'ESCALATE' });
  const inReview = submit(ready, ws, sv(ws), 'Adds the specialist call.', AT);
  const approved = decide(as(inReview, 'p-checker'), sv(ws), 'APPROVE', 'Looks right.', true, AT + 1);

  it('only an author submits, with a reason; submitting freezes a candidate with an ID, a revision and a pinned manifest', () => {
    expect(submitProblem(as(ready, 'p-checker'), ws, sv(ws))).toMatch(/Only an author/);
    expect(submitProblem(as(ready, 'p-publisher'), ws, sv(ws))).toMatch(/Only an author/);
    expect(() => submit(ready, ws, sv(ws), '', AT)).toThrow(/Describe what changed/);
    const c = govOf(inReview, id).submissions[0]!;
    expect(c).toMatchObject({ id: 'C-1', n: 1, by: 'p-author', status: 'IN_REVIEW' });
    expect(c.candidate.fingerprint).toBe(surveyFingerprint(ws, sv(ws)));
    expect(c.manifest.modules).toHaveLength(8);
    expect(c.manifestHash).toBe(manifestHashOf(lockOf(ws, sv(ws))));
    expect(c.wording.length).toBeGreaterThan(0);
    expect(c.acknowledged.length).toBeGreaterThan(0);
    expect(standing(ws, sv(ws), govOf(inReview, id))).toMatchObject({ stage: 'IN_REVIEW', draftDiffers: false, candidate: { id: 'C-1' } });
    expect(submitProblem(inReview, ws, sv(ws))).toMatch(/already candidate C-1/);
  });

  it('the submitted candidate is immutable: the author goes on editing a separate draft and the candidate does not move', () => {
    const frozen = canonical(govOf(inReview, id).submissions[0]!.candidate.ws);
    const st = standing(edited, sv(edited), govOf(inReview, id));
    // the candidate is still in review, exactly as submitted; the draft is reported as having moved on
    expect(st).toMatchObject({ stage: 'IN_REVIEW', draftDiffers: true, candidate: { id: 'C-1', status: 'IN_REVIEW' } });
    expect(st.text).toBe('Candidate C-1 (revision 1) is waiting for a checker. The draft has later changes that are not part of it');
    expect(canonical(govOf(inReview, id).submissions[0]!.candidate.ws)).toBe(frozen);
    // the checker decides the CANDIDATE; what the draft looks like plays no part
    expect(decideProblem(as(inReview, 'p-checker'), sv(edited))).toBeNull();
    const done = decide(as(inReview, 'p-checker'), sv(edited), 'APPROVE', '', true, AT + 1);
    const c = govOf(done, id).submissions[0]!;
    expect(c.status).toBe('APPROVED');
    expect(c.candidate.fingerprint).toBe(surveyFingerprint(ws, sv(ws))); // what was approved is what was submitted, not the edited draft
    expect(c.candidate.fingerprint).not.toBe(surveyFingerprint(edited, sv(edited)));
  });

  it('separates maker and checker: an author cannot approve, and a person with every permission cannot approve her own submission', () => {
    expect(decideProblem(inReview, sv(ws))).toMatch(/Only a checker/);
    expect(decideProblem(as(inReview, 'p-publisher'), sv(ws))).toMatch(/Only a checker/);
    expect(() => decide(inReview, sv(ws), 'APPROVE', '', true, AT)).toThrow(/Only a checker/);
    const own = submit(as(ready, 'p-lead'), ws, sv(ws), 'My own change.', AT);
    expect(decideProblem(own, sv(ws))).toMatch(/You submitted this.*must be different people/);
    expect(() => decide(own, sv(ws), 'APPROVE', '', true, AT)).toThrow(/must be different people/);
    expect(decideProblem(as(own, 'p-checker'), sv(ws))).toBeNull();
    expect(decideProblem(as(inReview, 'p-lead'), sv(ws))).toBeNull(); // she can check the author's submission
  });

  it('approval needs the wording to have been read; sending back needs a comment and closes that candidate', () => {
    const g = as(inReview, 'p-checker');
    expect(() => decide(g, sv(ws), 'APPROVE', '', false, AT)).toThrow(/Confirm that you have read the \d+ wordings/);
    expect(() => decide(g, sv(ws), 'REJECT', '', false, AT)).toThrow(/Say what must change/);
    const rejected = decide(g, sv(ws), 'REJECT', 'The closing wording is unclear.', false, AT);
    expect(standing(ws, sv(ws), govOf(rejected, id)).stage).toBe('REJECTED');
    expect(submitProblem(as(rejected, 'p-author'), ws, sv(ws))).toMatch(/sent back as candidate C-1. Change it/);
    // a changed draft is a new candidate with the next revision number
    const again = submit(as(rejected, 'p-author'), edited, sv(edited), 'Escalate when identity cannot be verified.', AT + 5);
    expect(govOf(again, id).submissions.map((c) => `${c.id}:${c.status}`)).toEqual(['C-1:REJECTED', 'C-2:IN_REVIEW']);
  });

  it('publishing is a separate permission: neither an author nor a checker can publish, and the submitter never can', () => {
    expect(publishProblem(inReview, sv(ws))).toMatch(/Only an approved candidate/);
    expect(publishProblem(as(approved, 'p-author'), sv(ws))).toMatch(/needs the Publisher permission. Mei Ling Tan does not hold it: being an author does not grant/);
    // the checker who approved it holds no publishing right merely by being a checker
    expect(publishProblem(as(approved, 'p-checker'), sv(ws))).toMatch(/Arjun Menon does not hold it: being a checker does not grant the right to publish/);
    expect(() => publish(as(approved, 'p-checker'), sv(ws), AT)).toThrow(/Publisher permission/);
    expect(publishProblem(as(approved, 'p-publisher'), sv(ws))).toBeNull();
    expect(publishProblem(as(approved, 'p-lead'), sv(ws))).toBeNull(); // holds the permission and did not submit this candidate
    // identity: she holds the permission, but she submitted this one
    const own = decide(as(submit(as(ready, 'p-lead'), ws, sv(ws), 'My own change.', AT), 'p-checker'), sv(ws), 'APPROVE', '', true, AT + 1);
    expect(publishProblem(as(own, 'p-lead'), sv(ws))).toMatch(/You submitted this candidate. Holding the Publisher permission is not enough/);
    expect(() => publish(as(own, 'p-lead'), sv(ws), AT + 2)).toThrow(/may not publish it/);
    expect(publishProblem(as(own, 'p-publisher'), sv(ws))).toBeNull();
  });

  it('an approval is bound to its candidate by ID: editing the draft does not void it, and nothing moves it onto another draft', () => {
    const bound = govOf(approved, id).submissions[0]!;
    // the draft is edited: candidate C-1 is still approved and still publishable — as itself
    const st = standing(edited, sv(edited), govOf(approved, id));
    expect(st).toMatchObject({ stage: 'APPROVED', draftDiffers: true, candidate: { id: 'C-1' } });
    expect(publishProblem(as(approved, 'p-publisher'), sv(edited))).toBeNull();
    const pub = govOf(publish(as(approved, 'p-publisher'), sv(edited), AT + 2), id).publications[0]!;
    expect(pub).toMatchObject({ candidate: 'C-1', revision: 1, manifestHash: bound.manifestHash });
    expect(pub.snapshot.fingerprint).toBe(bound.candidate.fingerprint); // the CANDIDATE was published, not the edited draft
    expect(pub.snapshot.fingerprint).not.toBe(surveyFingerprint(edited, sv(edited)));
    // the edited draft itself is not approved: it would have to be submitted, and would start in review
    const next = submit(as(approved, 'p-author'), edited, sv(edited), 'Escalate when identity cannot be verified.', AT + 3);
    expect(govOf(next, id).submissions.map((c) => `${c.id}:${c.status}`)).toEqual(['C-1:SUPERSEDED', 'C-2:IN_REVIEW']);
    expect(govOf(next, id).audit.map((a) => a.action)).toContain('Superseded a candidate');
  });

  it('undo does not resurrect an approval: a draft made identical to a superseded candidate is NOT approved', () => {
    // C-1 approved → the author edits and submits C-2 (C-1 superseded) → the author undoes the edit
    const next = submit(as(approved, 'p-author'), edited, sv(edited), 'Escalate when identity cannot be verified.', AT + 3);
    const undone = ws; // the draft is, once more, byte-for-byte the content of C-1
    expect(surveyFingerprint(undone, sv(undone))).toBe(govOf(next, id).submissions[0]!.candidate.fingerprint);
    const st = standing(undone, sv(undone), govOf(next, id));
    expect(st).toMatchObject({ stage: 'IN_REVIEW', candidate: { id: 'C-2' }, draftDiffers: true }); // the record, not the look of the draft
    expect(govOf(next, id).submissions[0]!.status).toBe('SUPERSEDED');
    expect(publishProblem(as(next, 'p-publisher'), sv(undone))).toMatch(/Only an approved candidate/);
    expect(() => publish(as(next, 'p-publisher'), sv(undone), AT + 4)).toThrow(/Only an approved candidate/);
    // submitting that same content again makes a NEW candidate, C-3, which starts in review like any other
    const third = submit(as(next, 'p-author'), undone, sv(undone), 'Reverts the escalation change.', AT + 5);
    expect(govOf(third, id).submissions.map((c) => `${c.id}:${c.status}`)).toEqual(['C-1:SUPERSEDED', 'C-2:SUPERSEDED', 'C-3:IN_REVIEW']);
    expect(govOf(third, id).submissions[2]!.candidate.fingerprint).toBe(govOf(third, id).submissions[0]!.candidate.fingerprint); // same content, different candidate
    expect(govOf(third, id).submissions[2]!.decision).toBeUndefined();
  });

  it('publishes the approved candidate with its manifest, immutably, and records who did what against the candidate ID', () => {
    const g = publish(as(approved, 'p-publisher'), sv(ws), AT + 2);
    const sg = govOf(g, id);
    const pub = sg.publications[0]!;
    expect(pub).toMatchObject({ version: 1, label: '1.0', candidate: 'C-1', revision: 1, submittedBy: 'p-author', approvedBy: 'p-checker', publishedBy: 'p-publisher' });
    expect(new Set([pub.submittedBy, pub.approvedBy, pub.publishedBy]).size).toBe(3);
    expect(pub.lock.modules).toHaveLength(8);
    expect(standing(ws, sv(ws), sg).stage).toBe('PUBLISHED');
    expect(sg.acks).toEqual({});
    const mine = sg.audit.filter((a) => a.candidate);
    expect(mine.map((a) => a.action)).toEqual(['Submitted for review', 'Approved (simulated)', 'Published (simulated)']);
    expect(mine.every((a) => a.candidate === 'C-1' && a.fingerprint === pub.snapshot.fingerprint)).toBe(true);
    const frozen = canonical(pub.snapshot.ws);
    expect(standing(edited, sv(edited), sg)).toMatchObject({ stage: 'DRAFT', text: 'Draft with changes since version 1.0' });
    expect(canonical(pub.snapshot.ws)).toBe(frozen);
    expect(assess(ws, sv(ws), sg).wording.toApprove).toEqual([]);
  });

  it('only the submitter can withdraw a candidate in review', () => {
    expect(() => withdraw(as(inReview, 'p-checker'), sv(ws), AT)).toThrow(/Only the person who submitted/);
    expect(standing(ws, sv(ws), govOf(withdraw(inReview, sv(ws), AT), id)).stage).toBe('DRAFT');
  });
});

describe('comparing two revisions', () => {
  const before = demoBaseline(ws, id);
  const a = snapshot(before, sv(before)), b = snapshot(ws, sv(ws));
  const d = compare(a, b);

  it('the earlier revision of the demonstration survey is itself valid', () => {
    expect(validateSurvey(before, sv(before))).toEqual([]);
  });

  it('reports added modules, routing changes and condition changes in a reviewer’s words', () => {
    expect(d.identical).toBe(false);
    expect(d.changes.filter((c) => c.area === 'MODULES').map((c) => `${c.kind} ${c.title}`)).toEqual(['ADDED Escalation and follow-up was added']);
    const cond = d.changes.filter((c) => c.area === 'CONDITIONS').map((c) => c.title);
    expect(cond).toEqual(expect.arrayContaining(['Whether High value review may run changed (eligibility)', 'Whether Policy replacement may run changed (eligibility)']));
    const hv = d.changes.find((c) => c.title.startsWith('Whether High value review'))!;
    expect(hv.before).toMatch(/30,000/);
    expect(hv.after).toMatch(/12,000/);
    expect(d.changes.find((c) => c.title.startsWith('Whether Policy replacement'))).toMatchObject({ before: expect.stringMatching(/stop for review/), after: expect.stringMatching(/skip and record why/) });
    const routes = d.changes.filter((c) => c.area === 'ROUTING');
    expect(routes.find((c) => c.title === 'Affordability check: what “Clarification required” leads to')).toMatchObject({ before: 'end the call: Clarification required', after: 'go to Escalation and follow-up' });
    expect(routes.some((c) => c.module === 'Suitability' && c.after === 'go to Clarifications')).toBe(true);
  });

  it('shows which synthetic customers take a different journey, and says what the change requires', () => {
    const hit = d.journeys.filter((j) => j.changed).map((j) => j.profile);
    expect(hit).toEqual(expect.arrayContaining(['HIGH_PREMIUM', 'MISSING', 'UNEASY_OLDER', 'UNEASY_NO_AGE']));
    expect(hit).not.toContain('NORMAL');
    expect(d.journeys.find((j) => j.profile === 'UNEASY_OLDER')!.detail).toMatch(/Now also runs Escalation and follow-up/);
    expect(d.needs).toMatchObject({ revalidation: true, reapproval: true });
    expect(d.needs.wordingApproval).toBeGreaterThan(0); // the added module brings wording that was never approved with this survey
    expect(d.needs.text.join(' ')).toMatch(/needs a fresh review by a different person from the author/);
  });

  it('a revision compared with itself is identical and requires nothing', () => {
    const same = compare(b, snapshot(ws, sv(ws)));
    expect(same).toMatchObject({ identical: true, changes: [], impacted: 0, needs: { revalidation: false, reapproval: false, wordingApproval: 0 } });
  });

  it('a wording change is matched by question identity: it is reported once, with the version it now pins', () => {
    const inst = sv(ws).sequence.find((x) => x.module.code === 'M-GENERAL')!;
    const [w1, key] = deriveModule(ws, id, inst.id);
    const w2 = updateQuestion(newQuestionVersion(w1, key, 'n2'), key, 'n2', { text: 'Can you confirm that you bought this policy yourself?' });
    const dd = compare(b, snapshot(w2, sv(w2)));
    const wording = dd.changes.filter((c) => c.area === 'QUESTIONS');
    expect(wording).toHaveLength(1);
    expect(wording[0]).toMatchObject({ kind: 'MODIFIED', title: 'General verification: the wording of a question changed', after: 'Can you confirm that you bought this policy yourself?', wording: true });
    expect(dd.changes.filter((c) => c.area === 'DEPENDENCIES').map((c) => c.title)).toEqual(['General verification now pins a different module version', 'A question now pins a different version']);
    expect(dd.changes.filter((c) => c.area === 'ROUTING')).toEqual([]);
    expect(dd.needs.wordingApproval).toBe(1);
    expect(dd.renumbered).toEqual([]);
  });

  it('inserting a question renumbers the ones after it — reported as renumbering, never as changes to those questions', () => {
    const inst = sv(ws).sequence.find((x) => x.module.code === 'M-GENERAL')!;
    const [w1, key] = deriveModule(ws, id, inst.id);
    const [w2, added] = insertQuestion(w1, key, { from: 'n1', on: 'YES' }, { type: 'YES_NO' });
    const w3 = updateQuestion(w2, key, added, { text: 'Is now a good time to talk?' });
    const dd = compare(b, snapshot(w3, sv(w3)));
    const q = dd.changes.filter((c) => c.area === 'QUESTIONS');
    expect(q.map((c) => `${c.kind} ${c.title}`)).toEqual(['ADDED General verification: a question was added']);
    // the questions that moved down keep their identity: they appear under renumbering, with no wording or content change
    expect(dd.renumbered.map((r) => `${r.before}→${r.after}`)).toEqual(['Q2→Q3', 'Q3→Q4']);
    expect(dd.changes.some((c) => /wording of a question changed/.test(c.title))).toBe(false);
    // the one route that really changed is reported: the first question now leads to the new one
    expect(dd.changes.filter((c) => c.area === 'ROUTING')).toHaveLength(1);
  });

  it('the seeded earlier publication of the demonstration survey is labelled as seeded and compares with the draft', () => {
    const g = seedPublication(emptyGov(), a, AT);
    const sg = govOf(g, id);
    expect(sg.publications[0]).toMatchObject({ label: '1.0', seeded: true, candidate: 'C-1', submittedBy: 'p-author', approvedBy: 'p-checker', publishedBy: 'p-publisher' });
    expect(standing(ws, sv(ws), sg)).toMatchObject({ stage: 'DRAFT', text: 'Draft with changes since version 1.0' });
    // wording that came with 1.0 is not asked for again; the new module's wording is
    const need = assess(ws, sv(ws), sg).wording.toApprove;
    expect(need.length).toBeGreaterThan(0);
    expect(need.every((q) => q.usedIn.includes('Escalation and follow-up'))).toBe(true);
    expect(seedPublication(g, a, AT)).toBe(g); // never seeded twice
  });
});
