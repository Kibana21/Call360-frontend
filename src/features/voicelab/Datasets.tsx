// Voice Lab Golden Dataset (S1-E.1): datasets of synthetic test cases — system prompt, test instruction, expected
// spoken statement, synthetic customer response, expected structured answer, expected behaviour, evaluation criteria,
// optional mock output and optional synthetic audio fixture (16 kHz mono WAV). Saving an existing case appends a
// revision (history kept). Synthetic questions and statements can be imported from Script Studio.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, unwrap } from '../../api/client';
import { Badge, Button, Card } from '../../components/ui';
import { when } from '../cases/shared';
import { ErrorBox, Field } from '../scripts/ScriptEditor';
import { errorText } from '../simulator/ScenarioLibrary';
import { useLabAction, type LabCase, type LabDataset } from './shared';

interface CaseForm {
  name: string; description: string; system_prompt: string; test_instruction: string; expected_statement: string;
  customer_response: string; answer: string; expected_behaviour: string; mock_output: string; exact: boolean;
  max_wer: string; max_first: string; max_int: string; min_acc: string; note: string; wav: string | null; wavName: string;
}
const BLANK: CaseForm = {
  name: '', description: '', system_prompt: '', test_instruction: '', expected_statement: '', customer_response: '', answer: '',
  expected_behaviour: '', mock_output: '', exact: true, max_wer: '0.1', max_first: '', max_int: '', min_acc: '', note: '', wav: null, wavName: '',
};

function toForm(c: LabCase): CaseForm {
  const cr = c.criteria as Record<string, unknown>;
  const s = (k: string) => (cr[k] === undefined ? '' : String(cr[k]));
  return {
    name: c.name, description: c.description, system_prompt: c.system_prompt, test_instruction: c.test_instruction,
    expected_statement: c.expected_statement, customer_response: c.customer_response,
    answer: Object.entries(c.expected_answer).map(([k, v]) => `${k}=${String(v)}`).join('\n'), expected_behaviour: c.expected_behaviour,
    mock_output: c.mock_output ?? '', exact: cr.exact_wording === true, max_wer: s('max_wer'), max_first: s('max_first_audio_ms'),
    max_int: s('max_interruption_ms'), min_acc: s('min_answer_accuracy'), note: '', wav: null, wavName: '',
  };
}

function body(f: CaseForm) {
  const criteria: Record<string, unknown> = {};
  if (f.exact) criteria.exact_wording = true;
  for (const [k, v] of [['max_wer', f.max_wer], ['max_first_audio_ms', f.max_first], ['max_interruption_ms', f.max_int], ['min_answer_accuracy', f.min_acc]] as const) {
    if (v.trim() !== '') criteria[k] = Number(v);
  }
  const expected_answer = Object.fromEntries(f.answer.split('\n').map((l) => l.split('=').map((x) => x.trim())).filter((p) => p.length === 2 && p[0]).map(([k, v]) => [k, v]));
  return {
    name: f.name, description: f.description, system_prompt: f.system_prompt, test_instruction: f.test_instruction,
    expected_statement: f.expected_statement, customer_response: f.customer_response, expected_answer,
    expected_behaviour: f.expected_behaviour, criteria, mock_output: f.mock_output.trim() ? f.mock_output : null,
    audio_wav_b64: f.wav, keep_audio: true, retired: false, change_note: f.note || null,
  };
}

async function fileB64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function Datasets() {
  const q = useQuery({ queryKey: ['voicelab', 'datasets'], queryFn: async () => unwrap(await api.GET('/api/v1/voice-lab/datasets')) });
  const [sel, setSel] = useState('');
  const [newName, setNewName] = useState('');
  const create = useLabAction<LabDataset>();
  const list = useMemo(() => q.data?.items ?? [], [q.data]);
  useEffect(() => { if (!sel && list[0]) setSel(list[0].id); }, [list, sel]);
  const d = list.find((x) => x.id === sel) ?? null;
  return (
    <div className="stack" style={{ gap: 16 }} data-testid="lab-datasets">
      <Card title="Golden datasets" subtitle="Synthetic test cases only — never real customer speech or data.">
        <div className="row wrap" style={{ gap: 8, alignItems: 'flex-end' }}>
          <Field id="ds-sel" label="Dataset">{(p) => (
            <select {...p} className="field" value={sel} onChange={(e) => setSel(e.target.value)} data-testid="lab-dataset-select">
              {list.length ? null : <option value="">No datasets yet</option>}
              {list.map((x) => <option key={x.id} value={x.id}>{x.dataset_ref} · {x.name} ({x.cases.length})</option>)}
            </select>)}</Field>
          <Field id="ds-new" label="New dataset name">{(p) => <input {...p} className="field labelled" value={newName} onChange={(e) => setNewName(e.target.value)} data-testid="lab-dataset-name" />}</Field>
          <Button onClick={() => create.mutate(async () => { const r = unwrap(await api.POST('/api/v1/voice-lab/datasets', { body: { name: newName, description: '' } })); setSel(r.id); setNewName(''); return r; })}
            disabled={newName.trim().length < 3 || create.isPending} data-testid="lab-dataset-create">Create dataset</Button>
        </div>
        <ErrorBox error={create.error ? errorText(create.error) : null} />
      </Card>
      {d ? <DatasetCases key={d.id} d={d} /> : null}
    </div>
  );
}

