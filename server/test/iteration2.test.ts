import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { asUser, compliantDoc, createTestApp } from './helpers';

let app: FastifyInstance;
let db: typeof import('../src/db').db;
beforeAll(async () => { app = await createTestApp(); db = (await import('../src/db')).db; });
afterAll(async () => { await app.close(); });

const alice = asUser('alice2');
const bob = asUser('bob2');
const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, headers: Record<string, string>, payload?: unknown) =>
  app.inject({ method, url, headers, payload: payload as object | undefined });
const strat = (url = '', h = alice, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', p?: unknown) => call(method, `/api/strategies${url}`, h, p);

async function newToken(h = alice, name = 'srv'): Promise<string> {
  const r = await call('POST', '/api/tokens', h, { name });
  expect(r.statusCode).toBe(201);
  return r.json().token;
}
const ingest = (token: string | null, path: string, body: unknown) =>
  app.inject({ method: 'POST', url: `/api/ingest/${path}`, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body as object });

describe('jetons API', () => {
  it('exige une session, crée (clair une seule fois), liste, révoque, isole', async () => {
    expect((await call('GET', '/api/tokens', {})).statusCode).toBe(401);
    const c = (await call('POST', '/api/tokens', alice, { name: 'nas' })).json();
    expect(c.token).toMatch(/^bvk_[A-Za-z0-9_-]{43}$/);
    expect(c).toMatchObject({ name: 'nas', lastUsedAt: null });
    const list = (await call('GET', '/api/tokens', alice)).json();
    const mine = list.find((t: { id: string }) => t.id === c.id);
    expect(mine.token).toBeUndefined();
    expect(JSON.stringify(list)).not.toContain(c.token);
    const stored = db.prepare('SELECT token_hash FROM api_tokens WHERE id = ?').get(c.id) as { token_hash: string };
    expect(stored.token_hash).not.toContain(c.token);
    expect((await call('GET', '/api/tokens', bob)).json().find((t: { id: string }) => t.id === c.id)).toBeUndefined();
    expect((await call('DELETE', `/api/tokens/${c.id}`, bob)).statusCode).toBe(404);
    expect((await call('DELETE', `/api/tokens/${c.id}`, alice)).statusCode).toBe(204);
    expect((await call('DELETE', `/api/tokens/${c.id}`, alice)).statusCode).toBe(404);
    expect((await call('POST', '/api/tokens', alice, { name: '' })).statusCode).toBe(400);
  });

  it('limite à 20 jetons par utilisateur', async () => {
    const h = asUser('tokmax');
    for (let i = 0; i < 20; i++) expect((await call('POST', '/api/tokens', h, { name: `t${i}` })).statusCode).toBe(201);
    const r = await call('POST', '/api/tokens', h, { name: 'trop' });
    expect(r.statusCode).toBe(409);
  });
});

describe('ingestion restic', () => {
  const doc = () => {
    const d = compliantDoc();
    d.nodes[1]!.hostname = 'Nas-01';
    d.nodes[1]!.staleAfterHours = 24;
    return d;
  };

  it('rejette jeton absent, invalide, ou session cookie seule', async () => {
    const s = (await strat('', alice, 'POST', { name: 'I', doc: doc() })).json();
    expect((await ingest(null, `${s.id}/n1`, { status: 'ok' })).statusCode).toBe(401);
    expect((await ingest('bvk_nope', `${s.id}/n1`, { status: 'ok' })).statusCode).toBe(401);
    const r = await app.inject({ method: 'POST', url: `/api/ingest/${s.id}/n1`, headers: alice, payload: { status: 'ok' } });
    expect(r.statusCode).toBe(401);
  });

  it('enregistre le statut, calcule lastSuccessAt/snapshotCount, expose statuses et met à jour last_used_at', async () => {
    const s = (await strat('', alice, 'POST', { name: 'I', doc: doc() })).json();
    const tok = await newToken();
    const recent = new Date(Date.now() - 3600_000).toISOString();
    const r = await ingest(tok, `${s.id}/n1`, {
      tool: 'restic', status: 'ok', sizeBytes: 1234, message: 'fin',
      snapshots: [{ time: '2020-01-01T00:00:00Z', id: 'a' }, { time: recent, id: 'b', extra: 1 }],
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(true);
    expect(r.json().evaluationStatus).toBeTruthy();
    const got = (await strat(`/${s.id}`)).json();
    expect(got.statuses.n1).toMatchObject({ tool: 'restic', lastStatus: 'ok', lastSuccessAt: recent, snapshotCount: 2, sizeBytes: 1234, message: 'fin' });
    expect(got.evaluation.alerts.find((a: { rule: string }) => a.rule === 'freshness')).toBeUndefined();
    const info = (await call('GET', '/api/tokens', alice)).json().find((t: { name: string }) => t.name === 'srv');
    expect(info.lastUsedAt).toBeTruthy();
    const list = (await strat('')).json().find((x: { id: string }) => x.id === s.id);
    expect(list.errorCount).toBe(got.evaluation.alerts.filter((a: { severity: string }) => a.severity === 'error').length);
  });

  it('échec : conserve le dernier succès ; alerte freshness (error) ; suppression en cascade', async () => {
    const s = (await strat('', alice, 'POST', { name: 'I', doc: doc() })).json();
    const tok = await newToken();
    const recent = new Date(Date.now() - 3600_000).toISOString();
    await ingest(tok, `${s.id}/n1`, { status: 'ok', snapshots: [{ time: recent }] });
    await ingest(tok, `${s.id}/n1`, { status: 'failed', message: 'repo locked' });
    const got = (await strat(`/${s.id}`)).json();
    expect(got.statuses.n1).toMatchObject({ lastStatus: 'failed', lastSuccessAt: recent, message: 'repo locked' });
    const fresh = got.evaluation.alerts.filter((a: { rule: string }) => a.rule === 'freshness');
    expect(fresh).toHaveLength(1);
    expect(fresh[0].severity).toBe('error');
    expect(got.evaluation.status).toBe('violation');
    await strat(`/${s.id}`, alice, 'DELETE');
    const c = db.prepare('SELECT COUNT(*) AS c FROM node_status WHERE strategy_id = ?').get(s.id) as { c: number };
    expect(Number(c.c)).toBe(0);
  });

  it('alerte freshness quand le dernier succès est trop ancien', async () => {
    const s = (await strat('', alice, 'POST', { name: 'I', doc: doc() })).json();
    const tok = await newToken();
    await ingest(tok, `${s.id}/n1`, { status: 'ok', snapshots: [{ time: new Date(Date.now() - 72 * 3600_000).toISOString() }] });
    const got = (await strat(`/${s.id}`)).json();
    expect(got.evaluation.alerts.some((a: { rule: string; severity: string }) => a.rule === 'freshness' && a.severity === 'error')).toBe(true);
  });

  it('404 noeud inconnu, 400 body invalide, isolation entre utilisateurs', async () => {
    const s = (await strat('', alice, 'POST', { name: 'I', doc: doc() })).json();
    const tokA = await newToken(alice);
    const tokB = await newToken(bob);
    expect((await ingest(tokA, `${s.id}/zzz`, { status: 'ok' })).statusCode).toBe(404);
    expect((await ingest(tokA, `${s.id}/n1`, { status: 'bizarre' })).statusCode).toBe(400);
    expect((await ingest(tokB, `${s.id}/n1`, { status: 'ok' })).statusCode).toBe(404);
    expect((await ingest(tokA, `inconnue/n1`, { status: 'ok' })).statusCode).toBe(404);
    expect(Object.keys((await strat(`/${s.id}`)).json().statuses)).toHaveLength(0);
  });

  it('by-hostname : insensible à la casse, 404, 409 si ambigu', async () => {
    const s = (await strat('', alice, 'POST', { name: 'H', doc: doc() })).json();
    const tok = await newToken();
    expect((await ingest(tok, `${s.id}/by-hostname/NAS-01`, { status: 'ok', snapshots: [{ time: new Date().toISOString() }] })).statusCode).toBe(200);
    expect((await strat(`/${s.id}`)).json().statuses.n1.snapshotCount).toBe(1);
    expect((await ingest(tok, `${s.id}/by-hostname/inconnu`, { status: 'ok' })).statusCode).toBe(404);
    const d = doc();
    d.nodes[0]!.hostname = 'nas-01';
    await strat(`/${s.id}`, alice, 'PUT', { doc: d });
    expect((await ingest(tok, `${s.id}/by-hostname/nas-01`, { status: 'ok' })).statusCode).toBe(409);
  });

  it('limite le corps à 2 MB et rate-limit 60/min par jeton', async () => {
    const s = (await strat('', alice, 'POST', { name: 'R', doc: doc() })).json();
    const tok = await newToken(alice, 'rl');
    const big = { status: 'ok', snapshots: Array.from({ length: 15000 }, (_, i) => ({ time: '2024-01-01T00:00:00Z', id: String(i).padStart(64, '0') })) };
    expect(JSON.stringify(big).length).toBeGreaterThan(1024 * 1024);
    expect((await ingest(tok, `${s.id}/n1`, big)).statusCode).toBe(200); // > 1 MB global mais < 2 MB
    const huge = { status: 'ok', message: 'x'.repeat(10), pad: 'y'.repeat(2.1 * 1024 * 1024) };
    expect((await ingest(tok, `${s.id}/n1`, huge)).statusCode).toBe(413);
    let last = 200;
    for (let i = 0; i < 65 && last !== 429; i++) last = (await ingest(tok, `${s.id}/n1`, { status: 'ok' })).statusCode;
    expect(last).toBe(429);
  });
});

describe('versions', () => {
  const docV = (n: number) => {
    const d = compliantDoc();
    d.nodes[0]!.label = `v${n}`;
    return d;
  };
  const ageVersions = (id: string, ms: number) =>
    db.prepare('UPDATE strategy_versions SET created_at = ? WHERE strategy_id = ?').run(new Date(Date.now() - ms).toISOString(), id);

  it('snapshot à la modification du doc, coalescence < 2 min, pas de snapshot si doc inchangé', async () => {
    const s = (await strat('', alice, 'POST', { name: 'V', doc: docV(0) })).json();
    expect((await strat(`/${s.id}/versions`)).json()).toEqual([]);
    await strat(`/${s.id}`, alice, 'PUT', { name: 'V renommée' }); // pas de doc
    await strat(`/${s.id}`, alice, 'PUT', { doc: docV(0) }); // doc identique
    expect((await strat(`/${s.id}/versions`)).json()).toHaveLength(0);
    await strat(`/${s.id}`, alice, 'PUT', { doc: docV(1) });
    await strat(`/${s.id}`, alice, 'PUT', { doc: docV(2) }); // coalescé
    const list = (await strat(`/${s.id}/versions`)).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ reason: 'auto', name: 'V renommée', nodeCount: 3, edgeCount: 2 });
    const v = (await strat(`/${s.id}/versions/${list[0].id}`)).json();
    expect(v.doc.nodes[0].label).toBe('v0');
    ageVersions(s.id, 5 * 60_000);
    await strat(`/${s.id}`, alice, 'PUT', { doc: docV(3) });
    const list2 = (await strat(`/${s.id}/versions`)).json();
    expect(list2).toHaveLength(2);
    expect((await strat(`/${s.id}/versions/${list2[0].id}`)).json().doc.nodes[0].label).toBe('v2'); // desc : le plus récent d'abord
  });

  it('purge à 50 versions max', async () => {
    const s = (await strat('', alice, 'POST', { name: 'P', doc: docV(0) })).json();
    for (let i = 1; i <= 55; i++) {
      await strat(`/${s.id}`, alice, 'PUT', { doc: docV(i) });
      ageVersions(s.id, 10 * 60_000);
    }
    const list = (await strat(`/${s.id}/versions`)).json();
    expect(list).toHaveLength(50);
    const newest = (await strat(`/${s.id}/versions/${list[0].id}`)).json();
    expect(newest.doc.nodes[0].label).toBe('v54');
  });

  it('restaure (snapshot restore de l\'état courant), renvoie la Strategy, scoping strict', async () => {
    const s = (await strat('', alice, 'POST', { name: 'R', doc: docV(0) })).json();
    await strat(`/${s.id}`, alice, 'PUT', { name: 'R2', doc: docV(1) });
    const [v] = (await strat(`/${s.id}/versions`)).json();
    expect((await strat(`/${s.id}/versions`, bob)).statusCode).toBe(404);
    expect((await strat(`/${s.id}/versions/${v.id}`, bob)).statusCode).toBe(404);
    expect((await strat(`/${s.id}/versions/${v.id}/restore`, bob, 'POST')).statusCode).toBe(404);
    expect((await strat(`/${s.id}/versions/inconnue`)).statusCode).toBe(404);
    const r = await strat(`/${s.id}/versions/${v.id}/restore`, alice, 'POST');
    expect(r.statusCode).toBe(200);
    const restored = r.json();
    expect(restored.name).toBe('R');
    expect(restored.nodes[0].label).toBe('v0');
    expect(restored.evaluation).toBeTruthy();
    expect(restored.statuses).toEqual({});
    const list = (await strat(`/${s.id}/versions`)).json();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ reason: 'restore', name: 'R2' });
    // l'autre stratégie d'un autre utilisateur n'est pas atteignable via une version d'ailleurs
    const other = (await strat('', bob, 'POST', { name: 'B', doc: docV(9) })).json();
    expect((await strat(`/${other.id}/versions/${v.id}`, bob)).statusCode).toBe(404);
  });
});
