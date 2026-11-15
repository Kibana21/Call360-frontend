// Administration → Configuration (CP0.1B-1): versioned code lists and stage-gated feature flags.
// Governance is enforced by the server; this screen only offers actions the server permits.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiFailure, unwrap, type CodeList, type CodeListVersion, type FeatureFlag } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Empty, ErrorState, Forbidden, Loading } from '../../components/StateView';
import { Badge, Button, Card } from '../../components/ui';

const when = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore' }).format(new Date(iso)) : '—';

function failure(e: unknown, what: string) {
  if (e instanceof ApiFailure && e.status === 403) return <Forbidden />;
  return <ErrorState message={`${what} could not be loaded.`} correlationId={e instanceof ApiFailure ? e.body?.correlation_id : null} />;
}

export function ConfigPage() {
  return (
    <div className="stack" style={{ gap: 19 }}>
      <CodeListsCard />
      <FlagsCard />
    </div>
  );
}

// ---- Code lists --------------------------------------------------------------------------------
function CodeListsCard() {
  const query = useQuery({ queryKey: ['admin', 'code-lists'], queryFn: async () => unwrap(await api.GET('/api/v1/admin/code-lists')) });
  const [openCode, setOpenCode] = useState<string | null>(null);
  let body: ReactNode;
  if (query.isPending) body = <Loading label="Loading code lists…" />;
  else if (query.isError) body = failure(query.error, 'Code lists');
  else if (query.data.items.length === 0) body = <Empty title="No code lists are defined" />;
  else body = (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="sr-only">Code lists</caption>
        <thead><tr><th scope="col">List</th><th scope="col">Governance</th><th scope="col">Active version</th><th scope="col">Values</th><th scope="col">Versions</th><th scope="col"><span className="sr-only">Details</span></th></tr></thead>
        <tbody>
          {query.data.items.map((cl) => {
            const active = cl.versions.find((v) => v.status === 'ACTIVE');
            return (
              <tr key={cl.code}>
                <td><div className="strong">{cl.name}</div><div className="xsmall muted mono">{cl.code}</div></td>
                <td>{cl.governed ? <Badge tone="amber">Governed · read-only</Badge> : <Badge tone="blue">Labels editable</Badge>}</td>
                <td>{active ? `v${active.version}` : <span className="muted">Not yet seeded</span>}</td>
                <td>{active ? active.values.length : '—'}</td>
                <td>{cl.versions.length}</td>
                <td style={{ textAlign: 'right' }}><button type="button" className="linkbtn" onClick={() => setOpenCode(cl.code)} aria-label={`View ${cl.name}`}>View</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  const open = query.data?.items.find((c) => c.code === openCode) ?? null;
  return (
    <Card title="Code lists" subtitle="Versioned value lists. Business-governed lists are read-only until the approval workflow is available; their values arrive with the business data." pad={false}>
      {body}
      {open ? <CodeListDrawer list={open} onClose={() => setOpenCode(null)} /> : null}
    </Card>
  );
}

function CodeListDrawer({ list, onClose }: { list: CodeList; onClose: () => void }) {
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);
  const active = list.versions.find((v) => v.status === 'ACTIVE');
  const canEdit = !list.governed && can('config.manage') && !!active;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="list-title">
        <div className="drawer-head">
          <div><div className="eyebrow">Code list · {list.code}</div><h2 id="list-title">{list.name}</h2></div>
          <Button icon="close" onClick={onClose} autoFocus>Close</Button>
        </div>
        <div className="drawer-body">
          <p className="small muted" style={{ marginTop: 0, lineHeight: 1.6 }}>{list.description}</p>
          {list.governed ? (
            <div className="explain" role="note">Business-governed list: read-only. Changes require the business approval workflow, which arrives in a later stage.</div>
          ) : null}
          {editing && active ? (
            <NewVersionForm list={list} active={active} onDone={() => setEditing(false)} />
          ) : (
            <>
              {canEdit ? <div className="row right" style={{ marginBottom: 12 }}><Button variant="primary" icon="plus" onClick={() => setEditing(true)}>New version</Button></div> : null}
              {list.versions.length === 0 ? <Empty title="No versions yet">Values for this list are seeded with the business data.</Empty> : null}
              {list.versions.map((v) => <VersionBlock key={v.version} version={v} />)}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function VersionBlock({ version }: { version: CodeListVersion }) {
  const tone = version.status === 'ACTIVE' ? 'green' : version.status === 'SUPERSEDED' ? 'gray' : 'amber';
  return (
    <section className="softbox" style={{ marginBottom: 12 }} aria-label={`Version ${version.version}`}>
      <div className="row between wrap">
        <strong>Version {version.version}</strong>
        <Badge tone={tone}>{version.status}</Badge>
      </div>
      <div className="xsmall muted" style={{ margin: '6px 0 10px', lineHeight: 1.6 }}>
        Activated {when(version.activated_at)}{version.superseded_at ? ` · superseded ${when(version.superseded_at)}` : ''} · by {version.created_by_name ?? version.created_by}<br />
        Reason: {version.change_reason}
      </div>
      <table className="data-table">
        <caption className="sr-only">Values in version {version.version}</caption>
        <thead><tr><th scope="col">Code</th><th scope="col">Label</th><th scope="col">Attributes</th></tr></thead>
        <tbody>{version.values.map((v) => (
          <tr key={v.code}><td className="mono strong">{v.code}</td><td>{v.label}</td>
            <td className="mono xsmall">{Object.keys(v.attributes).length ? JSON.stringify(v.attributes) : '—'}</td></tr>
        ))}</tbody>
      </table>
    </section>
  );
}

function NewVersionForm({ list, active, onDone }: { list: CodeList; active: CodeListVersion; onDone: () => void }) {
  const qc = useQueryClient();
  const [labels, setLabels] = useState<Record<string, string>>(() => Object.fromEntries(active.values.map((v) => [v.code, v.label])));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const changed = active.values.some((v) => labels[v.code]?.trim() !== v.label);
  const mutation = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/v1/admin/code-lists/{code}/versions', {
      params: { path: { code: list.code } },
      body: {
        based_on_version: active.version,
        reason: reason.trim(),
        values: active.values.map((v) => ({ code: v.code, label: (labels[v.code] ?? v.label).trim(), attributes: v.attributes as Record<string, string | number | boolean | null>, sort_order: v.sort_order })),
      },
    })),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['admin', 'code-lists'] }); onDone(); },
    onError: (e) => setError(e instanceof ApiFailure && e.code === 'CONFLICT_STALE_VERSION'
      ? 'This list changed since you opened it. Close and reopen to see the latest version.'
      : e instanceof ApiFailure ? e.message : 'The new version could not be saved.'),
  });
  function submit(event: FormEvent) { event.preventDefault(); setError(null); mutation.mutate(); }
  return (
    <form onSubmit={submit} aria-label={`New version of ${list.name}`}>
      <div className="section-label">New version (based on v{active.version})</div>
      <p className="small muted" style={{ marginTop: 0 }}>Codes are fixed for this list; only labels can change. The current version is superseded and kept in history.</p>
      {active.values.map((v, i) => (
        <div key={v.code} style={{ marginBottom: 12 }}>
          <label className="form-label" htmlFor={`label-${v.code}`}>Label for <span className="mono">{v.code}</span></label>
          <input id={`label-${v.code}`} ref={i === 0 ? first : undefined} className="field labelled" maxLength={120} required
            value={labels[v.code] ?? ''} onChange={(e) => setLabels({ ...labels, [v.code]: e.target.value })} />
        </div>
      ))}
      <label className="form-label" htmlFor="version-reason">Reason (required)</label>
      <textarea id="version-reason" className="field labelled textarea" rows={3} minLength={3} maxLength={500} required
        value={reason} onChange={(e) => setReason(e.target.value)} />
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <div className="row right" style={{ marginTop: 16 }}>
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!changed || reason.trim().length < 3 || mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Activate new version'}
        </Button>
      </div>
    </form>
  );
}

