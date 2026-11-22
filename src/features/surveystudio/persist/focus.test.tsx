// A drawer that is a modal dialog keeps keyboard focus inside it and gives it back when it closes.
import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { focusableIn, useDialogFocus } from './focus';

function Drawer({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  useDialogFocus(panel, onClose);
  return (
    <aside role="dialog" tabIndex={-1} ref={panel} data-testid="drawer">
      <button type="button">First</button>
      <details><summary>More</summary><button type="button">Hidden while closed</button></details>
      <button type="button" disabled>Disabled</button>
      <a href="/x">Last</a>
    </aside>
  );
}
function Page() {
  const [open, setOpen] = useState(false);
  return (<><button type="button" onClick={() => setOpen(true)}>Open</button><button type="button">Behind</button>{open ? <Drawer onClose={() => setOpen(false)} /> : null}</>);
}

describe('dialog focus', () => {
  it('moves focus in, keeps Tab inside in both directions, closes on Escape and returns focus to the opener', () => {
    render(<Page />);
    const opener = screen.getByText('Open');
    opener.focus();
    fireEvent.click(opener);
    const drawer = screen.getByTestId('drawer');
    expect(document.activeElement).toBe(drawer);
    expect(focusableIn(drawer).map((x) => x.textContent)).toEqual(['First', 'More', 'Last']); // not the disabled one, not what a closed section hides
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText('Last')); // backwards from the top wraps to the end
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('First')); // forwards from the end wraps to the top
    screen.getByText('Behind').focus(); // focus that escaped (a click outside) is brought back by the next Tab
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('First'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('drawer')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
