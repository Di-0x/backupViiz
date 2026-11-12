import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 128 * N * R * 2;

function scryptAsync(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  const opts: ScryptOptions = { N: n, r, p, maxmem: Math.max(MAXMEM, 256 * n * r) };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEYLEN, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Format : scrypt$N$r$p$salt$hash (base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts as [string, string, string, string, string, string];
  const nn = Number(n), rr = Number(r), pp = Number(p);
  if (!Number.isInteger(nn) || !Number.isInteger(rr) || !Number.isInteger(pp)) return false;
  const expected = Buffer.from(hash, 'base64');
  if (expected.length === 0) return false;
  let actual: Buffer;
  try {
    actual = await scrypt2(password, Buffer.from(salt, 'base64'), nn, rr, pp, expected.length);
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function scrypt2(password: string, salt: Buffer, n: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, keylen, { N: n, r, p, maxmem: Math.max(MAXMEM, 256 * n * r) }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

let dummy: Promise<string> | undefined;
/** Hash factice pour égaliser le temps de réponse quand l'utilisateur n'existe pas. */
export function dummyHash(): Promise<string> {
  return (dummy ??= hashPassword(randomBytes(12).toString('hex')));
}
