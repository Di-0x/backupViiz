import type { NodeStatus } from '@backupviiz/shared';

export type StatusLevel = 'ok' | 'failed' | 'stale';
const DEFAULT_STALE_H = 72;

/** Durée relative en français (« il y a 3 h »). */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'date inconnue';
  const min = Math.max(0, Math.round((now.getTime() - t) / 60000));
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

export function formatSize(bytes?: number): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) (v /= 1024, i++);
  return `${i === 0 ? v : v.toFixed(1).replace('.', ',')} ${u[i]}`;
}

export interface StatusView {
  level: StatusLevel;
  text: string;
}

/** Pastille d'état : échec (rouge), ancien (orange), récent (vert). */
export function describeStatus(status: NodeStatus, staleAfterHours?: number, now: Date = new Date()): StatusView {
  if (status.lastStatus === 'failed') return { level: 'failed', text: 'Échec' };
  if (!status.lastSuccessAt) return { level: 'stale', text: 'Ancien' };
  const age = (now.getTime() - Date.parse(status.lastSuccessAt)) / 3600000;
  const rel = relativeTime(status.lastSuccessAt, now);
  if (age > (staleAfterHours ?? DEFAULT_STALE_H)) return { level: 'stale', text: `Ancien : ${rel}` };
  return { level: 'ok', text: `Backup ${rel}` };
}
