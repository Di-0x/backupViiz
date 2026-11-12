import { z } from 'zod';
import { LOCATIONS, MEDIA_TYPES, NODE_KINDS } from './types';

export const MAX_NODES = 200;
export const MAX_EDGES = 500;

const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Identifiant invalide (lettres, chiffres, _ et - uniquement)');

const notesSchema = z.string().max(500, '500 caractères maximum');
const shortText = z.string().max(100, '100 caractères maximum');

export const backupNodeSchema = z.object({
  id: idSchema,
  kind: z.enum(NODE_KINDS),
  label: z.string().trim().min(1, 'Nom requis').max(80, '80 caractères maximum'),
  mediaType: z.enum(MEDIA_TYPES),
  location: z.enum(LOCATIONS),
  immutable: z.boolean().optional(),
  notes: notesSchema.optional(),
  position: z.object({
    x: z.number().finite().min(-1e6).max(1e6),
    y: z.number().finite().min(-1e6).max(1e6),
  }),
});

export const backupEdgeSchema = z.object({
  id: idSchema,
  from: idSchema,
  to: idSchema,
  method: shortText.optional(),
  schedule: shortText.optional(),
  notes: notesSchema.optional(),
});

export const strategyDocSchema = z.object({
  nodes: z.array(backupNodeSchema).max(MAX_NODES, `${MAX_NODES} éléments maximum`),
  edges: z.array(backupEdgeSchema).max(MAX_EDGES, `${MAX_EDGES} liens maximum`),
});

const nameSchema = z.string().trim().min(1, 'Nom requis').max(100, '100 caractères maximum');
const descriptionSchema = z.string().max(500, '500 caractères maximum');

export const createStrategySchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
  doc: strategyDocSchema.optional(),
});

export const updateStrategySchema = z.object({
  name: nameSchema.optional(),
  description: descriptionSchema.optional(),
  doc: strategyDocSchema.optional(),
});

export type CreateStrategyInput = z.infer<typeof createStrategySchema>;
export type UpdateStrategyInput = z.infer<typeof updateStrategySchema>;
