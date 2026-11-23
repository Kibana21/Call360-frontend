// S2-B Assignment Rules — shared types, option lookups, badges and small renderers. Every vocabulary, validation
// result, specificity and explanation comes from the backend (`/assignment-rules/options`, `/explain`, drafts).
import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { Badge, type Tone } from '../../components/ui';
import { humanize } from '../cases/shared';

export type RuleOptions = components['schemas']['RuleOptions'];
export type RuleDraft = components['schemas']['RuleDraftOut'];
export type RuleVersion = components['schemas']['RuleVersionOut'];
export type RuleSummary = components['schemas']['RuleSummary'];
export type RuleCondition = components['schemas']['RuleCondition'];
export type RuleContent = components['schemas']['RuleContent'];
export type Analysis = components['schemas']['RuleAnalysis'];
export type Simulation = components['schemas']['RuleSimulation'];
export type SimCase = components['schemas']['SimCase'];
export type RuleValue = string | boolean;

export function useRuleOptions() {
  return useQuery({ queryKey: ['rule-options'], queryFn: async () => unwrap(await api.GET('/api/v1/assignment-rules/options')), staleTime: 60_000 });
}

/** SHARED-1 — what a rule selects. A survey-only rule names no script and can never assign one to a case. */
export const SURVEY_ONLY = 'SURVEY_BINDING';
export const isSurveyOnly = (x: { target_kind?: string } | null | undefined) => x?.target_kind === SURVEY_ONLY;
export const BINDINGS_HREF = '/survey-studio/assignment';
export function TargetKind({ kind }: { kind: string | undefined }) {
  return kind === SURVEY_ONLY
    ? <Badge tone="purple" noDot>Survey binding · no script</Badge>
    : <Badge tone="gray" noDot>Script · for cases</Badge>;
}

export const ruleHref = (code: string, query?: string) => `/assignment-rules/${encodeURIComponent(code)}${query ? `?${query}` : ''}`;

export function fieldLabel(o: RuleOptions | undefined, field: string): string {
  return o?.fields.find((f) => f.field === field)?.label ?? humanize(field.toUpperCase());
}

export function valueLabel(o: RuleOptions | undefined, field: string, value: unknown): string {
  const f = o?.fields.find((x) => x.field === field);
  const hit = f?.values.find((v) => v.value === value);
  if (hit) return hit.label;
  if (typeof value === 'boolean') return value ? 'ILP' : 'Not ILP';
  return String(value);
}

/** One chip per constrained field ("Product family: ILP or Endowment"). Unlisted fields are unrestricted (any). */
export function ConditionChips({ conditions, o }: { conditions: RuleCondition[]; o: RuleOptions | undefined }) {
  return (
    <span className="row wrap" style={{ gap: 6 }} data-testid="condition-chips">
      {conditions.map((c) => (
        <span key={c.field} className="tag"><span className="muted">{fieldLabel(o, c.field)}:</span> <strong>{c.values.map((v) => valueLabel(o, c.field, v)).join(' or ')}</strong></span>
      ))}
    </span>
  );
}

const OUTCOME: Record<string, [string, Tone]> = {
  SELECTED: ['Script selected', 'green'],
  SELECTED_BY_FALLBACK: ['Selected by fallback', 'blue'],
  NO_MATCH: ['No match', 'gray'],
  AMBIGUOUS: ['Ambiguous', 'red'],
  AMBIGUOUS_SAME_TARGET: ['Tie (same script) — review', 'red'],
  INPUT_MISSING: ['Input missing', 'amber'],
  TARGET_NOT_EFFECTIVE: ['Script not effective', 'amber'],
};
export const outcomeLabel = (o: string) => OUTCOME[o]?.[0] ?? humanize(o);
export function OutcomeBadge({ outcome }: { outcome: string }) {
  const [label, tone] = OUTCOME[outcome] ?? [humanize(outcome), 'gray' as Tone];
  return <Badge tone={tone}>{label}</Badge>;
}

const STATUS: Record<string, Tone> = {
  PUBLISHED: 'green', DRAFT: 'amber', SUBMITTED_FOR_REVIEW: 'purple', APPROVED: 'blue', SUPERSEDED: 'gray', WITHDRAWN: 'red', ABANDONED: 'gray',
};
export function RuleStatus({ status }: { status: string }) {
  return <Badge tone={STATUS[status] ?? 'gray'}>{humanize(status)}</Badge>;
}

export function IssueList({ analysis, testId = 'rule-issues' }: { analysis: Analysis; testId?: string }) {
  const issues = analysis.issues;
  if (!issues.length) return <p className="small" data-testid={`${testId}-clean`} style={{ margin: 0 }}><Badge tone="green">Valid</Badge> No errors or warnings.</p>;
  return (
    <ul className="plain-list stack" style={{ gap: 6 }} aria-label="Validation results" data-testid={testId}>
      {issues.map((i, k) => (
        <li key={k} className="small" data-testid={`issue-${i.code}`}>
          <Badge tone={i.severity === 'ERROR' ? 'red' : i.severity === 'WARNING' ? 'amber' : 'blue'}>{humanize(i.severity)}</Badge> {i.message}
        </li>
      ))}
    </ul>
  );
}

export function ConflictList({ conflicts }: { conflicts: Analysis['conflicts'] }) {
  if (!conflicts.length) return <p className="small muted" style={{ margin: 0 }} data-testid="no-conflicts">No overlapping or conflicting rules.</p>;
  const tone: Record<string, Tone> = { AMBIGUOUS: 'red', SAME_TARGET_TIE: 'red', SHADOWED: 'amber', OVERLAP: 'blue' };
  return (
    <ul className="plain-list stack" style={{ gap: 6 }} data-testid="rule-conflicts">
      {conflicts.map((c, k) => (
        <li key={k} className="small" data-testid={`conflict-${c.kind}`}>
          <Badge tone={tone[c.kind] ?? 'gray'}>{humanize(c.kind)}</Badge>{c.against === 'OPEN_DRAFT' ? <Badge tone="gray" noDot>Unpublished draft</Badge> : null} {c.message}
        </li>
      ))}
    </ul>
  );
}

export const people = (map: Record<string, string> | undefined, ref: string | null | undefined) => (ref ? map?.[ref] ?? ref : '—');
