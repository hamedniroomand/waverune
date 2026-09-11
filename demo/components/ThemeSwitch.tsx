import type { ReactNode } from 'react';

import { THEMES, type Theme } from '../theme';

interface ThemeSwitchProps {
  theme: Theme;
  onChange: (theme: Theme) => void;
}

const LABELS: Record<Theme, string> = {
  system: 'System theme',
  light: 'Light theme',
  dark: 'Dark theme',
};

export function ThemeSwitch({ theme, onChange }: ThemeSwitchProps) {
  return (
    <div
      className="theme-switch"
      role="group"
      aria-label="Theme"
    >
      {THEMES.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={theme === option}
          aria-label={LABELS[option]}
          title={LABELS[option]}
          onClick={() => onChange(option)}
        >
          {ICONS[option]}
        </button>
      ))}
    </div>
  );
}

const iconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

const ICONS: Record<Theme, ReactNode> = {
  system: (
    <svg {...iconProps}>
      <rect
        x="3"
        y="4"
        width="18"
        height="12"
        rx="2"
      />
      <path d="M8 20h8M12 16v4" />
    </svg>
  ),
  light: (
    <svg {...iconProps}>
      <circle
        cx="12"
        cy="12"
        r="4"
      />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  dark: (
    <svg {...iconProps}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  ),
};
