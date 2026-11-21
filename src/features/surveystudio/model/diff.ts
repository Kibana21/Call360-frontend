// Survey Studio prototype (SS-02C) — comparing two revisions of one survey.
// A question is matched by its IDENTITY (its place in the module and its question code), never by its display number:
// inserting a question renumbers the ones after it, and that is reported as renumbering, not as a change to them.
import { PROFILES, playback } from './demo';
import { targetLabel } from './engine';
import { buildFlow } from './flow';
import { bindingText, lockOf, surveyOf, type Snapshot } from './governance';
import { activationOf, eligibilityOf, findModule, findQuestion, routesFrom } from './ops';
import { OUTCOME_LABEL } from './sample';
import { DELIVERY_LABEL, deliveryOf } from './wording';
import { isQuestion, mKey, type Instance, type Module, type ModuleNode, type OutcomeCode, type Question, type Survey, type SurveyTarget, type Workspace } from './types';

export type ChangeArea = 'MODULES' | 'QUESTIONS' | 'ROUTING' | 'CONDITIONS' | 'DEPENDENCIES';
export const CHANGE_AREAS: Array<{ id: ChangeArea; label: string }> = [
  { id: 'MODULES', label: 'Modules' }, { id: 'QUESTIONS', label: 'Questions and wording' }, { id: 'ROUTING', label: 'Routing' },
  { id: 'CONDITIONS', label: 'Activation and eligibility conditions' }, { id: 'DEPENDENCIES', label: 'Pinned versions' },
];
export interface Change {
  id: string; area: ChangeArea; kind: 'ADDED' | 'REMOVED' | 'MODIFIED' | 'MOVED';
  title: string; before?: string; after?: string; module?: string;
  /** true = customer-facing wording is new or different, so it needs wording approval. */
  wording?: boolean;
  where?: { instanceId?: string; nodeId?: string };
}
export interface JourneyImpact { profile: string; name: string; changed: boolean; before: string; after: string; detail: string }
export interface Comparison {
  identical: boolean;
  changes: Change[];
  /** Questions whose display number moved while their identity and content stayed the same. Not changes. */
  renumbered: Array<{ module: string; text: string; before: string; after: string }>;
  journeys: JourneyImpact[];
  impacted: number;
  needs: { revalidation: boolean; wordingApproval: number; reapproval: boolean; text: string[] };
}

const short = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const nameOf = (ws: Workspace, i: Instance) => findModule(ws, mKey(i.module))?.name ?? i.id;
const targetText = (ws: Workspace, s: Survey, t: SurveyTarget | null | undefined): string =>
  (t === null || t === undefined ? 'not decided' : t === '@CONTINUE' ? 'continue with the next module' : 'surveyOutcome' in t ? `end the call: ${OUTCOME_LABEL[t.surveyOutcome]}`
    : `go to ${s.sequence.find((x) => x.id === t.instance) ? nameOf(ws, s.sequence.find((x) => x.id === t.instance)!) : 'a removed module'}`);
const activationText = (ws: Workspace, s: Survey, i: Instance): string => {
  const a = activationOf(i);
  if (!a) return 'selected in sequence';
  const of = s.sequence.find((x) => x.id === a.of);
  return `selected after ${of ? nameOf(ws, of) : 'a removed module'} ends with ${a.outcomes.map((o) => OUTCOME_LABEL[o]).join(' or ')}`;
};
const POLICY = { BLOCK: 'stop for review', SKIP_WITH_REASON: 'skip and record why', ROUTE: 'follow the Unknown route' } as const;
const eligibilityText = (ws: Workspace, i: Instance): string => {
  const b = eligibilityOf(i);
  return b ? `eligible when ${bindingText(ws, b)}; if information is missing: ${b.unknownPolicy ? POLICY[b.unknownPolicy] : 'not chosen'}` : 'no eligibility condition';
};
const VIA: Record<string, string> = { ANY: 'Any answer', AFTER_CAPTURE: 'After the answer', MATCH: 'Matches', NO_MATCH: 'Otherwise', UNKNOWN: 'Information missing', FALLBACK: 'No rule fits', REJOIN: 'After the follow-ups', YES: 'Yes', NO: 'No' };
function routesText(ws: Workspace, m: Module, n: ModuleNode, numbers: Map<string, string>): string {
  const q = isQuestion(n) ? findQuestion(ws, n.q) : undefined;
  const label = (via: string) => {
    const [kind, code] = via.split(':');
    const opt = (c: string) => q?.options.find((o) => o.code === c)?.label ?? c;
    if (code && kind === 'FOLLOWUP') return `Follow-up for “${opt(code)}”`;
    if (code && kind === 'INTERRUPT') return `“${opt(code)}” interrupts`;
    if (code && kind === 'RULE') { const r = isQuestion(n) ? n.routing.rules?.find((x) => x.id === code) : undefined; return r ? `Rule: ${r.kind.toLowerCase()} of ${r.options.map(opt).join(', ')}` : 'Rule'; }
    return VIA[via] ?? `“${opt(via)}”`;
  };
  const lines = routesFrom(m, n).map((r) => `${label(r.via)} → ${targetLabel(r.to, m, ws, numbers)}`);
  return lines.length ? lines.join(' · ') : 'leads nowhere yet';
}
const optionsText = (q: Question) => q.options.map((o) => `${o.label || o.code}${o.exclusive ? ' (exclusive)' : ''}${o.isOther ? ' (other, with text)' : ''}${o.interrupt === 'MANDATORY' ? ' (mandatory escalation)' : ''}`).join(' · ');

