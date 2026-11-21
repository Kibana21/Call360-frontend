// Survey Studio prototype — Screen A: Studio Home and Reusable Library.
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { describeAst } from './model/engine';
import { buildFlow } from './model/flow';
import { bindingSentence } from './EntryRuleDrawer';
import { conditionConsumers, createSurvey, findModule, questionNodes, usage } from './model/ops';
import { KIND_LABEL, OUTCOME_LABEL, TEMPLATE_MODULES } from './model/sample';
import { mKey, type Module } from './model/types';
import { NewModuleForm } from './NewModule';
import { StudioBar } from './StudioRoot';
import { useStudio } from './store';
import { Glyph, KIND_GLYPH, Popover, Tag } from './ui';

const TYPE_LABEL = { YES_NO: 'Yes / No', SINGLE_SELECT: 'Single choice', MULTI_SELECT: 'Multiple choice', FREE_TEXT: 'Free text', NUMERIC: 'Number', ACKNOWLEDGEMENT: 'Acknowledgement', STATEMENT: 'Statement' } as const;
type Tab = 'modules' | 'questions' | 'conditions';

export function HomePage() {
  const { ws, apply } = useStudio();
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<Tab>('modules');
  const [query, setQuery] = useState('');
  const match = (s: string) => !query.trim() || s.toLowerCase().includes(query.trim().toLowerCase());
  const modules = useMemo(() => ws.modules.filter((m) => m.published), [ws.modules]);
  const drafts = [...ws.surveys].sort((a, b) => b.createdAt - a.createdAt);
  const draftModules = ws.modules.filter((m) => !m.published && !m.derivedFor);

  return (
    <>
      <StudioBar crumbs={[{ label: 'Survey Studio' }]} />
      <div className="ss-home">
        <section className="ss-hero" aria-labelledby="ss-hero-h">
          <div>
            <h1 id="ss-hero-h">Build a callback survey from ready-made modules</h1>
            <p>Pick the modules you need, decide when each one runs, then open a module to shape its questions and where every answer leads.</p>
          </div>
          {creating ? null : (
            <button type="button" className="ss-btn primary big" onClick={() => setCreating(true)} data-testid="ss-create">
              <Glyph name="plus" /> Create survey
            </button>
          )}
        </section>

        {creating ? (
          <CreateSurvey onCancel={() => setCreating(false)}
            onCreate={(name, purpose, template) => {
              const id = apply(`Created survey "${name}"`, (w) => createSurvey(w, { name, purpose, modules: template ? TEMPLATE_MODULES : [] }));
              if (id) nav(`/survey-studio/surveys/${id}`);
            }} />
        ) : null}

        <section aria-labelledby="ss-drafts-h" className="ss-section">
          <h2 id="ss-drafts-h">Your draft surveys</h2>
          {drafts.length === 0 ? (
            <div className="ss-empty" data-testid="ss-no-drafts">
              <p><strong>No surveys yet.</strong> Create one and add your first module — a simple survey takes a few minutes.</p>
            </div>
          ) : (
            <ul className="ss-draft-list" data-testid="ss-drafts">
              {drafts.map((s) => (
                <li key={s.id}>
                  <Link to={`/survey-studio/surveys/${s.id}`} className="ss-draft">
                    <span className="ss-draft-name">{s.name}</span>
                    <span className="ss-muted">{s.sequence.length} module{s.sequence.length === 1 ? '' : 's'}{s.purpose ? ` · ${s.purpose}` : ''}</span>
                    <Tag tone="draft">Draft v{s.versionLabel}</Tag>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="ss-lib-h" className="ss-section">
          <div className="ss-section-head">
            <h2 id="ss-lib-h">Reusable library</h2>
            <label className="ss-search">
              <Glyph name="search" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the library" aria-label="Search the library" data-testid="ss-lib-search" />
            </label>
          </div>
          <div className="ss-tabs" role="tablist" aria-label="Library">
            {([['modules', `Modules (${modules.length})`], ['questions', `Questions (${ws.questions.filter((q) => q.published).length})`], ['conditions', `Conditions (${ws.conditions.filter((c) => c.shared).length})`]] as Array<[Tab, string]>).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} data-testid={`ss-tab-${k}`}>{label}</button>
            ))}
          </div>

          {tab === 'modules' ? (
            <div className="ss-lib-tools">
              <Popover label="Create a blank module" wide
                trigger={(p) => <button type="button" className="ss-btn small" {...p} data-testid="ss-home-new-module"><Glyph name="plus" size={14} /> New module</button>}>
                {(close) => <NewModuleForm onDone={close} />}
              </Popover>
              {draftModules.length ? <span className="ss-muted">Your draft modules:</span> : null}
              {draftModules.map((m) => <Link key={mKey(m)} className="ss-chip-btn" to={`/survey-studio/modules/${encodeURIComponent(mKey(m))}`} data-testid={`ss-draft-module-${m.code}`}>{m.name} · draft</Link>)}
            </div>
          ) : null}
          {tab === 'modules' ? (
            <ul className="ss-tiles" data-testid="ss-lib-modules">
              {modules.filter((m) => match(`${m.name} ${m.intent} ${KIND_LABEL[m.kind]}`)).map((m) => <ModuleTile key={mKey(m)} m={m} />)}
            </ul>
          ) : null}
          {tab === 'questions' ? (
            <ul className="ss-rows" data-testid="ss-lib-questions">
              {ws.questions.filter((q) => q.published && match(`${q.wording.text} ${q.intent} ${q.code}`)).map((q) => (
                <li key={`${q.code}@${q.version}`}>
                  <span className="ss-row-main"><strong>{q.wording.text}</strong><small>{q.intent}</small></span>
                  <Tag>{TYPE_LABEL[q.answerType]}</Tag>
                  <Tag tone="shared" glyph="link">Used in {usage(ws, q.code)} place{usage(ws, q.code) === 1 ? '' : 's'}</Tag>
                  <span className="ss-code">{q.code} · v{q.version}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {tab === 'conditions' ? (
            <ul className="ss-rows" data-testid="ss-lib-conditions">
              {ws.conditions.filter((c) => c.shared && match(`${c.name} ${describeAst(c.ast, c)}`)).map((c) => {
                const uses = conditionConsumers(ws, c.code).filter((u) => u.version === c.version).length;
                const settings = Object.values(c.params).map((x) => x.label);
                return (
                  <li key={`${c.code}@${c.version}`} data-testid={`ss-lib-condition-${c.code}-${c.version}`}>
                    <span className="ss-row-main"><strong>{c.name}</strong><small>{describeAst(c.ast, c)}</small>
                      {settings.length ? <small>Each place sets its own: {settings.join(', ')}</small> : null}</span>
                    <Tag tone="shared" glyph="link">Used in {uses} place{uses === 1 ? '' : 's'}</Tag>
                    <span className="ss-code">{c.code} · v{c.version}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      </div>
    </>
  );
}

function CreateSurvey({ onCancel, onCreate }: { onCancel: () => void; onCreate: (name: string, purpose: string, template: boolean) => void }) {
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [template, setTemplate] = useState(false);
  const submit = (e: FormEvent) => { e.preventDefault(); if (name.trim()) onCreate(name.trim(), purpose, template); };
  return (
    <form className="ss-create" onSubmit={submit} data-testid="ss-create-form" aria-label="Create survey">
      <label className="ss-field"><span>Survey name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New business callback" data-testid="ss-create-name" required />
      </label>
      <label className="ss-field"><span>What is it for? <em>optional</em></span>
        <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Verify a new policy sale" data-testid="ss-create-purpose" />
      </label>
      <fieldset className="ss-choice">
        <legend>Start from</legend>
        <label className={!template ? 'on' : ''}><input type="radio" name="start" checked={!template} onChange={() => setTemplate(false)} />
          <span><strong>A blank survey</strong><small>Add modules one by one.</small></span></label>
        <label className={template ? 'on' : ''}><input type="radio" name="start" checked={template} onChange={() => setTemplate(true)} data-testid="ss-create-template" />
          <span><strong>Three starter modules</strong><small>General verification, Suitability and Closing.</small></span></label>
      </fieldset>
      <div className="ss-actions">
        <button type="submit" className="ss-btn primary" disabled={!name.trim()} data-testid="ss-create-go">Create and open</button>
        <button type="button" className="ss-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function ModuleTile({ m, action }: { m: Module; action?: React.ReactNode }) {
  const { ws } = useStudio();
  const live = findModule(ws, mKey(m)) ?? m;
  return (
    <li className={`ss-tile kind-${m.kind.toLowerCase()}`} data-testid={`ss-tile-${m.code}`}>
      <div className="ss-tile-head">
        <span className="ss-kind"><Glyph name={KIND_GLYPH[m.kind]} /> {KIND_LABEL[m.kind]}</span>
        {m.published ? <Tag tone="shared">v{m.revision} · Approved</Tag> : <Tag tone="draft">Draft · not shared</Tag>}
      </div>
      <h3>{m.name}</h3>
      <p>{m.intent}</p>
      <div className="ss-tile-meta">
        <span>{questionNodes(m).length} question{questionNodes(m).length === 1 ? '' : 's'}</span>
        {m.nodes.length > questionNodes(m).length ? <span>{m.nodes.length - questionNodes(m).length} condition{m.nodes.length - questionNodes(m).length === 1 ? '' : 's'}</span> : null}
        {m.outcomes.map((o) => <span key={o} className={`ss-outcome ${o === 'COMPLETED' ? 'ok' : 'alt'}`}>{OUTCOME_LABEL[o]}</span>)}
      </div>
      <div className="ss-tile-actions">
        <Popover label={`Preview of ${m.name}`} wide
          trigger={(p) => <button type="button" className="ss-btn small" {...p}>Preview</button>}>
          {() => (
            <div className="ss-preview">
              <h3>{m.name}</h3>
              <ol>
                {buildFlow(ws, live).main.map((it) => <li key={it.node.id}>{it.kind === 'QUESTION' ? it.question.wording.text : `Condition: ${bindingSentence(ws, it.node.binding, live) ?? 'not set'}`}</li>)}
              </ol>
              <p className="ss-muted">Previewing does not copy the module. Adding it to a survey pins this exact version.</p>
            </div>
          )}
        </Popover>
        {action}
      </div>
    </li>
  );
}
