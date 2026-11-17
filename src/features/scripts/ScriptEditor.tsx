// S2-A Script Studio authoring (SUR-002/003/005/006/007, SCR-007/008/012/013/014/015; ADR-0007).
// The server owns every rule: vocabularies come from /script-authoring/options, every change carries the draft's
// row version (a concurrent edit is refused, never overwritten), validation, maker-checker and immutability are
// enforced by the backend and the database. This file renders the editor, the review/publish workflow, the semantic
// version diff and the change history.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiFailure, unwrap } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { useAuth } from '../../auth/AuthContext';
import { Icon } from '../../components/Icon';
import { Badge, Button, Card, type Tone } from '../../components/ui';
import { humanize, when } from '../cases/shared';
import { describeCondition, scriptHref, show, StatusBadge, type ScriptQuestion, type ScriptVersionDetail, type ScriptVersionSummary } from './shared';

type Options = components['schemas']['AuthoringOptions'];
type Section = ScriptVersionDetail['sections'][number];
type Issue = components['schemas']['ValidationIssue'];
type QuestionContent = components['schemas']['QuestionContent'];
type Cond = Record<string, unknown> | null;

const FACT_LABEL: Record<string, string> = {
  product_family: 'Product family', is_ilp: 'Investment-linked product', selling_channel: 'Selling channel',
  premium_frequency: 'Premium frequency', risk_band: 'SBQ selection-risk band',
};

/** The API error as readable text (with validation issues when present). */
export function errorText(e: unknown): { message: string; issues: Issue[] } {
  if (e instanceof ApiFailure) {
    const details = (e.body?.details ?? []) as unknown as Issue[];
    return { message: e.message, issues: details.filter((d) => d && typeof d === 'object' && 'severity' in d) };
  }
  return { message: 'The change could not be saved', issues: [] };
}

export function useAuthoringOptions() {
  return useQuery({ queryKey: ['script-authoring-options'], queryFn: async () => unwrap(await api.GET('/api/v1/script-authoring/options')), staleTime: 60_000 });
}

/** Run one change against the draft and refresh everything that depends on it. */
function useChange(versionId: string, familyId: string) {
  const qc = useQueryClient();
  const [error, setError] = useState<{ message: string; issues: Issue[] } | null>(null);
  const m = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => { setError(null); },
    onError: (e) => setError(errorText(e)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['script-version', versionId] });
      void qc.invalidateQueries({ queryKey: ['script-family', familyId] });
      void qc.invalidateQueries({ queryKey: ['script-history', versionId] });
      void qc.invalidateQueries({ queryKey: ['script-diff', versionId] });
      void qc.invalidateQueries({ queryKey: ['scripts'] });
    },
  });
  return { run: (fn: () => Promise<unknown>) => m.mutateAsync(fn).then(() => true, () => false), pending: m.isPending, error, clear: () => setError(null) };
}

export function ErrorBox({ error }: { error: { message: string; issues: Issue[] } | null }) {
  if (!error) return null;
  return (
    <div className="field-error" role="alert" data-testid="editor-error" style={{ margin: '8px 0' }}>
      <strong>{error.message}</strong>
      {error.issues.length ? <ul className="plain-list" style={{ marginTop: 6 }}>{error.issues.map((i, k) => <li key={k}>{i.severity === 'ERROR' ? 'Error' : 'Warning'}: {i.message}</li>)}</ul> : null}
    </div>
  );
}

// ---- creating scripts and versions ------------------------------------------------------------------------------
export function NewScriptForm({ onCancel }: { onCancel: () => void }) {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/v1/scripts', { body: { code, name, description, purpose: 'SALE_VERIFICATION', market: 'SG' } })),
    onSuccess: (r) => nav(scriptHref(r.script_family_id, r.script_version_id)),
    onError: (e) => setError(errorText(e).message),
  });
  return (
    <form className="card card-pad stack" style={{ gap: 12, marginBottom: 16 }} aria-labelledby="ns-h" data-testid="new-script-form"
      onSubmit={(e: FormEvent) => { e.preventDefault(); create.mutate(); }}>
      <h2 id="ns-h" style={{ margin: 0, fontSize: 16 }}>New script</h2>
      <p className="xsmall muted" style={{ margin: 0 }}>Creates a script family for Singapore and its first draft version (v1.0). Content is synthetic and not approved AIA/MAS wording.</p>
      <div className="input-grid">
        <Field id="ns-code" label="Family code" hint="Capital letters, digits, '_' or '-' (e.g. SALES_VERIFICATION_ILP)">
          {(p) => <input {...p} className="field labelled" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required minLength={3} maxLength={40} />}
        </Field>
        <Field id="ns-name" label="Name">{(p) => <input {...p} className="field labelled" value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={120} />}</Field>
      </div>
      <Field id="ns-desc" label="Purpose and scope (optional)">{(p) => <textarea {...p} className="field textarea labelled" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />}</Field>
      {error ? <div className="field-error" role="alert">{error}</div> : null}
      <div className="row" style={{ gap: 8 }}>
        <Button type="submit" variant="primary" icon="plus" disabled={create.isPending} data-testid="new-script-create">{create.isPending ? 'Creating…' : 'Create script and draft'}</Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

export function NewDraftButton({ familyId, versions }: { familyId: string; versions: ScriptVersionSummary[] }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const open = versions.find((v) => ['DRAFT', 'SUBMITTED_FOR_REVIEW', 'APPROVED'].includes(v.status));
  const make = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/v1/scripts/{script_family_id}/drafts', { params: { path: { script_family_id: familyId } }, body: {} })),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['script-family', familyId] }); nav(scriptHref(familyId, r.script_version_id)); },
    onError: (e) => setError(errorText(e).message),
  });
  return (
    <span className="row" style={{ gap: 6 }}>
      <Button tiny icon="plus" onClick={() => make.mutate()} disabled={!!open || make.isPending} data-testid="new-draft"
        title={open ? `v${open.version_label} is still ${humanize(open.status).toLowerCase()}` : 'New draft from the published version'}>New draft version</Button>
      {open ? <span className="xsmall muted">v{open.version_label} is open</span> : null}
      {error ? <span className="field-error" role="alert">{error}</span> : null}
    </span>
  );
}

// ---- the version workspace -------------------------------------------------------------------------------------
type Tab = 'structure' | 'review' | 'diff' | 'history';

export function VersionWorkspace({ d, family, versions, readView }: {
  d: ScriptVersionDetail; family: { id: string }; versions: ScriptVersionSummary[]; readView: ReactNode;
}) {
  const { can, me } = useAuth();
  const [tab, setTab] = useState<Tab>('structure');
  const editing = d.status === 'DRAFT' && can('script.edit');
  const iAmMaker = !!me && d.makers.includes(me.principal.principal_id);
  const needsAttention = (d.status === 'SUBMITTED_FOR_REVIEW' && can('script.approve')) || (d.status === 'APPROVED' && can('script.publish'));
  const tabs: Array<[Tab, string]> = [['structure', editing ? 'Edit questions' : 'Questions'], ['review', 'Review & publish'], ['diff', 'Version diff'], ['history', 'Change history']];
  return (
    <>
      {d.status !== 'DRAFT' ? (
        <div className="topnotice" role="note" data-testid="immutable-note" style={{ marginBottom: 0 }}>
          <div className="row"><Icon name="lock" size="sm" />
            <span>{d.status === 'SUBMITTED_FOR_REVIEW' || d.status === 'APPROVED'
              ? 'Locked for review: content cannot change until the checker returns it or it is published.'
              : d.status === 'ABANDONED'
                ? 'Abandoned draft: frozen and kept for audit. Nothing was deleted; start a new draft version to continue.'
                : 'Immutable version: content and manifest checksum never change. Changes need a new draft version.'}</span></div>
        </div>
      ) : null}
      <div className="subtabs" role="tablist" aria-label="Script version sections">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" id={`sv-tab-${k}`} aria-selected={tab === k} aria-controls="sv-panel" className={tab === k ? 'active' : ''}
            onClick={() => setTab(k)} data-testid={`sv-tab-${k}`}>{label}{k === 'review' && needsAttention && !iAmMaker ? ' •' : ''}</button>
        ))}
      </div>
      <div id="sv-panel" role="tabpanel" aria-labelledby={`sv-tab-${tab}`} className="stack" style={{ gap: 16 }}>
        {tab === 'structure' ? (editing ? <DraftEditor d={d} familyId={family.id} /> : readView) : null}
        {tab === 'review' ? <ReviewPanel d={d} familyId={family.id} versions={versions} iAmMaker={iAmMaker} /> : null}
        {tab === 'diff' ? <DiffPanel d={d} versions={versions} /> : null}
        {tab === 'history' ? <HistoryPanel d={d} /> : null}
      </div>
    </>
  );
}

