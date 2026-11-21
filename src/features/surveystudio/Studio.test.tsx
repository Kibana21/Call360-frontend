// SS-02A — the feature setting and one authoring flow through the real components.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { json, ME, renderAt, stubApi } from '../../test/render';
import { resetStudioMemory } from './store';

const USER = { ...ME, roles: ['USER'], permissions: ['dashboard.read', 'script.read'] };
beforeEach(() => { resetStudioMemory(); stubApi({ 'GET /api/v1/me': () => json(200, USER) }); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Survey Studio prototype setting', () => {
  it('is absent when the setting is off: no navigation entry, no route, no label', async () => {
    renderAt(<App />, '/survey-studio');
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).queryByRole('link', { name: 'Survey Studio' })).toBeNull();
    expect(within(nav).getByRole('link', { name: 'Script Studio' })).toBeInTheDocument();
    expect(screen.queryByTestId('survey-studio')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Survey Studio/);
  });

  it('appears under Governance when the setting is on, labelled as a prototype', async () => {
    vi.stubEnv('VITE_SURVEY_STUDIO_PROTOTYPE', '1');
    renderAt(<App />, '/survey-studio');
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByRole('link', { name: 'Survey Studio' })).toHaveAttribute('href', '/survey-studio');
    expect(within(nav).getByRole('link', { name: 'Script Studio' })).toBeInTheDocument(); // the existing screen coexists
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Build a callback survey');
    expect(screen.getByTestId('ss-prototype-tag')).toHaveTextContent('Prototype · not saved');
    expect(document.body.textContent).not.toMatch(/Call 360/);
  });

  it('creates a survey from the starter modules, shows undecided outcomes, and undoes a removal', async () => {
    vi.stubEnv('VITE_SURVEY_STUDIO_PROTOTYPE', '1');
    renderAt(<App />, '/survey-studio');
    await userEvent.click(await screen.findByTestId('ss-create'));
    await userEvent.type(screen.getByTestId('ss-create-name'), 'Starter survey');
    await userEvent.click(screen.getByTestId('ss-create-template'));
    await userEvent.click(screen.getByTestId('ss-create-go'));
    expect(await screen.findByTestId('ss-card-mi-suitability')).toHaveTextContent('when Product family is ILP');
    expect(screen.getByTestId('ss-route-mi-suitability-CLARIFICATION_REQUIRED')).toHaveTextContent('Choose what happens');
    expect(screen.getByTestId('ss-issues')).toHaveTextContent('2 to fix');
    await userEvent.click(screen.getByTestId('ss-remove-mi-suitability'));
    await userEvent.click(screen.getByTestId('ss-remove-confirm'));
    await waitFor(() => expect(screen.queryByTestId('ss-card-mi-suitability')).toBeNull());
    await userEvent.click(screen.getByTestId('ss-undo'));
    expect(await screen.findByTestId('ss-card-mi-suitability')).toBeInTheDocument();
    expect(screen.getByTestId('ss-redo')).toBeEnabled();
  });
});
