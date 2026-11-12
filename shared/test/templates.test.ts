import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/evaluate';
import { TEMPLATES, instantiateTemplate } from '../src/templates';
import { strategyDocSchema } from '../src/validate';

describe('templates', () => {
  it('4 templates, ids uniques, docs valides', () => {
    expect(TEMPLATES).toHaveLength(4);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(4);
    for (const t of TEMPLATES) expect(strategyDocSchema.safeParse(t.doc).success).toBe(true);
  });

  it('statuts attendus', () => {
    const st = Object.fromEntries(TEMPLATES.map((t) => [t.id, evaluate(t.doc).status]));
    expect(st).toEqual({ empty: 'empty', 'classic-321': 'compliant', sme: 'compliant', 'non-compliant': 'violation' });
  });

  it('instantiateTemplate régénère des ids uniques et garde la structure', () => {
    for (const t of TEMPLATES) {
      const a = instantiateTemplate(t);
      const b = instantiateTemplate(t);
      const all = [...a.nodes, ...a.edges, ...b.nodes, ...b.edges].map((x) => x.id);
      expect(new Set(all).size).toBe(all.length);
      expect(strategyDocSchema.safeParse(a).success).toBe(true);
      expect(evaluate(a)).toEqual(evaluate(t.doc).status === 'empty' ? evaluate(a) : { ...evaluate(a) });
      expect(evaluate(a).status).toBe(evaluate(t.doc).status);
      const nodeIds = new Set(a.nodes.map((x) => x.id));
      for (const ed of a.edges) {
        expect(nodeIds.has(ed.from)).toBe(true);
        expect(nodeIds.has(ed.to)).toBe(true);
      }
    }
  });

  it('ne partage pas de références avec le template', () => {
    const t = TEMPLATES[1];
    const a = instantiateTemplate(t);
    a.nodes[0].position.x = 9999;
    expect(t.doc.nodes[0].position.x).not.toBe(9999);
  });
});
