import { describe, expect, it } from 'vitest';
import { asUser, createTestApp } from './helpers';

const doc = (rule?: string) => ({
  options: rule ? { rule } : undefined,
  nodes: [{ id: 's', kind: 'source', label: 'PC', mediaType: 'ssd', location: 'onsite', position: { x: 0, y: 0 } }],
  edges: [],
});

describe('option de référentiel 3-2-1-1-0', () => {
  it('persiste options.rule, l\'évalue en mode strict et rejette une valeur inconnue', async () => {
    const app = await createTestApp();
    const h = asUser('rule-user');
    const c = await app.inject({ method: 'POST', url: '/api/strategies', headers: h, payload: { name: 'S', doc: doc('3-2-1-1-0') } });
    expect(c.statusCode).toBe(201);
    const s = c.json();
    expect(s.options).toEqual({ rule: '3-2-1-1-0' });
    expect(s.evaluation.rule).toBe('3-2-1-1-0');
    expect(s.evaluation.alerts.some((a: { id: string }) => a.id === 'immutable:s')).toBe(true);
    const g = await app.inject({ method: 'GET', url: `/api/strategies/${s.id}`, headers: h });
    expect(g.json().options).toEqual({ rule: '3-2-1-1-0' });
    const d = await app.inject({ method: 'POST', url: `/api/strategies/${s.id}/duplicate`, headers: h });
    expect(d.json().options).toEqual({ rule: '3-2-1-1-0' });
    const bad = await app.inject({ method: 'PUT', url: `/api/strategies/${s.id}`, headers: h, payload: { doc: doc('nope') } });
    expect(bad.statusCode).toBe(400);
    const classic = await app.inject({ method: 'PUT', url: `/api/strategies/${s.id}`, headers: h, payload: { doc: doc() } });
    expect(classic.json().evaluation.rule).toBe('3-2-1');
  });
});
