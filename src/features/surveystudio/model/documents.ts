// Survey Studio (FI-1) — the ONE mapping between the editor's Workspace and the six canonical survey documents of the
// backend (Call360-specs docs/plans/survey-studio/04_SS-01_CANONICAL_CONTRACTS.md §9; Call360-backend
// app/domain/survey/documents.py). There is no second model: the Workspace is the editing shape of exactly these
// documents, and everything saved or loaded passes through this file.
//
// Rules that make the mapping lossless in both directions (proved on all 27 golden fixtures, documents.test.ts):
//  * a value equal to its default is not stored: module kind COMMON, delivery CONTROLLED_TTS in the Workspace (the
//    document always states delivery_mode), an empty intent, a parameter label equal to its name;
//  * what the documents have no field for and an author can type is kept in the optional `authoring` object of the
//    document: it is part of the document and of its hash, and has no execution meaning;
//  * identities are never invented or renumbered: item, module, condition, option-set, node, edge, rule and instance
//    codes pass through unchanged, so the execution identity `<instance>/<node>` is the same before and after.
// The server's SHA-256 of each document is authoritative; nothing here computes a hash.
import type {
  Activation, Ast, Binding, Condition, DecisionNode, Edge, Entry, FieldType, Instance, Interrupt, Module, ModuleKind, ModuleNode, Option, OutcomeCode,
  Question, QuestionNode, Routing, SetRule, Survey, SurveyTarget, Target, TextRule, Workspace,
} from './types';

export type AssetKind = 'OPTION_SET' | 'ITEM' | 'WORDING' | 'CONDITION' | 'MODULE';
export type Doc = Record<string, unknown>;
export interface AssetDoc { kind: AssetKind; code: string; version: number; document: Doc }
/** One survey as documents: its content and every asset version the editor holds for it. */
export interface DocumentSet { content: Doc; assets: AssetDoc[] }
export interface SurveyMeta { name: string; purpose: string; versionLabel: string }

export const SCHEMA = {
  OPTION_SET: 'call360.survey.option-set/1', ITEM: 'call360.survey.item/1', WORDING: 'call360.survey.wording/1',
  CONDITION: 'call360.survey.condition/1', MODULE: 'call360.survey.module/1', SURVEY: 'call360.survey.content/1',
} as const;

/** The editor cannot represent, or cannot unambiguously write, what it was given. Never swallowed: shown to the author. */
export class MappingError extends Error {}

export const assetKey = (a: { kind: string; code: string; version: number }) => `${a.kind}:${a.code}@${a.version}`;

const sortKeys = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Doc)[k])])) : v);
/** A stable text of any JSON value (keys sorted, array order kept): equal values give equal text. For comparison only. */
export const stable = (v: unknown): string => JSON.stringify(sortKeys(v));

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- documents arrive as untyped JSON

// ---- shared pieces ------------------------------------------------------------------------------------------------
const targetOut = (t: Target | null | undefined): unknown => (t == null ? null : 'ret' in t ? { return: true } : t);
const targetIn = (t: Any): Target | null => (t == null ? null : t.return ? { ret: true } : 'node' in t ? { node: t.node } : { outcome: t.outcome as OutcomeCode });
const surveyTargetOut = (t: SurveyTarget | null): unknown => (t === null ? null : t === '@CONTINUE' ? '@CONTINUE' : 'instance' in t ? { instance: t.instance } : { survey_outcome: t.surveyOutcome });
const surveyTargetIn = (t: Any): SurveyTarget | null => (t == null ? null : t === '@CONTINUE' ? '@CONTINUE' : 'instance' in t ? { instance: t.instance } : { surveyOutcome: t.survey_outcome as OutcomeCode });
const textRuleOut = (r: TextRule) => ({ required: r.required, min_length: r.min, max_length: r.max });
const textRuleIn = (r: Any): TextRule => ({ required: r.required, min: r.min_length, max: r.max_length });

