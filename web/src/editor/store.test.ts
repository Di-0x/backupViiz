import { beforeEach, describe, expect, it } from 'vitest';
import type { Strategy } from '@backupviiz/shared';
import { useEditor } from './store';

const strat: Strategy = {
  id: 's',
  name: 'T',
  description: '',
  createdAt: '',
  updatedAt: '',
  evaluation: { status: 'empty', sources: [], alerts: [] },
  statuses: { a: { tool: 'restic', lastSuccessAt: null, lastStatus: 'failed', reportedAt: '2026-01-01T00:00:00Z' } },
  nodes: [
    { id: 'a', kind: 'source', label: 'PC', mediaType: 'disk', location: 'onsite', position: { x: 100, y: 100 } },
    { id: 'b', kind: 'storage', label: 'NAS', mediaType: 'nas', location: 'onsite', position: { x: 500, y: 100 } },
  ],
  edges: [],
};

describe('store.applyFix', () => {
  beforeEach(() => useEditor.getState().load(strat));

  it('charge les statuts', () => {
    expect(useEditor.getState().statuses['a']?.lastStatus).toBe('failed');
  });

  it('add-storage : ajoute un noeud à droite + lien, sélectionne, undo en une étape', () => {
    const before = useEditor.getState().doc;
    const id = useEditor.getState().applyFix({ kind: 'add-storage', fromId: 'b', label: 'Cloud', mediaType: 'cloud', location: 'offsite' });
    const s = useEditor.getState();
    expect(id).toBeTruthy();
    const n = s.doc.nodes.find((x) => x.id === id)!;
    expect(n.kind).toBe('storage');
    expect(n.position.x).toBeGreaterThan(500);
    expect(s.doc.edges).toHaveLength(1);
    expect(s.doc.edges[0]).toMatchObject({ from: 'b', to: id });
    expect(s.selectedNodeIds).toEqual([id]);
    s.undo();
    expect(useEditor.getState().doc).toEqual(before);
    expect(useEditor.getState().past).toHaveLength(0);
  });

  it('connect : crée le lien, sans doublon', () => {
    const fix = { kind: 'connect', fromId: 'a', toId: 'b' } as const;
    useEditor.getState().applyFix(fix);
    expect(useEditor.getState().doc.edges).toHaveLength(1);
    useEditor.getState().applyFix(fix);
    expect(useEditor.getState().doc.edges).toHaveLength(1);
    useEditor.getState().undo();
    expect(useEditor.getState().doc.edges).toHaveLength(0);
  });

  it('noeud source introuvable : sans effet', () => {
    expect(useEditor.getState().applyFix({ kind: 'add-storage', fromId: 'zz', label: 'X', mediaType: 'cloud', location: 'offsite' })).toBeNull();
    expect(useEditor.getState().doc.nodes).toHaveLength(2);
  });
});

describe('store.setRule (3-2-1-1-0)', () => {
  beforeEach(() => useEditor.getState().load(strat));

  it('bascule le référentiel, réévalue, est undoable et conserve options après applyFix', () => {
    const st = () => useEditor.getState();
    expect(st().evaluation.rule).toBe('3-2-1');
    st().setRule('3-2-1-1-0');
    expect(st().doc.options?.rule).toBe('3-2-1-1-0');
    expect(st().evaluation.rule).toBe('3-2-1-1-0');
    const fix = st().evaluation.alerts.find((a) => a.id === 'immutable:a')?.fix;
    expect(fix).toMatchObject({ kind: 'add-storage', immutable: true });
    const id = st().applyFix(fix!)!;
    expect(st().doc.options?.rule).toBe('3-2-1-1-0');
    expect(st().doc.nodes.find((n) => n.id === id)?.immutable).toBe(true);
    st().undo();
    st().undo();
    expect(st().doc.options).toBeUndefined();
  });
});
