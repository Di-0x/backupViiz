import type { Location, MediaType, NodeKind } from '@backupviiz/shared';

export interface PaletteItem {
  kind: NodeKind;
  mediaType: MediaType;
  location: Location;
  label: string;
}

export const SOURCE_ITEMS: PaletteItem[] = [
  { kind: 'source', mediaType: 'disk', location: 'onsite', label: 'PC / Serveur' },
  { kind: 'source', mediaType: 'ssd', location: 'onsite', label: 'Poste (SSD)' },
  { kind: 'source', mediaType: 'nas', location: 'onsite', label: 'NAS source' },
  { kind: 'source', mediaType: 'cloud', location: 'offsite', label: 'Données cloud' },
];

export const STORAGE_ITEMS: PaletteItem[] = [
  { kind: 'storage', mediaType: 'disk', location: 'onsite', label: 'Disque de sauvegarde' },
  { kind: 'storage', mediaType: 'ssd', location: 'onsite', label: 'SSD de sauvegarde' },
  { kind: 'storage', mediaType: 'nas', location: 'onsite', label: 'NAS' },
  { kind: 'storage', mediaType: 'usb', location: 'onsite', label: 'Disque USB' },
  { kind: 'storage', mediaType: 'tape', location: 'offsite', label: 'Bande' },
  { kind: 'storage', mediaType: 'cloud', location: 'offsite', label: 'Cloud' },
  { kind: 'storage', mediaType: 'object-storage', location: 'offsite', label: 'Stockage objet' },
  { kind: 'storage', mediaType: 'optical', location: 'offsite', label: 'Disque optique' },
  { kind: 'storage', mediaType: 'other', location: 'onsite', label: 'Autre support' },
];

export const DRAG_MIME = 'application/x-backupviiz-node';