const bindingOut = (b: Binding, withInputs: boolean): Doc => ({
  condition: { code: b.condition.code, version: b.condition.version }, params: { ...b.params },
  ...(withInputs ? { inputs: Object.fromEntries(Object.entries(b.inputs ?? {}).map(([k, v]) => [k, { node: v.node }])) } : {}),
  unknown_policy: b.unknownPolicy,
});
const bindingIn = (b: Any): Binding => ({
  condition: { code: b.condition.code, version: b.condition.version }, params: { ...(b.params ?? {}) },
  ...(b.inputs && Object.keys(b.inputs).length ? { inputs: Object.fromEntries(Object.entries(b.inputs as Record<string, Any>).map(([k, v]) => [k, { node: v.node }])) } : {}),
  unknownPolicy: b.unknown_policy ?? null,
});
const entryOut = (e: Entry): Doc => (e.mode === 'RULE' ? { mode: 'RULE', binding: bindingOut(e.binding, false) } : e.mode === 'ON_OUTCOME' ? { mode: 'ON_OUTCOME', of: e.of, outcomes: [...e.outcomes] } : { mode: 'ALWAYS' });
const entryIn = (e: Any): Entry => (e.mode === 'RULE' ? { mode: 'RULE', binding: bindingIn(e.binding) } : e.mode === 'ON_OUTCOME' ? { mode: 'ON_OUTCOME', of: e.of, outcomes: [...e.outcomes] } : { mode: 'ALWAYS' });

const optionOut = (o: Option): Doc => ({
  code: o.code, label: o.label,
  ...(o.exclusive !== undefined ? { exclusive: o.exclusive } : {}), ...(o.isOther !== undefined ? { is_other: o.isOther } : {}),
  ...(o.otherText ? { other_text: textRuleOut(o.otherText) } : {}), ...(o.interrupt ? { interrupt: o.interrupt } : {}),
});
const optionIn = (o: Any): Option => ({
  code: o.code, label: o.label ?? '',
  ...(o.exclusive !== undefined ? { exclusive: o.exclusive } : {}), ...(o.is_other !== undefined ? { isOther: o.is_other } : {}),
  ...(o.other_text ? { otherText: textRuleIn(o.other_text) } : {}), ...(o.interrupt ? { interrupt: o.interrupt } : {}),
});

const routingOut = (r: Routing): Doc => ({
  mode: r.mode,
  ...(r.normal !== undefined ? { normal_answer: r.normal } : {}),
  ...(r.followups ? { followups: r.followups.map((f) => ({ option: f.option, nodes: [...f.nodes] })) } : {}),
  ...(r.noFollowup ? { no_followup: [...r.noFollowup] } : {}),
  ...(r.interrupts ? { interrupts: r.interrupts.map((i) => ({ option: i.option, policy: i.policy, ...(i.outcome !== undefined ? { outcome: i.outcome } : {}), ...(i.nodes ? { nodes: [...i.nodes] } : {}), ...(i.rejoin !== undefined ? { rejoin: targetOut(i.rejoin) } : {}) })) } : {}),
  ...(r.rejoin !== undefined ? { rejoin: targetOut(r.rejoin) } : {}),
  ...(r.rules ? { rules: r.rules.map((x) => ({ rule: x.id, when: { kind: x.kind, options: [...x.options] }, to: targetOut(x.to) })) } : {}),
  ...(r.fallback !== undefined ? { fallback: targetOut(r.fallback) } : {}),
});
const routingIn = (r: Any): Routing => ({
  mode: r.mode,
  ...(r.normal_answer !== undefined ? { normal: r.normal_answer } : {}),
  ...(r.followups ? { followups: (r.followups as Any[]).map((f) => ({ option: f.option, nodes: [...f.nodes] })) } : {}),
  ...(r.no_followup ? { noFollowup: [...r.no_followup] } : {}),
  ...(r.interrupts ? { interrupts: (r.interrupts as Any[]).map((i): Interrupt => ({ option: i.option, policy: i.policy, ...(i.outcome !== undefined ? { outcome: i.outcome } : {}), ...(i.nodes ? { nodes: [...i.nodes] } : {}), ...(i.rejoin !== undefined ? { rejoin: targetIn(i.rejoin) } : {}) })) } : {}),
  ...(r.rejoin !== undefined ? { rejoin: targetIn(r.rejoin) } : {}),
  ...(r.rules ? { rules: (r.rules as Any[]).map((x): SetRule => ({ id: x.rule, kind: x.when.kind, options: [...x.when.options], to: targetIn(x.to) })) } : {}),
  ...(r.fallback !== undefined ? { fallback: targetIn(r.fallback) } : {}),
});

