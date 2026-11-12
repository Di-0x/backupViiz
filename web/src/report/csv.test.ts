import { describe, expect, it } from 'vitest';
import type { BackupNode } from '@backupviiz/shared';
import { buildInventoryCsv, csvCell } from './csv';

const node = (o: Partial<BackupNode>): BackupNode => ({ id: 'a', kind: 'source', label: 'PC', mediaType: 'disk', location: 'onsite', position: { x: 0, y: 0 }, ...o });

describe('csv', () => {
  it('échappe ; guillemets et retours ligne', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('di"t')).toBe('"di""t"');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell('simple')).toBe('simple');
  });
  it('neutralise les formules', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('@cmd')).toBe("'@cmd");
  });
  it('BOM, en-tête et lignes', () => {
    const csv = buildInventoryCsv(
      [node({ label: 'Srv; "1"', hostname: 'srv1', encrypted: true }), node({ id: 'b', kind: 'storage', label: 'NAS', mediaType: 'nas' })],
      { a: { tool: 'restic', lastSuccessAt: '2026-01-02T03:04:05Z', lastStatus: 'ok', reportedAt: '2026-01-02T03:05:00Z' } },
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n') as [string, string, string, string];
    expect(lines[0].startsWith('Nom;Rôle;')).toBe(true);
    expect(lines[1]).toContain('"Srv; ""1"""');
    expect(lines[1]).toContain('srv1');
    expect(lines[1]).toContain('2026-01-02T03:04:05Z;OK');
    expect(lines[2]).toContain('NAS;Support');
    expect(lines.length).toBe(4);
    expect(lines[0].split(';').length).toBe(lines[2].split(';').length);
  });
});
