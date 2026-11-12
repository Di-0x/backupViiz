import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { asUser, compliantDoc, createTestApp } from './helpers';

let app: FastifyInstance;
beforeAll(async () => { app = await createTestApp(); });
afterAll(async () => { await app.close(); });

const alice = asUser('alice');
const bob = asUser('bob');
const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, headers: Record<string, string>, payload?: unknown) =>
  app.inject({ method, url: `/api/strategies${url}`, headers, payload: payload as object | undefined });

describe('strategies', () => {
  it('exige une authentification', async () => {
    expect((await call('GET', '', {})).statusCode).toBe(401);
  });

  it('crée avec doc par défaut vide puis lit avec évaluation', async () => {
    const res = await call('POST', '', alice, { name: 'Ma strat' });
    expect(res.statusCode).toBe(201);
    const s = res.json();
    expect(s).toMatchObject({ name: 'Ma strat', description: '', nodes: [], edges: [] });
    expect(s.evaluation.status).toBe('empty');
    const got = await call('GET', `/${s.id}`, alice);
    expect(got.statusCode).toBe(200);
    expect(got.json().id).toBe(s.id);
  });

  it('évalue un doc conforme et fournit un résumé', async () => {
    const s = (await call('POST', '', alice, { name: 'OK', doc: compliantDoc() })).json();
    expect(s.evaluation.status).not.toBe('violation');
    const list = (await call('GET', '', alice)).json();
    const sum = list.find((x: { id: string }) => x.id === s.id);
    expect(sum).toMatchObject({ nodeCount: 3, edgeCount: 2, errorCount: 0 });
    expect(sum.doc).toBeUndefined();
  });

  it('valide les entrées (400 + fields)', async () => {
    const r = await call('POST', '', alice, { name: '' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('validation_error');
    expect(r.json().error.fields).toBeTruthy();
    expect((await call('POST', '', alice, { name: 'x', doc: { nodes: 'no', edges: [] } })).statusCode).toBe(400);
  });

  it('met à jour (PUT partiel) et trie par updated_at', async () => {
    const a = (await call('POST', '', alice, { name: 'A1' })).json();
    await new Promise((r) => setTimeout(r, 5));
    await call('POST', '', alice, { name: 'A2' });
    await new Promise((r) => setTimeout(r, 5));
    const put = await call('PUT', `/${a.id}`, alice, { description: 'desc', doc: compliantDoc() });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ name: 'A1', description: 'desc' });
    expect(put.json().nodes).toHaveLength(3);
    const list = (await call('GET', '', alice)).json();
    expect(list[0].id).toBe(a.id);
  });

  it('duplique, exporte, importe', async () => {
    const a = (await call('POST', '', alice, { name: 'Source', description: 'd', doc: compliantDoc() })).json();
    const dup = await call('POST', `/${a.id}/duplicate`, alice);
    expect(dup.statusCode).toBe(201);
    expect(dup.json()).toMatchObject({ name: 'Copie de Source', description: 'd' });
    expect(dup.json().id).not.toBe(a.id);

    const exp = await call('GET', `/${a.id}/export`, alice);
    expect(exp.statusCode).toBe(200);
    expect(exp.headers['content-disposition']).toMatch(/attachment; filename="Source\.backupviiz\.json"/);
    const file = exp.json();
    expect(file).toMatchObject({ version: 1, name: 'Source', description: 'd' });

    const imp = await call('POST', '/import', bob, file);
    expect(imp.statusCode).toBe(201);
    expect(imp.json()).toMatchObject({ name: 'Source', description: 'd' });
    expect(imp.json().nodes).toHaveLength(3);
    expect((await call('POST', '/import', bob, { name: 'x' })).statusCode).toBe(400);
    expect((await call('POST', '/import', bob, { doc: compliantDoc() })).json().name).toBe('Stratégie importée');
  });

  it('supprime (204 puis 404)', async () => {
    const a = (await call('POST', '', alice, { name: 'tmp' })).json();
    expect((await call('DELETE', `/${a.id}`, alice)).statusCode).toBe(204);
    expect((await call('GET', `/${a.id}`, alice)).statusCode).toBe(404);
  });

  it('isole les utilisateurs (404 pour un non-propriétaire)', async () => {
    const a = (await call('POST', '', alice, { name: 'privée' })).json();
    for (const [m, u] of [['GET', ''], ['PUT', ''], ['DELETE', ''], ['POST', '/duplicate'], ['GET', '/export']] as const) {
      const r = await call(m, `/${a.id}${u}`, bob, m === 'PUT' ? { name: 'hack' } : undefined);
      expect(r.statusCode, `${m} ${u}`).toBe(404);
      expect(r.json().error.code).toBe('not_found');
    }
    const list = (await call('GET', '', bob)).json();
    expect(list.find((x: { id: string }) => x.id === a.id)).toBeUndefined();
    expect((await call('GET', `/${a.id}`, alice)).json().name).toBe('privée');
  });
});

describe('erreurs globales', () => {
  it('404 JSON pour route API inconnue', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe('not_found');
  });

  it('JSON invalide -> 400 ApiError', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/strategies', headers: { ...alice, 'content-type': 'application/json' }, payload: '{bad' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('bad_request');
  });

  it('body > 1 MB -> 413', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/strategies', headers: alice, payload: { name: 'x', description: 'a'.repeat(1_100_000) } });
    expect(r.statusCode).toBe(413);
    expect(r.json().error.code).toBe('payload_too_large');
  });

  it('health ok', async () => {
    expect((await app.inject({ url: '/api/health' })).json()).toEqual({ status: 'ok' });
  });
});
