import Link from "next/link";

export function BoothBack({ href = "/", label = "← กลับ" }: { href?: string; label?: string }) {
  return (
    <Link href={href} className="tap-target inline-flex px-4 py-3 text-sm font-medium text-slate-500">
      {label}
    </Link>
  );
}
