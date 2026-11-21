import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { StageChip } from '../components/ui';
import { GlobalSearch } from './GlobalSearch';
import { surveyStudioEnabled } from '../features/surveystudio/flag';
import { navFor, PAGE_TITLES } from './nav';

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
}

export function AppShell() {
  const { me, signOut, can } = useAuth();
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] ?? (surveyStudioEnabled() && location.pathname.startsWith('/survey-studio') ? 'Survey Studio' : location.pathname.startsWith('/cases/') ? 'Call Detail' : location.pathname.startsWith('/policies/') ? 'Policy Detail' : location.pathname.startsWith('/scripts/') ? 'Script Detail' : location.pathname.startsWith('/assignment-rules/') ? 'Rule Detail' : location.pathname.startsWith('/reviews/cases/') ? 'Case Review' : location.pathname === '/account/password' ? 'Change password' : 'Call360');
  const isAdmin = !!me?.roles.includes('ADMIN');

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
          {navFor(surveyStudioEnabled()).map((group) => (
            <div key={group.group} role="group" aria-labelledby={`nav-${group.group}`}>
              <div className="nav-section" id={`nav-${group.group}`}>{group.group}</div>
              {group.items.map((item) =>
                item.to ? (
                  <NavLink key={item.label} to={item.to} end={item.to === '/'}
                    className={({ isActive }) => `navitem${isActive || (item.to?.startsWith('/admin') && location.pathname.startsWith('/admin')) || (item.to === '/calls' && location.pathname.startsWith('/cases/')) || (item.to === '/policies' && location.pathname.startsWith('/policies/')) || (item.to === '/scripts' && location.pathname.startsWith('/scripts/')) ? ' active' : ''}`}>
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                    {item.adminOnly && !isAdmin ? <Icon name="lock" size="sm" /> : null}
                  </NavLink>
                ) : (
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
                ),
              )}
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
          <div className="crumb">Workspace <Icon name="chev" size="sm" /> <strong>{title}</strong></div>
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