// ---- Feature flags -----------------------------------------------------------------------------
function FlagsCard() {
  const { can } = useAuth();
  const query = useQuery({ queryKey: ['admin', 'feature-flags'], queryFn: async () => unwrap(await api.GET('/api/v1/admin/feature-flags')) });
  const [target, setTarget] = useState<FeatureFlag | null>(null);
  let body: ReactNode;
  if (query.isPending) body = <Loading label="Loading feature flags…" />;
  else if (query.isError) body = failure(query.error, 'Feature flags');
  else if (query.data.items.length === 0) body = <Empty title="No feature flags are registered" />;
  else body = (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="sr-only">Feature flags (current stage {query.data.current_stage})</caption>
        <thead><tr><th scope="col">Capability</th><th scope="col">Stage</th><th scope="col">State</th><th scope="col">Last change</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {query.data.items.map((f) => {
            const last = f.history[0];
            const note = `stage-${f.code.replace(/\W/g, '-')}`;
            return (
              <tr key={f.code}>
                <td><div className="strong">{f.description}</div><div className="xsmall muted mono">{f.code}</div></td>
                <td><span className="stage-chip">Stage {f.stage_gate}</span></td>
                <td>{f.enabled ? <Badge tone="green">On</Badge> : <Badge tone="gray">Off</Badge>}{f.locked ? <span id={note} className="xsmall muted" style={{ display: 'block', marginTop: 4 }}>Locked until Stage {f.stage_gate}</span> : null}</td>
                <td className="small">{last ? `${last.new_enabled ? 'Enabled' : 'Disabled'} by ${last.changed_by_name ?? last.changed_by} · ${when(last.changed_at)}` : <span className="muted">No changes</span>}</td>
                <td style={{ textAlign: 'right' }}>
                  {can('config.manage') ? (
                    <Button tiny disabled={f.locked && !f.enabled} aria-describedby={f.locked ? note : undefined}
                      aria-label={`${f.enabled ? 'Disable' : 'Enable'} ${f.description}`} onClick={() => setTarget(f)}>
                      {f.enabled ? 'Disable' : 'Enable'}
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  return (
    <Card title="Feature flags" subtitle="Capabilities for later stages are registered here, switched off and locked until their stage. Flags do not turn on features that have not been built." pad={false}>
      {body}
      {target ? <FlagDialog flag={target} onClose={() => setTarget(null)} /> : null}
    </Card>
  );
}

function FlagDialog({ flag, onClose }: { flag: FeatureFlag; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const enabling = !flag.enabled;
  const mutation = useMutation({
    mutationFn: async () => unwrap(await api.PATCH('/api/v1/admin/feature-flags/{code}', {
      params: { path: { code: flag.code }, header: { 'If-Match': String(flag.row_version) } },
      body: { enabled: enabling, reason: reason.trim() },
    })),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['admin', 'feature-flags'] }); onClose(); },
    onError: (e) => setError(e instanceof ApiFailure ? e.message : 'The change could not be saved.'),
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="flag-title">
        <form className="modal-content" onSubmit={(e) => { e.preventDefault(); setError(null); mutation.mutate(); }}>
          <div className="eyebrow">{enabling ? 'Enable' : 'Disable'} feature flag</div>
          <h2 id="flag-title" style={{ margin: '6px 0 12px' }}>{flag.description}</h2>
          <label className="form-label" htmlFor="flag-reason">Reason (required)</label>
          <textarea id="flag-reason" className="field labelled textarea" rows={3} minLength={3} maxLength={500} autoFocus
            value={reason} onChange={(e) => setReason(e.target.value)} required />
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <div className="row right" style={{ marginTop: 18 }}>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={reason.trim().length < 3 || mutation.isPending}>
              {mutation.isPending ? 'Saving…' : enabling ? 'Enable flag' : 'Disable flag'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