export function isEditing(d: ScriptVersionDetail | undefined, can: (p: string) => boolean): boolean {
  return !!d && d.status === 'DRAFT' && can('script.edit');
}

// ---- draft editor ----------------------------------------------------------------------------------------------
function DraftEditor({ d, familyId }: { d: ScriptVersionDetail; familyId: string }) {
  const opts = useAuthoringOptions();
  const ch = useChange(d.id, familyId);
  const [adding, setAdding] = useState(false);
  const base = `/api/v1/script-versions/{script_version_id}` as const;
  const vpath = { script_version_id: d.id };
  if (!opts.data) return <p className="small muted" role="status">Loading the editor…</p>;
  const o = opts.data;
  const moveSection = (i: number, delta: number) => {
    const ids = d.sections.map((s) => s.section_id);
    const j = i + delta;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void ch.run(async () => unwrap(await api.POST(`${base}/sections/reorder`, { params: { path: vpath }, body: { expected_row_version: d.row_version, order: ids } })));
  };
  return (
    <div className="stack" style={{ gap: 16 }} data-testid="draft-editor">
      <div className="explain">You are editing draft v{d.version_label}. Every change is saved immediately as a recorded change; published versions are never altered.
        Reused published modules get a new revision the first time you change them in this draft.</div>
      <ErrorBox error={ch.error} />
      {d.sections.length === 0 ? <p className="small muted" data-testid="no-sections">No sections yet. Add the first section (a module of questions) below.</p> : null}
      {d.sections.map((s, i) => (
        <SectionEditor key={s.section_id} d={d} s={s} index={i} count={d.sections.length} o={o} ch={ch}
          onMove={(delta) => moveSection(i, delta)} />
      ))}
      {adding ? <AddSectionForm d={d} o={o} ch={ch} onDone={() => setAdding(false)} />
        : <div><Button icon="plus" onClick={() => setAdding(true)} data-testid="add-section">Add section</Button></div>}
      <ValidatePanel d={d} familyId={familyId} />
    </div>
  );
}

type Change = ReturnType<typeof useChange>;

