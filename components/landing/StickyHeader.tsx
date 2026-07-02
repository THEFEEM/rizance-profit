"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { Menu, X, ArrowRight } from "lucide-react";
import { btnPrimary, focusRing } from "./shared/ui";

const NAV = [
  { label: "ฟีเจอร์", href: "#features" },
  { label: "โหมดการใช้งาน", href: "#modes" },
  { label: "แพ็กเกจ", href: "#pricing" },
  { label: "ติดต่อ", href: "#contact" },
];

export function StickyHeader() {
  const [navOpen, setNavOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          setScrolled(window.scrollY > 24);
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 border-b transition-[background,border-color,backdrop-filter] duration-300 ${
        scrolled
          ? "border-[var(--rz-border)] bg-[rgba(14,21,37,0.82)] backdrop-blur-[14px]"
          : "border-transparent bg-transparent"
      }`}
    >
      <div className="relative z-10 mx-auto max-w-[1200px] px-6">
        <nav className="flex items-center justify-between py-[18px]">
          <Link href="/" className={`flex items-center gap-2.5 font-serif text-xl font-bold rounded-md ${focusRing}`}>
            <span className="flex h-[34px] w-[34px] items-center justify-center overflow-hidden rounded-[10px] border-[0.5px] border-[var(--rz-logo-border)] bg-[var(--rz-logo-bg)]">
              <Image src="/Logo.png" alt="Rizance" width={22} height={22} priority style={{ objectFit: "contain" }} />
            </span>
            Rizance
          </Link>

          <div className="hidden items-center gap-8 md:flex">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className={`rounded-md text-[14.5px] text-[var(--rz-muted)] transition-colors hover:text-[var(--rz-text)] ${focusRing}`}
              >
                {n.label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-6">
            <Link
              href="/login"
              className={`hidden rounded-md text-[14.5px] text-[var(--rz-muted)] transition-colors hover:text-[var(--rz-text)] md:inline ${focusRing}`}
            >
              เข้าสู่ระบบ
            </Link>
            <Link href="/register" className={btnPrimary}>
              เริ่มใช้ฟรี <ArrowRight size={15} />
            </Link>
            <button
              type="button"
              className={`flex text-[var(--rz-text)] md:hidden ${focusRing} rounded-md`}
              onClick={() => setNavOpen((v) => !v)}
              aria-label="เมนู"
              aria-expanded={navOpen}
            >
              {navOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </nav>

        {navOpen && (
          <div className="mt-1.5 flex flex-col gap-0.5 border-t border-[var(--rz-border)] pt-2 pb-6 md:hidden">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                onClick={() => setNavOpen(false)}
                className={`flex min-h-[44px] items-center border-b border-[var(--rz-border)] px-1 py-3.5 text-[var(--rz-muted)] transition-colors hover:text-[var(--rz-text)] ${focusRing}`}
              >
                {n.label}
              </a>
            ))}
            <Link
              href="/login"
              onClick={() => setNavOpen(false)}
              className={`flex min-h-[44px] items-center px-1 py-3.5 text-[var(--rz-muted)] transition-colors hover:text-[var(--rz-text)] ${focusRing}`}
            >
              เข้าสู่ระบบ
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
