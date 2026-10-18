interface LogoProps {
  size?: number;
}

/** App mark: a purple rounded square with a play triangle and a timeline bar. */
export function Logo({ size = 32 }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" role="img" aria-label="Auto Video Editor">
      <defs>
        <linearGradient id="logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#6d28d9" />
        </linearGradient>
      </defs>
      <rect x="64" y="64" width="896" height="896" rx="208" fill="url(#logo-bg)" />
      <path d="M400 296 L400 600 L676 448 Z" fill="#ffffff" />
      <rect x="216" y="716" width="592" height="56" rx="28" fill="#ffffff" fillOpacity="0.35" />
      <rect x="216" y="716" width="300" height="56" rx="28" fill="#ffffff" />
    </svg>
  );
}