// ---- Workspace -> documents ---------------------------------------------------------------------------------------
/**
 * Every document the Workspace holds for one survey: the content, and one document per option set, item, wording,
 * condition and module version in the library (placed or not), in the Workspace's own order.
 */
export function toDocuments(ws: Workspace, survey: Survey): DocumentSet {
  const assets: AssetDoc[] = [];
  const seen = new Map<string, string>();
  const put = (kind: AssetKind, code: string, version: number, document: Doc, clash: string): boolean => {
    const key = assetKey({ kind, code, version });
    const text = stable(document);
    const had = seen.get(key);
    if (had !== undefined) { if (had !== text) throw new MappingError(clash); return false; }
    seen.set(key, text);
    assets.push({ kind, code, version, document });
    return true;
  };

  // which item versions a module places: an item nobody places records its own wording version (see `authoring`)
  const placed = new Set<string>();
  for (const m of ws.modules) for (const n of m.nodes) if (n.type !== 'DECISION') placed.add(`${n.q.code}@${n.q.version}`);

  const optionSets = new Map<string, string>(); // option-set key -> the options it holds
  const optionRef = (q: Question): { code: string; version: number } | null => {
    if (!q.options.length) return null;
    const document = (ref: { code: string; version: number }): Doc => ({ schema: SCHEMA.OPTION_SET, code: ref.code, version: ref.version, options: q.options.map(optionOut) });
    const text = stable(q.options.map(optionOut));
    let ref = q.optionSet ?? { code: `OS-${q.code}`, version: q.version };
    const holds = optionSets.get(assetKey({ kind: 'OPTION_SET', ...ref }));
    if (holds !== undefined && holds !== text) {
      // a shared option set whose answers this question has changed: it gets its own set rather than changing the others'
      ref = { code: `OS-${q.code}`, version: q.version };
      const own = optionSets.get(assetKey({ kind: 'OPTION_SET', ...ref }));
      if (own !== undefined && own !== text) throw new MappingError(`Two questions would write different answers to the option set ${ref.code} version ${ref.version}.`);
    }
    const key = assetKey({ kind: 'OPTION_SET', ...ref });
    if (!optionSets.has(key)) { optionSets.set(key, text); put('OPTION_SET', ref.code, ref.version, document(ref), ''); }
    return { code: ref.code, version: ref.version };
  };

  const sets: AssetDoc[] = [];
  const items: AssetDoc[] = [];
  const wordings: AssetDoc[] = [];
  for (const q of ws.questions) {
    const before = assets.length;
    const ref = optionRef(q);
    sets.push(...assets.splice(before));
    const obligation = q.mandatory ? 'MANDATORY' : q.obligation;
    const item: Doc = {
      schema: SCHEMA.ITEM, code: q.code, version: q.version, answer_type: q.answerType, intent: q.intent,
      ...(ref ? { option_set: ref } : {}), ...(q.selection ? { selection: { min: q.selection.min, max: q.selection.max } } : {}),
      ...(q.textRule ? { text_rule: textRuleOut(q.textRule) } : {}), ...(q.numberRule ? { number_rule: { ...q.numberRule } } : {}),
      ...(q.statement ? { statement_role: q.statement } : {}), ...(q.role ? { lifecycle_role: q.role } : {}),
      ...(obligation ? { response_obligation: obligation } : {}),
      ...(!placed.has(`${q.code}@${q.version}`) && q.wording.version !== q.version ? { authoring: { wording_version: q.wording.version } } : {}),
    };
    put('ITEM', q.code, q.version, item, `The item ${q.code} version ${q.version} appears twice with different content.`);
    items.push(...assets.splice(before));
    const wording: Doc = {
      schema: SCHEMA.WORDING, item: q.code, language: 'en', wording_version: q.wording.version, text: q.wording.text,
      delivery_mode: q.wording.delivery ?? 'CONTROLLED_TTS', ...(q.wording.optionTexts ? { option_texts: { ...q.wording.optionTexts } } : {}),
    };
    put('WORDING', q.code, q.wording.version, wording, `Two versions of ${q.code} carry different text as wording version ${q.wording.version}. A changed wording needs a new wording version.`);
    wordings.push(...assets.splice(before));
  }

  const conditions: AssetDoc[] = [];
  for (const c of ws.conditions) {
    const labels = Object.fromEntries(Object.entries(c.params).filter(([k, p]) => p.label !== k).map(([k, p]) => [k, p.label]));
    const authoring = { ...(Object.keys(labels).length ? { param_labels: labels } : {}), ...(c.shared ? {} : { shared: false }) };
    const doc: Doc = {
      schema: SCHEMA.CONDITION, code: c.code, version: c.version, name: c.name, ast: c.ast as unknown as Doc,
      params: Object.fromEntries(Object.entries(c.params).map(([k, p]) => [k, { type: p.type, ...(p.unit !== undefined ? { unit: p.unit } : {}) }])),
      inputs: Object.fromEntries(Object.entries(c.inputs ?? {}).map(([k, d]) => [k, { answer_type: d.answerType, item: { code: d.question.code, version: d.question.version } }])),
      ...(Object.keys(authoring).length ? { authoring } : {}),
    };
    const before = assets.length;
    put('CONDITION', c.code, c.version, doc, `The condition ${c.code} version ${c.version} appears twice with different content.`);
    conditions.push(...assets.splice(before));
  }

  const modules: AssetDoc[] = [];
  const wordingOf = new Map(ws.questions.map((q) => [`${q.code}@${q.version}`, q.wording.version]));
  for (const m of ws.modules) {
    const authoring = { ...(m.intent ? { intent: m.intent } : {}), ...(m.defaultEntry ? { default_entry: entryOut(m.defaultEntry) } : {}), ...(m.derivedFor ? { derived_for: m.derivedFor } : {}) };
    const doc: Doc = {
      schema: SCHEMA.MODULE, code: m.code, revision: m.revision, name: m.name, outcomes: [...m.outcomes], entry: m.entry,
      nodes: m.nodes.map((n): Doc => {
        if (n.type === 'DECISION') return { node: n.id, type: 'DECISION', binding: n.binding ? bindingOut(n.binding, true) : null };
        const wv = wordingOf.get(`${n.q.code}@${n.q.version}`);
        if (wv === undefined) throw new MappingError(`${m.name} places ${n.q.code} version ${n.q.version}, which is not in the library.`);
        return { node: n.id, type: n.type, item: { code: n.q.code, version: n.q.version, wording_version: wv }, routing: routingOut(n.routing), ...(n.role ? { role: n.role } : {}) };
      }),
      edges: m.edges.map((e) => ({ edge: e.id, from: e.from, on: e.on, to: targetOut(e.to) })),
      ...(m.kind !== 'COMMON' ? { kind: m.kind } : {}), ...(Object.keys(authoring).length ? { authoring } : {}),
    };
    const before = assets.length;
    put('MODULE', m.code, m.revision, doc, `The module ${m.code} revision ${m.revision} appears twice with different content.`);
    modules.push(...assets.splice(before));
  }

  const content: Doc = {
    schema: SCHEMA.SURVEY, code: survey.id,
    sequence: survey.sequence.map((i): Doc => {
      const activation: Activation | undefined = i.activation ?? (i.entry.mode === 'ON_OUTCOME' ? { of: i.entry.of, outcomes: i.entry.outcomes } : undefined);
      return {
        instance: i.id, module: { code: i.module.code, revision: i.module.revision },
        routes: Object.fromEntries(Object.entries(i.routes).map(([k, t]) => [k, surveyTargetOut(t)])),
        ...(i.entry.mode === 'RULE' ? { eligibility: bindingOut(i.entry.binding, false) } : {}),
        ...(activation ? { activation: { of: activation.of, outcomes: [...activation.outcomes] } } : {}),
        ...(i.ifIneligible !== undefined ? { if_ineligible: surveyTargetOut(i.ifIneligible) } : {}),
        ...(i.ifSkippedInSequence !== undefined ? { if_skipped_in_sequence: surveyTargetOut(i.ifSkippedInSequence) } : {}),
      };
    }),
  };
  return { content, assets: [...sets, ...items, ...wordings, ...conditions, ...modules] };
}

