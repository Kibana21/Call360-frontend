// Survey Studio (UX-HOME-1) — the rules explorer. READ ONLY, and not a rule engine or a rule registry.
// Four families of rules already exist in Call360, each owned and governed by its own module. This page lists what
// each of those modules publishes, in words, and links to the screen that owns it. Nothing is evaluated here and
// nothing can be changed here. A family this person may not read, or that is switched off, says so.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthContext';
import { FIELDS } from '../model/sample';
import { Glyph, Tag, type GlyphName } from '../ui';
import { getComponent, listSurveys, type Component, type SurveySummary } from './api';
import { InspectorDrawer, inspectParam, parseInspect, type Inspect } from './Inspector';
import { allComponents, assignmentPolicy, controlPolicies, findingRuleSets, missing, requirementGroups, ruleInWords, words, type Maybe, type Unavailable } from './workspaceApi';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- other modules' lists are read as JSON
type Family = 'assignment' | 'logic' | 'applicability' | 'findings';
const FAMILIES: Array<{ key: Family; label: string; glyph: GlyphName; owns: string; what: string }> = [
  { key: 'assignment', label: 'Assignment rules', glyph: 'branch', owns: 'Assignment Rules, and Survey assignment', what: 'Which survey an application gets. A published rule is bound to one published survey version, and rules are arranged in requirement groups.' },
  { key: 'logic', label: 'Survey logic', glyph: 'flow', owns: 'Survey Studio (the module and its conditions)', what: 'Which question comes next inside a survey: the branches of each published module, and the reusable conditions they and the surveys use.' },
  { key: 'applicability', label: 'Control applicability', glyph: 'check', owns: 'Control policies and evidence', what: 'When a control obligation applies to an application, as written in a published control policy.' },
  { key: 'findings', label: 'Finding rules', glyph: 'alert', owns: 'Finding Rules', what: 'Which evaluated discrepancy becomes a finding, and with what severity, in a published finding rule set.' },
];
const why = (u: Unavailable, owner: string) => (u.unavailable === 'OFF' ? `${owner} is not switched on for this server.` : u.unavailable === 'NO_PERMISSION' ? `Reading these needs a permission of ${owner} that you do not hold.` : 'They could not be reached.');
const fieldLabel = (f: string) => FIELDS.find((x) => x.code === f)?.label ?? f;
const STATUS: Record<string, 'ok' | 'warn' | 'draft' | 'plain'> = { PUBLISHED: 'ok', APPROVED: 'warn', PROPOSED: 'draft', IN_REVIEW: 'draft', SUPERSEDED: 'plain', WITHDRAWN: 'plain', REJECTED: 'plain', DRAFT: 'draft' };

function Rule({ title, tags, children, link, testid }: { title: ReactNode; tags?: ReactNode; children?: ReactNode; link?: ReactNode; testid?: string }) {
  return <li className="ss-rx-rule" data-testid={testid}><header><strong>{title}</strong><span className="ss-rx-tags">{tags}</span></header>{children}{link ? <p className="ss-rx-link">{link}</p> : null}</li>;
}

