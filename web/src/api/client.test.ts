import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiRequestError, setUnauthorizedHandler } from './client';

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

describe('api client', () => {
  it('envoie JSON avec credentials same-origin et parse la réponse', async () => {
    const fn = mockFetch(200, { id: 'u1', username: 'a', hasPassword: true, passkeyCount: 0 });
    const u = await api.auth.login('a', 'secret-password');
    expect(u.username).toBe('a');
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/login');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(JSON.parse(init.body as string)).toEqual({ username: 'a', password: 'secret-password' });
  });

  it('gère 204 sans corps', async () => {
    mockFetch(204);
    await expect(api.strategies.remove('x/y')).resolves.toBeUndefined();
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe('/api/strategies/x%2Fy');
  });

  it("parse ApiError (code, message, fields)", async () => {
    mockFetch(400, { error: { code: 'validation', message: 'Invalide', fields: { name: 'requis' } } });
    const err = await api.strategies.create({ name: '' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 400, code: 'validation', message: 'Invalide', fields: { name: 'requis' } });
  });

  it('appelle le handler 401 sauf sur les routes publiques', async () => {
    const h = vi.fn();
    setUnauthorizedHandler(h);
    mockFetch(401, { error: { code: 'unauthorized', message: 'Non connecté' } });
    await api.strategies.list().catch(() => {});
    expect(h).toHaveBeenCalledTimes(1);
    await api.auth.login('a', 'b').catch(() => {});
    await api.auth.me().catch(() => {});
    expect(h).toHaveBeenCalledTimes(1);
  });

  it('convertit une panne réseau en erreur typée', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fail'); }));
    await expect(api.strategies.list()).rejects.toMatchObject({ status: 0, code: 'network' });
  });
});
