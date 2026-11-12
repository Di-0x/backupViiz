// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '../../api/client';
import VersionsDrawer from './VersionsDrawer';
import { describeDiff, diffDocs } from './diff';

afterEach(cleanup);

const node = (id: string, kind: 'source' | 'storage' = 'storage') => ({ id, kind, label: id, mediaType: 'disk' as const, location: 'onsite' as const, position: { x: 0, y: 0 } });
const oldDoc = { nodes: [node('a', 'source'), node('b'), node('c')], edges: [{ id: 'e1', from: 'a', to: 'b' }, { id: 'e2', from: 'b', to: 'c' }] };
const curDoc = { nodes: [node('a', 'source'), node('b'), node('d'), node('e')], edges: [{ id: 'e1', from: 'a', to: 'b' }] };
const iso = new Date(Date.now() - 3600_000).toISOString();

beforeEach(() => {
  vi.spyOn(api.strategies, 'versions').mockResolvedValue([
    { id: 'v1', createdAt: iso, name: 'S', nodeCount: 3, edgeCount: 2, reason: 'auto' },
    { id: 'v2', createdAt: iso, name: 'S', nodeCount: 1, edgeCount: 0, reason: 'restore' },
  ]);
  vi.spyOn(api.strategies, 'get').mockResolvedValue(curDoc as never);
  vi.spyOn(api.strategies, 'version').mockResolvedValue({ id: 'v1', createdAt: iso, name: 'S', description: '', doc: oldDoc });
});

describe('diff', () => {
  it('décrit les différences', () => {
    expect(describeDiff(diffDocs(curDoc, oldDoc))).toBe('+1 nœud, −2 nœuds, +1 lien');
    expect(describeDiff(diffDocs(oldDoc, oldDoc))).toMatch(/Identique/);
  });
});

describe('VersionsDrawer', () => {
  it('ne rend rien fermé', () => {
    const { container } = render(<VersionsDrawer strategyId="s" open={false} onClose={() => {}} onRestored={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('liste, aperçu, diff, restauration confirmée', async () => {
    const restored = { id: 's' } as never;
    const restore = vi.spyOn(api.strategies, 'restoreVersion').mockResolvedValue(restored);
    const onRestored = vi.fn(); const onClose = vi.fn();
    render(<VersionsDrawer strategyId="s" open onClose={onClose} onRestored={onRestored} />);
    expect(screen.getByRole('dialog', { name: 'Historique des versions' })).toBeTruthy();
    expect(await screen.findByText('Avant une restauration')).toBeTruthy();
    fireEvent.click((await screen.findAllByRole('button', { name: /nœud/ }))[0]!);
    expect(await screen.findByText(/\+1 nœud, −2 nœuds, \+1 lien/)).toBeTruthy();
    expect(screen.getByRole('img', { name: /3 nœuds/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restaurer cette version' }));
    expect(restore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la restauration' }));
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(restored));
    expect(restore).toHaveBeenCalledWith('s', 'v1');
    expect(onClose).toHaveBeenCalled();
  });

  it('annuler la confirmation ne restaure pas ; erreur affichée', async () => {
    vi.spyOn(api.strategies, 'restoreVersion').mockRejectedValue(new Error('boom'));
    const onRestored = vi.fn();
    render(<VersionsDrawer strategyId="s" open onClose={() => {}} onRestored={onRestored} />);
    fireEvent.click((await screen.findAllByRole('button', { name: /nœud/ }))[0]!);
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurer cette version' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('button', { name: 'Confirmer la restauration' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Restaurer cette version' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la restauration' }));
    expect((await screen.findByText(/Échec de la restauration : boom/))).toBeTruthy();
    expect(onRestored).not.toHaveBeenCalled();
  });

  it('état vide, erreur avec réessai, Échap', async () => {
    (api.strategies.versions as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('KO')).mockResolvedValueOnce([]);
    const onClose = vi.fn();
    render(<VersionsDrawer strategyId="s" open onClose={onClose} onRestored={() => {}} />);
    expect(await screen.findByText(/Impossible de charger l’historique : KO/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText(/Aucune version enregistrée/)).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('piège le focus (Tab sur le dernier élément)', async () => {
    render(<VersionsDrawer strategyId="s" open onClose={() => {}} onRestored={() => {}} />);
    const items = await screen.findAllByRole('button', { name: /nœud/ });
    const last = items[items.length - 1]!;
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fermer' }));
  });
});
