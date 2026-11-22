import { describe, expect, it } from 'vitest';
import { NAV, childIsHere, navFor, placeOf } from './nav';

const routes = (groups: ReturnType<typeof navFor>) => groups.flatMap((g) => g.items.flatMap((i) => [i.to, ...(i.children ?? []).map((c) => c.to.split('?')[0])])).filter(Boolean);

describe('NAV-1 the consolidated navigation', () => {
  it('has five groups in order, in every mode', () => {
    for (const g of [NAV, navFor(true, false), navFor(true, true)]) expect(g.map((x) => x.group)).toEqual(['Workspace', 'Design & Govern', 'Simulate & Analyze', 'Operations', 'Legacy & Administration']);
  });
  it('keeps every route the old navigation had, with its label', () => {
    const before: Array<[string, string]> = [['Overview', '/'], ['Call Explorer', '/calls'], ['Policy Explorer', '/policies'], ['SBQ Risk Workbench', '/risk-assessments'], ['Work Queues', '/queues'], ['Voice Studio', '/voice-studio'], ['Voice Lab', '/voice-lab'], ['Script Studio', '/scripts'], ['Assignment Rules', '/assignment-rules'], ['Simulation Workbench', '/simulator'], ['Finding Rules', '/finding-rules'], ['Review Workbench', '/reviews'], ['Search', '/search'], ['Data Intake', '/intake'], ['Administration', '/admin/users']];
    for (const groups of [NAV, navFor(true, true)]) {
      const all = groups.flatMap((g) => g.items.flatMap((i) => [[i.label, i.to], ...(i.children ?? []).map((c) => [c.label, c.to])]));
      for (const [label, to] of before) expect(all, `${label} → ${to}`).toContainEqual([label, to]);
    }
    for (const stage of ['Live Monitor', 'Campaigns', 'Analytics']) expect(NAV.flatMap((g) => g.items).find((i) => i.label === stage)).toMatchObject({ stage: 'Stage S4' });
  });
  it('lists no screen twice at the top level, and Survey Studio only when its setting is on', () => {
    for (const groups of [NAV, navFor(true, true)]) { const top = groups.flatMap((g) => g.items.map((i) => i.to)).filter(Boolean); expect(new Set(top).size).toBe(top.length); }
    expect(routes(NAV).some((r) => String(r).startsWith('/survey-studio'))).toBe(false);
    expect(navFor(true, false).flatMap((g) => g.items).find((i) => i.label === 'Survey Studio')?.children).toBeUndefined(); // the prototype has no sub-pages
  });
  it('knows where an address is: the active entry and the breadcrumb', () => {
    const g = navFor(true, true);
    const at = (path: string, search = '') => { const p = placeOf(g, path, search); return [p?.group, p?.item.label, p?.child?.label]; };
    expect(at('/survey-studio')).toEqual(['Design & Govern', 'Survey Studio', 'Home']);
    expect(at('/survey-studio', '?view=blocks')).toEqual(['Design & Govern', 'Survey Studio', 'Building blocks']);
    expect(at('/survey-studio/surveys/S-1/modules/m1')).toEqual(['Design & Govern', 'Survey Studio', 'Surveys']);
    expect(at('/survey-studio/rules')).toEqual(['Design & Govern', 'Survey Studio', 'Rules explorer']);
    expect(at('/survey-studio/assignment')).toEqual(['Design & Govern', 'Assignment Rules', 'Survey bindings and groups']);
    expect(at('/assignment-rules/SG-X')).toEqual(['Design & Govern', 'Assignment Rules', 'Rules']);
    expect(at('/survey-studio/evaluations/abc')).toEqual(['Simulate & Analyze', 'Simulation & Evaluation', 'Application journeys']);
    expect(at('/survey-studio/controls')).toEqual(['Simulate & Analyze', 'Simulation & Evaluation', 'Controls and evidence']);
    expect(at('/simulator')).toEqual(['Simulate & Analyze', 'Simulation & Evaluation', 'Simulation Workbench']);
    expect(at('/reviews/cases/1')).toEqual(['Operations', 'Review Workbench', undefined]);
    expect(at('/scripts/fam-1')).toEqual(['Legacy & Administration', 'Script Studio', undefined]);
    expect(at('/cases/9')).toEqual(['Workspace', 'Call Explorer', undefined]);
    expect(at('/admin/audit')).toEqual(['Legacy & Administration', 'Administration', undefined]);
    expect(placeOf(NAV, '/simulator', '')?.item.label).toBe('Simulation Workbench');
    expect(childIsHere({ label: 'x', to: '/survey-studio', exact: true }, '/survey-studio', '?view=surveys')).toBe(false);
  });
});