// ---- documents -> Workspace ---------------------------------------------------------------------------------------
/**
 * The Workspace of one survey. `frozen` holds the asset keys the server reports as FROZEN: those versions are shown as
 * published and the editor refuses to change them (a change is a new version). `seq` is where new codes start.
 */
export function fromDocuments(set: DocumentSet, opts: { meta: SurveyMeta; frozen?: ReadonlySet<string>; seq?: number }): Workspace {
  const frozen = opts.frozen ?? new Set<string>();
  const of = (kind: AssetKind) => set.assets.filter((a) => a.kind === kind);
  const optionSets = new Map(of('OPTION_SET').map((a) => [`${a.code}@${a.version}`, a.document as Any]));
  const wordingDocs = new Map(of('WORDING').map((a) => [`${a.code}@${a.version}`, a.document as Any]));

  // the wording version each item version is pinned with, by the modules that place it
  const pinned = new Map<string, number>();
  for (const a of of('MODULE')) for (const n of ((a.document as Any).nodes ?? []) as Any[]) {
    if (n.type === 'DECISION') continue;
    const k = `${n.item.code}@${n.item.version}`;
    const had = pinned.get(k);
    if (had !== undefined && had !== n.item.wording_version) throw new MappingError(`${n.item.code} version ${n.item.version} is placed with two different wording versions (${had} and ${n.item.wording_version}). This editor shows one wording per question version and cannot open it without losing one.`);
    pinned.set(k, n.item.wording_version);
  }

  const questions: Question[] = of('ITEM').map((a) => {
    const d = a.document as Any;
    const k = `${d.code}@${d.version}`;
    const candidates = [...wordingDocs.keys()].filter((w) => w.startsWith(`${d.code}@`));
    const wv = pinned.get(k) ?? d.authoring?.wording_version ?? (wordingDocs.has(`${d.code}@${d.version}`) ? d.version : candidates.length === 1 ? Number(candidates[0]!.slice(d.code.length + 1)) : undefined);
    const w = wv === undefined ? undefined : wordingDocs.get(`${d.code}@${wv}`);
    if (!w) throw new MappingError(`The wording of ${d.code} version ${d.version} is missing from the saved draft.`);
    const os = d.option_set ? optionSets.get(`${d.option_set.code}@${d.option_set.version}`) : undefined;
    if (d.option_set && !os) throw new MappingError(`The answers of ${d.code} version ${d.version} (option set ${d.option_set.code}) are missing from the saved draft.`);
    const obligation: string | undefined = d.response_obligation;
    return {
      code: d.code, version: d.version, answerType: d.answer_type, intent: d.intent ?? '',
      options: os ? (os.options as Any[]).map(optionIn) : [],
      // the question's own set, named from its code, is the default and is not stored
      ...(d.option_set && !(d.option_set.code === `OS-${d.code}` && d.option_set.version === d.version) ? { optionSet: { code: d.option_set.code, version: d.option_set.version } } : {}),
      ...(d.selection ? { selection: { min: d.selection.min, max: d.selection.max } } : {}),
      ...(d.text_rule ? { textRule: textRuleIn(d.text_rule) } : {}), ...(d.number_rule ? { numberRule: { ...d.number_rule } } : {}),
      ...(d.statement_role ? { statement: d.statement_role } : {}), ...(d.lifecycle_role ? { role: d.lifecycle_role } : {}),
      ...(obligation === 'MANDATORY' ? { mandatory: true } : obligation ? { obligation } : {}),
      wording: { version: w.wording_version, text: w.text, approval: 'SYNTHETIC_UNAPPROVED', ...(w.delivery_mode !== 'CONTROLLED_TTS' ? { delivery: w.delivery_mode } : {}), ...(w.option_texts ? { optionTexts: { ...w.option_texts } } : {}) },
      published: frozen.has(assetKey(a)),
    } as Question;
  });

  const conditions: Condition[] = of('CONDITION').map((a) => {
    const d = a.document as Any;
    const labels: Record<string, string> = d.authoring?.param_labels ?? {};
    const inputs = Object.entries((d.inputs ?? {}) as Record<string, Any>);
    return {
      code: d.code, version: d.version, name: d.name, ast: d.ast as Ast,
      params: Object.fromEntries(Object.entries((d.params ?? {}) as Record<string, Any>).map(([k, p]) => [k, { type: p.type as FieldType, ...(p.unit !== undefined ? { unit: p.unit } : {}), label: labels[k] ?? k }])),
      ...(inputs.length ? { inputs: Object.fromEntries(inputs.map(([k, v]) => [k, { question: { code: v.item.code, version: v.item.version }, answerType: v.answer_type, scope: 'MODULE' as const }])) } : {}),
      shared: d.authoring?.shared ?? true,
    };
  });

  const modules: Module[] = of('MODULE').map((a) => {
    const d = a.document as Any;
    return {
      code: d.code, revision: d.revision, name: d.name, kind: (d.kind ?? 'COMMON') as ModuleKind, intent: d.authoring?.intent ?? '',
      published: frozen.has(assetKey(a)), entry: d.entry ?? null, outcomes: [...d.outcomes],
      nodes: (d.nodes as Any[]).map((n): ModuleNode => (n.type === 'DECISION'
        ? ({ id: n.node, type: 'DECISION', binding: n.binding ? bindingIn(n.binding) : null } satisfies DecisionNode)
        : ({ id: n.node, type: n.type, q: { code: n.item.code, version: n.item.version }, routing: routingIn(n.routing), ...(n.role ? { role: n.role } : {}) } satisfies QuestionNode))),
      edges: (d.edges as Any[]).map((e): Edge => ({ id: e.edge, from: e.from, on: e.on, to: targetIn(e.to)! })),
      ...(d.authoring?.default_entry ? { defaultEntry: entryIn(d.authoring.default_entry) } : {}),
      ...(d.authoring?.derived_for ? { derivedFor: d.authoring.derived_for } : {}),
    };
  });

  const c = set.content as Any;
  const survey: Survey = {
    id: c.code, name: opts.meta.name, purpose: opts.meta.purpose, versionLabel: opts.meta.versionLabel, createdAt: 1,
    sequence: ((c.sequence ?? []) as Any[]).map((i): Instance => ({
      id: i.instance, module: { code: i.module.code, revision: i.module.revision },
      entry: i.eligibility ? { mode: 'RULE', binding: bindingIn(i.eligibility) } : { mode: 'ALWAYS' },
      ...(i.activation ? { activation: { of: i.activation.of, outcomes: [...i.activation.outcomes] } } : {}),
      routes: Object.fromEntries(Object.entries((i.routes ?? {}) as Record<string, Any>).map(([k, t]) => [k, surveyTargetIn(t)])),
      ...(i.if_ineligible !== undefined ? { ifIneligible: surveyTargetIn(i.if_ineligible) } : {}),
      ...(i.if_skipped_in_sequence !== undefined ? { ifSkippedInSequence: surveyTargetIn(i.if_skipped_in_sequence) } : {}),
    })),
  };
  return { questions, conditions, modules, surveys: [survey], seq: opts.seq ?? 1 };
}

