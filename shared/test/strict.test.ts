import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/evaluate';
import { strategyDocSchema } from '../src/validate';
import type { BackupNode, StrategyDoc } from '../src/types';

const node = (id: string, kind: 'source' | 'storage', over: Partial<BackupNode> = {}): BackupNode => ({
  id, kind, label: id, mediaType: 'ssd', location: 'onsite', position: { x: 0, y: 0 }, ...over,
});
const base = (over: { immutable?: boolean; test?: string } = {}, rule?: '3-2-1' | '3-2-1-1-0'): StrategyDoc => ({
  options: rule ? { rule } : undefined,
  nodes: [
    node('s', 'source', over.test ? { lastRestoreTestAt: over.test } : {}),
    node('nas', 'storage', { mediaType: 'nas' }),
    node('cloud', 'storage', { mediaType: 'cloud', location: 'offsite', immutable: over.immutable }),
  ],
  edges: [{ id: 'e1', from: 's', to: 'nas' }, { id: 'e2', from: 'nas', to: 'cloud' }],
});
const now = new Date('2026-11-13T00:00:00Z');
const today = '2026-11-01';

describe('3-2-1-1-0', () => {
  it('3-2-1 par défaut : une stratégie conforme reste conforme, aucune règle stricte exposée', () => {
    const ev = evaluate(base(), { now });
    expect(ev.rule).toBe('3-2-1');
    expect(ev.sources[0]!.ruleImmutable).toBeUndefined();
    expect(ev.alerts.some((a) => a.id === 'immutable:global' && a.severity === 'info')).toBe(true);
  });

  it('strict : erreur si aucune copie immuable, avec correction proposée immuable', () => {
    const ev = evaluate(base({ test: today }, '3-2-1-1-0'), { now });
    expect(ev.rule).toBe('3-2-1-1-0');
    const a = ev.alerts.find((x) => x.id === 'immutable:s');
    expect(a?.severity).toBe('error');
    expect(a?.fix).toMatchObject({ kind: 'add-storage', immutable: true, location: 'offsite' });
    expect(ev.status).toBe('violation');
    expect(ev.sources[0]!.ruleImmutable).toBe(false);
    expect(ev.sources[0]!.compliant).toBe(false);
    expect(ev.alerts.some((x) => x.id === 'immutable:global')).toBe(false);
  });

  it('strict : restauration jamais testée = erreur (info en 3-2-1)', () => {
    const strict = evaluate(base({ immutable: true }, '3-2-1-1-0'), { now });
    expect(strict.alerts.find((x) => x.id === 'restore:s')?.severity).toBe('error');
    expect(strict.sources[0]!.ruleZero).toBe(false);
    const classic = evaluate(base({ immutable: true }), { now });
    expect(classic.alerts.find((x) => x.id === 'restore:s')?.severity).toBe('info');
  });

  it('strict : conforme avec copie immuable + restauration testée', () => {
    const ev = evaluate(base({ immutable: true, test: today }, '3-2-1-1-0'), { now });
    expect(ev.sources[0]).toMatchObject({ ruleImmutable: true, ruleZero: true, compliant: true });
    expect(ev.alerts.filter((a) => a.severity === 'error')).toEqual([]);
    expect(ev.status).not.toBe('violation');
  });

  it('strict : un backup en échec empêche la règle 0', () => {
    const ev = evaluate(base({ immutable: true, test: today }, '3-2-1-1-0'), {
      now,
      statuses: { nas: { tool: 'restic', lastStatus: 'failed', lastSuccessAt: null, reportedAt: now.toISOString() } },
    });
    expect(ev.sources[0]!.ruleZero).toBe(false);
    expect(ev.sources[0]!.compliant).toBe(false);
  });

  it('strict : la source marquée immuable ne suffit pas (il faut un support)', () => {
    const doc = base({ test: today }, '3-2-1-1-0');
    doc.nodes[0]!.immutable = true;
    expect(evaluate(doc, { now }).sources[0]!.ruleImmutable).toBe(false);
  });

  it('validation : accepte options.rule valide, rejette une valeur inconnue', () => {
    expect(strategyDocSchema.safeParse({ nodes: [], edges: [], options: { rule: '3-2-1-1-0' } }).success).toBe(true);
    expect(strategyDocSchema.safeParse({ nodes: [], edges: [], options: { rule: 'x' } }).success).toBe(false);
    expect(strategyDocSchema.parse({ nodes: [], edges: [] }).options).toBeUndefined();
  });
});