/** What differs between revision `a` (earlier) and revision `b` (later), in a reviewer's words. */
const deliveryFacts = (q: Question) => [deliveryOf(q), q.mandatory ?? false, q.role ?? null, q.statement ?? null];
const deliveryText = (q: Question): string => [DELIVERY_LABEL[deliveryOf(q)], q.answerType === 'STATEMENT' ? `${(q.statement ?? 'TRANSITION').toLowerCase()} statement` : q.mandatory ? 'mandatory' : 'not mandatory', q.role ? q.role.toLowerCase().replace(/_/g, ' ') : null].filter(Boolean).join(' · ');

export function compare(a: Snapshot, b: Snapshot): Comparison {
  const sa = surveyOf(a), sb = surveyOf(b);
  const changes: Change[] = [];
  const renumbered: Comparison['renumbered'] = [];
  const add = (c: Omit<Change, 'id'>) => changes.push({ ...c, id: `${changes.length}|${c.area}|${c.title}` });
  const inA = new Map(sa.sequence.map((i) => [i.id, i])), inB = new Map(sb.sequence.map((i) => [i.id, i]));

  for (const [id, i] of inB) if (!inA.has(id)) {
    const m = findModule(b.ws, mKey(i.module));
    const qs = (m?.nodes.filter(isQuestion) ?? []).length;
    add({ area: 'MODULES', kind: 'ADDED', title: `${nameOf(b.ws, i)} was added`, after: `Position ${sb.sequence.indexOf(i) + 1} of ${sb.sequence.length} · ${qs} question${qs === 1 ? '' : 's'} · ${activationText(b.ws, sb, i)} · ${eligibilityText(b.ws, i)}`, module: nameOf(b.ws, i), wording: qs > 0, where: { instanceId: id } });
  }
  for (const [id, i] of inA) if (!inB.has(id)) add({ area: 'MODULES', kind: 'REMOVED', title: `${nameOf(a.ws, i)} was removed`, before: `Position ${sa.sequence.indexOf(i) + 1} of ${sa.sequence.length}`, module: nameOf(a.ws, i) });
  const commonA = sa.sequence.filter((i) => inB.has(i.id)).map((i) => i.id), commonB = sb.sequence.filter((i) => inA.has(i.id)).map((i) => i.id);
  if (!same(commonA, commonB)) add({ area: 'MODULES', kind: 'MOVED', title: 'The order of the modules changed', before: commonA.map((id) => nameOf(a.ws, inA.get(id)!)).join(' → '), after: commonB.map((id) => nameOf(b.ws, inB.get(id)!)).join(' → ') });

  for (const id of commonB) {
    const ia = inA.get(id)!, ib = inB.get(id)!;
    const ma = findModule(a.ws, mKey(ia.module)), mb = findModule(b.ws, mKey(ib.module));
    const name = nameOf(b.ws, ib);
    const where = { instanceId: id };
    if (mKey(ia.module) !== mKey(ib.module)) add({ area: 'DEPENDENCIES', kind: 'MODIFIED', title: `${name} now pins a different module version`, before: `v${ia.module.revision}${ma?.published ? ' (shared)' : ' (draft)'}`, after: `v${ib.module.revision}${mb?.published ? ' (shared)' : ' (draft for this survey)'}`, module: name, where });
    if (!same(activationOf(ia), activationOf(ib))) add({ area: 'CONDITIONS', kind: 'MODIFIED', title: `When ${name} is selected changed (activation)`, before: activationText(a.ws, sa, ia), after: activationText(b.ws, sb, ib), module: name, where });
    if (!same(eligibilityOf(ia), eligibilityOf(ib))) add({ area: 'CONDITIONS', kind: 'MODIFIED', title: `Whether ${name} may run changed (eligibility)`, before: eligibilityText(a.ws, ia), after: eligibilityText(b.ws, ib), module: name, where });
    for (const [key, what] of [['ifIneligible', 'jumped to but does not apply'], ['ifSkippedInSequence', 'reached in sequence but does not apply']] as const) {
      if (!same(ia[key], ib[key])) add({ area: 'ROUTING', kind: 'MODIFIED', title: `${name}: what happens when it is ${what}`, before: ia[key] === undefined ? (key === 'ifIneligible' ? 'not set' : 'continue with the next module (default)') : targetText(a.ws, sa, ia[key]), after: ib[key] === undefined ? (key === 'ifIneligible' ? 'not set' : 'continue with the next module (default)') : targetText(b.ws, sb, ib[key]), module: name, where });
    }
    for (const o of [...new Set([...Object.keys(ia.routes), ...Object.keys(ib.routes)])]) {
      const ta = targetText(a.ws, sa, ia.routes[o]), tb = targetText(b.ws, sb, ib.routes[o]);
      const has = (i: Instance) => o in i.routes;
      if (has(ia) && has(ib) && ta === tb) continue;
      add({ area: 'ROUTING', kind: !has(ia) ? 'ADDED' : !has(ib) ? 'REMOVED' : 'MODIFIED', title: `${name}: what “${OUTCOME_LABEL[o as OutcomeCode] ?? o}” leads to`, before: has(ia) ? ta : 'this outcome did not exist', after: has(ib) ? tb : 'this outcome no longer exists', module: name, where });
    }
    if (!ma || !mb) continue;
    const na = buildFlow(a.ws, ma).numbers, nb = buildFlow(b.ws, mb).numbers;
    if (ma.entry !== mb.entry) add({ area: 'ROUTING', kind: 'MODIFIED', title: `${name} now starts with a different question`, before: ma.entry ? `${na.get(ma.entry) ?? ''} ${ma.nodes.find((n) => n.id === ma.entry) ? '' : '(removed)'}`.trim() : 'nothing', after: mb.entry && mb.nodes.find((n) => n.id === mb.entry) ? (isQuestion(mb.nodes.find((n) => n.id === mb.entry)!) ? `“${short(findQuestion(b.ws, (mb.nodes.find((n) => n.id === mb.entry) as { q: { code: string; version: number } }).q)?.wording.text.trim() || 'Untitled question')}”` : 'a condition') : 'nothing', module: name, where });
    const nodesA = new Map(ma.nodes.map((n) => [n.id, n])), nodesB = new Map(mb.nodes.map((n) => [n.id, n]));
    const qText = (ws: Workspace, n: ModuleNode) => (isQuestion(n) ? `“${short(findQuestion(ws, n.q)?.wording.text.trim() || (n.type === 'STATEMENT' ? 'Untitled statement' : 'Untitled question'))}”` : 'a condition');
    const itemWord = (n: ModuleNode) => (!isQuestion(n) ? 'a condition' : n.type === 'STATEMENT' ? 'a statement' : 'a question');
    for (const [nid, n] of nodesB) if (!nodesA.has(nid)) add({ area: isQuestion(n) ? 'QUESTIONS' : 'CONDITIONS', kind: 'ADDED', title: `${name}: ${itemWord(n)} was added`, after: isQuestion(n) ? `${nb.get(nid) ?? ''} ${qText(b.ws, n)}` : `${nb.get(nid) ?? ''} checks ${bindingText(b.ws, n.binding)}`, module: name, wording: isQuestion(n), where: { instanceId: id, nodeId: nid } });
    for (const [nid, n] of nodesA) if (!nodesB.has(nid)) add({ area: isQuestion(n) ? 'QUESTIONS' : 'CONDITIONS', kind: 'REMOVED', title: `${name}: ${itemWord(n)} was removed`, before: isQuestion(n) ? `${na.get(nid) ?? ''} ${qText(a.ws, n)}` : `${na.get(nid) ?? ''} checked ${bindingText(a.ws, n.binding)}`, module: name });
    for (const [nid, x] of nodesA) {
      const y = nodesB.get(nid);
      if (!y) continue;
      const w = { instanceId: id, nodeId: nid };
      let touched = false;
      if (isQuestion(x) && isQuestion(y)) {
        const qa = findQuestion(a.ws, x.q), qb = findQuestion(b.ws, y.q);
        if (!qa || !qb) continue;
        const ref = `${name}: ${qText(b.ws, y)}`;
        if (qa.code !== qb.code) { add({ area: 'QUESTIONS', kind: 'MODIFIED', title: `${name}: a different question is now asked at this point`, before: qText(a.ws, x), after: qText(b.ws, y), module: name, wording: true, where: w }); touched = true; }
        else {
          if (qa.wording.text.trim() !== qb.wording.text.trim()) { add({ area: 'QUESTIONS', kind: 'MODIFIED', title: `${name}: the wording of ${itemWord(y)} changed`, before: qa.wording.text.trim(), after: qb.wording.text.trim(), module: name, wording: true, where: w }); touched = true; }
          if (!same(qa.options, qb.options)) { add({ area: 'QUESTIONS', kind: 'MODIFIED', title: `${ref} — its answer options changed`, before: optionsText(qa), after: optionsText(qb), module: name, wording: !same(qa.options.map((o) => o.label), qb.options.map((o) => o.label)), where: w }); touched = true; }
          if (!same(deliveryFacts(qa), deliveryFacts(qb))) { add({ area: 'QUESTIONS', kind: 'MODIFIED', title: `${ref} — how it is delivered, or its role, changed`, before: deliveryText(qa), after: deliveryText(qb), module: name, wording: deliveryOf(qa) !== deliveryOf(qb), where: w }); touched = true; }
          if (!same(qa.numberRule ?? null, qb.numberRule ?? null)) { add({ area: 'QUESTIONS', kind: 'MODIFIED', title: `${ref} — the number it accepts changed`, before: JSON.stringify(qa.numberRule ?? {}), after: JSON.stringify(qb.numberRule ?? {}), module: name, where: w }); touched = true; }
          if (!same([qa.answerType, qa.selection, qa.textRule], [qb.answerType, qb.selection, qb.textRule])) { add({ area: 'QUESTIONS', kind: 'MODIFIED', title: `${ref} — how it may be answered changed`, before: `${qa.answerType}${qa.selection ? ` · ${qa.selection.min}–${qa.selection.max} answers` : ''}`, after: `${qb.answerType}${qb.selection ? ` · ${qb.selection.min}–${qb.selection.max} answers` : ''}`, module: name, where: w }); touched = true; }
        }
      } else if (!isQuestion(x) && !isQuestion(y) && !same(x.binding, y.binding)) {
        add({ area: 'CONDITIONS', kind: 'MODIFIED', title: `${name}: the condition ${nb.get(nid) ?? ''} checks something different`, before: bindingText(a.ws, x.binding), after: bindingText(b.ws, y.binding), module: name, where: w });
        touched = true;
      }
      const ra = routesText(a.ws, ma, x, na), rb = routesText(b.ws, mb, y, nb);
      // compare where it leads by IDENTITY of the destinations, so pure renumbering is not reported as a routing change
      const ident = (m: Module, n: ModuleNode) => JSON.stringify([isQuestion(n) ? n.routing : null, routesFrom(m, n)]);
      if (ident(ma, x) !== ident(mb, y)) { add({ area: 'ROUTING', kind: 'MODIFIED', title: `${name}: where ${isQuestion(y) ? qText(b.ws, y) : `the condition ${nb.get(nid) ?? ''}`} leads changed`, before: ra, after: rb, module: name, where: w }); touched = true; }
      if (!touched && isQuestion(y) && na.get(nid) !== nb.get(nid)) renumbered.push({ module: name, text: short(findQuestion(b.ws, y.q)?.wording.text.trim() || 'Untitled question', 60), before: na.get(nid) ?? '—', after: nb.get(nid) ?? '—' });
    }
  }

  // pinned versions of shared questions and conditions (the module version is reported per placement above)
  const la = lockOf(a.ws, sa), lb = lockOf(b.ws, sb);
  for (const q of lb.questions) {
    const was = la.questions.filter((x) => x.code === q.code);
    if (was.length && !was.some((x) => x.version === q.version)) add({ area: 'DEPENDENCIES', kind: 'MODIFIED', title: `A question now pins a different version`, before: `v${was.map((x) => x.version).join(', v')} · “${short(was[0]!.text)}”`, after: `v${q.version} · “${short(q.text)}” · used in ${q.usedIn.join(', ')}`, module: q.usedIn[0] });
  }
  for (const c of lb.conditions.filter((x) => x.shared)) {
    const was = la.conditions.filter((x) => x.code === c.code);
    if (was.length && !was.some((x) => x.version === c.version)) add({ area: 'DEPENDENCIES', kind: 'MODIFIED', title: `The condition “${c.name}” now pins a different version`, before: `v${was.map((x) => x.version).join(', v')}`, after: `v${c.version} · used in ${c.usedIn.join(', ')}`, module: c.usedIn[0] });
  }

  // impacted journeys: the same synthetic customers, played through both revisions
  // "Affected" = what the customer experiences differs: the questions asked, the modules that run, or how the call ends.
  // A module that is merely considered and skipped in both revisions is not a difference.
  const journeys: JourneyImpact[] = PROFILES.map((p) => {
    const ra = playback(a.ws, sa, p), rb = playback(b.ws, sb, p);
    const end = (r: typeof ra) => (r.end?.headline ?? 'Stopped at a question');
    const ran = (r: typeof ra) => r.modules.filter((m) => m.status === 'ACTIVATED').map((m) => `${m.name}|${m.outcome}`);
    const names = (r: typeof ra) => r.modules.filter((m) => m.status === 'ACTIVATED').map((m) => m.name);
    const sig = (r: typeof ra) => JSON.stringify([r.asked, ran(r), r.terminal]);
    const changed = sig(ra) !== sig(rb);
    const more = names(rb).filter((x) => !names(ra).includes(x)), less = names(ra).filter((x) => !names(rb).includes(x));
    const outcomes = rb.modules.filter((m) => m.status === 'ACTIVATED' && ra.modules.some((x) => x.instance === m.instance && x.status === 'ACTIVATED' && x.outcome !== m.outcome)).map((m) => m.name);
    const askedMore = rb.asked.filter((k) => !ra.asked.includes(k)).length, askedLess = ra.asked.filter((k) => !rb.asked.includes(k)).length;
    const detail = !changed ? 'The same journey in both revisions.' : [
      more.length ? `Now also runs ${more.join(', ')}.` : '', less.length ? `No longer runs ${less.join(', ')}.` : '',
      outcomes.length ? `${outcomes.join(', ')} now end${outcomes.length === 1 ? 's' : ''} differently.` : '',
      askedMore || askedLess ? `${askedMore ? `${askedMore} more question${askedMore === 1 ? '' : 's'} asked` : ''}${askedMore && askedLess ? ', ' : ''}${askedLess ? `${askedLess} no longer asked` : ''}.` : '',
      end(ra) !== end(rb) ? 'The call ends differently.' : '',
    ].filter(Boolean).join(' ');
    return { profile: p.id, name: p.name, changed, before: end(ra), after: end(rb), detail };
  });
  const impacted = journeys.filter((j) => j.changed).length;
  const identical = a.fingerprint === b.fingerprint;
  const wordingApproval = changes.filter((c) => c.wording).length;
  const text = identical ? ['Nothing differs. No revalidation or re-approval is needed.'] : [
    'Revalidation: the changed revision must pass validation again before it can be submitted.',
    wordingApproval ? `Wording approval: ${wordingApproval} change${wordingApproval === 1 ? '' : 's'} add or alter customer-facing wording and must be read and confirmed by the checker.` : 'Wording approval: no customer-facing wording was added or altered.',
    'Re-approval: an approval belongs to one exact revision. Any earlier approval does not cover this one; it needs a fresh review by a different person from the author.',
    impacted ? `Journeys: ${impacted} of ${journeys.length} synthetic customers take a different journey and should be simulated again.` : `Journeys: all ${journeys.length} synthetic customers take the same journey as before.`,
  ];
  return { identical, changes, renumbered, journeys, impacted, needs: { revalidation: !identical, wordingApproval, reapproval: !identical, text } };
}