function AddSectionForm({ d, o, ch, onDone }: { d: ScriptVersionDetail; o: Options; ch: Change; onDone: () => void }) {
  const [mode, setMode] = useState<'new' | 'reuse'>('new');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('COMMON');
  const [moduleId, setModuleId] = useState('');
  const [cond, setCond] = useState<Cond>(null);
  const used = new Set(d.sections.map((s) => s.module_code));
  const reusable = o.published_modules.filter((m) => !used.has(m.code));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = mode === 'new'
      ? { expected_row_version: d.row_version, module_code: code, module_name: name, module_kind: kind as 'COMMON', inclusion_condition: cond }
      : { expected_row_version: d.row_version, module_id: moduleId, inclusion_condition: cond };
    if (await ch.run(async () => unwrap(await api.POST('/api/v1/script-versions/{script_version_id}/sections', { params: { path: { script_version_id: d.id } }, body })))) onDone();
  };
  return (
    <form className="card card-pad stack" style={{ gap: 12 }} onSubmit={(e) => void submit(e)} aria-label="Add section" data-testid="add-section-form">
      <fieldset className="row wrap" style={{ gap: 14, border: 0, padding: 0, margin: 0 }}>
        <legend className="form-label">Section module</legend>
        <label className="row small" style={{ gap: 6 }}><input type="radio" name="sec-mode" checked={mode === 'new'} onChange={() => setMode('new')} /> New module</label>
        <label className="row small" style={{ gap: 6 }}><input type="radio" name="sec-mode" checked={mode === 'reuse'} onChange={() => setMode('reuse')} data-testid="sec-reuse" /> Reuse a published module</label>
      </fieldset>
      {mode === 'new' ? (
        <div className="input-grid">
          <Field id="sec-code" label="Module code" hint="e.g. COMMON_DISCLOSURES">{(p) => <input {...p} className="field labelled" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required />}</Field>
          <Field id="sec-name" label="Module name">{(p) => <input {...p} className="field labelled" value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
          <Field id="sec-kind" label="Module kind">{(p) => (
            <select {...p} className="field labelled" value={kind} onChange={(e) => setKind(e.target.value)}>
              {o.module_kinds.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select>)}</Field>
        </div>
      ) : (
        <Field id="sec-module" label="Published module">{(p) => (
          <select {...p} className="field labelled" value={moduleId} onChange={(e) => setModuleId(e.target.value)} required>
            <option value="">Choose a module…</option>
            {reusable.map((m) => <option key={m.id} value={m.id}>{m.code} r{m.revision} · {m.name} · {m.questions} questions</option>)}</select>)}</Field>
      )}
      <ConditionEditor id="sec-cond" label="Include this section when" value={cond} onChange={setCond} o={o} />
      <div className="row" style={{ gap: 8 }}>
        <Button type="submit" variant="primary" disabled={ch.pending} data-testid="add-section-save">Add section</Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function SectionEditor({ d, s, index, count, o, ch, onMove }: {
  d: ScriptVersionDetail; s: Section; index: number; count: number; o: Options; ch: Change; onMove: (delta: number) => void;
}) {
  const [editCond, setEditCond] = useState(false);
  const [cond, setCond] = useState<Cond>(s.inclusion_condition as Cond);
  const [name, setName] = useState(s.module_name);
  const [confirm, setConfirm] = useState(false);
  const [adding, setAdding] = useState<null | 'new' | 'bank'>(null);
  const path = { script_version_id: d.id, section_id: s.section_id };
  const moveQ = (i: number, delta: number) => {
    const ids = s.questions.map((q) => q.module_question_id);
    const j = i + delta;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void ch.run(async () => unwrap(await api.POST('/api/v1/script-versions/{script_version_id}/sections/{section_id}/questions/reorder', { params: { path }, body: { expected_row_version: d.row_version, order: ids } })));
  };
  return (
    <section className="card card-pad" aria-labelledby={`es-${s.section_id}`} data-testid="edit-section">
      <div className="card-heading" style={{ marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h2 id={`es-${s.section_id}`}>{s.position}. {s.module_name}</h2>
          <p><span className="mono">{s.module_code}</span> r{s.module_revision} · {humanize(s.module_kind)} ·{' '}
            {s.module_status === 'DRAFT' ? <Badge tone="amber">New revision in this draft</Badge> : <Badge tone="green">Published module (copied on first change)</Badge>}</p>
          <p className="small" style={{ margin: '4px 0 0' }}>{describeCondition(s.inclusion_condition)}</p>
        </div>
        <div className="row wrap" style={{ gap: 4 }}>
          <Button tiny onClick={() => onMove(-1)} disabled={index === 0 || ch.pending} aria-label={`Move section ${s.module_code} up`}><Icon name="up" size="sm" /></Button>
          <Button tiny onClick={() => onMove(1)} disabled={index === count - 1 || ch.pending} aria-label={`Move section ${s.module_code} down`}><Icon name="down" size="sm" /></Button>
          <Button tiny icon="edit" onClick={() => setEditCond((x) => !x)} aria-expanded={editCond}>Section settings</Button>
          {confirm ? (
            <>
              <Button tiny variant="danger" data-testid="confirm-remove-section" onClick={() => void ch.run(async () => unwrap(await api.DELETE('/api/v1/script-versions/{script_version_id}/sections/{section_id}', { params: { path, query: { expected_row_version: d.row_version } } })))}>Confirm remove</Button>
              <Button tiny onClick={() => setConfirm(false)}>Keep</Button>
            </>
          ) : <Button tiny variant="danger" onClick={() => setConfirm(true)} aria-label={`Remove section ${s.module_code}`}>Remove</Button>}
        </div>
      </div>
      {editCond ? (
        <form className="softbox stack" style={{ gap: 10, marginBottom: 12 }} aria-label={`Settings of ${s.module_code}`}
          onSubmit={(e) => { e.preventDefault(); void ch.run(async () => unwrap(await api.PATCH('/api/v1/script-versions/{script_version_id}/sections/{section_id}', { params: { path }, body: { expected_row_version: d.row_version, inclusion_condition: cond, module_name: name } }))).then((ok) => ok && setEditCond(false)); }}>
          <Field id={`sn-${s.section_id}`} label="Module name">{(p) => <input {...p} className="field labelled" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <ConditionEditor id={`sc-${s.section_id}`} label="Include this section when" value={cond} onChange={setCond} o={o} />
          <div className="row" style={{ gap: 8 }}><Button type="submit" variant="primary" disabled={ch.pending}>Save section</Button><Button onClick={() => setEditCond(false)}>Cancel</Button></div>
        </form>
      ) : null}
      {s.questions.length === 0 ? <p className="small muted">No questions in this section yet.</p> : null}
      {s.questions.map((q, i) => (
        <QuestionEditor key={q.module_question_id} d={d} s={s} q={q} index={i} count={s.questions.length} o={o} ch={ch} onMove={(delta) => moveQ(i, delta)} />
      ))}
      {adding ? <AddQuestion d={d} s={s} o={o} ch={ch} mode={adding} onDone={() => setAdding(null)} /> : (
        <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
          <Button tiny icon="plus" onClick={() => setAdding('new')} data-testid="add-question">New question</Button>
          <Button tiny icon="search" onClick={() => setAdding('bank')} data-testid="add-from-bank">Add from question bank</Button>
        </div>
      )}
    </section>
  );
}

function QuestionEditor({ d, s, q, index, count, o, ch, onMove }: {
  d: ScriptVersionDetail; s: Section; q: ScriptQuestion; index: number; count: number; o: Options; ch: Change; onMove: (delta: number) => void;
}) {
  const [open, setOpen] = useState<null | 'edit' | 'controls'>(null);
  const [confirm, setConfirm] = useState(false);
  const path = { script_version_id: d.id, section_id: s.section_id, module_question_id: q.module_question_id };
  return (
    <div className="script-question" data-testid={`edit-question-${q.question_code}`}>
      <div className="script-question-head" style={{ cursor: 'default' }}>
        <span className="q-num">{s.position}.{q.position}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="row wrap" style={{ gap: 6 }}><span className="mono strong small">{q.question_code}</span>
            <span className="xsmall muted">r{q.revision}</span>
            {q.mandatory ? <Badge tone="red">Mandatory</Badge> : <Badge tone="gray">Optional</Badge>}
            <Badge tone="blue">{humanize(q.answer_type)}</Badge><Badge tone="gray">{humanize(q.delivery_mode)}</Badge>
            <Badge tone="purple">{humanize(q.expected_answer_policy)}</Badge>
            {q.controls.length ? <Badge tone="green">{`${q.controls.length} control${q.controls.length === 1 ? '' : 's'}`}</Badge>
              : q.mandatory ? <Badge tone="amber">Mandatory · no mapped control (flagged for checker)</Badge> : <Badge tone="gray">No control</Badge>}</span>
          <span className="small" style={{ display: 'block', marginTop: 6 }}>{q.wording}</span>
          {q.branch_condition ? <span className="xsmall muted">Asked when {describeCondition(q.branch_condition)}</span> : null}
        </span>
        <span className="row wrap" style={{ gap: 4, alignSelf: 'flex-start' }}>
          <Button tiny onClick={() => onMove(-1)} disabled={index === 0 || ch.pending} aria-label={`Move ${q.question_code} up`}><Icon name="up" size="sm" /></Button>
          <Button tiny onClick={() => onMove(1)} disabled={index === count - 1 || ch.pending} aria-label={`Move ${q.question_code} down`}><Icon name="down" size="sm" /></Button>
          <Button tiny icon="edit" onClick={() => setOpen(open === 'edit' ? null : 'edit')} aria-expanded={open === 'edit'} data-testid={`edit-${q.question_code}`}>Edit</Button>
          <Button tiny icon="shield" onClick={() => setOpen(open === 'controls' ? null : 'controls')} aria-expanded={open === 'controls'} data-testid={`controls-${q.question_code}`}>Controls</Button>
          {confirm ? (
            <>
              <Button tiny variant="danger" data-testid={`confirm-remove-${q.question_code}`} onClick={() => void ch.run(async () => unwrap(await api.DELETE('/api/v1/script-versions/{script_version_id}/sections/{section_id}/questions/{module_question_id}', { params: { path, query: { expected_row_version: d.row_version } } })))}>Confirm remove</Button>
              <Button tiny onClick={() => setConfirm(false)}>Keep</Button>
            </>
          ) : <Button tiny variant="danger" onClick={() => setConfirm(true)} aria-label={`Remove ${q.question_code}`}>Remove</Button>}
        </span>
      </div>
      {open === 'edit' ? (
        <div className="question-body">
          <QuestionForm o={o} initial={fromQuestion(q)} code={q.question_code} branch={q.branch_condition as Cond} pending={ch.pending} withReason
            onCancel={() => setOpen(null)}
            onSave={(content, branch, reason) => ch.run(async () => unwrap(await api.PUT('/api/v1/script-versions/{script_version_id}/sections/{section_id}/questions/{module_question_id}', {
              params: { path }, body: { expected_row_version: d.row_version, content, branch_condition: branch, change_reason: reason || null } }))).then((ok) => { if (ok) setOpen(null); })} />
        </div>
      ) : null}
      {open === 'controls' ? <div className="question-body"><ControlsEditor d={d} q={q} o={o} ch={ch} onDone={() => setOpen(null)} /></div> : null}
    </div>
  );
}

function AddQuestion({ d, s, o, ch, mode, onDone }: { d: ScriptVersionDetail; s: Section; o: Options; ch: Change; mode: 'new' | 'bank'; onDone: () => void }) {
  const [code, setCode] = useState('Q-');
  const [search, setSearch] = useState('');
  const bank = useQuery({ queryKey: ['question-bank', search], enabled: mode === 'bank', queryFn: async () => unwrap(await api.GET('/api/v1/question-bank', { params: { query: { q: search || undefined } } })) });
  const inDraft = new Set(d.sections.flatMap((x) => x.questions.map((q) => q.question_code)));
  const path = { script_version_id: d.id, section_id: s.section_id };
  const add = (body: components['schemas']['QuestionAdd']) => ch.run(async () => unwrap(await api.POST('/api/v1/script-versions/{script_version_id}/sections/{section_id}/questions', { params: { path }, body }))).then((ok) => { if (ok) onDone(); });
  if (mode === 'bank') {
    return (
      <div className="softbox stack" style={{ gap: 8, marginTop: 10 }} data-testid="bank-picker">
        <label className="form-label" htmlFor={`bank-${s.section_id}`}>Search the question bank</label>
        <input id={`bank-${s.section_id}`} className="field labelled" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Code, intent or wording" />
        <ul className="plain-list" aria-label="Question bank results" style={{ maxHeight: 260, overflow: 'auto' }}>
          {(bank.data?.items ?? []).map((b) => (
            <li key={b.id} className="row between" style={{ gap: 8, padding: '6px 0' }}>
              <span style={{ minWidth: 0 }}><span className="mono small strong">{b.question_code}</span> <span className="xsmall muted">r{b.latest_revision} · {humanize(b.answer_type)} · used in {b.used_in_versions}</span>
                <span className="small" style={{ display: 'block' }}>{b.customer_wording}</span></span>
              <Button tiny disabled={inDraft.has(b.question_code) || !b.reusable || ch.pending} onClick={() => void add({ expected_row_version: d.row_version, question_code: b.question_code })}
                aria-label={`Add ${b.question_code}`} title={!b.reusable ? 'Only in an unpublished draft; reusable once published' : undefined}>
                {inDraft.has(b.question_code) ? 'In draft' : !b.reusable ? 'Draft only' : 'Add'}</Button>
            </li>
          ))}
        </ul>
        <div><Button tiny onClick={onDone}>Close</Button></div>
      </div>
    );
  }
  return (
    <div className="softbox" style={{ marginTop: 10 }} data-testid="new-question-form">
      <Field id={`nq-code-${s.section_id}`} label="Question code" hint="Stable key, e.g. Q-CHARGES-EXPLAINED">
        {(p) => <input {...p} className="field labelled" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />}
      </Field>
      <QuestionForm o={o} initial={EMPTY} code={code} branch={null} pending={ch.pending} onCancel={onDone}
        onSave={(content, branch) => add({ expected_row_version: d.row_version, question_code: code, content, branch_condition: branch })} />
    </div>
  );
}

// ---- question form ---------------------------------------------------------------------------------------------
interface QState {
  intent: string; category: string; customer_wording: string; delivery_mode: string; answer_type: string; enum_options: string;
  mandatory: boolean; expected_answer_policy: string; expected_boolean: '' | 'yes' | 'no'; policy_fact_key: string;
  acceptable_variants: string; unacceptable_outcomes: string; not_applicable_predicate: Cond; evidence_required: boolean;
  escalation_rule_ref: string; max_reprompts: number;
}
const EMPTY: QState = {
  intent: '', category: 'SALES_CONDUCT', customer_wording: '', delivery_mode: 'CONVERSATIONAL', answer_type: 'YES_NO', enum_options: '',
  mandatory: true, expected_answer_policy: 'EXACT_BOOLEAN', expected_boolean: 'yes', policy_fact_key: '', acceptable_variants: '',
  unacceptable_outcomes: '', not_applicable_predicate: null, evidence_required: true, escalation_rule_ref: '', max_reprompts: 1,
};
const lines = (v: unknown) => (Array.isArray(v) ? v.join('\n') : '');
function fromQuestion(q: ScriptQuestion): QState {
  const schema = (q.answer_schema ?? {}) as { enum?: string[] };
  const exp = (q.expected_value ?? {}) as { value?: boolean };
  return {
    intent: q.intent ?? '', category: q.category, customer_wording: q.wording, delivery_mode: q.delivery_mode, answer_type: q.answer_type,
    enum_options: (schema.enum ?? []).join('\n'), mandatory: q.mandatory, expected_answer_policy: q.expected_answer_policy,
    expected_boolean: exp.value === true ? 'yes' : exp.value === false ? 'no' : '', policy_fact_key: q.policy_fact_key ?? '',
    acceptable_variants: lines(q.acceptable_variants), unacceptable_outcomes: lines(q.unacceptable_outcomes),
    not_applicable_predicate: (q.not_applicable_predicate as Cond) ?? null, evidence_required: q.evidence_required,
    escalation_rule_ref: q.escalation_rule_ref ?? '', max_reprompts: q.max_reprompts,
  };
}
const split = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
function toContent(s: QState): QuestionContent {
  return {
    intent: s.intent, category: s.category, customer_wording: s.customer_wording, delivery_mode: s.delivery_mode as QuestionContent['delivery_mode'],
    answer_type: s.answer_type as QuestionContent['answer_type'], enum_options: split(s.enum_options), mandatory: s.mandatory,
    expected_answer_policy: s.expected_answer_policy as QuestionContent['expected_answer_policy'],
    expected_boolean: s.expected_boolean === '' ? null : s.expected_boolean === 'yes', policy_fact_key: s.policy_fact_key || null,
    acceptable_variants: split(s.acceptable_variants), unacceptable_outcomes: split(s.unacceptable_outcomes),
    not_applicable_predicate: s.not_applicable_predicate, evidence_required: s.evidence_required,
    escalation_rule_ref: s.escalation_rule_ref || null, max_reprompts: s.max_reprompts,
  };
}
// Which expected-answer policies fit an answer type (the server enforces the same pairs).
const POLICY_FOR: Record<string, string[]> = {
  YES_NO: ['EXACT_BOOLEAN', 'COLLECT_ONLY'], NUMERIC: ['NUMERIC_MATCH_POLICY_FACT', 'COLLECT_ONLY'], ENUM: ['COLLECT_ONLY'],
  FREE_TEXT: ['NARRATIVE_REVIEW', 'COLLECT_ONLY'], ACKNOWLEDGEMENT: ['ACKNOWLEDGEMENT'],
};

function QuestionForm({ o, initial, code, branch, pending, onSave, onCancel, withReason }: {
  o: Options; initial: QState; code: string; branch: Cond; pending: boolean; withReason?: boolean;
  onSave: (content: QuestionContent, branch: Cond, reason: string) => Promise<void> | void; onCancel: () => void;
}) {
  const [s, setS] = useState<QState>(initial);
  const [b, setB] = useState<Cond>(branch);
  const [reason, setReason] = useState('');
  const id = useId();
  const set = <K extends keyof QState>(k: K, v: QState[K]) => setS((x) => ({ ...x, [k]: v }));
  const policies = POLICY_FOR[s.answer_type] ?? [];
  const changeType = (t: string) => setS((x) => ({ ...x, answer_type: t, expected_answer_policy: (POLICY_FOR[t] ?? [x.expected_answer_policy]).includes(x.expected_answer_policy) ? x.expected_answer_policy : POLICY_FOR[t]![0]! }));
  return (
    <form className="stack" style={{ gap: 12 }} aria-label={`Question ${code}`} data-testid="question-form"
      onSubmit={(e) => { e.preventDefault(); void onSave(toContent(s), b, reason); }}>
      <Field id={`${id}-w`} label="Exact customer wording" hint="Synthetic example text — not approved AIA/MAS wording">
        {(p) => <textarea {...p} className="field textarea labelled" rows={2} value={s.customer_wording} onChange={(e) => set('customer_wording', e.target.value)} required minLength={10} maxLength={1000} />}
      </Field>
      <div className="input-grid">
        <Field id={`${id}-i`} label="Intent (what the question establishes)">{(p) => <input {...p} className="field labelled" value={s.intent} onChange={(e) => set('intent', e.target.value)} required minLength={5} />}</Field>
        <Field id={`${id}-c`} label="Category">{(p) => <select {...p} className="field labelled" value={s.category} onChange={(e) => set('category', e.target.value)}>{o.categories.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select>}</Field>
        <Field id={`${id}-t`} label="Answer type">{(p) => <select {...p} className="field labelled" value={s.answer_type} onChange={(e) => changeType(e.target.value)}>{o.answer_types.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select>}</Field>
        <Field id={`${id}-m`} label="Delivery mode" hint={s.delivery_mode === 'EXACT_AUDIO' ? 'Needs an approved audio asset (not attachable yet)' : undefined}>{(p) => <select {...p} className="field labelled" value={s.delivery_mode} onChange={(e) => set('delivery_mode', e.target.value)}>{o.delivery_modes.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select>}</Field>
        <Field id={`${id}-p`} label="Expected-answer policy">{(p) => <select {...p} className="field labelled" value={s.expected_answer_policy} onChange={(e) => set('expected_answer_policy', e.target.value)}>{policies.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select>}</Field>
        {s.expected_answer_policy === 'EXACT_BOOLEAN' ? (
          <Field id={`${id}-e`} label="Expected answer">{(p) => <select {...p} className="field labelled" value={s.expected_boolean} onChange={(e) => set('expected_boolean', e.target.value as QState['expected_boolean'])}><option value="">Choose…</option><option value="yes">Yes</option><option value="no">No</option></select>}</Field>
        ) : null}
        {s.expected_answer_policy === 'NUMERIC_MATCH_POLICY_FACT' ? (
          <Field id={`${id}-f`} label="Compare with policy fact">{(p) => <select {...p} className="field labelled" value={s.policy_fact_key} onChange={(e) => set('policy_fact_key', e.target.value)}><option value="">Choose…</option>{Object.entries(o.fact_keys).map(([k, l]) => <option key={k} value={k}>{k} — {l}</option>)}</select>}</Field>
        ) : null}
        <Field id={`${id}-r`} label="Maximum re-prompts">{(p) => <input {...p} type="number" min={0} max={5} className="field labelled" value={s.max_reprompts} onChange={(e) => set('max_reprompts', Number(e.target.value))} />}</Field>
      </div>
      {s.answer_type === 'ENUM' ? <Field id={`${id}-o`} label="Choice options (one per line)">{(p) => <textarea {...p} className="field textarea labelled" rows={3} value={s.enum_options} onChange={(e) => set('enum_options', e.target.value)} />}</Field> : null}
      <div className="row wrap" style={{ gap: 16 }}>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={s.mandatory} onChange={(e) => set('mandatory', e.target.checked)} data-testid="q-mandatory" /> Mandatory question</label>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={s.evidence_required} onChange={(e) => set('evidence_required', e.target.checked)} /> Evidence required</label>
      </div>
      <details>
        <summary className="small strong" style={{ cursor: 'pointer' }}>Variants, outcomes, conditions and escalation</summary>
        <div className="stack" style={{ gap: 10, marginTop: 10 }}>
          <div className="input-grid">
            <Field id={`${id}-av`} label="Acceptable answer variants (one per line)">{(p) => <textarea {...p} className="field textarea labelled" rows={2} value={s.acceptable_variants} onChange={(e) => set('acceptable_variants', e.target.value)} />}</Field>
            <Field id={`${id}-uo`} label="Unacceptable outcomes (one per line)">{(p) => <textarea {...p} className="field textarea labelled" rows={2} value={s.unacceptable_outcomes} onChange={(e) => set('unacceptable_outcomes', e.target.value)} />}</Field>
          </div>
          <ConditionEditor id={`${id}-na`} label="Not applicable when" value={s.not_applicable_predicate} onChange={(c) => set('not_applicable_predicate', c)} o={o} noneLabel="Always applicable" />
          <ConditionEditor id={`${id}-br`} label="Ask only when" value={b} onChange={setB} o={o} noneLabel="Always asked" />
          <Field id={`${id}-x`} label="Escalation rule reference (optional)">{(p) => <input {...p} className="field labelled" value={s.escalation_rule_ref} onChange={(e) => set('escalation_rule_ref', e.target.value)} maxLength={40} />}</Field>
        </div>
      </details>
      {withReason ? <Field id={`${id}-why`} label="Reason for this change" hint="Recorded with the new question revision">{(p) => <input {...p} className="field labelled" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}</Field> : null}
      <div className="row" style={{ gap: 8 }}>
        <Button type="submit" variant="primary" disabled={pending} data-testid="question-save">{pending ? 'Saving…' : 'Save question'}</Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

// ---- controls ---------------------------------------------------------------------------------------------------
function ControlsEditor({ d, q, o, ch, onDone }: { d: ScriptVersionDetail; q: ScriptQuestion; o: Options; ch: Change; onDone: () => void }) {
  const initial = q.controls.map((c) => {
    const x = c as Record<string, string | null>;
    return { control_id: x.control_id ?? '', regulatory_reference_id: x.regulatory_reference_id ?? '', rationale: x.rationale ?? '' };
  }).filter((x) => x.control_id);
  const [links, setLinks] = useState(initial);
  const id = useId();
  const upd = (i: number, k: keyof (typeof links)[number], v: string) => setLinks((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <form className="stack" style={{ gap: 10 }} aria-label={`Controls of ${q.question_code}`} data-testid="controls-form"
      onSubmit={(e) => { e.preventDefault(); void ch.run(async () => unwrap(await api.PUT('/api/v1/script-versions/{script_version_id}/questions/{question_code}/controls', {
        params: { path: { script_version_id: d.id, question_code: q.question_code } },
        body: { expected_row_version: d.row_version, links: links.map((l) => ({ control_id: l.control_id, regulatory_reference_id: l.regulatory_reference_id || null, rationale: l.rationale })) } }))).then((ok) => { if (ok) onDone(); }); }}>
      <p className="xsmall muted" style={{ margin: 0 }}>Links are proposals for review (synthetic controls; regulatory references are public sources, not approved interpretations). Removed links are retired, never deleted.</p>
      {links.map((l, i) => (
        <div key={i} className="input-grid softbox">
          <Field id={`${id}-c${i}`} label="Control">{(p) => <select {...p} className="field labelled" value={l.control_id} onChange={(e) => upd(i, 'control_id', e.target.value)} required><option value="">Choose…</option>{o.controls.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.label}</option>)}</select>}</Field>
          <Field id={`${id}-r${i}`} label="Regulatory reference (optional)">{(p) => <select {...p} className="field labelled" value={l.regulatory_reference_id} onChange={(e) => upd(i, 'regulatory_reference_id', e.target.value)}><option value="">None</option>{o.regulatory_references.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>}</Field>
          <Field id={`${id}-w${i}`} label="Rationale">{(p) => <input {...p} className="field labelled" value={l.rationale} onChange={(e) => upd(i, 'rationale', e.target.value)} required minLength={5} />}</Field>
          <div style={{ alignSelf: 'end' }}><Button tiny variant="danger" onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove link ${i + 1}`}>Remove link</Button></div>
        </div>
      ))}
      <div className="row wrap" style={{ gap: 8 }}>
        <Button tiny icon="plus" onClick={() => setLinks((ls) => [...ls, { control_id: '', regulatory_reference_id: '', rationale: '' }])} data-testid="add-control-link">Add control link</Button>
        <Button tiny type="submit" variant="primary" disabled={ch.pending} data-testid="controls-save">Save controls</Button>
        <Button tiny onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

// ---- conditions (only the approved predicate language) ----------------------------------------------------------
type Row = { kind: 'fact'; fact: string; value: string } | { kind: 'band'; bands: string[] };
function toRows(c: Cond): Row[] {
  if (!c) return [];
  if (Array.isArray(c.all)) return (c.all as Cond[]).flatMap(toRows);
  if (Array.isArray(c.risk_band_in)) return [{ kind: 'band', bands: c.risk_band_in as string[] }];
  if (typeof c.fact === 'string') return [{ kind: 'fact', fact: c.fact, value: String(c.equals) }];
  return [];
}
function fromRows(rows: Row[]): Cond {
  const parts = rows.map((r): Record<string, unknown> => (r.kind === 'band' ? { risk_band_in: r.bands }
    : { fact: r.fact, equals: r.fact === 'is_ilp' ? r.value === 'true' : r.value }));
  return parts.length === 0 ? null : parts.length === 1 ? parts[0]! : { all: parts };
}

function ConditionEditor({ id, label, value, onChange, o, noneLabel = 'Always included' }: {
  id: string; label: string; value: Cond; onChange: (c: Cond) => void; o: Options; noneLabel?: string;
}) {
  const rows = toRows(value);
  const set = (next: Row[]) => onChange(fromRows(next));
  const facts = Object.keys(o.condition_facts);
  return (
    <fieldset className="softbox" style={{ margin: 0 }} data-testid={`cond-${id}`}>
      <legend className="form-label">{label}</legend>
      <p className="xsmall muted" style={{ margin: '0 0 8px' }}>{rows.length ? `${describeCondition(value)} (all must hold)` : noneLabel}</p>
      {rows.map((r, i) => (
        <div key={i} className="row wrap" style={{ gap: 8, marginBottom: 6 }}>
          <label className="sr-only" htmlFor={`${id}-k${i}`}>Condition {i + 1} fact</label>
          <select id={`${id}-k${i}`} className="field" value={r.kind === 'band' ? 'risk_band' : r.fact}
            onChange={(e) => set(rows.map((x, j) => (j !== i ? x : e.target.value === 'risk_band' ? { kind: 'band', bands: [o.risk_bands[o.risk_bands.length - 1]!] }
              : { kind: 'fact', fact: e.target.value, value: String(o.condition_facts[e.target.value]![0]) })))}>
            {[...facts, 'risk_band'].map((f) => <option key={f} value={f}>{FACT_LABEL[f] ?? humanize(f)}</option>)}
          </select>
          {r.kind === 'fact' ? (
            <>
              <span className="small">is</span>
              <label className="sr-only" htmlFor={`${id}-v${i}`}>Condition {i + 1} value</label>
              <select id={`${id}-v${i}`} className="field" value={r.value} onChange={(e) => set(rows.map((x, j) => (j === i ? { ...r, value: e.target.value } : x)))}>
                {(o.condition_facts[r.fact] ?? []).map((v) => <option key={String(v)} value={String(v)}>{typeof v === 'boolean' ? (v ? 'Yes' : 'No') : humanize(String(v))}</option>)}
              </select>
            </>
          ) : (
            <span className="row wrap" style={{ gap: 8 }} role="group" aria-label={`Condition ${i + 1} risk bands`}>
              <span className="small">is one of</span>
              {o.risk_bands.map((band) => (
                <label key={band} className="row small" style={{ gap: 4 }}><input type="checkbox" checked={r.bands.includes(band)}
                  onChange={(e) => set(rows.map((x, j) => (j === i ? { kind: 'band', bands: e.target.checked ? [...r.bands, band] : r.bands.filter((b) => b !== band) } : x)))} />{humanize(band)}</label>
              ))}
            </span>
          )}
          <Button tiny onClick={() => set(rows.filter((_, j) => j !== i))} aria-label={`Remove condition ${i + 1}`}>Remove</Button>
        </div>
      ))}
      <Button tiny icon="plus" onClick={() => set([...rows, { kind: 'fact', fact: facts[0]!, value: String(o.condition_facts[facts[0]!]![0]) }])} data-testid={`cond-add-${id}`}>Add condition</Button>
    </fieldset>
  );
}

// ---- validation and submission ---------------------------------------------------------------------------------
function ValidatePanel({ d, familyId }: { d: ScriptVersionDetail; familyId: string }) {
  const { me } = useAuth();
  const ch = useChange(d.id, familyId);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [summary, setSummary] = useState('');
  const validate = () => ch.run(async () => {
    const r = unwrap(await api.POST('/api/v1/script-versions/{script_version_id}/validate', { params: { path: { script_version_id: d.id } } }));
    setIssues(r.issues);
  });
  return (
    <Card title="Validate and submit" subtitle="Submission freezes the content and its SHA-256 manifest for an independent S&C checker">
      <div className="stack" style={{ gap: 10 }} data-testid="submit-panel">
        <div className="row wrap" style={{ gap: 8 }}>
          <Button icon="check" onClick={() => void validate()} disabled={ch.pending} data-testid="validate">Validate draft</Button>
          <span className="small">Validation: <strong data-testid="validation-status">{humanize(d.validation_status ?? 'NOT_VALIDATED')}</strong></span>
        </div>
        {issues ? (issues.length ? (
          <ul className="plain-list" aria-label="Validation results" data-testid="validation-issues">
            {issues.map((i, k) => <li key={k} className="small"><Badge tone={i.severity === 'ERROR' ? 'red' : 'amber'}>{humanize(i.severity)}</Badge> {i.message}</li>)}
          </ul>) : <p className="small" data-testid="validation-clean">No errors or warnings.</p>) : null}
        <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void ch.run(async () => unwrap(await api.POST('/api/v1/script-versions/{script_version_id}/submit', { params: { path: { script_version_id: d.id } }, body: { expected_row_version: d.row_version, change_summary: summary } }))); }}>
          <Field id="sub-summary" label="Change summary for the reviewer" hint="What changed and why (10–2000 characters)">
            {(p) => <textarea {...p} className="field textarea labelled" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} required minLength={10} />}
          </Field>
          <div><Button type="submit" variant="primary" icon="upload" disabled={ch.pending} data-testid="submit-review">Submit for review</Button></div>
        </form>
        <ErrorBox error={ch.error} />
        {isMaker(d, me?.principal.principal_id) ? <AbandonDraft d={d} familyId={familyId} /> : null}
      </div>
    </Card>
  );
}

const isMaker = (d: ScriptVersionDetail, principal: string | undefined) => !!principal && d.makers.includes(principal);

/** Abandon a draft (S2-A.1): audited, with a reason; nothing is deleted and the content stays readable. */
function AbandonDraft({ d, familyId }: { d: ScriptVersionDetail; familyId: string }) {
  const ch = useChange(d.id, familyId);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) return <div><Button tiny variant="danger" onClick={() => setOpen(true)} data-testid="abandon-open">Abandon draft…</Button></div>;
  return (
    <form className="softbox stack" style={{ gap: 8 }} data-testid="abandon-form" aria-label="Abandon draft"
      onSubmit={(e) => { e.preventDefault(); void ch.run(async () => unwrap(await api.POST('/api/v1/script-versions/{script_version_id}/abandon', { params: { path: { script_version_id: d.id } }, body: { expected_row_version: d.row_version, reason } }))); }}>
      <p className="small" style={{ margin: 0 }}>Abandoning v{d.version_label} freezes it and records your reason in the audit trail. Nothing is deleted; the family can start a new draft.</p>
      <Field id="abandon-reason" label="Reason for abandoning" hint="5–2000 characters">
        {(p) => <textarea {...p} className="field textarea labelled" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} />}
      </Field>
      <div className="row wrap" style={{ gap: 8 }}>
        <Button type="submit" variant="danger" disabled={ch.pending} data-testid="abandon-confirm">Abandon v{d.version_label}</Button>
        <Button onClick={() => setOpen(false)}>Keep draft</Button>
      </div>
      <ErrorBox error={ch.error} />
    </form>
  );
}

// ---- review and publish ----------------------------------------------------------------------------------------
function ReviewPanel({ d, familyId, versions, iAmMaker }: { d: ScriptVersionDetail; familyId: string; versions: ScriptVersionSummary[]; iAmMaker: boolean }) {
  const { can } = useAuth();
  const ch = useChange(d.id, familyId);
  const [reason, setReason] = useState('');
  const [acked, setAcked] = useState<string[]>([]);
  const unmapped = d.unmapped_mandatory ?? [];
  const published = versions.find((v) => v.status === 'PUBLISHED' && v.id !== d.id);
  const [supersede, setSupersede] = useState(!!published && published.rules_targeting.length === 0);
  const steps: Array<[string, string]> = [['DRAFT', 'Draft'], ['SUBMITTED_FOR_REVIEW', 'Submitted'], ['APPROVED', 'Approved'], ['PUBLISHED', 'Published']];
  const at = steps.findIndex(([s]) => s === d.status);
  const review = (decision: 'APPROVE' | 'REQUEST_CHANGES') => ch.run(async () => unwrap(await api.POST('/api/v1/script-versions/{script_version_id}/review', { params: { path: { script_version_id: d.id } }, body: { decision, reason, acknowledged_unmapped_mandatory: decision === 'APPROVE' ? acked : [] } })));
  const publish = () => ch.run(async () => unwrap(await api.POST('/api/v1/script-versions/{script_version_id}/publish', { params: { path: { script_version_id: d.id } }, body: { supersede_version_id: supersede && published ? published.id : null, reason: reason || null } })));
  const checkerBlocked = iAmMaker ? 'You authored or edited this version: another S&C checker must review and publish it.' : null;
  return (
    <Card title="Review & publish" subtitle="Maker-checker: the author drafts and submits; a different S&C checker approves and publishes">
      <div className="stack" style={{ gap: 12 }} data-testid="review-panel">
        <ol className="row wrap lifecycle" aria-label="Lifecycle" style={{ gap: 8, listStyle: 'none', padding: 0, margin: 0 }}>
          {steps.map(([s, label], i) => <li key={s}><Badge tone={i < at ? 'green' : i === at ? 'blue' : 'gray'}>{`${i + 1}. ${label}${i === at ? ' (current)' : ''}`}</Badge></li>)}
          {['SUPERSEDED', 'WITHDRAWN'].includes(d.status) ? <li><StatusBadge status={d.status} /></li> : null}
        </ol>
        <dl className="kv rw-kv">
          <dt>Author</dt><dd>{name(d, d.author_ref)}</dd>
          <dt>Makers (cannot approve)</dt><dd>{d.makers.map((m) => name(d, m)).join(', ') || '—'}</dd>
          <dt>Reviewer</dt><dd>{name(d, d.reviewer_ref)}</dd>
          <dt>Manifest SHA-256</dt><dd className="mono" style={{ overflowWrap: 'anywhere' }}>{d.manifest_sha256 ?? 'Frozen on submission'}</dd>
        </dl>
        {d.status === 'DRAFT' ? <p className="small muted">The author submits the draft from “Edit questions” after validation.</p> : null}
        {d.status === 'ABANDONED' ? <p className="small" data-testid="abandoned-note">Abandoned by its author. The content, change history and audit record are kept; it can no longer be submitted.</p> : null}
        {unmapped.length && d.status !== 'SUBMITTED_FOR_REVIEW' ? (
          <p className="small" role="note" data-testid="unmapped-flag"><Badge tone="amber">{`${unmapped.length} flagged`}</Badge> Mandatory without a mapped control: {unmapped.join(', ')}</p>
        ) : null}
        {d.status === 'SUBMITTED_FOR_REVIEW' ? (can('script.approve') ? (checkerBlocked ? <p className="small" role="note" data-testid="maker-note">{checkerBlocked}</p> : (
          <div className="stack" style={{ gap: 8 }}>
            <p className="small" style={{ margin: 0 }}>Check the content and the <strong>Version diff</strong> tab, then decide. A reason is recorded either way.</p>
            {unmapped.length ? (
              <fieldset className="softbox stack" style={{ gap: 6 }} data-testid="unmapped-ack">
                <legend className="small strong">Mandatory questions without a mapped control ({unmapped.length})</legend>
                <p className="xsmall muted" style={{ margin: 0 }}>Review each one and acknowledge it before approving. Your acknowledgement is recorded with the approval.</p>
                {unmapped.map((code) => (
                  <label key={code} className="row small" style={{ gap: 6 }}>
                    <input type="checkbox" checked={acked.includes(code)} onChange={(e) => setAcked(e.target.checked ? [...acked, code] : acked.filter((x) => x !== code))} />
                    <span className="mono">{code}</span> — reviewed; approve without a mapped control
                  </label>
                ))}
              </fieldset>
            ) : null}
            <Field id="rv-reason" label="Reviewer reason">{(p) => <textarea {...p} className="field textarea labelled" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
            <div className="row wrap" style={{ gap: 8 }}>
              <Button variant="primary" icon="check" disabled={ch.pending || acked.length !== unmapped.length} onClick={() => void review('APPROVE')} data-testid="approve">Approve</Button>
              <Button disabled={ch.pending} onClick={() => void review('REQUEST_CHANGES')} data-testid="request-changes">Return for changes</Button>
            </div>
          </div>)) : <p className="small muted">Awaiting an S&C checker. Your role cannot approve script versions.</p>) : null}
        {d.status === 'APPROVED' ? (can('script.publish') ? (checkerBlocked ? <p className="small" role="note" data-testid="maker-note">{checkerBlocked}</p> : (
          <div className="stack" style={{ gap: 8 }}>
            <p className="small" style={{ margin: 0 }}>Publishing makes this version and its new module revisions immutable and effective now.</p>
            {published ? (
              <label className="row small" style={{ gap: 6 }}>
                <input type="checkbox" checked={supersede} onChange={(e) => setSupersede(e.target.checked)} data-testid="supersede" />
                Supersede v{published.version_label} (published){published.rules_targeting.length ? ` — note: ${published.rules_targeting.join(', ')} still targets it` : ''}
              </label>
            ) : null}
            <Field id="pub-reason" label="Publication note (optional)">{(p) => <input {...p} className="field labelled" value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
            <div><Button variant="primary" icon="upload" disabled={ch.pending} onClick={() => void publish()} data-testid="publish">Publish v{d.version_label}</Button></div>
          </div>)) : <p className="small muted">Approved. Awaiting publication by an S&C checker.</p>) : null}
        {d.status === 'PUBLISHED' ? <p className="small" data-testid="published-note">Published {d.published_at ? `${when(d.published_at)} SGT` : ''}. This version is immutable; its manifest checksum is fixed.</p> : null}
        <ErrorBox error={ch.error} />
      </div>
    </Card>
  );
}

const name = (d: ScriptVersionDetail, ref: string | null | undefined) => (ref ? d.people[ref] ?? ref : '—');

// ---- version diff ----------------------------------------------------------------------------------------------
const CHANGE_TONE: Record<string, Tone> = { ADDED: 'green', REMOVED: 'red', REWORDED: 'amber', CHANGED: 'amber', MOVED: 'blue', UNCHANGED: 'gray' };

function DiffPanel({ d, versions }: { d: ScriptVersionDetail; versions: ScriptVersionSummary[] }) {
  const others = versions.filter((v) => v.id !== d.id);
  const [against, setAgainst] = useState<string>(d.supersedes_id ?? others.find((v) => v.status === 'PUBLISHED')?.id ?? '');
  const diff = useQuery({
    queryKey: ['script-diff', d.id, against],
    queryFn: async () => unwrap(await api.GET('/api/v1/script-versions/{script_version_id}/diff', { params: { path: { script_version_id: d.id }, query: { against: against || undefined } } })),
  });
  const [showAll, setShowAll] = useState(false);
  return (
    <Card title="Version diff" subtitle="Semantic comparison: added, removed, moved, reworded and changed questions and sections">
      <div className="stack" style={{ gap: 12 }} data-testid="diff-panel">
        <div className="row wrap" style={{ gap: 8 }}>
          <label className="form-label" htmlFor="diff-against" style={{ margin: 0 }}>Compare v{d.version_label} with</label>
          <select id="diff-against" className="field" value={against} onChange={(e) => setAgainst(e.target.value)}>
            <option value="">Nothing (all content new)</option>
            {others.map((v) => <option key={v.id} value={v.id}>v{v.version_label} · {humanize(v.status)}</option>)}
          </select>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show unchanged</label>
        </div>
        {diff.data ? (
          <>
            <div className="row wrap" style={{ gap: 6 }} data-testid="diff-summary">
              {Object.entries(diff.data.summary).map(([k, n]) => <Badge key={k} tone={CHANGE_TONE[k] ?? 'gray'}>{`${n} ${humanize(k).toLowerCase()}`}</Badge>)}
            </div>
            {diff.data.sections.filter((s) => showAll || s.change !== 'UNCHANGED').length ? (
              <div><div className="section-label">Sections</div>
                <ul className="plain-list">{diff.data.sections.filter((s) => showAll || s.change !== 'UNCHANGED').map((s) => (
                  <li key={s.module_code} className="small"><Badge tone={CHANGE_TONE[s.change] ?? 'gray'}>{humanize(s.change)}</Badge> <span className="mono">{s.module_code}</span>
                    {s.from_position !== s.to_position && s.from_position && s.to_position ? ` · position ${s.from_position} → ${s.to_position}` : ''}
                    {s.fields.map((f) => <div key={f.field} className="xsmall muted">{humanize(f.field.toUpperCase())}: {fmt(f.before)} → {fmt(f.after)}</div>)}</li>))}</ul></div>
            ) : null}
            <div><div className="section-label">Questions</div>
              <ul className="plain-list" data-testid="diff-questions">
                {diff.data.questions.filter((q) => showAll || q.change !== 'UNCHANGED').map((q) => (
                  <li key={q.question_code} className="small" data-testid={`diff-${q.question_code}`}>
                    <Badge tone={CHANGE_TONE[q.change] ?? 'gray'}>{humanize(q.change)}</Badge> <span className="mono strong">{q.question_code}</span>
                    <span className="xsmall muted"> · {q.to_module ?? q.from_module}{q.moved ? ` (moved from ${q.from_module} #${q.from_position})` : ''}</span>
                    {q.fields.map((f) => (
                      <div key={f.field} className="diff-field xsmall"><span className="muted">{humanize(f.field.toUpperCase())}:</span>{' '}
                        {f.before != null ? <del>{fmt(f.before)}</del> : null}{f.before != null && f.after != null ? ' → ' : ''}{f.after != null ? <ins>{fmt(f.after)}</ins> : null}</div>
                    ))}
                  </li>
                ))}
              </ul>
              {!diff.data.questions.some((q) => showAll || q.change !== 'UNCHANGED') ? <p className="small muted">No question changes.</p> : null}
            </div>
          </>
        ) : <p className="small muted" role="status">{diff.isError ? 'The comparison could not be loaded.' : 'Comparing…'}</p>}
      </div>
    </Card>
  );
}
const fmt = (v: unknown): string => (typeof v === 'string' ? v : v != null && typeof v === 'object' && !Array.isArray(v) && ('fact' in v || 'all' in v || 'risk_band_in' in v) ? describeCondition(v) : show(v));

// ---- history ---------------------------------------------------------------------------------------------------
const EVENT_TEXT: Record<string, string> = {
  DRAFT_CREATED: 'Draft created', CONTENT_CHANGED: 'Content changed', VALIDATED: 'Validated', SUBMITTED: 'Submitted for review',
  CHANGES_REQUESTED: 'Returned for changes', APPROVED: 'Approved', PUBLISHED: 'Published', SUPERSEDED: 'Superseded', ABANDONED: 'Abandoned',
};
function HistoryPanel({ d }: { d: ScriptVersionDetail }) {
  const h = useQuery({ queryKey: ['script-history', d.id], queryFn: async () => unwrap(await api.GET('/api/v1/script-versions/{script_version_id}/history', { params: { path: { script_version_id: d.id } } })) });
  return (
    <Card title="Change history" subtitle="Every change and decision, with who made it and why (insert-only)">
      {h.data ? (
        <ol className="mini-timeline" aria-label="Change history" data-testid="history">
          {h.data.events.length ? [...h.data.events].reverse().map((e) => (
            <li key={e.seq} className="step"><div className={`step-dot${['PUBLISHED', 'APPROVED'].includes(e.event_type) ? ' green' : e.event_type === 'CHANGES_REQUESTED' ? ' red' : ''}`} />
              <div className="step-body"><strong>{EVENT_TEXT[e.event_type] ?? e.event_type}{e.details.action ? ` · ${humanize(String(e.details.action))}` : ''}</strong>
                {when(e.occurred_at)} SGT · {e.actor_name}
                {e.reason ? <small>“{e.reason}”</small> : null}
                {describeDetails(e.details) ? <small>{describeDetails(e.details)}</small> : null}</div></li>
          )) : <li className="small muted">No recorded changes. Seeded versions were created before change history existed.</li>}
        </ol>
      ) : <p className="small muted" role="status">Loading history…</p>}
    </Card>
  );
}
function describeDetails(d: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const k of ['question_code', 'module', 'how', 'result', 'manifest_sha256', 'modules_published', 'supersedes', 'superseded_by', 'based_on']) {
    if (d[k] != null && d[k] !== '') parts.push(`${humanize(k.toUpperCase())}: ${Array.isArray(d[k]) ? (d[k] as string[]).join(', ') : String(d[k]).slice(0, k === 'manifest_sha256' ? 12 : 80)}`);
  }
  if (Array.isArray(d.fields) && d.fields.length) parts.push(`Fields: ${(d.fields as string[]).map((f) => humanize(f.toUpperCase())).join(', ')}`);
  return parts.join(' · ');
}

// ---- small form helper -----------------------------------------------------------------------------------------
export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: (p: { id: string; 'aria-describedby'?: string }) => ReactNode }) {
  return (
    <div className="stack" style={{ gap: 4, minWidth: 0 }}>
      <label className="form-label" htmlFor={id} style={{ marginBottom: 0 }}>{label}</label>
      {children({ id, 'aria-describedby': hint ? `${id}-hint` : undefined })}
      {hint ? <span id={`${id}-hint`} className="xsmall muted">{hint}</span> : null}
    </div>
  );
}
