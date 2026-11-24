// Survey Applicability (APPL-X1R) — choosing surveys. The list is Survey Studio's own catalogue of PUBLISHED versions
// (surveys.ts): nothing here is typed in, and an unpublished survey cannot appear. Several can be chosen at once, and
// any of them can be previewed without leaving the picker.
import { useMemo, useState } from 'react';
import type { SurveyRef } from './model/types';
import { useAppl } from './store';
import { Empty, Icon, Tag, short, usePanelFocus } from './ui';

export function SurveyTicket({ survey: s, onOpen, onRemove, onAdopt, position, testid, note }: { survey: SurveyRef; onOpen?: () => void; onRemove?: () => void; /** deliberately move this reference to the newer published version */ onAdopt?: (latest: SurveyRef) => void; position?: number; testid?: string; note?: string }) {
  const { data } = useAppl();
  const latest = data.surveys.find((x) => x.code === s.code);
  const pinned = s.version > 0;
  const newer = pinned && latest && latest.version > s.version;
  const gone = pinned && data.surveys.length > 0 && !latest;
  return (
    <div className={`ap-realsurvey${pinned ? '' : ' unpinned'}`} data-testid={testid} data-pinned={pinned} data-version={s.label ?? s.version}>
      <button type="button" className="ap-ticket" onClick={(e) => { e.stopPropagation(); onOpen?.(); }} title="Preview the published survey">
        <span className="ap-ticket-n">{position ?? <Icon name="survey" size={13} />}</span>
        <span className="ap-ticket-body"><strong>{s.name}</strong>
          <small>{pinned ? <>Published in Survey Studio · version {s.label ?? s.version} · {short(s.fingerprint)}</> : 'Not pinned: Survey Studio has no published version with this code'}{note ? ` · ${note}` : ''}</small></span>
        {pinned ? <span className="ap-pin" title="Pinned to this exact published version"><Icon name="lock" size={12} /></span> : <Tag tone="bad">not published</Tag>}
      </button>
      {onRemove ? <button type="button" className="ap-iconbtn" aria-label={`Remove ${s.name}`} onClick={(e) => { e.stopPropagation(); onRemove(); }} data-testid={testid ? `${testid}-remove` : undefined}><Icon name="x" size={13} /></button> : null}
      {newer ? <span className="ap-newer" data-testid={testid ? `${testid}-newer` : undefined}><Icon name="info" size={12} /> Version {latest.label ?? latest.version} is now published. This requirement stays on {s.label ?? s.version} until you adopt it.{onAdopt ? <> <button type="button" className="ap-linkbtn" onClick={(e) => { e.stopPropagation(); onAdopt(latest); }} data-testid={testid ? `${testid}-adopt` : undefined}>Adopt version {latest.label ?? latest.version}</button></> : null}</span> : null}
      {gone ? <span className="ap-newer bad"><Icon name="warn" size={12} /> Survey Studio no longer lists this survey.</span> : null}
    </div>
  );
}

export function SurveyPicker({ onClose, onPick, already = [], title = 'Add surveys' }: { onClose: () => void; onPick: (surveys: SurveyRef[]) => void; already?: string[]; title?: string }) {
  const { data, setPreview } = useAppl();
  const ref = usePanelFocus(true, onClose);
  const [q, setQ] = useState('');
  const [market, setMarket] = useState('ALL');
  const [chosen, setChosen] = useState<string[]>([]);
  const shown = useMemo(() => { const k = q.trim().toLowerCase(); return data.surveys.filter((s) => (market === 'ALL' || s.market === market) && (!k || `${s.name} ${s.summary ?? ''} ${s.code}`.toLowerCase().includes(k))); }, [data.surveys, q, market]);
  const markets = [...new Set(data.surveys.map((s) => s.market).filter(Boolean))] as string[];
  const toggle = (code: string) => setChosen((c) => (c.includes(code) ? c.filter((x) => x !== code) : [...c, code]));
  return (
    <div className="ap-scrim top" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="ap-surveypicker" role="dialog" aria-modal="true" aria-label={title} data-testid="ap-survey-picker">
        <header><div><h2>{title}</h2><p>Published surveys from Survey Studio. A requirement is pinned to the exact version you choose.</p></div><button type="button" className="ap-iconbtn" aria-label="Close" onClick={onClose}><Icon name="x" /></button></header>
        <div className="ap-toolbar">
          <label className="ap-searchbox"><Icon name="search" size={14} /><input data-autofocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or what the survey is for" aria-label="Search published surveys" data-testid="ap-survey-picker-search" /></label>
          {markets.length > 1 ? <select className="ap-input" aria-label="Market" value={market} onChange={(e) => setMarket(e.target.value)}><option value="ALL">Every market</option>{markets.map((m) => <option key={m}>{m}</option>)}</select> : null}
          <span className="ap-count" data-testid="ap-survey-picker-count">{shown.length} published</span>
        </div>
        <ul className="ap-surveylist" aria-label="Published surveys">
          {shown.map((s) => { const on = chosen.includes(s.code); const here = already.includes(s.code); return (
            <li key={s.code} className={`${on ? 'on' : ''}${here ? ' here' : ''}`} data-testid={`ap-survey-option-${s.code}`}>
              <button type="button" aria-pressed={on} disabled={here} className="ap-surveyrow" onClick={() => toggle(s.code)} data-testid={`ap-survey-option-${s.code}-select`}>
                <span className={`ap-checkbtn${on ? ' on' : ''}`} aria-hidden="true">{on ? <Icon name="check" size={12} /> : null}</span>
                <span className="ap-surveyrow-text"><strong>{s.name}</strong><small>{s.summary || 'No description.'}</small>
                  <span className="ap-surveyrow-meta"><Tag tone="published"><Icon name="lock" size={11} /> Published · version {s.label ?? s.version}</Tag>{s.market ? <Tag>{s.market}</Tag> : null}<code>{s.code}</code>{here ? <Tag>already in this requirement</Tag> : null}</span></span>
              </button>
              <button type="button" className="ap-btn quiet" onClick={() => setPreview(s)} data-testid={`ap-survey-option-${s.code}-preview`}><Icon name="eye" size={13} /> Preview</button>
            </li>
          ); })}
        </ul>
        {!data.surveys.length ? <Empty icon="survey" title="Survey Studio has no published survey you can read">Publish a survey in Survey Studio first. A draft cannot be chosen here.</Empty> : !shown.length ? <Empty icon="search" title={`No published survey matches “${q}”`}>Only published versions are listed. Check the spelling, or publish the survey in Survey Studio.</Empty> : null}
        <footer><span className="ap-quiet">{chosen.length ? `${chosen.length} chosen` : 'Choose one or several'}</span><span className="ap-spacer" /><button type="button" className="ap-btn quiet" onClick={onClose}>Cancel</button>
          <button type="button" className="ap-btn primary" disabled={!chosen.length} onClick={() => { onPick(data.surveys.filter((s) => chosen.includes(s.code))); onClose(); }} data-testid="ap-survey-picker-add"><Icon name="plus" size={13} /> Add {chosen.length > 1 ? `${chosen.length} surveys` : 'survey'}</button></footer>
      </div>
    </div>
  );
}
