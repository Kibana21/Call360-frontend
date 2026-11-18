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
      { label: 'Voice Studio', icon: 'mic', to: '/voice-studio' },
      { label: 'Voice Lab', icon: 'headphones', to: '/voice-lab' },
      { label: 'Live Monitor', icon: 'headphones', stage: 'Stage S4' },
      { label: 'Campaigns', icon: 'flag', stage: 'Stage S4' },
    ],
  },
  {
    group: 'Governance',
    items: [
      { label: 'Script Studio', icon: 'clipboard', to: '/scripts' },
      { label: 'Assignment Rules', icon: 'layers', to: '/assignment-rules' },
      { label: 'Simulation Workbench', icon: 'chat', to: '/simulator' },
      { label: 'Finding Rules', icon: 'alert', to: '/finding-rules' },
      { label: 'Review Workbench', icon: 'shield', to: '/reviews' },
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
      { label: 'Data Intake', icon: 'server', to: '/intake', adminOnly: true },
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
