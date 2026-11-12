import { api, ApiRequestError } from '../api/client';
import type { User } from '@backupviiz/shared';

// @simplewebauthn/browser est chargé à la demande pour garder le bundle initial minimal.
const lib = () => import('@simplewebauthn/browser');

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';
}

export async function conditionalUiAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  try {
    return (await PublicKeyCredential.isConditionalMediationAvailable?.()) === true;
  } catch {
    return false;
  }
}

/** Message FR pour une erreur WebAuthn / API ; null si l'utilisateur a simplement annulé. */
export function passkeyErrorMessage(e: unknown): string | null {
  if (e instanceof ApiRequestError) return e.message;
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'AbortError') return null;
  if (name === 'InvalidStateError') return 'Cette passkey est déjà enregistrée sur cet appareil.';
  if (name === 'SecurityError') return 'Les passkeys exigent HTTPS (ou localhost).';
  return 'La passkey n’a pas pu être utilisée.';
}

export async function loginWithPasskey(opts: { conditional?: boolean; username?: string } = {}): Promise<User> {
  const [{ startAuthentication }, optionsJSON] = await Promise.all([lib(), api.passkey.loginOptions(opts.username)]);
  const response = await startAuthentication({ optionsJSON: optionsJSON as never, useBrowserAutofill: opts.conditional });
  return api.passkey.loginVerify(response);
}

export async function signupWithPasskey(username: string): Promise<User> {
  const [{ startRegistration }, optionsJSON] = await Promise.all([lib(), api.passkey.signupOptions(username)]);
  const response = await startRegistration({ optionsJSON: optionsJSON as never });
  return api.passkey.signupVerify(response);
}

export async function addPasskey(name?: string) {
  const [{ startRegistration }, optionsJSON] = await Promise.all([lib(), api.passkey.registerOptions()]);
  const response = await startRegistration({ optionsJSON: optionsJSON as never });
  return api.passkey.registerVerify(response, name);
}
