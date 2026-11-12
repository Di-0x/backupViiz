export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <g fill="none" stroke="var(--accent-contrast)" strokeWidth="2" strokeLinecap="round">
        <path d="M9 11h6a4 4 0 0 1 4 4v0a4 4 0 0 0 4 4h1" />
        <path d="M9 21h6" opacity=".7" />
      </g>
      <circle cx="9" cy="11" r="2.5" fill="var(--accent-contrast)" />
      <circle cx="9" cy="21" r="2.5" fill="var(--accent-contrast)" opacity=".7" />
      <circle cx="24" cy="19" r="2.5" fill="var(--accent-contrast)" />
    </svg>
  );
}
