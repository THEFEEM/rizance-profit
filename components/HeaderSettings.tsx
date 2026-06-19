import Link from "next/link";

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M19.4 13.5a7.4 7.4 0 0 0 .1-3l2-1.2-2-3.5-2.3.7a7.6 7.6 0 0 0-2.6-1.5l-.4-2.4H9.8l-.4 2.4a7.6 7.6 0 0 0-2.6 1.5l-2.3-.7-2 3.5 2 1.2a7.4 7.4 0 0 0-.1 3l-2 1.2 2 3.5 2.3-.7c.8.6 1.7 1.1 2.6 1.5l.4 2.4h4.4l.4-2.4c.9-.4 1.8-.9 2.6-1.5l2.3.7 2-3.5-2-1.2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HeaderSettings() {
  return (
    <Link
      href="/profile"
      aria-label="โปรไฟล์และตั้งค่า"
      className="tap-target flex h-11 w-11 items-center justify-center rounded-full text-rz-hint active:bg-rz-elevated"
    >
      <GearIcon />
    </Link>
  );
}
