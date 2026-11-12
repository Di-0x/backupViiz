import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';
delete process.env.ALLOW_REGISTRATION;

let app: FastifyInstance;
let dbm: typeof import('../src/db');
let sess: typeof import('../src/auth/session');

const HOST = { host: 'localhost:3000' };
const cookieOf = (res: { cookies: { name: string; value: string }[] }, name = 'bv_session') => res.cookies.find((c) => c.name === name)?.value;
const post = (url: string, payload?: unknown, cookie?: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers: { ...HOST, ...(cookie ? { cookie: `bv_session=${cookie}` } : {}), ...headers } });
const get = (url: string, cookie?: string) => app.inject({ method: 'GET', url, headers: { ...HOST, ...(cookie ? { cookie: `bv_session=${cookie}` } : {}) } });

beforeAll(async () => {
  dbm = await import('../src/db');
  sess = await import('../src/auth/session');
  const { buildApp } = await import('../src/app');
  app = await buildApp();
  await app.ready();
});
afterAll(async () => { await app?.close(); });

describe('auth', () => {
  let alice = '';

  it('config: inscription ouverte quand 0 utilisateur', async () => {
    const res = await get('/api/auth/config');
    expect(res.json()).toEqual({ registrationOpen: true });
  });

  it('refuse les routes protégées sans session (401)', async () => {
    expect((await get('/api/auth/me')).statusCode).toBe(401);
    expect((await post('/api/auth/password', { newPassword: 'x'.repeat(12) })).statusCode).toBe(401);
  });

  it('register: validation 400 avec fields', async () => {
    const res = await post('/api/auth/register', { username: 'a', password: 'court' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields).toHaveProperty('username');
    expect(res.json().error.fields).toHaveProperty('password');
  });

  it('register: 201 + cookie httpOnly SameSite=Lax, /me fonctionne', async () => {
    const res = await post('/api/auth/register', { username: 'alice', password: 'motdepasse-solide' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ username: 'alice', hasPassword: true, passkeyCount: 0 });
    const c = res.cookies.find((x) => x.name === 'bv_session')!;
    expect(c.httpOnly).toBe(true);
    expect(String(c.sameSite).toLowerCase()).toBe('lax');
    alice = c.value;
    const me = await get('/api/auth/me', alice);
    expect(me.statusCode).toBe(200);
    expect(me.json().username).toBe('alice');
    // le token n'est pas stocké en clair
    const rows = dbm.db.prepare('SELECT id_hash FROM sessions').all() as unknown as { id_hash: string }[];
    expect(rows.some((r) => r.id_hash === alice)).toBe(false);
    expect(rows.some((r) => r.id_hash === sess.sha256(alice))).toBe(true);
  });

  it('stocke un hash scrypt au bon format', () => {
    const r = dbm.db.prepare("SELECT password_hash FROM users WHERE username = 'alice'").get() as unknown as { password_hash: string };
    expect(r.password_hash).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it('inscription fermée une fois un utilisateur créé (403), sauf ALLOW_REGISTRATION', async () => {
    expect((await get('/api/auth/config')).json()).toEqual({ registrationOpen: false });
    const res = await post('/api/auth/register', { username: 'bob', password: 'motdepasse-solide' });
    expect(res.statusCode).toBe(403);
    process.env.ALLOW_REGISTRATION = 'true';
    try {
      expect((await get('/api/auth/config')).json()).toEqual({ registrationOpen: true });
      const dup = await post('/api/auth/register', { username: 'ALICE', password: 'motdepasse-solide' });
      expect(dup.statusCode).toBe(409);
      const ok = await post('/api/auth/register', { username: 'bob', password: 'motdepasse-solide' });
      expect(ok.statusCode).toBe(201);
    } finally { delete process.env.ALLOW_REGISTRATION; }
  });

  it('login: succès, et même message pour mdp faux / utilisateur inconnu', async () => {
    const ok = await post('/api/auth/login', { username: 'alice', password: 'motdepasse-solide' });
    expect(ok.statusCode).toBe(200);
    expect(cookieOf(ok)).toBeTruthy();
    const bad = await post('/api/auth/login', { username: 'alice', password: 'mauvais-mdp-xx' });
    const unknown = await post('/api/auth/login', { username: 'nobody', password: 'mauvais-mdp-xx' });
    expect(bad.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(bad.json()).toEqual(unknown.json());
  });

  it('CSRF: rejette un Origin différent, accepte le même host', async () => {
    const evil = await post('/api/auth/logout', undefined, alice, { origin: 'https://evil.example' });
    expect(evil.statusCode).toBe(403);
    expect(evil.json().error.code).toBe('csrf');
    const same = await post('/api/auth/login', { username: 'alice', password: 'motdepasse-solide' }, undefined, { origin: 'http://localhost:3000' });
    expect(same.statusCode).toBe(200);
    // les GET ne sont pas concernés
    const g = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { ...HOST, origin: 'https://evil.example', cookie: `bv_session=${alice}` } });
    expect(g.statusCode).toBe(200);
  });

  it('change de mot de passe: exige l\'actuel, invalide les autres sessions', async () => {
    const other = cookieOf(await post('/api/auth/login', { username: 'alice', password: 'motdepasse-solide' }))!;
    const wrong = await post('/api/auth/password', { currentPassword: 'incorrect-incorrect', newPassword: 'nouveau-mdp-solide' }, alice);
    expect(wrong.statusCode).toBe(403);
    const missing = await post('/api/auth/password', { newPassword: 'nouveau-mdp-solide' }, alice);
    expect(missing.statusCode).toBe(403);
    const ok = await post('/api/auth/password', { currentPassword: 'motdepasse-solide', newPassword: 'nouveau-mdp-solide' }, alice);
    expect(ok.statusCode).toBe(200);
    expect((await get('/api/auth/me', alice)).statusCode).toBe(200);
    expect((await get('/api/auth/me', other)).statusCode).toBe(401);
    expect((await post('/api/auth/login', { username: 'alice', password: 'motdepasse-solide' })).statusCode).toBe(401);
    expect((await post('/api/auth/login', { username: 'alice', password: 'nouveau-mdp-solide' })).statusCode).toBe(200);
  });

  it('sessions expirées refusées et purgées', async () => {
    const t = cookieOf(await post('/api/auth/login', { username: 'alice', password: 'nouveau-mdp-solide' }))!;
    dbm.db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').run(Date.now() - 1000, sess.sha256(t));
    expect((await get('/api/auth/me', t)).statusCode).toBe(401);
    expect(dbm.db.prepare('SELECT 1 FROM sessions WHERE id_hash = ?').get(sess.sha256(t))).toBeUndefined();
    const t2 = cookieOf(await post('/api/auth/login', { username: 'alice', password: 'nouveau-mdp-solide' }))!;
    dbm.db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').run(Date.now() - 1000, sess.sha256(t2));
    expect(sess.purgeExpired()).toBeGreaterThanOrEqual(1);
    expect(dbm.db.prepare('SELECT 1 FROM sessions WHERE id_hash = ?').get(sess.sha256(t2))).toBeUndefined();
  });

  it('durée glissante: prolonge la session', async () => {
    const t = cookieOf(await post('/api/auth/login', { username: 'alice', password: 'nouveau-mdp-solide' }))!;
    const soon = Date.now() + 3600_000;
    dbm.db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').run(soon, sess.sha256(t));
    const res = await get('/api/auth/me', t);
    expect(res.statusCode).toBe(200);
    const r = dbm.db.prepare('SELECT expires_at FROM sessions WHERE id_hash = ?').get(sess.sha256(t)) as unknown as { expires_at: number };
    expect(r.expires_at).toBeGreaterThan(Date.now() + 13 * 24 * 3600_000);
  });

  it('logout: 204 et session détruite', async () => {
    const t = cookieOf(await post('/api/auth/login', { username: 'alice', password: 'nouveau-mdp-solide' }))!;
    const res = await post('/api/auth/logout', undefined, t);
    expect(res.statusCode).toBe(204);
    expect((await get('/api/auth/me', t)).statusCode).toBe(401);
  });

  it('rate-limit du login: 429 au-delà de 10/min', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await post('/api/auth/login', { username: 'nobody', password: 'x' }, undefined, { 'x-test': String(i) })).statusCode);
    expect(codes).toContain(429);
  });

  it('/api/health reste public', async () => {
    expect((await get('/api/health')).statusCode).toBe(200);
  });
});
