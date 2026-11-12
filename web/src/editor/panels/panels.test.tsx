// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BackupEdge, BackupNode, Evaluation } from '@backupviiz/shared';
import { AlertsPanel, Inspector } from './index';

afterEach(cleanup);

const evalErr: Evaluation = {
  status: 'violation',
  sources: [],
  alerts: [
    { id: '3:s1', rule: '3', severity: 'error', message: 'Source "PC" : 2 copies sur 3 requises', nodeIds: ['s1'], sourceId: 's1' },
    { id: 'structure:x', rule: 'structure', severity: 'warning', message: 'Support orphelin', nodeIds: ['n2'] },
  ],
};

describe('AlertsPanel', () => {
  it('groupe par sévérité et déclenche les callbacks', () => {
    const hover = vi.fn();
    const select = vi.fn();
    const focus = vi.fn();
    render(<AlertsPanel evaluation={evalErr} onHoverAlert={hover} onSelectNodes={select} onFocusNode={focus} />);
    expect(screen.getByText('Erreurs')).toBeTruthy();
    expect(screen.getByText('Avertissements')).toBeTruthy();
    const btn = screen.getByRole('button', { name: /2 copies sur 3/ });
    fireEvent.mouseEnter(btn);
    expect(hover).toHaveBeenCalledWith(['s1']);
    fireEvent.mouseLeave(btn);
    expect(hover).toHaveBeenLastCalledWith(null);
    fireEvent.click(btn);
    expect(select).toHaveBeenCalledWith(['s1']);
    expect(focus).toHaveBeenCalledWith('s1');
  });

  it('affiche l’état conforme dans une région aria-live', () => {
    render(<AlertsPanel evaluation={{ status: 'compliant', sources: [], alerts: [] }} onHoverAlert={vi.fn()} onSelectNodes={vi.fn()} />);
    const live = screen.getByRole('status');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toContain('Conforme 3-2-1');
  });
});

const node: BackupNode = { id: 'n1', kind: 'storage', label: 'NAS', mediaType: 'nas', location: 'onsite', position: { x: 0, y: 0 } };
const edge: BackupEdge = { id: 'e1', from: 'n1', to: 'n2', method: 'rsync' };

describe('Inspector', () => {
  it('édite un noeud', () => {
    const onChangeNode = vi.fn();
    const onDelete = vi.fn();
    render(<Inspector node={node} nodes={[node]} onChangeNode={onChangeNode} onChangeEdge={vi.fn()} onDelete={onDelete} />);
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'NAS 2' } });
    expect(onChangeNode).toHaveBeenCalledWith('n1', { label: 'NAS 2' });
    fireEvent.change(screen.getByLabelText('Emplacement'), { target: { value: 'offsite' } });
    expect(onChangeNode).toHaveBeenCalledWith('n1', { location: 'offsite' });
    fireEvent.click(screen.getByLabelText(/immuable/i));
    expect(onChangeNode).toHaveBeenCalledWith('n1', { immutable: true });
    fireEvent.click(screen.getByRole('button', { name: /Supprimer/ }));
    expect(onDelete).toHaveBeenCalledWith('node', 'n1');
  });

  it('édite un lien', () => {
    const onChangeEdge = vi.fn();
    const onDelete = vi.fn();
    render(<Inspector edge={edge} nodes={[node]} onChangeNode={vi.fn()} onChangeEdge={onChangeEdge} onDelete={onDelete} />);
    fireEvent.change(screen.getByLabelText('Fréquence'), { target: { value: 'Mensuel' } });
    expect(onChangeEdge).toHaveBeenCalledWith('e1', { schedule: 'Mensuel' });
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer le lien' }));
    expect(onDelete).toHaveBeenCalledWith('edge', 'e1');
  });

  it('affiche un message sans sélection', () => {
    render(<Inspector nodes={[]} onChangeNode={vi.fn()} onChangeEdge={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/Sélectionnez/)).toBeTruthy();
  });
});
