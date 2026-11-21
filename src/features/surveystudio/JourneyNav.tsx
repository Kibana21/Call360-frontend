// Survey Studio prototype (SS-02C) — the one journey through a survey:
// Library → Compose → Build modules (Guided or Graph) → Simulate → Validate → Review and publish.
// Each step is a place that already exists; this strip only says where you are and what state each step is in.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PEOPLE, assess, govOf, person, setActor, standing, type Readiness, type Stage, type Standing } from './model/governance';
import type { Survey } from './model/types';
import { useStudio } from './store';
import { Glyph } from './ui';

export type JourneyStep = 'compose' | 'build' | 'simulate' | 'validate' | 'review';

export const STAGE_LABEL: Record<Stage, string> = { DRAFT: 'Draft', IN_REVIEW: 'In review', REJECTED: 'Sent back', APPROVED: 'Approved', PUBLISHED: 'Published' };

/** Validation readiness and lifecycle standing of one survey, recomputed only when the model or the review state changes. */
export function useGovernance(survey: Survey | undefined): { readiness: Readiness | null; standing: Standing | null } {
  const { ws, gov } = useStudio();
  return useMemo(() => {
    if (!survey) return { readiness: null, standing: null };
    const sg = govOf(gov, survey.id);
    return { readiness: assess(ws, survey, sg), standing: standing(ws, survey, sg) };
  }, [ws, gov, survey]);
}

/** `compact` = one slim row with no role switch, for the editing screens where the canvas needs the height. */
export function JourneyNav({ survey, at, compact }: { survey: Survey; at: JourneyStep; compact?: boolean }) {
  const { gov, govern } = useStudio();
  const { readiness, standing: st } = useGovernance(survey);
  const base = `/survey-studio/surveys/${survey.id}`;
  const first = survey.sequence[0]?.id;
  const steps: Array<{ id: JourneyStep | 'library'; label: string; to: string | null; state: string; tone?: 'warn' | 'ok' }> = [
    { id: 'library', label: 'Library', to: '/survey-studio', state: 'Modules and surveys' },
    { id: 'compose', label: 'Compose', to: base, state: `${survey.sequence.length} module${survey.sequence.length === 1 ? '' : 's'}` },
    { id: 'build', label: 'Build modules', to: first ? `${base}/modules/${first}` : null, state: 'Guided or graph' },
    { id: 'simulate', label: 'Simulate', to: survey.sequence.length ? `${base}/simulate` : null, state: 'Try a journey' },
    { id: 'validate', label: 'Validate', to: `${base}/validate`, ...(readiness?.blockers ? { state: `${readiness.blockers} blocker${readiness.blockers === 1 ? '' : 's'}`, tone: 'warn' as const } : readiness?.open ? { state: `${readiness.open} to acknowledge`, tone: 'warn' as const } : { state: 'Ready for review', tone: 'ok' as const }) },
    { id: 'review', label: 'Review and publish', to: `${base}/review`, state: st ? STAGE_LABEL[st.stage] : 'Draft', ...(st?.stage === 'REJECTED' ? { tone: 'warn' as const } : st?.stage === 'APPROVED' || st?.stage === 'PUBLISHED' ? { tone: 'ok' as const } : {}) },
  ];
  return (
    <div className={`ss-journey ${compact ? 'compact' : ''}`} data-testid="ss-journey">
      <nav aria-label="Steps for this survey">
        <ol>
          {steps.map((s, i) => {
            const body = (<><span className="ss-journey-n" aria-hidden="true">{i + 1}</span><span className="ss-journey-text"><strong>{s.label}</strong>
              <small className={s.tone ?? ''}>{s.tone === 'warn' ? <Glyph name="alert" size={12} /> : s.tone === 'ok' ? <Glyph name="check" size={12} /> : null}{s.state}</small></span></>);
            return (
              <li key={s.id} className={s.id === at ? 'here' : ''}>
                {s.id === at || !s.to ? <span className="ss-journey-step" aria-current={s.id === at ? 'step' : undefined} aria-disabled={!s.to && s.id !== at ? true : undefined}>{body}</span>
                  : <Link className="ss-journey-step" to={s.to} data-testid={`ss-journey-${s.id}`}>{body}</Link>}
              </li>
            );
          })}
        </ol>
      </nav>
      {compact ? null : <label className="ss-actor" title="Invented people. A role here is a label in the prototype, not a Call360 permission.">
        <span>Acting as <em>simulated</em></span>
        <select value={gov.actor} onChange={(e) => govern((g) => setActor(g, e.target.value))} data-testid="ss-actor">
          {PEOPLE.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.title}</option>)}
        </select>
      </label>}
    </div>
  );
}

/** "Mei Ling Tan (author)". */
export const who = (id: string): string => { const p = person(id); return `${p.name} (${p.can.map((c) => c.toLowerCase()).join(', ') || 'no permission'})`; };
export const when = (at: number): string => new Date(at).toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
