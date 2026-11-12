// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './Toast';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Demo({ onUndo, onExpire }: { onUndo: () => void; onExpire: () => void }) {
  const { toast } = useToast();
  return <button onClick={() => toast('Supprimée', { action: { label: 'Annuler', onClick: onUndo }, onExpire })}>go</button>;
}

describe('Toast (suppression avec annulation)', () => {
  it("« Annuler » appelle l'action et n'expire pas", () => {
    const undo = vi.fn();
    const expire = vi.fn();
    render(<ToastProvider><Demo onUndo={undo} onExpire={expire} /></ToastProvider>);
    fireEvent.click(screen.getByText('go'));
    fireEvent.click(screen.getByText('Annuler'));
    expect(undo).toHaveBeenCalledOnce();
    expect(expire).not.toHaveBeenCalled();
    expect(screen.queryByText('Supprimée')).toBeNull();
  });

  it('expire après le délai et déclenche onExpire', () => {
    vi.useFakeTimers();
    const expire = vi.fn();
    render(<ToastProvider><Demo onUndo={() => {}} onExpire={expire} /></ToastProvider>);
    fireEvent.click(screen.getByText('go'));
    expect(screen.getByText('Supprimée')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(8000); });
    expect(expire).toHaveBeenCalledOnce();
    expect(screen.queryByText('Supprimée')).toBeNull();
  });
});
