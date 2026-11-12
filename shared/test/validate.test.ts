import { describe, expect, it } from 'vitest';
import { createStrategySchema, strategyDocSchema, updateStrategySchema } from '../src/validate';

const node = (id: string, over: object = {}) => ({
  id,
  kind: 'source',
  label: 'PC',
  mediaType: 'ssd',
  location: 'onsite',
  position: { x: 0, y: 0 },
  ...over,
});

describe('validate', () => {
  it('accepte un doc valide, y compris edges sans intégrité référentielle', () => {
    const r = strategyDocSchema.safeParse({ nodes: [node('a')], edges: [{ id: 'e', from: 'a', to: 'zzz' }] });
    expect(r.success).toBe(true);
  });

  it('rejette ids invalides / trop longs', () => {
    expect(strategyDocSchema.safeParse({ nodes: [node('a b')], edges: [] }).success).toBe(false);
    expect(strategyDocSchema.safeParse({ nodes: [node('a'.repeat(65))], edges: [] }).success).toBe(false);
    expect(strategyDocSchema.safeParse({ nodes: [node('a'.repeat(64))], edges: [] }).success).toBe(true);
    expect(strategyDocSchema.safeParse({ nodes: [node('')], edges: [] }).success).toBe(false);
  });

  it('limites label / notes', () => {
    const p = (o: object) => strategyDocSchema.safeParse({ nodes: [node('a', o)], edges: [] }).success;
    expect(p({ label: '' })).toBe(false);
    expect(p({ label: 'x'.repeat(81) })).toBe(false);
    expect(p({ label: 'x'.repeat(80) })).toBe(true);
    expect(p({ notes: 'x'.repeat(501) })).toBe(false);
    expect(p({ notes: 'x'.repeat(500) })).toBe(true);
    expect(p({ mediaType: 'floppy' })).toBe(false);
    expect(p({ position: { x: NaN, y: 0 } })).toBe(false);
  });

  it('limites 200 noeuds / 500 liens', () => {
    const nodes = (k: number) => Array.from({ length: k }, (_, i) => node(`n${i}`));
    const edges = (k: number) => Array.from({ length: k }, (_, i) => ({ id: `e${i}`, from: 'a', to: 'b' }));
    expect(strategyDocSchema.safeParse({ nodes: nodes(200), edges: edges(500) }).success).toBe(true);
    expect(strategyDocSchema.safeParse({ nodes: nodes(201), edges: [] }).success).toBe(false);
    expect(strategyDocSchema.safeParse({ nodes: [], edges: edges(501) }).success).toBe(false);
  });

  it('create/update', () => {
    expect(createStrategySchema.safeParse({ name: 'x' }).success).toBe(true);
    expect(createStrategySchema.safeParse({ name: '' }).success).toBe(false);
    expect(createStrategySchema.safeParse({ name: 'x'.repeat(101) }).success).toBe(false);
    expect(createStrategySchema.safeParse({ name: 'x', description: 'd'.repeat(501) }).success).toBe(false);
    expect(createStrategySchema.safeParse({ name: 'x', doc: { nodes: [], edges: [] } }).success).toBe(true);
    expect(updateStrategySchema.safeParse({}).success).toBe(true);
    expect(updateStrategySchema.safeParse({ name: '' }).success).toBe(false);
    expect(updateStrategySchema.safeParse({ doc: { nodes: 1 } }).success).toBe(false);
  });
});