function DatasetCases({ d }: { d: LabDataset }) {
  const [editing, setEditing] = useState<LabCase | 'new' | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  return (
    <>
      <Card title={`${d.dataset_ref} · ${d.name}`} subtitle="Current revision of each test case" aside={<Button tiny onClick={() => setEditing('new')} data-testid="lab-case-new">Add test case</Button>}>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Test cases"><table className="data-table" data-testid="lab-cases">
          <thead><tr><th>Case</th><th>Expected statement</th><th>Answer</th><th>Audio</th><th>Source</th><th /></tr></thead>
          <tbody>
            {d.cases.length ? d.cases.map((c) => (
              <tr key={c.id} data-testid={`lab-case-${c.case_ref}`}>
                <td><span className="mono small">{c.case_ref}</span> r{c.revision}{c.retired ? <Badge tone="gray">Retired</Badge> : null}<div className="small">{c.name}</div></td>
                <td className="small">{c.expected_statement}</td>
                <td className="xsmall mono">{Object.keys(c.expected_answer).length ? JSON.stringify(c.expected_answer) : '—'}</td>
                <td className="xsmall">{c.audio_samples ? `${(c.audio_samples / 16000).toFixed(1)} s WAV` : 'None'}</td>
                <td className="xsmall">{(c.source as { kind?: string; question_code?: string }).kind === 'SCRIPT_STUDIO' ? `Script Studio ${(c.source as { question_code?: string }).question_code}` : 'Manual'}</td>
                <td><div className="row" style={{ gap: 4 }}>
                  <Button tiny onClick={() => setEditing(c)} data-testid={`lab-case-edit-${c.case_ref}`}>Revise</Button>
                  <Button tiny onClick={() => setHistory(history === c.test_case_id ? null : c.test_case_id)}>History ({c.revisions ?? 1})</Button>
                </div></td>
              </tr>
            )) : <tr><td colSpan={6} className="small muted">No test cases yet. Add one or import from Script Studio.</td></tr>}
          </tbody>
        </table></div>
        {history ? <CaseHistory caseId={history} /> : null}
      </Card>
      {editing ? <CaseEditor key={editing === 'new' ? 'new' : editing.id} d={d} existing={editing === 'new' ? null : editing} onDone={() => setEditing(null)} /> : null}
      <ScriptImport d={d} />
    </>
  );
}

function CaseHistory({ caseId }: { caseId: string }) {
  const q = useQuery({ queryKey: ['voicelab', 'case-history', caseId], queryFn: async () => unwrap(await api.GET('/api/v1/voice-lab/test-cases/{test_case_id}/revisions', { params: { path: { test_case_id: caseId } } })) });
  return (
    <ol className="plain-list small" style={{ flexDirection: 'column', marginTop: 10 }} data-testid="lab-case-history">
      {(q.data?.items ?? []).map((r) => <li key={r.id}>r{r.revision} · {when(r.created_at)} · {r.change_note} — “{r.expected_statement}”</li>)}
    </ol>
  );
}

