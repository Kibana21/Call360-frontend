// Evidence renderers shared by Call Detail (F3) and Policy Detail (F4): an SBQ selection-risk assessment and a
// policy fact snapshot. Investment suitability inside a snapshot is always shown apart from SBQ selection risk.
import { Fragment } from 'react';
import type { FactSnapshot as Snapshot, RiskAssessment } from '../../api/client';
import { Badge } from '../../components/ui';
import { humanize, RiskBadge, when } from '../cases/shared';

export const short = (sha?: string | null) => (sha ? `${sha.slice(0, 12)}…` : '—');

export const show = (v: unknown): string => {
  if (v == null) return '—';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1) return show(o[keys[0]!]);
    return keys.map((k) => `${humanize(k)}: ${show(o[k])}`).join(' · ');
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
};

export function Risk({ a, supersedes }: { a: RiskAssessment; supersedes?: RiskAssessment }) {
  return (
    <div className="evidence" data-testid={`risk-${a.origin}`}>
      <div className="row between wrap"><span className="row"><RiskBadge band={a.band_code ?? 'NOT_ASSESSED'} /><strong className="small">{humanize(a.origin)}</strong></span>
        <span className="row">{a.effective ? <Badge tone="blue">Effective</Badge> : null}<Badge tone="gray">{humanize(a.status)}</Badge></span></div>
      <dl className="kv xsmall" style={{ marginTop: 8 }}>
        <dt>Valid at</dt><dd>{when(a.valid_at)} SGT</dd>
        <dt>Reason codes</dt><dd className="mono">{a.reason_codes.join(', ') || '—'}</dd>
        {a.source_original_value ? <><dt>Source original value</dt><dd className="mono">{a.source_original_value}</dd></> : null}
        {a.rule_set ? <><dt>Rule set</dt><dd>{a.rule_set} <span className="muted">(synthetic rule set — not AIA-approved)</span></dd></> : null}
        <dt>Explanation</dt><dd>{a.explanation ?? '—'}</dd>
        {a.factors.length ? <><dt>Factors</dt><dd>{a.factors.map((f) => `${humanize(f.factor_code)} = ${show(f.value)} (${humanize(f.result)})`).join(' · ')}</dd></> : null}
        {a.input_snapshot_sha256 ? <><dt>Input snapshot</dt><dd className="mono" title={a.input_snapshot_sha256}>{short(a.input_snapshot_sha256)}</dd></> : null}
        {a.supersedes_id ? <><dt>Supersedes</dt><dd>{supersedes ? `${humanize(supersedes.origin)} ${supersedes.band_code ?? ''} · ${when(supersedes.valid_at)} SGT` : 'an earlier assessment'}</dd></> : null}
      </dl>
    </div>
  );
}

export function FactSnapshot({ snap }: { snap: Snapshot }) {
  const suitability = snap.facts.suitability;
  return (
    <div data-testid="fact-snapshot">
      <dl className="kv xsmall">
        {Object.entries(snap.facts).filter(([k]) => k !== 'suitability').map(([k, v]) => {
          const prov = snap.field_provenance[k] as { source_system?: string; as_of?: string } | undefined;
          return (
            <Fragment key={k}><dt>{humanize(k)}</dt>
              <dd>{show(v)}{prov?.source_system ? <span className="muted"> · {prov.source_system}{prov.as_of ? ` as of ${prov.as_of}` : ''}</span> : null}</dd></Fragment>
          );
        })}
      </dl>
      {suitability ? <div className="explain" style={{ marginTop: 12 }}><strong>Investment suitability fact (not SBQ selection risk):</strong> {show(suitability)}</div> : null}
    </div>
  );
}
