import { createElement } from 'react';
import { ICONS, type IconName } from './iconPaths';

const camel = (attr: string) => attr.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

export function Icon({ name, size }: { name: IconName; size?: 'sm' | 'lg' | 'xl' | 'huge' }) {
  return (
    <svg aria-hidden="true" focusable="false" className={`icon ${size ?? ''}`} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name].map(([tag, attrs], i) =>
        createElement(tag, { key: i, ...Object.fromEntries(Object.entries(attrs).map(([k, v]) => [camel(k), v])) }),
      )}
    </svg>
  );
}

export type { IconName };