// ---- what a Save sends ----------------------------------------------------------------------------------------------
export interface Change { put: AssetDoc[]; remove: Array<{ kind: AssetKind; code: string; version: number }>; content: Doc | null }

/** Exactly what differs between two document sets: documents to write (new or changed), to remove, and the content. */
export function changes(base: DocumentSet, next: DocumentSet): Change {
  const was = new Map(base.assets.map((a) => [assetKey(a), stable(a.document)]));
  const now = new Set(next.assets.map(assetKey));
  return {
    put: next.assets.filter((a) => was.get(assetKey(a)) !== stable(a.document)),
    remove: base.assets.filter((a) => !now.has(assetKey(a))).map(({ kind, code, version }) => ({ kind, code, version })),
    content: stable(base.content) === stable(next.content) ? null : next.content,
  };
}
export const isEmpty = (c: Change) => !c.put.length && !c.remove.length && c.content === null;

/** True when two document sets hold exactly the same documents (order does not matter). */
export function sameDocuments(a: DocumentSet, b: DocumentSet): boolean {
  return isEmpty(changes(a, b)) && isEmpty(changes(b, a));
}

/**
 * Where new codes start for one survey. Asset codes are unique across the whole server, and the editor numbers new
 * questions, modules and conditions from a counter; so each survey counts in its own range, above every number already
 * used in it. Deterministic: the same survey always gets the same range.
 */
export function seqFor(surveyCode: string, set: DocumentSet): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < surveyCode.length; i++) { h ^= surveyCode.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  const base = (((h >>> 0) % 900000) + 100000) * 1000; // 100000000 … 999999000
  let top = base;
  for (const a of set.assets) { const m = /-(\d{9,})$/.exec(a.code); if (m) { const n = Number(m[1]); if (n >= base && n < base + 1000 && n > top) top = n; } }
  return top + 1;
}
