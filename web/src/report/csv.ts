import type { BackupNode, NodeStatus } from '@backupviiz/shared';
import { LOCATION_LABEL, MEDIA_META } from '../editor/panels';

/** Échappe une cellule CSV (séparateur `;`). Neutralise aussi l'injection de formules (=, +, -, @). */
export function csvCell(value: unknown): string {
  let s = value === undefined || value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_HEADERS = [
  'Nom',
  'Rôle',
  'Type de support',
  'Site',
  'Machine',
  'IP',
  'Données',
  'Fréquence',
  'Chiffrement',
  'Immuable',
  'Rétention',
  'Dernier test de restauration',
  'Dernier backup réel',
  'Statut réel',
  'Notes',
] as const;

const yesNo = (v: boolean | undefined) => (v === undefined ? 'Non renseigné' : v ? 'Oui' : 'Non');

export function statusLabel(st: NodeStatus | undefined): string {
  if (!st) return '';
  return st.lastStatus === 'ok' ? 'OK' : 'Échec';
}

/** Inventaire des noeuds en CSV : BOM UTF-8, séparateur `;`, fins de ligne CRLF. */
export function buildInventoryCsv(nodes: BackupNode[], statuses: Record<string, NodeStatus> = {}): string {
  const rows: unknown[][] = [[...CSV_HEADERS]];
  for (const n of nodes) {
    const st = statuses[n.id];
    rows.push([
      n.label,
      n.kind === 'source' ? 'Source' : 'Support',
      MEDIA_META[n.mediaType].label,
      LOCATION_LABEL[n.location],
      n.hostname,
      n.ip,
      n.data,
      n.frequency,
      yesNo(n.encrypted),
      yesNo(n.immutable),
      n.retention,
      n.lastRestoreTestAt,
      st?.lastSuccessAt ?? '',
      statusLabel(st),
      n.notes,
    ]);
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}
