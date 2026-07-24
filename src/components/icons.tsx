/**
 * Small, dependency-free line-icon set (stroke = currentColor) for Poise.
 * Replaces emoji so the UI reads consistently across platforms.
 */

interface IconProps {
  size?: number;
  className?: string;
}

function svg(size: number, className: string | undefined, children: React.ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const MicIcon = ({ size = 18, className }: IconProps) =>
  svg(
    size,
    className,
    <>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </>
  );

export const MicOffIcon = ({ size = 18, className }: IconProps) =>
  svg(
    size,
    className,
    <>
      <line x1="2" y1="2" x2="22" y2="22" />
      <path d="M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V4a3 3 0 0 0-5.9-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.1 1.2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </>
  );

export const VolumeIcon = ({ size = 18, className }: IconProps) =>
  svg(
    size,
    className,
    <>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
    </>
  );

export const VolumeOffIcon = ({ size = 18, className }: IconProps) =>
  svg(
    size,
    className,
    <>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </>
  );

export const CameraIcon = ({ size = 18, className }: IconProps) =>
  svg(
    size,
    className,
    <>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </>
  );

export const CameraOffIcon = ({ size = 18, className }: IconProps) =>
  svg(
    size,
    className,
    <>
      <line x1="2" y1="2" x2="22" y2="22" />
      <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m4-3h6l2 3h4a2 2 0 0 1 2 2v9.3m-7.7-2a4 4 0 1 1-5.6-5.6" />
    </>
  );

export const RepeatIcon = ({ size = 18, className }: IconProps) =>
  svg(
    size,
    className,
    <>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </>
  );

export const LipstickIcon = ({ size = 18, className }: IconProps) =>
  svg(
    size,
    className,
    <>
      <rect x="8" y="10" width="8" height="11" rx="1.5" />
      <path d="M9 10V6l4-3v7" />
    </>
  );

export const SparkleIcon = ({ size = 18, className }: IconProps) =>
  svg(
    size,
    className,
    <path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z" fill="currentColor" stroke="none" />
  );

export const HeartIcon = ({ size = 18, className }: IconProps) =>
  svg(
    size,
    className,
    <path
      d="M20.84 4.6a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"
      fill="currentColor"
      stroke="none"
    />
  );

export const CheckIcon = ({ size = 18, className }: IconProps) =>
  svg(size, className, <polyline points="20 6 9 17 4 12" />);

export const UserIcon = ({ size = 18, className }: IconProps) =>
  svg(
    size,
    className,
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  );

export const PlayIcon = ({ size = 18, className }: IconProps) =>
  svg(size, className, <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />);

export const HomeIcon = ({ size = 18, className }: IconProps) =>
  svg(
    size,
    className,
    <>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </>
  );

export const ShirtIcon = ({ size = 18, className }: IconProps) =>
  svg(
    size,
    className,
    <path d="M20 5l-4-2-1.2 1.2a4 4 0 0 1-5.6 0L8 3 4 5l2 4 2-1v11h8V8l2 1 2-4z" />
  );

export const GearIcon = ({ size = 18, className }: IconProps) =>
  svg(
    size,
    className,
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  );

export const TrendUpIcon = ({ size = 18, className }: IconProps) =>
  svg(
    size,
    className,
    <>
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </>
  );
