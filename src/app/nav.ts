// Primary navigation: the approved mockup's grouped structure with canonical labels (C-1, EXC-003;
// Call360-specs SCREEN_NAMING_AND_ROUTES.md). Items without `to` are visible but disabled with a stage label.
import type { IconName } from '../components/Icon';

export interface NavItem {
  label: string;
  icon: IconName;
  to?: string;
  stage?: string; // disabled reason shown as a chip
  adminOnly?: boolean;
}

export const LATER_IN_S0 = 'Later in Stage 0';

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Workspace',
    items: [
      { label: 'Overview', icon: 'dashboard', to: '/' },
      { label: 'Call Explorer', icon: 'files', to: '/calls' },
      { label: 'Policy Explorer', icon: 'briefcase', to: '/policies' },
      { label: 'SBQ Risk Workbench', icon: 'target', to: '/risk-assessments' },
      { label: 'Work Queues', icon: 'calendar', to: '/queues' },
      { label: 'Voice Studio', icon: 'mic', stage: LATER_IN_S0 },
      { label: 'Live Monitor', icon: 'headphones', stage: 'Stage S4' },
      { label: 'Campaigns', icon: 'flag', stage: 'Stage S4' },
    ],
  },
  {
    group: 'Governance',
    items: [
      { label: 'Script Studio', icon: 'clipboard', stage: LATER_IN_S0 },
      { label: 'Assignment Rules', icon: 'layers', stage: LATER_IN_S0 },
      { label: 'Review Workbench', icon: 'shield', stage: LATER_IN_S0 },
    ],
  },
  {
    group: 'Intelligence',
    items: [
      { label: 'Search', icon: 'search', to: '/search' },
      { label: 'Analytics', icon: 'chart', stage: 'Stage S4' },
    ],
  },
  {
    group: 'Platform',
    items: [
      { label: 'Data Intake', icon: 'server', stage: LATER_IN_S0, adminOnly: true },
      { label: 'Administration', icon: 'settings', to: '/admin/users', adminOnly: true },
    ],
  },
];

export const PAGE_TITLES: Record<string, string> = {
  '/': 'Overview',
  '/calls': 'Call Explorer',
  '/policies': 'Policy Explorer',
  '/risk-assessments': 'SBQ Risk Workbench',
  '/queues': 'Work Queues',
  '/search': 'Search',
  '/admin/users': 'Administration',
  '/admin/audit': 'Administration',
  '/admin/config': 'Administration',
  '/unauthorized': 'Access restricted',
};
