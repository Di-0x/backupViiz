import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/evaluate';
import type { BackupEdge, BackupNode, MediaType, StrategyDoc } from '../src/types';

const n = (
  id: string,
  kind: 'source' | 'storage',
  mediaType: MediaType = 'disk',
  location: 'onsite' | 'offsite' = 'onsite',
  extra: Partial<BackupNode> = {},
): BackupNode => ({ id, kind, label: id.toUpperCase(), mediaType, location, position: { x: 0, y: 0 }, ...extra });
const e = (id: string, from: string, to: string, schedule: string | null = 'Quotidien'): BackupEdge => ({
  id,
  from,
  to,
  ...(schedule ? { schedule } : {}),
});
const ids = (d: StrategyDoc) => evaluate(d).alerts.map((a) => a.id);

describe('evaluate', () => {
  it('document vide -> empty', () => {
    const r = evaluate({ nodes: [], edges: [] });
    expect(r.status).toBe('empty');
    expect(r.alerts).toEqual([]);
    expect(r.sources).toEqual([]);
  });

  it('3-2-1 conforme (info immutable seulement -> compliant)', () => {
    const doc = {
      nodes: [n('s', 'source', 'ssd'), n('a', 'storage', 'nas'), n('b', 'storage', 'cloud', 'offsite')],
      edges: [e('1', 's', 'a'), e('2', 'a', 'b')],
    };
    const r = evaluate(doc);
    expect(r.status).toBe('compliant');
    expect(r.sources[0]).toMatchObject({ copies: 3, ruleThree: true, ruleTwo: true, ruleOne: true, compliant: true });
    expect(ids(doc)).toEqual(['immutable:global']);
  });

  it("pas d'alerte immutable si une copie est immuable", () => {
    const doc = {
      nodes: [n('s', 'source', 'ssd'), n('a', 'storage', 'nas'), n('b', 'storage', 'cloud', 'offsite', { immutable: true })],
      edges: [e('1', 's', 'a'), e('2', 's', 'b')],
    };
    expect(evaluate(doc).alerts).toEqual([]);
  });

  it('source seule: 3/2/1 violées + aucun lien sortant', () => {
    const doc = { nodes: [n('s', 'source')], edges: [] };
    const r = evaluate(doc);
    expect(r.status).toBe('violation');
    expect(ids(doc)).toEqual(['1:s', '2:s', '3:s', 'structure:no-outgoing:s', 'immutable:global']);
    expect(r.alerts.find((a) => a.id === '3:s')!.message).toBe(
      'Source "S" : 1 copie sur 3 requises — ajoutez 2 supports de sauvegarde.',
    );
  });

  it('2 copies : message "2 copies sur 3"', () => {
    const doc = { nodes: [n('s', 'source', 'ssd'), n('a', 'storage', 'nas', 'offsite')], edges: [e('1', 's', 'a')] };
    const a = evaluate(doc).alerts.find((x) => x.id === '3:s')!;
    expect(a.message).toContain('2 copies sur 3 requises');
    expect(a.severity).toBe('error');
  });

  it('mêmes media types -> règle 2 violée', () => {
    const doc = {
      nodes: [n('s', 'source', 'disk'), n('a', 'storage', 'disk'), n('b', 'storage', 'disk', 'offsite')],
      edges: [e('1', 's', 'a'), e('2', 'a', 'b')],
    };
    const r = evaluate(doc);
    expect(r.sources[0].ruleTwo).toBe(false);
    expect(r.sources[0].ruleThree).toBe(true);
    expect(ids(doc)).toContain('2:s');
  });

  it('pas de copie offsite -> règle 1 violée', () => {
    const doc = {
      nodes: [n('s', 'source', 'ssd'), n('a', 'storage', 'nas'), n('b', 'storage', 'tape')],
      edges: [e('1', 's', 'a'), e('2', 'a', 'b')],
    };
    const r = evaluate(doc);
    expect(r.sources[0].ruleOne).toBe(false);
    expect(r.sources[0].offsiteCopies).toBe(0);
    expect(ids(doc)).toContain('1:s');
  });

  it('cycles tolérés', () => {
    const doc = {
      nodes: [n('s', 'source', 'ssd'), n('a', 'storage', 'nas'), n('b', 'storage', 'cloud', 'offsite')],
      edges: [e('1', 's', 'a'), e('2', 'a', 'b'), e('3', 'b', 'a'), e('4', 'b', 's')],
    };
    const r = evaluate(doc);
    expect(r.sources[0].copies).toBe(3);
    expect(r.status).toBe('compliant');
  });

  it('orientation : le lien inverse ne compte pas (support orphelin)', () => {
    const doc = {
      nodes: [n('s', 'source', 'ssd'), n('a', 'storage', 'nas')],
      edges: [e('1', 'a', 's')],
    };
    const r = evaluate(doc);
    expect(r.sources[0].copies).toBe(1);
    expect(ids(doc)).toContain('structure:orphan:a');
    expect(ids(doc)).toContain('structure:no-outgoing:s');
  });

  it('multi-sources évaluées indépendamment', () => {
    const doc = {
      nodes: [
        n('s1', 'source', 'ssd'),
        n('s2', 'source', 'ssd'),
        n('a', 'storage', 'nas'),
        n('b', 'storage', 'cloud', 'offsite'),
      ],
      edges: [e('1', 's1', 'a'), e('2', 'a', 'b'), e('3', 's2', 'a')],
    };
    const r = evaluate(doc);
    expect(r.sources.map((s) => s.copies)).toEqual([3, 3]);
    const doc2 = { ...doc, edges: [e('1', 's1', 'a'), e('2', 'a', 'b'), e('3', 's2', 'b')] };
    expect(evaluate(doc2).sources.map((s) => s.compliant)).toEqual([true, false]);
    expect(ids(doc2)).toContain('3:s2');
    expect(ids(doc2)).not.toContain('3:s1');
  });

  it('support partagé non orphelin', () => {
    const doc = {
      nodes: [n('s1', 'source'), n('s2', 'source'), n('a', 'storage', 'nas')],
      edges: [e('1', 's1', 'a'), e('2', 's2', 'a')],
    };
    expect(ids(doc).some((i) => i.startsWith('structure:orphan'))).toBe(false);
  });

  it('lien vers un noeud inconnu', () => {
    const doc = { nodes: [n('s', 'source')], edges: [e('1', 's', 'ghost'), e('2', 'ghost2', 's')] };
    const r = evaluate(doc);
    expect(r.alerts.filter((a) => a.id.startsWith('structure:dangling')).map((a) => a.severity)).toEqual([
      'warning',
      'warning',
    ]);
    expect(r.alerts.find((a) => a.id === 'structure:dangling:1')!.nodeIds).toEqual(['s']);
    expect(r.sources[0].copies).toBe(1);
  });

  it('lien sans fréquence -> info', () => {
    const doc = { nodes: [n('s', 'source'), n('a', 'storage')], edges: [e('1', 's', 'a', null)] };
    const a = evaluate(doc).alerts.find((x) => x.id === 'structure:schedule:1')!;
    expect(a.severity).toBe('info');
    expect(a.nodeIds).toEqual(['s', 'a']);
  });

  it('lien vers soi-même', () => {
    const doc = { nodes: [n('s', 'source')], edges: [e('1', 's', 's')] };
    const r = evaluate(doc);
    expect(r.alerts.find((a) => a.id === 'structure:self:1')!.severity).toBe('warning');
    expect(r.sources[0].copies).toBe(1);
  });

  it('doublon from->to : une seule alerte', () => {
    const doc = {
      nodes: [n('s', 'source'), n('a', 'storage')],
      edges: [e('1', 's', 'a'), e('2', 's', 'a'), e('3', 's', 'a')],
    };
    expect(ids(doc).filter((i) => i.startsWith('structure:duplicate'))).toEqual(['structure:duplicate:1']);
    expect(evaluate(doc).sources[0].copies).toBe(2);
  });

  it('status warning quand seulement des warnings', () => {
    const doc = {
      nodes: [
        n('s', 'source', 'ssd'),
        n('a', 'storage', 'nas'),
        n('b', 'storage', 'cloud', 'offsite', { immutable: true }),
        n('o', 'storage', 'tape'),
      ],
      edges: [e('1', 's', 'a'), e('2', 'a', 'b')],
    };
    const r = evaluate(doc);
    expect(r.status).toBe('warning');
    expect(ids(doc)).toEqual(['structure:orphan:o']);
  });

  it('source offsite compte comme copie offsite ; source immuable comptée', () => {
    const doc = {
      nodes: [n('s', 'source', 'ssd', 'offsite', { immutable: true }), n('a', 'storage', 'nas'), n('b', 'storage', 'tape')],
      edges: [e('1', 's', 'a'), e('2', 's', 'b')],
    };
    const r = evaluate(doc);
    expect(r.sources[0].ruleOne).toBe(true);
    expect(ids(doc)).not.toContain('immutable:global');
  });

  it('tri stable : error > warning > info puis id ; déterministe', () => {
    const doc = {
      nodes: [n('s', 'source'), n('x', 'storage')],
      edges: [e('1', 's', 'ghost', null)],
    };
    const r = evaluate(doc);
    const order = { error: 0, warning: 1, info: 2 } as const;
    for (let i = 1; i < r.alerts.length; i++) {
      const p = r.alerts[i - 1];
      const c = r.alerts[i];
      expect(order[p.severity] <= order[c.severity]).toBe(true);
      if (p.severity === c.severity) expect(p.id < c.id).toBe(true);
    }
    expect(evaluate(doc)).toEqual(r);
  });

  it('ne mute pas le document', () => {
    const doc = { nodes: [n('s', 'source')], edges: [] };
    const copy = JSON.parse(JSON.stringify(doc));
    evaluate(doc);
    expect(doc).toEqual(copy);
  });

  it('performance : grand graphe', () => {
    const nodes: BackupNode[] = [n('s', 'source', 'ssd')];
    const edges: BackupEdge[] = [];
    for (let i = 0; i < 199; i++) {
      nodes.push(n(`n${i}`, 'storage', 'nas'));
      edges.push(e(`e${i}`, i === 0 ? 's' : `n${i - 1}`, `n${i}`));
    }
    const t = Date.now();
    expect(evaluate({ nodes, edges }).sources[0].copies).toBe(200);
    expect(Date.now() - t).toBeLessThan(200);
  });
});