function CaseEditor({ d, existing, onDone }: { d: LabDataset; existing: LabCase | null; onDone: () => void }) {
  const [f, setF] = useState<CaseForm>(existing ? toForm(existing) : BLANK);
  const save = useLabAction<LabCase>();
  const set = (k: keyof CaseForm) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = () => save.mutate(async () => {
    const r = existing
      ? unwrap(await api.POST('/api/v1/voice-lab/datasets/{dataset_id}/cases/{test_case_id}/revisions', { params: { path: { dataset_id: d.id, test_case_id: existing.test_case_id } }, body: { ...body(f), expected_revision: existing.revision } }))
      : unwrap(await api.POST('/api/v1/voice-lab/datasets/{dataset_id}/cases', { params: { path: { dataset_id: d.id } }, body: body(f) }));
    onDone();
    return r;
  });
  const text = (k: keyof CaseForm, label: string, rows = 2, hint?: string) => (
    <Field id={`lc-${k}`} label={label} hint={hint}>{(p) => <textarea {...p} className="field textarea labelled" rows={rows} value={String(f[k] ?? '')} onChange={set(k)} data-testid={`lab-case-${k}`} />}</Field>
  );
  return (
    <Card title={existing ? `Revise ${existing.case_ref} (creates r${existing.revision + 1})` : 'New test case'} subtitle="Synthetic content only">
      <div className="layout cols-2" style={{ gap: 12 }}>
        <div className="stack" style={{ gap: 8 }}>
          <Field id="lc-name" label="Name">{(p) => <input {...p} className="field labelled" value={f.name} onChange={set('name')} data-testid="lab-case-name" />}</Field>
          {text('description', 'Description', 1)}
          {text('system_prompt', 'System prompt', 2)}
          {text('test_instruction', 'Test instruction', 2)}
          {text('expected_statement', 'Expected spoken statement', 2)}
          {text('mock_output', 'Mock provider output (optional)', 2, 'What the mock reports it said; defaults to the expected statement. Lets you test deviations.')}
        </div>
        <div className="stack" style={{ gap: 8 }}>
          {text('customer_response', 'Synthetic customer response', 2)}
          {text('answer', 'Expected structured answer', 2, 'One field per line, e.g. answer=YES or term=20')}
          {text('expected_behaviour', 'Expected model behaviour', 2, 'Assessed by a person (no automated judge)')}
          <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0, margin: 0 }}>
            <legend className="form-label">Evaluation criteria</legend>
            <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={f.exact} onChange={(e) => setF({ ...f, exact: e.target.checked })} data-testid="lab-case-exact" /> Exact wording required</label>
            <div className="row wrap" style={{ gap: 8 }}>
              {([['max_wer', 'Max WER (0–1)'], ['max_first', 'Max first audio (ms)'], ['max_int', 'Max interruption (ms)'], ['min_acc', 'Min answer accuracy (0–1)']] as const).map(([k, l]) => (
                <Field key={k} id={`lc-${k}`} label={l}>{(p) => <input {...p} className="field labelled" style={{ width: 130 }} inputMode="decimal" value={f[k]} onChange={set(k)} data-testid={`lab-case-${k}`} />}</Field>
              ))}
            </div>
          </fieldset>
          <Field id="lc-wav" label="Synthetic audio fixture (optional)" hint={existing?.audio_samples ? 'Kept from the previous revision unless you choose a new file. 16 kHz mono 16-bit WAV, ≤ 30 s.' : '16 kHz mono 16-bit WAV, ≤ 30 s. Transcribed locally to measure what was heard.'}>{(p) => (
            <input {...p} type="file" accept=".wav,audio/wav" data-testid="lab-case-wav" onChange={async (e) => { const file = e.target.files?.[0]; setF({ ...f, wav: file ? await fileB64(file) : null, wavName: file?.name ?? '' }); }} />)}</Field>
          <Field id="lc-note" label="Change note">{(p) => <input {...p} className="field labelled" value={f.note} onChange={set('note')} data-testid="lab-case-note" />}</Field>
        </div>
      </div>
      <ErrorBox error={save.error ? errorText(save.error) : null} />
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <Button variant="primary" onClick={submit} disabled={save.isPending || f.name.trim().length < 3 || !f.expected_statement.trim()} data-testid="lab-case-save">{existing ? 'Save revision' : 'Save test case'}</Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </Card>
  );
}

function ScriptImport({ d }: { d: LabDataset }) {
  const src = useQuery({ queryKey: ['voicelab', 'script-sources'], queryFn: async () => unwrap(await api.GET('/api/v1/voice-lab/script-sources')) });
  const [vid, setVid] = useState('');
  const [codes, setCodes] = useState('');
  const run = useLabAction<unknown>();
  return (
    <Card title="Import from Script Studio" subtitle="Copies synthetic question and statement wording into new test cases (read-only on scripts; each case records its source question revision).">
      <div className="row wrap" style={{ gap: 8, alignItems: 'flex-end' }}>
        <Field id="imp-v" label="Script version">{(p) => (
          <select {...p} className="field" value={vid} onChange={(e) => setVid(e.target.value)} data-testid="lab-import-version">
            <option value="">Choose…</option>
            {(src.data?.items ?? []).map((s) => <option key={s.id} value={s.id}>{s.family} {s.version_label} · {s.status.toLowerCase()} · {s.questions} items</option>)}
          </select>)}</Field>
        <Field id="imp-c" label="Question codes (optional)" hint="Comma-separated; empty imports all">{(p) => <input {...p} className="field labelled" value={codes} onChange={(e) => setCodes(e.target.value)} data-testid="lab-import-codes" />}</Field>
        <Button onClick={() => run.mutate(async () => unwrap(await api.POST('/api/v1/voice-lab/datasets/{dataset_id}/import-script', { params: { path: { dataset_id: d.id } }, body: { script_version_id: vid, question_codes: codes.trim() ? codes.split(',').map((c) => c.trim()).filter(Boolean) : null } })))}
          disabled={!vid || run.isPending} data-testid="lab-import">Import</Button>
      </div>
      <ErrorBox error={run.error ? errorText(run.error) : null} />
      {run.isSuccess ? <p className="small" role="status" data-testid="lab-import-done">Imported.</p> : null}
    </Card>
  );
}
