import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/evaluate';
import { strategyDocSchema } from '../src/validate';
import { TEMPLATES } from '../src/templates';
import type { BackupEdge, BackupNode, MediaType, NodeStatus } from '../src/types';

const NOW = new Date('2026-06-01T12:00:00Z');
const n = (
  id: string,
  kind: 'source' | 'storage',
  mediaType: MediaType = 'disk',
  location: 'onsite' | 'offsite' = 'onsite',
  extra: Partial<BackupNode> = {},
): BackupNode => ({ id, kind, label: id.toUpperCase(), mediaType, location, position: { x: 0, y: 0 }, ...extra });
const e = (id: string, from: string, to: string): BackupEdge => ({ id, from, to, schedule: 'Quotidien' });
const st = (extra: Partial<NodeStatus> = {}): NodeStatus => ({
  tool: 'restic',
  lastSuccessAt: '2026-06-01T10:00:00Z',
  lastStatus: 'ok',
  reportedAt: '2026-06-01T10:00:00Z',
  ...extra,
});
const full = (extra: Partial<BackupNode> = {}) => ({
  nodes: [n('s', 'source', 'ssd'), n('a', 'storage', 'nas', 'onsite', extra), n('b', 'storage', 'cloud', 'offsite')],
  edges: [e('1', 's', 'a'), e('2', 'a', 'b')],
});
const find = (r: ReturnType<typeof evaluate>, id: string) => r.alerts.find((a) => a.id === id);

describe('restore', () => {
  it('jamais testée -> info (avec opts), sans effet sur le statut', () => {
    const r = evaluate(full(), { now: NOW });
    expect(find(r, 'restore:s')?.severity).toBe('info');
    expect(r.status).toBe('compliant');
  });
  it('test récent sur un support atteignable couvre la source', () => {
    const r = evaluate(full({ lastRestoreTestAt: '2026-05-01' }), { now: NOW });
    expect(find(r, 'restore:s')).toBeUndefined();
  });
  it('> 180 j et > 365 j -> warning (même id, message différent)', () => {
    const a = find(evaluate(full({ lastRestoreTestAt: '2025-11-01' }), { now: NOW }), 'restore:s')!;
    const b = find(evaluate(full({ lastRestoreTestAt: '2025-01-01' }), { now: NOW }), 'restore:s')!;
    expect(a.severity).toBe('warning');
    expect(b.severity).toBe('warning');
    expect(a.message).not.toBe(b.message);
    expect(evaluate(full({ lastRestoreTestAt: '2025-11-01' }), { now: NOW }).status).toBe('warning');
  });
  it('exactement 180 j : pas d\'alerte ; date future : pas d\'alerte', () => {
    expect(find(evaluate(full({ lastRestoreTestAt: '2025-12-03' }), { now: NOW }), 'restore:s')).toBeUndefined();
    expect(find(evaluate(full({ lastRestoreTestAt: '2030-01-01' }), { now: NOW }), 'restore:s')).toBeUndefined();
  });
  it('date invalide ignorée ; le plus récent des tests valides gagne', () => {
    const doc = full({ lastRestoreTestAt: 'pas-une-date' });
    expect(find(evaluate(doc, { now: NOW }), 'restore:s')?.severity).toBe('info');
    doc.nodes[0]!.lastRestoreTestAt = '2020-01-01';
    doc.nodes[2]!.lastRestoreTestAt = '2026-05-20';
    expect(find(evaluate(doc, { now: NOW }), 'restore:s')).toBeUndefined();
  });
  it('now injecté change le résultat', () => {
    const doc = full({ lastRestoreTestAt: '2026-05-01' });
    expect(find(evaluate(doc, { now: new Date('2027-06-01') }), 'restore:s')?.severity).toBe('warning');
  });
  it('rétrocompat : sans opts, pas d\'info "jamais testée"', () => {
    expect(evaluate(full()).alerts.map((a) => a.rule)).not.toContain('restore');
  });
});

