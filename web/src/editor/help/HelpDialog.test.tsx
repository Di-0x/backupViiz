// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import HelpDialog, { HELP_FLAG_KEY, markHelpSeen, shouldAutoOpenHelp } from './HelpDialog';

beforeEach(() => {
  localStorage.clear();
  // jsdom n'implémente pas showModal/close
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
});
afterEach(cleanup);

describe('HelpDialog', () => {
  it('flag : ouvre la 1re fois puis plus après markHelpSeen', () => {
    expect(shouldAutoOpenHelp()).toBe(true);
    markHelpSeen();
    expect(localStorage.getItem(HELP_FLAG_KEY)).toBe('1');
    expect(shouldAutoOpenHelp()).toBe(false);
  });

  it('flag : localStorage indisponible ne plante pas', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(shouldAutoOpenHelp()).toBe(false);
    spy.mockRestore();
  });

  it('affiche le contenu 3-2-1 dans un dialog nommé quand open', () => {
    render(<HelpDialog open onClose={() => undefined} />);
    const d = screen.getByRole('dialog', { name: /3-2-1/ });
    expect(d.hasAttribute('open')).toBe(true);
    expect(screen.getByRole('img', { name: /Schéma/ })).toBeTruthy();
    expect(d.textContent).toContain('hors site');
    expect(d.textContent).toContain('restauration');
  });

  it('fermer appelle onClose et mémorise la vue', () => {
    const onClose = vi.fn();
    render(<HelpDialog open onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /compris/ }));
    expect(onClose).toHaveBeenCalled();
    expect(shouldAutoOpenHelp()).toBe(false);
  });
});
