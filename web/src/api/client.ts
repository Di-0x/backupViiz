import type { ApiError, ApiTokenInfo, PasskeyInfo, StrategyVersionSummary, Strategy, StrategyDoc, StrategySummary, User } from '@backupviiz/shared';

/** Erreur API typée (parse `{ error: { code, message, fields? } }`). */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;
  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;
/** Enregistré par le contexte d'auth : appelé sur 401 (hors routes d'auth publiques). */
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null): void {
  onUnauthorized = fn;
}

const PUBLIC_PATHS = ['/api/auth/login', '/api/auth/register', '/api/auth/me', '/api/auth/config', '/api/auth/passkey/login/', '/api/auth/passkey/signup/'];

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiRequestError(0, 'network', 'Réseau indisponible. Vérifiez votre connexion.');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }
  if (!res.ok) {
    const err = (data as ApiError | undefined)?.error;
    if (res.status === 401 && onUnauthorized && !PUBLIC_PATHS.some((p) => path.startsWith(p))) onUnauthorized();
    throw new ApiRequestError(
      res.status,
      err?.code ?? `http_${res.status}`,
      err?.message ?? (res.status === 429 ? 'Trop de tentatives, réessayez dans un instant.' : `Erreur inattendue (${res.status}).`),
      err?.fields,
    );
  }
  return data as T;
}

const get = <T>(p: string) => request<T>('GET', p);
const post = <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {});

export interface ExportFile {
  version: 1;
  name: string;
  description: string;
  doc: StrategyDoc;
}

// Les réponses WebAuthn sont opaques côté client : on les type en `unknown`.
export const api = {
  auth: {
    config: () => get<{ registrationOpen: boolean }>('/api/auth/config'),
    me: () => get<User>('/api/auth/me'),
    login: (username: string, password: string) => post<User>('/api/auth/login', { username, password }),
    register: (username: string, password: string) => post<User>('/api/auth/register', { username, password }),
    logout: () => post<void>('/api/auth/logout'),
    setPassword: (input: { currentPassword?: string; newPassword: string }) => post<void>('/api/auth/password', input),
  },
  passkey: {
    list: () => get<PasskeyInfo[]>('/api/auth/passkey'),
    registerOptions: () => post<unknown>('/api/auth/passkey/register/options'),
    registerVerify: (response: unknown, name?: string) => post<PasskeyInfo>('/api/auth/passkey/register/verify', { response, name }),
    loginOptions: (username?: string) => post<unknown>('/api/auth/passkey/login/options', username ? { username } : {}),
    loginVerify: (response: unknown) => post<User>('/api/auth/passkey/login/verify', { response }),
    signupOptions: (username: string) => post<unknown>('/api/auth/passkey/signup/options', { username }),
    signupVerify: (response: unknown) => post<User>('/api/auth/passkey/signup/verify', { response }),
    rename: (id: string, name: string) => request<PasskeyInfo>('PATCH', `/api/auth/passkey/${encodeURIComponent(id)}`, { name }),
    remove: (id: string) => request<void>('DELETE', `/api/auth/passkey/${encodeURIComponent(id)}`),
  },
  tokens: {
    list: () => get<ApiTokenInfo[]>('/api/tokens'),
    /** Le jeton en clair n'est renvoyé qu'à la création. */
    create: (name: string) => post<ApiTokenInfo & { token: string }>('/api/tokens', { name }),
    remove: (id: string) => request<void>('DELETE', `/api/tokens/${encodeURIComponent(id)}`),
  },
  strategies: {
    list: () => get<StrategySummary[]>('/api/strategies'),
    get: (id: string) => get<Strategy>(`/api/strategies/${encodeURIComponent(id)}`),
    create: (input: { name: string; description?: string; doc?: StrategyDoc }) => post<Strategy>('/api/strategies', input),
    update: (id: string, input: { name?: string; description?: string; doc?: StrategyDoc }) =>
      request<Strategy>('PUT', `/api/strategies/${encodeURIComponent(id)}`, input),
    remove: (id: string) => request<void>('DELETE', `/api/strategies/${encodeURIComponent(id)}`),
    duplicate: (id: string) => post<Strategy>(`/api/strategies/${encodeURIComponent(id)}/duplicate`),
    export: (id: string) => get<ExportFile>(`/api/strategies/${encodeURIComponent(id)}/export`),
    versions: (id: string) => get<StrategyVersionSummary[]>(`/api/strategies/${encodeURIComponent(id)}/versions`),
    version: (id: string, vid: string) =>
      get<{ id: string; createdAt: string; name: string; description: string; doc: StrategyDoc }>(`/api/strategies/${encodeURIComponent(id)}/versions/${encodeURIComponent(vid)}`),
    restoreVersion: (id: string, vid: string) =>
      post<Strategy>(`/api/strategies/${encodeURIComponent(id)}/versions/${encodeURIComponent(vid)}/restore`),
    import: (input: { name?: string; description?: string; doc: StrategyDoc }) => post<Strategy>('/api/strategies/import', input),
  },
};