describe('freshness', () => {
  it('sans status : aucune alerte', () => {
    const r = evaluate(full({ staleAfterHours: 1 }), { now: NOW });
    expect(r.alerts.some((a) => a.rule === 'freshness')).toBe(false);
    expect(evaluate(full({ staleAfterHours: 1 }), { statuses: {}, now: NOW }).alerts.some((a) => a.rule === 'freshness')).toBe(false);
  });
  it('failed -> error / violation', () => {
    const r = evaluate(full(), { statuses: { a: st({ lastStatus: 'failed', message: 'repo locked' }) }, now: NOW });
    expect(find(r, 'freshness:a')).toMatchObject({ severity: 'error', nodeIds: ['a'] });
    expect(find(r, 'freshness:a')!.message).toContain('repo locked');
    expect(r.status).toBe('violation');
  });
  it('trop ancien -> error ; dans le seuil -> rien', () => {
    const old = { a: st({ lastSuccessAt: '2026-05-30T12:00:00Z' }) };
    const r = evaluate(full({ staleAfterHours: 24 }), { statuses: old, now: NOW });
    expect(find(r, 'freshness:a')?.message).toContain('48 h');
    expect(evaluate(full({ staleAfterHours: 72 }), { statuses: old, now: NOW }).alerts.some((a) => a.rule === 'freshness')).toBe(false);
  });
  it('lastSuccessAt null ou invalide avec seuil -> error ; sans seuil -> rien', () => {
    for (const v of [null, 'garbage']) {
      const s = { a: st({ lastSuccessAt: v }) };
      expect(find(evaluate(full({ staleAfterHours: 24 }), { statuses: s, now: NOW }), 'freshness:a')?.severity).toBe('error');
      expect(find(evaluate(full(), { statuses: s, now: NOW }), 'freshness:a')).toBeUndefined();
    }
  });
  it('status sur noeud inconnu, source ou orphelin : ignoré', () => {
    const r = evaluate(full(), { statuses: { zzz: st({ lastStatus: 'failed' }), s: st({ lastStatus: 'failed' }) }, now: NOW });
    expect(r.alerts.some((a) => a.rule === 'freshness')).toBe(false);
  });
});

describe('fix', () => {
  it('règle 3 : add-storage depuis la fin de la chaîne, type non utilisé', () => {
    const r = evaluate({ nodes: [n('s', 'source', 'ssd'), n('a', 'storage', 'nas', 'offsite')], edges: [e('1', 's', 'a')] });
    const fix = find(r, '3:s')!.fix!;
    expect(fix).toMatchObject({ kind: 'add-storage', fromId: 'a', location: 'onsite' });
    expect(['ssd', 'nas']).not.toContain((fix as { mediaType: string }).mediaType);
  });
  it('règle 1 : cloud offsite ; règle 2 : type différent', () => {
    const r = evaluate({ nodes: [n('s', 'source', 'disk'), n('a', 'storage', 'disk')], edges: [e('1', 's', 'a')] });
    expect(find(r, '1:s')!.fix).toMatchObject({ kind: 'add-storage', fromId: 'a', mediaType: 'cloud', location: 'offsite' });
    const f2 = find(r, '2:s')!.fix as { mediaType: string; location: string };
    expect(f2.mediaType).not.toBe('disk');
    expect(f2.location).toBe('offsite');
  });
  it('source sans lien : fromId = source', () => {
    const r = evaluate({ nodes: [n('s', 'source')], edges: [] });
    expect(find(r, '1:s')!.fix).toMatchObject({ fromId: 's' });
  });
  it('orphelin : connect depuis la première source', () => {
    const r = evaluate({ nodes: [n('s', 'source'), n('o', 'storage', 'nas')], edges: [] });
    expect(find(r, 'structure:orphan:o')!.fix).toEqual({ kind: 'connect', fromId: 's', toId: 'o' });
  });
  it("pas de fix pour les autres règles", () => {
    const r = evaluate({ nodes: [n('s', 'source', 'ssd'), n('a', 'storage', 'nas', 'onsite', { encrypted: false })], edges: [{ id: '1', from: 's', to: 'a' }] }, { now: NOW });
    for (const rule of ['structure', 'encryption', 'immutable', 'restore']) {
      for (const a of r.alerts.filter((x) => x.rule === rule)) expect(a.fix).toBeUndefined();
    }
  });
});

describe('validate + templates', () => {
  const base = { nodes: [n('s', 'source')], edges: [] };
  const ok = (extra: object) => strategyDocSchema.safeParse({ ...base, nodes: [{ ...base.nodes[0], ...extra }] }).success;
  it('retention / lastRestoreTestAt / staleAfterHours', () => {
    expect(ok({ retention: 'x'.repeat(200), lastRestoreTestAt: '2026-01-31', staleAfterHours: 24 })).toBe(true);
    expect(ok({ retention: 'x'.repeat(201) })).toBe(false);
    expect(ok({ lastRestoreTestAt: '31/01/2026' })).toBe(false);
    expect(ok({ staleAfterHours: 0 })).toBe(false);
    expect(ok({ staleAfterHours: 8761 })).toBe(false);
    expect(ok({ staleAfterHours: 1.5 })).toBe(false);
    expect(ok({ staleAfterHours: 8760 })).toBe(true);
  });
  it('template PME : champs itération 2 valides et statut sans violation', () => {
    const sme = TEMPLATES.find((t) => t.id === 'sme')!;
    expect(strategyDocSchema.safeParse(sme.doc).success).toBe(true);
    expect(sme.doc.nodes.some((x) => x.retention && x.lastRestoreTestAt && x.staleAfterHours)).toBe(true);
    expect(evaluate(sme.doc).status).not.toBe('violation');
  });
});
