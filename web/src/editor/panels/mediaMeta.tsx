import type { ReactNode } from 'react';
import type { Location, MediaType } from '@backupviiz/shared';

const svg = (children: ReactNode, size = 20): ReactNode => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

export const MEDIA_META: Record<MediaType, { label: string; icon: ReactNode }> = {
  disk: {
    label: 'Disque dur',
    icon: svg(
      <>
        <rect x="3" y="4" width="18" height="16" rx="2.5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="12" cy="12" r="0.8" fill="currentColor" />
        <path d="M17.5 7.5h.01" />
      </>,
    ),
  },
  ssd: {
    label: 'SSD',
    icon: svg(
      <>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M7 10v4M10 10v4M13 10v4" />
        <path d="M17 11l-1.5 2h3L17 15" />
      </>,
    ),
  },
  nas: {
    label: 'NAS',
    icon: svg(
      <>
        <rect x="3" y="3" width="18" height="7" rx="1.8" />
        <rect x="3" y="14" width="18" height="7" rx="1.8" />
        <path d="M7 6.5h.01M7 17.5h.01M12 6.5h5M12 17.5h5" />
      </>,
    ),
  },
  tape: {
    label: 'Bande (LTO)',
    icon: svg(
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="9" cy="12" r="2.5" />
        <circle cx="15" cy="12" r="2.5" />
        <path d="M9 14.5h6" />
      </>,
    ),
  },
  usb: {
    label: 'Clé / disque USB',
    icon: svg(
      <>
        <path d="M12 3v13" />
        <circle cx="12" cy="18.5" r="2.2" />
        <path d="M12 8l4 2v2.5M12 11l-4 2v1.5" />
        <rect x="14.8" y="12.5" width="2.4" height="2.4" />
        <circle cx="8" cy="15.6" r="1" />
      </>,
    ),
  },
  cloud: {
    label: 'Cloud',
    icon: svg(<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.8 8.6 4.8 4.8 0 0 1 17 18H7z" />),
  },
  'object-storage': {
    label: 'Stockage objet (S3)',
    icon: svg(
      <>
        <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
        <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
      </>,
    ),
  },
  optical: {
    label: 'Support optique',
    icon: svg(
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M12 6a6 6 0 0 1 6 6" />
      </>,
    ),
  },
  other: {
    label: 'Autre',
    icon: svg(
      <>
        <path d="M12 3l8 4v10l-8 4-8-4V7l8-4z" />
        <path d="M10 10a2 2 0 1 1 2.8 1.8c-.6.3-.8.7-.8 1.2M12 16h.01" />
      </>,
    ),
  },
};

export const LOCATION_LABEL: Record<Location, string> = {
  onsite: 'Sur site',
  offsite: 'Hors site',
};

export const METHOD_SUGGESTIONS: string[] = [
  'rsync', 'restic', 'borg', 'Veeam', 'Duplicati', 'rclone', 'Snapshot', 'Réplication', 'Time Machine', 'Copie manuelle',
];

export const SCHEDULE_SUGGESTIONS: string[] = [
  'Temps réel', 'Toutes les heures', 'Quotidien 02:00', 'Hebdomadaire (dimanche)', 'Mensuel', 'Manuel',
];
