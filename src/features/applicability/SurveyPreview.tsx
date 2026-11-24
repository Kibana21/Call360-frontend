// Survey Applicability (APPL-X1R) — a published survey, looked at without leaving the applicability page: its exact
// published identity, its modules, its questions and where each answer leads, who published it, and the way into
// Survey Studio. Everything shown is read from Survey Studio's own API for THAT published version.
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { fromDocuments, type DocumentSet } from '../surveystudio/model/documents';
import { isQuestion, type Edge, type Module, type Target, type Workspace } from '../surveystudio/model/types';
import { setReturn } from './crossnav';
import { sentence } from './model/describe';
import { useAppl } from './store';
import { publishedDetail, type PublishedDetail } from './surveys';
import { DrawerPanel, Empty, Icon, Tag } from './ui';
import { BASE, docsOf, surveysOf } from './usage';

const TYPE: Record<string, string> = { YES_NO: 'Yes / no', SINGLE_SELECT: 'Choose one', MULTI_SELECT: 'Choose several', FREE_TEXT: 'Free text', NUMERIC: 'Number', ACKNOWLEDGEMENT: 'Acknowledgement', STATEMENT: 'Statement' };
const EVENT: Record<string, string> = { SUBMITTED: 'Submitted for review', APPROVED: 'Approved', PUBLISHED: 'Published', RETURNED: 'Returned', CREATED: 'Created' };

