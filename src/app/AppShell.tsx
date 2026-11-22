import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { StageChip } from '../components/ui';
import { GlobalSearch } from './GlobalSearch';
import { surveyStudioPersisted, surveyStudioVisible } from '../features/surveystudio/flag';
import '../styles/nav.css';
import { childIsHere, navFor, PAGE_TITLES, placeOf } from './nav';

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
}

export function AppShell() {
  const { me, signOut, can } = useAuth();
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] ?? (surveyStudioVisible() && location.pathname.startsWith('/survey-studio') ? 'Survey Studio' : location.pathname.startsWith('/cases/') ? 'Call Detail' : location.pathname.startsWith('/policies/') ? 'Policy Detail' : location.pathname.startsWith('/scripts/') ? 'Script Detail' : location.pathname.startsWith('/assignment-rules/') ? 'Rule Detail' : location.pathname.startsWith('/reviews/cases/') ? 'Case Review' : location.pathname === '/account/password' ? 'Change password' : 'Call360');
  const isAdmin = !!me?.roles.includes('ADMIN');
  // NAV-1: where the address is in the navigation (for the active entry and the breadcrumb), and which sections are open
  const groups = navFor(surveyStudioVisible(), surveyStudioPersisted());
  const place = placeOf(groups, location.pathname, location.search);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  useEffect(() => {
    document.title = `Call360 · ${title}`;
  }, [title]);

  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to content</a>
      <aside className="sidebar" aria-label="Primary">
        <div className="brand">
          <div className="brandmark"><Icon name="shield" size="lg" /></div>
          <div>
            <div className="brandname">Call<b>360</b></div>
            <div className="brandsub">CLIENT ASSURANCE</div>
          </div>
        </div>
        <nav className="nav-scroll" aria-label="Main navigation">
          {groups.map((group) => (
            <div key={group.group} role="group" aria-labelledby={`nav-${group.group.replace(/\W+/g, '-')}`}>
              <div className="nav-section" id={`nav-${group.group.replace(/\W+/g, '-')}`}>{group.group}</div>
              {group.items.map((item) => {
                if (!item.to) {
                  return (
                    <span key={item.label} className="navitem" role="link" aria-disabled="true" tabIndex={0}
                      aria-describedby={`stage-${item.label.replace(/\W/g, '')}`} title={`${item.label} — ${item.stage}`}>
                      <Icon name={item.icon} />
                      <span>{item.label}</span>
                      <span className="stage-wrap" id={`stage-${item.label.replace(/\W/g, '')}`}>
                        {item.stage === 'Stage S4'
                          ? <StageChip label="S4" />
                          : <span className="stage-icon"><Icon name="clock" size="sm" /></span>}
                        <span className="sr-only">Not yet available: {item.stage}</span>
                      </span>
                    </span>
                  );
                }
                const here = place?.item === item;
                const children = (item.children ?? []).filter((c) => !c.permission || can(c.permission));
                const open = children.length > 0 && (toggled[item.label] ?? here);
                const id = `navsub-${item.label.replace(/\W/g, '')}`;
                return (
                  <div key={item.label} className={`navrow${children.length ? ' has-sub' : ''}`}>
                    <Link to={item.to} className={`navitem${here ? ' active' : ''}`} aria-current={here && !place?.child ? 'page' : undefined}>
                      <Icon name={item.icon} />
                      <span>{item.label}</span>
                      {item.tag ? <span className="navtag" aria-hidden="true" title={`${item.label}: the existing area, kept in use during the transition`}>{item.tag}</span> : null}
                      {item.adminOnly && !isAdmin ? <Icon name="lock" size="sm" /> : null}
                    </Link>
                    {children.length ? (
                      <button type="button" className="navcaret" aria-expanded={open} aria-controls={id} aria-label={`${open ? 'Hide' : 'Show'} the pages of ${item.label}`}
                        onClick={() => setToggled((t) => ({ ...t, [item.label]: !open }))} data-testid={`nav-toggle-${item.label.replace(/\W/g, '')}`}>
                        <Icon name={open ? 'up' : 'down'} size="sm" />
                      </button>
                    ) : null}
                    {open ? (
                      <ul className="navsubs" id={id} aria-label={`${item.label} pages`}>
                        {children.map((c) => {
                          const on = childIsHere(c, location.pathname, location.search) && place?.child === c;
                          return <li key={c.label}><Link to={c.to} className={`navsub${on ? ' active' : ''}`} aria-current={on ? 'page' : undefined}>{c.label}</Link></li>;
                        })}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="env">
            <span className="envdot" aria-hidden="true" />
            <span>{me?.environment.app_env === 'local' ? 'Local environment' : 'Test environment'}<br />All records synthetic</span>
          </div>
          <div className="sidebar-version">CALL360 · STAGE 0 · F7</div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="crumb" data-testid="app-crumb">{place?.group ?? 'Workspace'} <Icon name="chev" size="sm" /> {place?.child && place.item.label !== title ? <><Link to={place.item.to ?? '/'}>{place.item.label}</Link> <Icon name="chev" size="sm" /> </> : null}<strong>{place?.child ? (place.child.label === 'Home' || place.child.label === 'Rules' ? title : place.child.label) : title}</strong></div>
          {can('search.use') ? <GlobalSearch /> : null}
          <div className="topright">{me ? <UserMenu name={me.principal.display_name}
            role={me.roles.includes('ADMIN') ? 'Administrator' : me.roles.includes('USER') ? 'Operations user' : me.roles.includes('SC_CHECKER') ? 'S&C script checker' : 'Signed in'}
            username={me.principal.username ?? ''} onSignOut={signOut} /> : null}</div>
        </header>
        <main className="page" id="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function UserMenu({ name, role, username, onSignOut }: {
  name: string; role: string; username: string; onSignOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="person" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <div className="avatar" aria-hidden="true">{initials(name)}</div>
        <div>
          <div className="personname">{name}</div>
          <div className="personrole">{role} · Local demo</div>
        </div>
        <Icon name="down" size="sm" />
      </button>
      {open ? (
        <div className="menu" role="menu">
          <div className="menu-meta">Signed in as <strong>{username}</strong><br />Local demo identity — not SSO</div>
          <button role="menuitem" onClick={() => { setOpen(false); navigate('/account/password'); }}>
            <Icon name="key" size="sm" /> Change password
          </button>
          <button role="menuitem" onClick={() => { setOpen(false); void onSignOut(); }}>
            <Icon name="logout" size="sm" /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
