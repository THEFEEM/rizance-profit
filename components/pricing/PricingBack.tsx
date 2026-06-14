import Link from "next/link";

export function PricingBack({ href = "/pricing", label = "← กลับ" }: { href?: string; label?: string }) {
  return (
    <Link
      href={href}
      className="tap-target inline-flex px-4 py-3 text-sm font-medium text-rz-hint active:text-rz-muted"
    >
      {label}
    </Link>
  );
}
