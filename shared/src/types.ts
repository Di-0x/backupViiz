/** Contrat de données partagé web <-> server. NE PAS modifier sans coordination (voir docs/SPEC.md). */

export const MEDIA_TYPES = ['disk', 'ssd', 'nas', 'tape', 'usb', 'cloud', 'object-storage', 'optical', 'other'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const LOCATIONS = ['onsite', 'offsite'] as const;
export type Location = (typeof LOCATIONS)[number];

export const NODE_KINDS = ['source', 'storage'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** Un noeud = une donnée d'origine (source) ou un support de sauvegarde (storage). */
export interface BackupNode {
  id: string;
  kind: NodeKind;
  label: string;
  mediaType: MediaType;
  /** onsite = même site que la source ; offsite = site distant / cloud distant. */
  location: Location;
  /** Copie immuable / WORM / air-gap (bonus 3-2-1-1-0, info uniquement). */
  immutable?: boolean;
  /** Chiffrement du support / des données (undefined = non renseigné). */
  encrypted?: boolean;
  /** Nom de machine (hostname). */
  hostname?: string;
  /** Adresse IP ou plage. */
  ip?: string;
  /** Données concernées (ex: « Bases SQL, /srv/files »). */
  data?: string;
  /** Fréquence de sauvegarde / réplication (ex: « Quotidien 02:00 »). */
  frequency?: string;
  /** Politique de rétention (ex: « 7 quotidiens, 4 hebdo, 12 mensuels »). */
  retention?: string;
  /** Date (YYYY-MM-DD) du dernier test de restauration réussi. */
  lastRestoreTestAt?: string;
  /** Alerte si aucun backup réussi n'a été reporté depuis N heures (support/cible uniquement). */
  staleAfterHours?: number;
  notes?: string;
  position: { x: number; y: number };
}

/** Un lien orienté = un job de sauvegarde / réplication de `from` vers `to`. */
export interface BackupEdge {
  id: string;
  from: string;
  to: string;
  /** ex: rsync, restic, borg, veeam, snapshot, réplication… */
  method?: string;
  /** ex: "Quotidien 02:00" */
  schedule?: string;
  notes?: string;
}

export interface StrategyDoc {
  nodes: BackupNode[];
  edges: BackupEdge[];
}

export type RuleId = '3' | '2' | '1' | 'structure' | 'immutable' | 'encryption' | 'restore' | 'freshness';
export type Severity = 'error' | 'warning' | 'info';

/** Statut réel reporté par un outil de backup (restic…) pour un noeud. Stocké côté serveur, hors `StrategyDoc`. */
export interface NodeStatus {
  tool: string; // 'restic'
  /** Dernier backup réussi (ISO) — issu du snapshot le plus récent si status 'ok'. */
  lastSuccessAt: string | null;
  lastStatus: 'ok' | 'failed';
  snapshotCount?: number;
  sizeBytes?: number;
  message?: string;
  reportedAt: string; // ISO
}

/** Correction proposée en un clic ; appliquée côté éditeur (undo possible). */
export type AlertFix =
  | { kind: 'add-storage'; fromId: string; label: string; mediaType: MediaType; location: Location }
  | { kind: 'connect'; fromId: string; toId: string };

export interface Alert {
  id: string;
  rule: RuleId;
  severity: Severity;
  /** Message FR lisible, actionnable. */
  message: string;
  /** Noeuds concernés (surlignage dans le diagramme). */
  nodeIds: string[];
  /** Source concernée (undefined = global). */
  sourceId?: string;
  /** Correction automatique proposée (si applicable). */
  fix?: AlertFix;
}

export interface SourceEvaluation {
  sourceId: string;
  /** Source elle-même + supports atteignables via chemins orientés. */
  copies: number;
  mediaTypes: MediaType[];
  offsiteCopies: number;
  reachableStorageIds: string[];
  /** copies>=3 */ ruleThree: boolean;
  /** >=2 types de supports distincts (source incluse) */ ruleTwo: boolean;
  /** >=1 copie offsite */ ruleOne: boolean;
  compliant: boolean;
}

export type ComplianceStatus = 'compliant' | 'warning' | 'violation' | 'empty';

export interface Evaluation {
  status: ComplianceStatus; // violation si ≥1 alerte error ; warning si ≥1 warning ; empty si aucune source
  sources: SourceEvaluation[];
  alerts: Alert[];
}

export interface Strategy extends StrategyDoc {
  id: string;
  name: string;
  description: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  evaluation: Evaluation; // calculé serveur (statuses pris en compte)
  /** Statuts réels reportés, par id de noeud. */
  statuses: Record<string, NodeStatus>;
}

export interface StrategySummary {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  nodeCount: number;
  edgeCount: number;
  status: ComplianceStatus;
  errorCount: number;
  warningCount: number;
}

export interface User {
  id: string;
  username: string;
  hasPassword: boolean;
  passkeyCount: number;
}

export interface StrategyVersionSummary {
  id: string;
  createdAt: string;
  name: string;
  nodeCount: number;
  edgeCount: number;
  /** 'auto' (enregistrement) | 'restore' (avant restauration) */
  reason: 'auto' | 'restore';
}

export interface ApiTokenInfo {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface PasskeyInfo {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ApiError {
  error: { code: string; message: string; fields?: Record<string, string> };
}
