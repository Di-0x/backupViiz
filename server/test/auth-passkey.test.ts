import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('@simplewebauthn/server', async (orig) => ({
  ...(await orig<typeof import('@simplewebauthn/server')>()),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';
delete process.env.ALLOW_REGISTRATION;

let app: FastifyInstance;
let dbm: typeof import('../src/db');
let wa: typeof import('@simplewebauthn/server');

const HOST = { host: 'localhost:3000' };
type Res = Awaited<ReturnType<FastifyInstance['inject']>>;
const val = (res: Res, name: string) => res.cookies.find((c) => c.name === name)?.value;
const req = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, opts: { payload?: unknown; session?: string; wa?: string } = {}) => {
  const cookie = [opts.session && `bv_session=${opts.session}`, opts.wa && `bv_wa=${opts.wa}`].filter(Boolean).join('; ');
  return app.inject({ method, url, payload: opts.payload as object, headers: { ...HOST, ...(cookie ? { cookie } : {}) } });
};
const fakeResponse = (id: string) => ({ id, rawId: id, type: 'public-key', response: {}, clientExtensionResults: {} });
const okReg = (id: string) => ({
  verified: true,
  registrationInfo: { credential: { id, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] } },
});

beforeAll(async () => {
  dbm = await import('../src/db');
  wa = await import('@simplewebauthn/server');
  const { buildApp } = await import('../src/app');
  app = await buildApp();
  await app.ready();
});
afterAll(async () => { await app?.close(); });

describe('passkeys', () => {
  let session = '';
  let sessionB = '';

  it('prépare deux comptes', async () => {
    const a = await req('POST', '/api/auth/register', { payload: { username: 'alice', password: 'motdepasse-solide' } });
    session = val(a, 'bv_session')!;
    process.env.ALLOW_REGISTRATION = 'true';
    const b = await req('POST', '/api/auth/register', { payload: { username: 'bob', password: 'motdepasse-solide' } });
    delete process.env.ALLOW_REGISTRATION;
    sessionB = val(b, 'bv_session')!;
    expect(session && sessionB).toBeTruthy();
  });

  it('register/options exige l\'auth et pose le cookie de défi', async () => {
    expect((await req('POST', '/api/auth/passkey/register/options')).statusCode).toBe(401);
    const res = await req('POST', '/api/auth/passkey/register/options', { session });
    expect(res.statusCode).toBe(200);
    const o = res.json();
    expect(o.rp.id).toBe('localhost');
    expect(o.user.name).toBe('alice');
    expect(o.authenticatorSelection).toMatchObject({ residentKey: 'preferred', userVerification: 'preferred' });
    const c = res.cookies.find((x) => x.name === 'bv_wa')!;
    expect(c.httpOnly).toBe(true);
    const row = dbm.db.prepare('SELECT challenge, purpose FROM webauthn_challenges WHERE id = ?').get(c.value) as unknown as { challenge: string; purpose: string };
    expect(row).toEqual({ challenge: o.challenge, purpose: 'register' });
  });

  it('register/verify: sans défi 400; avec défi 201 puis usage unique', async () => {
    expect((await req('POST', '/api/auth/passkey/register/verify', { session, payload: { response: fakeResponse('cred-a1') } })).statusCode).toBe(400);
    const opt = await req('POST', '/api/auth/passkey/register/options', { session });
    const waCookie = val(opt, 'bv_wa')!;
    vi.mocked(wa.verifyRegistrationResponse).mockResolvedValueOnce(okReg('cred-a1') as never);
    const res = await req('POST', '/api/auth/passkey/register/verify', { session, wa: waCookie, payload: { response: fakeResponse('cred-a1'), name: 'Mon Mac' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: 'cred-a1', name: 'Mon Mac', lastUsedAt: null });
    expect(vi.mocked(wa.verifyRegistrationResponse).mock.calls.at(-1)![0]).toMatchObject({ expectedChallenge: opt.json().challenge, expectedRPID: 'localhost', expectedOrigin: 'http://localhost:3000' });
    // rejeu du même défi
    const replay = await req('POST', '/api/auth/passkey/register/verify', { session, wa: waCookie, payload: { response: fakeResponse('cred-a2') } });
    expect(replay.statusCode).toBe(400);
    expect((await req('GET', '/api/auth/me', { session })).json().passkeyCount).toBe(1);
  });

  it('défi expiré refusé', async () => {
    const opt = await req('POST', '/api/auth/passkey/register/options', { session });
    const id = val(opt, 'bv_wa')!;
    dbm.db.prepare('UPDATE webauthn_challenges SET expires_at = ? WHERE id = ?').run(Date.now() - 1, id);
    const res = await req('POST', '/api/auth/passkey/register/verify', { session, wa: id, payload: { response: fakeResponse('cred-a3') } });
    expect(res.statusCode).toBe(400);
  });

  it('vérification échouée -> 400', async () => {
    const opt = await req('POST', '/api/auth/passkey/register/options', { session });
    vi.mocked(wa.verifyRegistrationResponse).mockResolvedValueOnce({ verified: false } as never);
    const res = await req('POST', '/api/auth/passkey/register/verify', { session, wa: val(opt, 'bv_wa'), payload: { response: fakeResponse('x') } });
    expect(res.statusCode).toBe(400);
  });

  it('login/options: discoverable (sans username) et avec username (allowCredentials)', async () => {
    const anon = await req('POST', '/api/auth/passkey/login/options', { payload: {} });
    expect(anon.statusCode).toBe(200);
    expect(anon.json().allowCredentials ?? []).toEqual([]);
    const noBody = await req('POST', '/api/auth/passkey/login/options');
    expect(noBody.statusCode).toBe(200);
    const named = await req('POST', '/api/auth/passkey/login/options', { payload: { username: 'alice' } });
    expect(named.json().allowCredentials.map((c: { id: string }) => c.id)).toEqual(['cred-a1']);
    const unknown = await req('POST', '/api/auth/passkey/login/options', { payload: { username: 'ghost' } });
    expect(unknown.statusCode).toBe(200);
  });

  it('login/verify: crée la session, met à jour counter et last_used_at', async () => {
    const opt = await req('POST', '/api/auth/passkey/login/options', { payload: {} });
    vi.mocked(wa.verifyAuthenticationResponse).mockResolvedValueOnce({ verified: true, authenticationInfo: { newCounter: 7 } } as never);
    const res = await req('POST', '/api/auth/passkey/login/verify', { wa: val(opt, 'bv_wa'), payload: { response: fakeResponse('cred-a1') } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ username: 'alice', passkeyCount: 1 });
    const s = val(res, 'bv_session')!;
    expect((await req('GET', '/api/auth/me', { session: s })).statusCode).toBe(200);
    const row = dbm.db.prepare('SELECT counter, last_used_at FROM passkeys WHERE id = ?').get('cred-a1') as unknown as { counter: number; last_used_at: string };
    expect(row.counter).toBe(7);
    expect(row.last_used_at).toBeTruthy();
  });

  it('login/verify: credential inconnue ou vérif KO -> 401; sans défi -> 400', async () => {
    const o1 = await req('POST', '/api/auth/passkey/login/options', { payload: {} });
    expect((await req('POST', '/api/auth/passkey/login/verify', { wa: val(o1, 'bv_wa'), payload: { response: fakeResponse('inconnu') } })).statusCode).toBe(401);
    const o2 = await req('POST', '/api/auth/passkey/login/options', { payload: {} });
    vi.mocked(wa.verifyAuthenticationResponse).mockRejectedValueOnce(new Error('bad'));
    expect((await req('POST', '/api/auth/passkey/login/verify', { wa: val(o2, 'bv_wa'), payload: { response: fakeResponse('cred-a1') } })).statusCode).toBe(401);
    expect((await req('POST', '/api/auth/passkey/login/verify', { payload: { response: fakeResponse('cred-a1') } })).statusCode).toBe(400);
  });

  it('liste / renomme / supprime avec isolation entre utilisateurs', async () => {
    const list = await req('GET', '/api/auth/passkey', { session });
    expect(list.json()).toHaveLength(1);
    expect((await req('GET', '/api/auth/passkey', { session: sessionB })).json()).toEqual([]);
    expect((await req('PATCH', '/api/auth/passkey/cred-a1', { session: sessionB, payload: { name: 'pirate' } })).statusCode).toBe(404);
    expect((await req('DELETE', '/api/auth/passkey/cred-a1', { session: sessionB })).statusCode).toBe(404);
    expect((await req('PATCH', '/api/auth/passkey/cred-a1', { session, payload: { name: '' } })).statusCode).toBe(400);
    const ren = await req('PATCH', '/api/auth/passkey/cred-a1', { session, payload: { name: 'Clé USB' } });
    expect(ren.json()).toMatchObject({ id: 'cred-a1', name: 'Clé USB' });
    expect((await req('DELETE', '/api/auth/passkey/cred-a1', { session })).statusCode).toBe(204); // alice a un mot de passe
    expect((await req('GET', '/api/auth/passkey', { session })).json()).toEqual([]);
  });

  let pkOnly = '';
  it('signup passkey-only: inscription fermée -> 403', async () => {
    const res = await req('POST', '/api/auth/passkey/signup/options', { payload: { username: 'carol' } });
    expect(res.statusCode).toBe(403);
  });

  it('signup passkey-only: options + verify créent le compte sans mot de passe', async () => {
    process.env.ALLOW_REGISTRATION = 'true';
    try {
      expect((await req('POST', '/api/auth/passkey/signup/options', { payload: { username: 'x' } })).statusCode).toBe(400);
      expect((await req('POST', '/api/auth/passkey/signup/options', { payload: { username: 'alice' } })).statusCode).toBe(409);
      const opt = await req('POST', '/api/auth/passkey/signup/options', { payload: { username: 'carol' } });
      expect(opt.statusCode).toBe(200);
      vi.mocked(wa.verifyRegistrationResponse).mockResolvedValueOnce(okReg('cred-c1') as never);
      const res = await req('POST', '/api/auth/passkey/signup/verify', { wa: val(opt, 'bv_wa'), payload: { response: fakeResponse('cred-c1') } });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ username: 'carol', hasPassword: false, passkeyCount: 1 });
      pkOnly = val(res, 'bv_session')!;
      expect((await req('GET', '/api/auth/me', { session: pkOnly })).statusCode).toBe(200);
      // un login par mot de passe ne marche pas pour ce compte
      const l = await req('POST', '/api/auth/login', { payload: { username: 'carol', password: 'nimporte-quoi-1' } });
      expect(l.statusCode).toBe(401);
    } finally { delete process.env.ALLOW_REGISTRATION; }
  });

  it('refuse de supprimer le dernier moyen de connexion sans mot de passe (409), puis OK après définition du mdp', async () => {
    const del = await req('DELETE', '/api/auth/passkey/cred-c1', { session: pkOnly });
    expect(del.statusCode).toBe(409);
    const setPw = await req('POST', '/api/auth/password', { session: pkOnly, payload: { newPassword: 'un-mot-de-passe-ok' } });
    expect(setPw.statusCode).toBe(200);
    expect(setPw.json().hasPassword).toBe(true);
    expect((await req('DELETE', '/api/auth/passkey/cred-c1', { session: pkOnly })).statusCode).toBe(204);
  });
});