export function RulesExplorerPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const family = (FAMILIES.find((f) => f.key === params.get('family'))?.key ?? 'assignment') as Family;
  const q = (params.get('q') ?? '').trim().toLowerCase();
  const status = params.get('status') ?? 'PUBLISHED';
  const inspecting = parseInspect(params.get('inspect'));
  const set = (changes: Record<string, string | null>) => { const next = new URLSearchParams(window.location.search); for (const [k, v] of Object.entries(changes)) { if (!v) next.delete(k); else next.set(k, v); } setParams(next, { replace: true }); };
  const inspect = (c: Inspect) => set({ inspect: inspectParam(c) });
  const [data, setData] = useState<{ policy: Maybe<Any>; groups: Maybe<Any>; conditions: Maybe<Component[]>; modules: Maybe<Component[]>; policies: Maybe<Any[]>; findings: Maybe<Any> } | null>(null);
  const [docs, setDocs] = useState<Record<string, Any>>({});
  const [surveys, setSurveys] = useState<SurveySummary[]>([]);
  useEffect(() => {
    let current = true;
    Promise.all([assignmentPolicy(), requirementGroups(), allComponents('CONDITION'), allComponents('MODULE'), controlPolicies(), findingRuleSets()]).then(([policy, groups, conditions, modules, policies, findings]) => { if (current) setData({ policy, groups, conditions, modules, policies, findings }); });
    listSurveys().then((s) => { if (current) setSurveys(s); }).catch(() => undefined);
    return () => { current = false; };
  }, []);
  // the published document of each condition, for its rule in words (the library's own read)
  useEffect(() => {
    if (!data || missing(data.conditions)) return;
    let current = true;
    Promise.all(data.conditions.filter((c) => c.is_latest).map(async (c) => [`${c.code}@${c.version}`, (await getComponent('CONDITION', c.code, c.version)).document] as const)).then((all) => { if (current) setDocs(Object.fromEntries(all)); }).catch(() => undefined);
    return () => { current = false; };
  }, [data]);

  const match = (...texts: unknown[]) => !q || texts.some((t) => String(t ?? '').toLowerCase().includes(q));
  const counts = useMemo(() => ({
    assignment: data && !missing(data.policy) ? (data.policy.rules as Any[]).length : null,
    logic: data && !missing(data.conditions) && !missing(data.modules) ? data.conditions.filter((c) => c.is_latest).length + data.modules.filter((c) => c.is_latest).length : null,
    applicability: data && !missing(data.policies) ? data.policies.reduce((n, p) => n + (p.controls as Any[]).reduce((m, c) => m + (c.obligations as Any[]).length, 0), 0) : null,
    findings: data && !missing(data.findings) ? ((data.findings.items ?? data.findings.versions ?? []) as Any[]).length : null,
  }), [data]);
  const f = FAMILIES.find((x) => x.key === family)!;

  let body: ReactNode = <p className="ss-loading" role="status"><span className="ss-spinner" aria-hidden="true" /> Loading…</p>;
  if (data && family === 'assignment') {
    if (missing(data.policy)) body = <div className="ss-empty" data-testid="ss-rx-unavailable"><p><strong>Assignment rules cannot be shown.</strong> {why(data.policy, 'Survey assignment')}</p></div>;
    else {
      const groups = missing(data.groups) ? [] : ((data.groups.groups ?? []) as Any[]);
      const groupOf = (code: string, version: number) => groups.filter((g) => g.status === 'PUBLISHED' && (g.members as Any[]).some((m) => m.rule_code === code && m.rule_version === version));
      const bindings = (data.policy.bindings ?? []) as Any[];
      const bindingOf = (id: unknown) => (id ? bindings.find((x) => x.id === id) ?? null : null); // a rule names its published binding by id
      const rules = (data.policy.rules as Any[]).filter((r) => match(r.name, r.rule_code, ...(r.when as string[]), bindingOf(r.published_binding)?.survey_name) && (status === 'ALL' || (status === 'PUBLISHED' ? r.effective_now : !r.effective_now)));
      body = (
        <ul className="ss-rx-list" data-testid="ss-rx-assignment">
          {rules.map((r) => {
            const b = bindingOf(r.published_binding), gs = groupOf(r.rule_code, r.rule_version);
            return (
              <Rule key={r.ref} testid={`ss-rx-rule-${r.rule_code}`} title={<>{r.name} <span className="ss-code">{r.ref}</span></>}
                tags={<><Tag tone={r.effective_now ? 'ok' : 'plain'}>{r.effective_now ? 'In effect' : 'Not in effect'}</Tag><Tag>{r.market_code}</Tag>{r.is_fallback ? <Tag tone="draft">Fallback</Tag> : null}<Tag>Priority {r.priority}</Tag></>}
                link={<>{can('script.read') ? <Link to={`/assignment-rules/${r.rule_code}`}>Open the rule in Assignment Rules</Link> : <span className="ss-muted">The rule itself is governed in Assignment Rules.</span>} · <Link to="/survey-studio/assignment">Open Survey assignment</Link></>}>
                <p><span className="ss-rx-when">When</span> {(r.when as string[]).join(', and ') || 'always'}</p>
                <p><span className="ss-rx-when">Then</span> {b ? <>the survey <Link to={`/survey-studio/surveys/${b.survey_code}/versions/${b.survey_version_id}`}>{b.survey_name}, version {b.version_label}</Link></> : <em>no survey is bound to it — it selects a script only</em>}{gs.length ? <> · in {gs.map((g) => `${g.name} (${words(g.kind)}, order ${g.sequence})`).join('; ')}</> : b ? <> · <em>in no requirement group</em></> : null}</p>
              </Rule>
            );
          })}
          {!rules.length ? <li className="ss-ws-quiet">No assignment rule matches.</li> : null}
        </ul>
      );
    }
  }
  if (data && family === 'logic') {
    if (missing(data.conditions) || missing(data.modules)) body = <div className="ss-empty" data-testid="ss-rx-unavailable"><p><strong>Survey logic cannot be shown.</strong> {why(missing(data.conditions) ? data.conditions : (data.modules as Unavailable), 'The component library')}</p></div>;
    else {
      const conditions = data.conditions.filter((c) => (status !== 'PUBLISHED' || c.is_latest) && match(c.title, c.code, c.description));
      const modules = data.modules.filter((c) => (status !== 'PUBLISHED' || c.is_latest) && match(c.title, c.code, c.description));
      body = (
        <>
          <h3 className="ss-rx-sub">Reusable conditions <span>{conditions.length}</span></h3>
          <ul className="ss-rx-list" data-testid="ss-rx-conditions">
            {conditions.map((c) => {
              const doc = docs[`${c.code}@${c.version}`];
              return (
                <Rule key={`${c.code}@${c.version}`} testid={`ss-rx-condition-${c.code}`} title={c.title} tags={<><Tag tone="ok">Published · version {c.version}</Tag><Tag tone={c.used_by.surveys > 1 ? 'shared' : 'plain'}>Used by {c.used_by.surveys}</Tag></>}
                  link={<button type="button" className="ss-link" onClick={() => inspect({ kind: 'CONDITION', code: c.code, version: c.version })}>Inspect the condition</button>}>
                  <p><span className="ss-rx-when">Met when</span> {doc ? ruleInWords(doc.ast, fieldLabel) : 'loading its rule…'}</p>
                  <p className="ss-muted">Reads {(((c.facts as Any).fields ?? []) as string[]).map(fieldLabel).join(', ') || 'no customer or policy information'}. Unknown is never read as “not met”.</p>
                </Rule>
              );
            })}
            {!conditions.length ? <li className="ss-ws-quiet">No published condition{q ? ' matches' : ' yet. A condition becomes reusable when a survey that uses it is published'}.</li> : null}
          </ul>
          <h3 className="ss-rx-sub">Branches inside modules <span>{modules.length}</span></h3>
          <ul className="ss-rx-list" data-testid="ss-rx-modules">
            {modules.map((c) => (
              <Rule key={`${c.code}@${c.version}`} testid={`ss-rx-module-${c.code}`} title={c.title} tags={<><Tag tone="ok">Published · revision {c.version}</Tag><Tag tone={c.used_by.surveys > 1 ? 'shared' : 'plain'}>Used by {c.used_by.surveys}</Tag></>}
                link={<button type="button" className="ss-link" onClick={() => inspect({ kind: 'MODULE', code: c.code, version: c.version })} data-testid={`ss-rx-inspect-${c.code}`}>See every branch in the inspector</button>}>
                <p>{(c.facts as Any).questions} question(s), {(c.facts as Any).decisions} decision(s); can end as {(((c.facts as Any).outcomes ?? []) as string[]).map(words).join(', ') || 'nothing stated'}.</p>
              </Rule>))}
            {!modules.length ? <li className="ss-ws-quiet">No published module matches.</li> : null}
          </ul>
        </>
      );
    }
  }
  if (data && family === 'applicability') {
    if (missing(data.policies)) body = <div className="ss-empty" data-testid="ss-rx-unavailable"><p><strong>Control applicability cannot be shown.</strong> {why(data.policies, 'Control policies')}</p></div>;
    else {
      const rows = data.policies.filter((p) => status === 'ALL' || p.status === status || (status !== 'PUBLISHED' && p.status !== 'PUBLISHED')).flatMap((p) => (p.controls as Any[]).flatMap((c) => (c.obligations as Any[]).map((o) => ({ p, c, o })))).filter(({ p, c, o }) => match(p.name, p.code, c.control.code, c.control.name, o.title, o.key));
      body = (
        <ul className="ss-rx-list" data-testid="ss-rx-applicability">
          {rows.map(({ p, c, o }) => (
            <Rule key={`${p.id}-${c.control.code}-${o.key}`} testid={`ss-rx-obligation-${c.control.code}-${o.key}`} title={<>{o.title} <span className="ss-code">{c.control.code} / {o.key}</span></>}
              tags={<><Tag tone={STATUS[p.status] ?? 'plain'}>{words(p.status)}</Tag><Tag>{p.market_code}</Tag><Tag>Revision {p.revision}</Tag></>}
              link={<Link to={`/survey-studio/controls?view=policy&policy=${p.id}`}>Open {p.name} in Control policies</Link>}>
              <p><span className="ss-rx-when">Applies</span> {o.applicability ? <>when {o.applicability.condition?.name ?? 'its condition'} is met: {ruleInWords(o.applicability.ast, fieldLabel)}{Object.keys(o.applicability.params ?? {}).length ? ` (${Object.entries(o.applicability.params).map(([k, v]) => `${k} = ${String(v)}`).join(', ')})` : ''}</> : 'to every application in the policy’s scope'}</p>
              <p className="ss-muted">Needs {(o.evidence as Any[]).map((e) => `${e.description || e.key} (${e.evidence_type === 'DELIVERY' ? 'a delivery' : 'an answer'}${e.required ? '' : ', optional'})`).join('; ')}. Synthetic; not an approved compliance obligation.</p>
            </Rule>))}
          {!rows.length ? <li className="ss-ws-quiet">No control obligation matches.</li> : null}
        </ul>
      );
    }
  }
  if (data && family === 'findings') {
    if (missing(data.findings)) body = <div className="ss-empty" data-testid="ss-rx-unavailable"><p><strong>Finding rules cannot be shown here.</strong> {why(data.findings, 'Finding Rules')} Evaluations still apply the published rule set and show it on each finding.</p>{can('script.read') ? <Link className="ss-btn" to="/finding-rules">Open Finding Rules</Link> : null}</div>;
    else {
      const sets = ((data.findings.items ?? data.findings.versions ?? []) as Any[]).filter((s) => (status === 'ALL' || (status === 'PUBLISHED' ? s.status === 'PUBLISHED' : s.status !== 'PUBLISHED')) && match(s.label, s.status, s.market_code));
      body = (
        <ul className="ss-rx-list" data-testid="ss-rx-findings">
          {sets.map((s) => <Rule key={s.id ?? s.version_id} title={s.label ?? `Rule set version ${s.version_no ?? ''}`} tags={<><Tag tone={STATUS[s.status] ?? 'plain'}>{words(s.status)}</Tag>{s.market_code ? <Tag>{s.market_code}</Tag> : null}</>} link={<Link to="/finding-rules">Open it in Finding Rules</Link>}><p>{s.rule_count !== undefined ? `${s.rule_count} rule(s). ` : ''}Each rule names what triggers a finding and its severity; the existing findings engine applies the published set.</p></Rule>)}
          {!sets.length ? <li className="ss-ws-quiet">No finding rule set matches.</li> : null}
        </ul>
      );
    }
  }

  return (
    <>
      <div className="ss-bar">
        <nav className="ss-crumbs" aria-label="Survey Studio breadcrumb"><Link to="/survey-studio">Survey Studio</Link><Glyph name="right" size={13} /><span aria-current="page">Rules explorer</span></nav>
        <div className="ss-bar-tools"><span className="ss-proto saved-mode"><Glyph name="info" size={14} /> Read only · synthetic</span></div>
      </div>
      <div className="ss-ws ss-rx" data-testid="ss-rx" data-family={family}>
        <header className="ss-ws-head">
          <div className="ss-ws-head-text"><h1 className="ss-title">Rules explorer</h1><p>Four kinds of rule decide what happens to an application. Each is owned and governed by its own screen; this page shows what they publish, and links there. Nothing is decided or changed here.</p></div>
          <div className="ss-ws-search" role="search"><Glyph name="search" size={18} /><input type="search" value={params.get('q') ?? ''} onChange={(e) => set({ q: e.target.value })} placeholder="Search rules by name, code or what they read" aria-label="Search rules" data-testid="ss-rx-search" /></div>
        </header>
        <div className="ss-rx-cols">
          <nav className="ss-rx-families" aria-label="Kinds of rule">
            {FAMILIES.map((x) => <button key={x.key} type="button" className={family === x.key ? 'on' : ''} aria-current={family === x.key} onClick={() => set({ family: x.key })} data-testid={`ss-rx-family-${x.key}`}><Glyph name={x.glyph} size={16} /><span><strong>{x.label}</strong><small>Owned by {x.owns}</small></span><b>{counts[x.key] ?? '–'}</b></button>)}
          </nav>
          <section className="ss-ws-section" aria-labelledby="ss-rx-h">
            <header><h2 id="ss-rx-h">{f.label}</h2>
              <label className="ss-ws-filter">Show <select value={status} onChange={(e) => set({ status: e.target.value === 'PUBLISHED' ? null : e.target.value })} data-testid="ss-rx-status"><option value="PUBLISHED">{family === 'assignment' ? 'In effect' : family === 'logic' ? 'Latest published' : 'Published'}</option><option value="OTHER">{family === 'assignment' ? 'Not in effect' : family === 'logic' ? 'Every published revision' : 'Not published'}</option><option value="ALL">All</option></select></label>
            </header>
            <p className="ss-ws-hint">{f.what}</p>
            {body}
          </section>
        </div>
      </div>
      {inspecting ? <InspectorDrawer target={inspecting} surveys={can('survey.edit') ? surveys.filter(Boolean) : []} onInspect={inspect} onClose={() => set({ inspect: null })} /> : null}
    </>
  );
}
