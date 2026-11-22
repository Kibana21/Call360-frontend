// Primary navigation (NAV-1, owner decision of 2026-11-22; supersedes the four groups of C-1 / EXC-003 — see
// Call360-specs SCREEN_NAMING_AND_ROUTES.md). Five groups by what a person is doing: looking at operations, designing
// and governing, simulating and analysing, operating, and legacy and administration. EVERY EXISTING ROUTE IS KEPT, with
// its label: this file regroups entries and adds sub-entries; it removes none, and a route's guard is unchanged.
// Items without `to` are visible but disabled with a stage label. A sub-item is listed only for a person who may open
// it (`permission`) — the route guard still decides.
import type { IconName } from '../components/Icon';

export interface NavChild { label: string; to: string; permission?: string; /** the address must match exactly to be "here" */ exact?: boolean; /** also "here" under these path prefixes */ under?: string[]; /** a query the address must carry to be "here" */ query?: string }
export interface NavItem {
  label: string;
  icon: IconName;
  to?: string;
  stage?: string; // disabled reason shown as a chip
  adminOnly?: boolean;
  /** shown under the item when it is open */
  children?: NavChild[];
  /** a short tag after the label, e.g. "Legacy" */
  tag?: string;
}
export interface NavGroup { group: string; items: NavItem[] }

export const LATER_IN_S0 = 'Later in Stage 0';

const WORKSPACE: NavGroup = {
  group: 'Workspace',
  items: [
    { label: 'Overview', icon: 'dashboard', to: '/' },
    { label: 'Search', icon: 'search', to: '/search' },
    { label: 'Call Explorer', icon: 'files', to: '/calls' },
    { label: 'Policy Explorer', icon: 'briefcase', to: '/policies' },
    { label: 'SBQ Risk Workbench', icon: 'target', to: '/risk-assessments' },
    { label: 'Work Queues', icon: 'calendar', to: '/queues' },
  ],
};
const SURVEY_STUDIO: NavItem = {
  label: 'Survey Studio', icon: 'layers', to: '/survey-studio',
  children: [
    { label: 'Home', to: '/survey-studio', exact: true },
    { label: 'Surveys', to: '/survey-studio?view=surveys', query: 'view=surveys', under: ['/survey-studio/surveys'] },
    { label: 'Building blocks', to: '/survey-studio?view=blocks', query: 'view=blocks' },
    { label: 'Rules explorer', to: '/survey-studio/rules' },
  ],
};
const OPERATIONS: NavGroup = {
  group: 'Operations',
  items: [
    { label: 'Review Workbench', icon: 'shield', to: '/reviews' },
    { label: 'Voice Studio', icon: 'mic', to: '/voice-studio' },
    { label: 'Voice Lab', icon: 'headphones', to: '/voice-lab' },
    { label: 'Live Monitor', icon: 'headphones', stage: 'Stage S4' },
    { label: 'Campaigns', icon: 'flag', stage: 'Stage S4' },
  ],
};
const LEGACY: NavGroup = {
  group: 'Legacy & Administration',
  items: [
    { label: 'Script Studio', icon: 'clipboard', to: '/scripts', tag: 'Legacy' },
    { label: 'Data Intake', icon: 'server', to: '/intake', adminOnly: true },
    { label: 'Administration', icon: 'settings', to: '/admin/users', adminOnly: true },
  ],
};

/** `studio`: Survey Studio is listed (its build setting is on). `persisted`: it is the persisted mode, which has the
    assignment, simulation and evaluation screens; the in-memory prototype has only its own pages. */
export function navFor(studio: boolean, persisted = false): NavGroup[] {
  const design: NavGroup = {
    group: 'Design & Govern',
    items: [
      ...(studio ? [persisted ? SURVEY_STUDIO : { ...SURVEY_STUDIO, children: undefined }] : []),
      {
        label: 'Assignment Rules', icon: 'sliders', to: '/assignment-rules',
        children: persisted ? [
          { label: 'Rules', to: '/assignment-rules', under: ['/assignment-rules'], permission: 'script.read' },
          { label: 'Survey bindings and groups', to: '/survey-studio/assignment', permission: 'survey.assignment.read' },
        ] : undefined,
      },
      { label: 'Finding Rules', icon: 'alert', to: '/finding-rules' },
    ],
  };
  const simulate: NavGroup = {
    group: 'Simulate & Analyze',
    items: [
      persisted ? {
        label: 'Simulation & Evaluation', icon: 'play', to: '/survey-studio/simulation',
        children: [
          { label: 'All simulation and evaluation', to: '/survey-studio/simulation' },
          { label: 'Application journeys', to: '/survey-studio/journeys', under: ['/survey-studio/journeys', '/survey-studio/evaluations', '/survey-studio/coordinated-simulations'], permission: 'survey.evaluation.read' },
          { label: 'Controls and evidence', to: '/survey-studio/controls', permission: 'survey.evaluation.read' },
          { label: 'Simulation Workbench', to: '/simulator', permission: 'script.read' },
        ],
      } : { label: 'Simulation Workbench', icon: 'chat', to: '/simulator' },
      { label: 'Analytics', icon: 'chart', stage: 'Stage S4' },
    ],
  };
  return [WORKSPACE, design, simulate, OPERATIONS, LEGACY];
}
export const NAV: NavGroup[] = navFor(false);

/** Is this child the page the address names? */
export function childIsHere(c: NavChild, pathname: string, search: string): boolean {
  const [path] = c.to.split('?');
  if ((c.under ?? []).some((u) => pathname === u || pathname.startsWith(`${u}/`))) return true;
  if (c.query) return pathname === path && search.includes(c.query);
  if (c.exact) return pathname === path && !/[?&]view=(surveys|blocks)/.test(search);
  return pathname === path || pathname.startsWith(`${path}/`);
}
/** The group and item a path belongs to, for the breadcrumb. */
export function placeOf(groups: NavGroup[], pathname: string, search: string): { group: string; item: NavItem; child?: NavChild } | null {
  for (const g of groups) for (const item of g.items) {
    const child = (item.children ?? []).find((c) => childIsHere(c, pathname, search));
    if (child) return { group: g.group, item, child };
  }
  let best: { group: string; item: NavItem } | null = null;
  for (const g of groups) for (const item of g.items) {
    if (!item.to) continue;
    const here = item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(`${item.to}/`) || (item.to.startsWith('/admin') && pathname.startsWith('/admin')) || (item.to === '/calls' && pathname.startsWith('/cases/')) || (item.to === '/reviews' && pathname.startsWith('/reviews'));
    if (here && (!best || (item.to.length > (best.item.to ?? '').length))) best = { group: g.group, item };
  }
  return best;
}

export const PAGE_TITLES: Record<string, string> = {
  '/': 'Overview',
  '/calls': 'Call Explorer',
  '/policies': 'Policy Explorer',
  '/risk-assessments': 'SBQ Risk Workbench',
  '/queues': 'Work Queues',
  '/search': 'Search',
  '/intake': 'Data Intake',
  '/scripts': 'Script Studio',
  '/assignment-rules': 'Assignment Rules',
  '/simulator': 'Simulation Workbench',
  '/finding-rules': 'Finding Rules',
  '/reviews': 'Review Workbench',
  '/voice-studio': 'Voice Studio',
  '/voice-lab': 'Voice Lab',
  '/admin/users': 'Administration',
  '/admin/audit': 'Administration',
  '/admin/config': 'Administration',
  '/admin/groups': 'Administration',
  '/admin/sessions': 'Administration',
  '/admin/system': 'Administration',
  '/unauthorized': 'Access restricted',
};