export function SurveyPreview() {
  const { preview: s, setPreview, data, look, current } = useAppl();
  const loc = useLocation();
  const [detail, setDetail] = useState<PublishedDetail | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setDetail(null); setFailed(false); if (s?.version_id) publishedDetail(s).then(setDetail).catch(() => setFailed(true)); }, [s]);
  const model = useMemo<Workspace | null>(() => {
    if (!detail?.content || !s) return null;
    try { return fromDocuments({ content: detail.content, assets: detail.assets } as unknown as DocumentSet, { meta: { name: s.name, purpose: s.summary ?? '', versionLabel: String(s.label ?? s.version) } }); } catch { return null; }
  }, [detail, s]);
  if (!s) return null;
  const survey = model?.surveys[0];
  const moduleOf = (code: string, revision: number) => model?.modules.find((m) => m.code === code && m.revision === revision);
  const question = (code: string, version: number) => model?.questions.find((q) => q.code === code && q.version === version);
  const counts = survey ? survey.sequence.reduce((n, i) => n + (moduleOf(i.module.code, i.module.revision)?.nodes.filter(isQuestion).length ?? 0), 0) : 0;
  const uses = data.policies.flatMap((rec) => docsOf(rec).flatMap(({ doc, state }) => doc.requirements.filter((r) => surveysOf(r).some((x) => x.code === s.code)).map((r) => ({ rec, doc, state, r }))));
  const leave = () => setReturn({ path: `${loc.pathname}${loc.search}`, label: current ? (current.draft ?? current.published)!.name : 'Survey applicability' });
  const where = (m: Module, t: Target, last: boolean): string => {
    if ('ret' in t) return last ? 'this module ends' : 'continues';
    if ('outcome' in t) return `ends the module: ${t.outcome.toLowerCase().replaceAll('_', ' ')}`;
    const n = m.nodes.find((x) => x.id === t.node);
    const q = n && isQuestion(n) ? question(n.q.code, n.q.version) : undefined;
    return `goes to “${(q?.wording.text ?? q?.intent ?? 'a decision').slice(0, 60)}${(q?.wording.text ?? '').length > 60 ? '…' : ''}”`;
  };
  return (
    <DrawerPanel wide testid="ap-survey-preview" onClose={() => setPreview(null)} title={s.name} subtitle={s.summary || 'A published survey of Survey Studio.'}
      footer={<>
        <span className="ap-quiet">Read from Survey Studio. Your applicability draft stays open behind this.</span><span className="ap-spacer" />
        {s.version_id ? <Link className="ap-btn" to={`/survey-studio/surveys/${s.code}/simulate`} onClick={() => { leave(); setPreview(null); }} data-testid="ap-preview-simulate" title="Run this published survey on its own in Survey Studio's simulator">Simulate in Survey Studio</Link> : null}
        {s.version_id ? <Link className="ap-btn" to={`/survey-studio/surveys/${s.code}/versions/${s.version_id}`} onClick={() => { leave(); setPreview(null); }} data-testid="ap-preview-open-version">Published version in Survey Studio</Link> : null}
        <Link className="ap-btn primary" to={`/survey-studio/surveys/${s.code}`} onClick={() => { leave(); setPreview(null); }} data-testid="ap-preview-open">Open in Survey Studio <Icon name="right" size={13} /></Link>
      </>}>
      {!s.version_id ? <Empty icon="warn" title="This survey is not published in Survey Studio">The reference names <code>{s.code}</code>, but Survey Studio lists no published version with that code. It cannot be previewed, and a policy that names it cannot be submitted.</Empty> : (
        <>
          <dl className="ap-identity" data-testid="ap-preview-identity">
            <div><dt>Published version</dt><dd><Tag tone="published"><Icon name="lock" size={11} /> {s.label ?? s.version}</Tag></dd></div>
            <div><dt>Survey</dt><dd><code>{s.code}</code>{s.market ? ` · ${s.market}` : ''}</dd></div>
            <div><dt>Content fingerprint</dt><dd><code data-testid="ap-preview-fingerprint">{s.fingerprint}</code></dd></div>
            <div><dt>Manifest fingerprint</dt><dd><code>{s.manifest}</code></dd></div>
          </dl>
          {failed ? <Empty icon="warn" title="Survey Studio could not be read">Try again in a moment.</Empty> : !detail ? <p className="ap-quiet">Reading the published content…</p> : !survey ? <Empty icon="info" title="The content cannot be laid out here">Open the published version in Survey Studio to see it.</Empty> : (
            <section data-testid="ap-preview-structure">
              <h3>What is in it <span className="ap-count">{survey.sequence.length} module{survey.sequence.length === 1 ? '' : 's'} · {counts} question{counts === 1 ? '' : 's'}</span></h3>
              <ol className="ap-pv-modules">
                {survey.sequence.map((inst, mi) => { const m = moduleOf(inst.module.code, inst.module.revision); if (!m) return null; return (
                  <li key={inst.id} data-testid={`ap-pv-module-${mi}`}>
                    <header><span className="ap-pv-n">{mi + 1}</span><div><strong>{m.name}</strong><small>{m.intent}</small></div><Tag tone="info" title="A LEGO module, pinned by exact revision">module {m.code} · revision {m.revision}</Tag></header>
                    <ol className="ap-pv-questions">
                      {m.nodes.map((n, ni) => {
                        if (!isQuestion(n)) return <li key={n.id} className="decision"><Icon name="condition" size={13} /> A decision point: the path depends on a condition{m.edges.filter((e) => e.from === n.id).map((e) => <span key={e.id} className="ap-pv-branch"><b>{e.on.toLowerCase().replaceAll('_', ' ')}</b> {where(m, e.to, false)}</span>)}</li>;
                        const q = question(n.q.code, n.q.version);
                        const out = m.edges.filter((e: Edge) => e.from === n.id);
                        const branching = new Set(out.map((e) => JSON.stringify(e.to))).size > 1;
                        return (
                          <li key={n.id} className={branching ? 'branches' : ''} data-testid={`ap-pv-q-${mi}-${ni}`}>
                            <p className="ap-pv-text">{q?.wording.text ?? q?.intent ?? n.q.code}</p>
                            <div className="ap-pv-meta"><Tag>{TYPE[q?.answerType ?? ''] ?? q?.answerType}</Tag>{q?.mandatory ? <Tag tone="warn">must be answered</Tag> : null}{branching ? <Tag tone="cond"><Icon name="condition" size={11} /> branches</Tag> : null}
                              {q && q.options.length && q.answerType !== 'YES_NO' ? <span className="ap-pv-options">{q.options.map((o) => <span key={o.code} className="ap-chip plain">{o.label}</span>)}</span> : null}</div>
                            {branching ? <ul className="ap-pv-branches">{out.map((e) => <li key={e.id}><b>{q?.options.find((o) => o.code === e.on)?.label ?? (e.on === 'YES' ? 'Yes' : e.on === 'NO' ? 'No' : e.on === 'ANY' ? 'Any answer' : e.on.toLowerCase().replaceAll('_', ' '))}</b> <Icon name="arrow" size={12} /> {where(m, e.to, ni === m.nodes.length - 1)}</li>)}</ul> : null}
                          </li>
                        );
                      })}
                    </ol>
                  </li>
                ); })}
              </ol>
            </section>
          )}
          {detail?.events.length ? <section data-testid="ap-preview-history"><h3>How it was published <Tag tone="published">enforced by Survey Studio</Tag></h3><ol className="ap-pv-history">{detail.events.map((e, i) => <li key={i}><strong>{EVENT[e.event] ?? e.event.toLowerCase()}</strong><span>{e.who || 'someone'} · {e.at.slice(0, 16).replace('T', ' ')}</span></li>)}</ol></section> : null}
        </>
      )}
      <section data-testid="ap-preview-uses"><h3>Where this workspace uses it <span className="ap-count">{uses.length}</span></h3>
        {uses.length ? <ul className="ap-uses">{uses.map(({ doc, state, r }) => <li key={`${doc.code}-${state}-${r.id}`}><Link to={`${BASE}/policies/${doc.code}?r=${r.id}`} onClick={() => setPreview(null)}><Icon name="policy" size={14} /><span><strong>{r.name}</strong><small>{doc.name} · {state.toLowerCase()} v{doc.version} · when {sentence(r.when, look)} · pinned to {surveysOf(r).find((x) => x.code === s.code)?.label ?? '—'}</small></span><Icon name="right" size={13} /></Link></li>)}</ul> : <p className="ap-quiet">No requirement in this workspace names it yet.</p>}
        <p className="ap-quiet">Only the policies open in this browser tab: applicability policies are not saved in Call360 yet.</p></section>
    </DrawerPanel>
  );
}
