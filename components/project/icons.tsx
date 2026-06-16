import type { ReactNode } from "react";

type IconProps = { className?: string; size?: number };

function Svg({ size = 18, className, children }: { size?: number; className?: string; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      {children}
    </svg>
  );
}

export function BuildingStoreIcon({ className, size = 18 }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path
        d="M4 10h16l-1.5-5H5.5L4 10Zm0 0v10h16V10M9 14h6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function TentIcon({ className, size = 18 }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path
        d="M4 20h16M6 20 12 4l6 16M9 14h6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function ClipboardListIcon({ className, size = 18 }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="8" y="3" width="8" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M9 7h6v14H9V7ZM10 11h4M10 14h4M10 17h2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function CalendarEventIcon({ className, size = 18 }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="4" y="5" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="15" r="2" stroke="currentColor" strokeWidth="1.5" />
    </Svg>
  );
}

export function CalendarStatsIcon({ className, size = 18 }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="4" y="5" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 3v4M16 3v4M4 10h16M8 14v4M12 13v5M16 15v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  );
}

export function BuildingBankIcon({ className, size = 18 }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M4 10h16L12 4 4 10Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6 10v8M10 10v8M14 10v8M18 10v8M4 18h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  );
}

export function HeartHandshakeIcon({ className, size = 18 }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path
        d="M12 20s-6-4.5-6-9a3.5 3.5 0 0 1 6-2 3.5 3.5 0 0 1 6 2c0 4.5-6 9-6 9Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M8 12l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function UsersIcon({ className, size = 18 }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 19c0-3 2.5-5 6-5s6 2 6 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="17" cy="9" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M15 19c0-2 1.5-3.5 4-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  );
}

export function PencilIcon({ className, size = 18 }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path
        d="M4 20h4l10-10-4-4L4 16v4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function BuildingIcon({ className, size = 18 }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="5" y="3" width="14" height="18" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  );
}

export function SoupIcon({ className, size = 18 }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M4 12h16v2a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6v-2Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 12V9a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  );
}

export function BusIcon({ className, size = 18 }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="4" y="6" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 11h16M8 18h2M14 18h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  );
}

export function ToolsIcon({ className, size = 18 }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path
        d="M14 4l6 6-4 4-3-3-6 6-2-2 6-6-3-3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function FileTextIcon({ className, size = 18 }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M8 4h8l4 4v12H8V4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M16 4v4h4M10 12h6M10 16h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  );
}

export function TrophyIcon({ className, size = 18 }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M8 6h8v5a4 4 0 0 1-8 0V6Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 6H4v2a2 2 0 0 0 2 2M18 6h2v2a2 2 0 0 1-2 2M12 15v3M9 20h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  );
}

export function UserCheckIcon({ className, size = 18 }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="10" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 19c0-3 2.5-5 6-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M17 11l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function DotsIcon({ className, size = 18 }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="6" cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="18" cy="12" r="1.5" fill="currentColor" />
    </Svg>
  );
}

export type ProjectIconName =
  | "building-store"
  | "tent"
  | "clipboard-list"
  | "calendar-event"
  | "calendar-stats"
  | "building-bank"
  | "heart-handshake"
  | "users"
  | "pencil"
  | "building"
  | "soup"
  | "bus"
  | "tools"
  | "file-text"
  | "trophy"
  | "user-check"
  | "dots";

const ICON_MAP: Record<ProjectIconName, React.FC<IconProps>> = {
  "building-store": BuildingStoreIcon,
  tent: TentIcon,
  "clipboard-list": ClipboardListIcon,
  "calendar-event": CalendarEventIcon,
  "calendar-stats": CalendarStatsIcon,
  "building-bank": BuildingBankIcon,
  "heart-handshake": HeartHandshakeIcon,
  users: UsersIcon,
  pencil: PencilIcon,
  building: BuildingIcon,
  soup: SoupIcon,
  bus: BusIcon,
  tools: ToolsIcon,
  "file-text": FileTextIcon,
  trophy: TrophyIcon,
  "user-check": UserCheckIcon,
  dots: DotsIcon,
};

export function ProjectIcon({
  name,
  className,
  size = 18,
}: {
  name: ProjectIconName;
  className?: string;
  size?: number;
}) {
  const Cmp = ICON_MAP[name];
  return <Cmp className={className} size={size} />;
}

export function ProjectIconBox({
  name,
  color,
  bg,
  size = 28,
}: {
  name: ProjectIconName;
  color: string;
  bg: string;
  size?: number;
}) {
  const iconSize = Math.round(size * 0.57);
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-lg"
      style={{ width: size, height: size, backgroundColor: bg, color }}
    >
      <ProjectIcon name={name} size={iconSize} />
    </div>
  );
}
