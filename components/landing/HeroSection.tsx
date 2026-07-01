"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, ArrowRight, Check, TrendingUp, Bell } from "lucide-react";
import { EXAMPLES } from "./data";
import { btnGhost, btnPrimary } from "./shared/ui";

const heroIn =
  "opacity-0 animate-rz-fade-up motion-reduce:animate-none motion-reduce:opacity-100";

type Phase = "typing" | "thinking" | "reveal" | "hold" | "fade";

export function HeroSection() {
  const [exIdx, setExIdx] = useState(0);
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<Phase>("typing");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    const current = EXAMPLES[exIdx].user;
    clearTimer();
    if (phase === "typing") {
      if (typed.length < current.length) {
        timerRef.current = setTimeout(() => setTyped(current.slice(0, typed.length + 1)), 45);
      } else {
        timerRef.current = setTimeout(() => setPhase("thinking"), 450);
      }
    } else if (phase === "thinking") {
      timerRef.current = setTimeout(() => setPhase("reveal"), 750);
    } else if (phase === "reveal") {
      timerRef.current = setTimeout(() => setPhase("hold"), 1700);
    } else if (phase === "hold") {
      timerRef.current = setTimeout(() => setPhase("fade"), 900);
    } else if (phase === "fade") {
      timerRef.current = setTimeout(() => {
        setTyped("");
        setExIdx((i) => (i + 1) % EXAMPLES.length);
        setPhase("typing");
      }, 500);
    }
    return clearTimer;
  }, [phase, typed, exIdx, clearTimer]);

  const ex = EXAMPLES[exIdx];
  const showAi = phase === "reveal" || phase === "hold" || phase === "fade";
  const fading = phase === "fade";

  return (
    <div className="relative z-10 mx-auto max-w-[1200px] px-6">
      <div className="grid grid-cols-1 items-center gap-12 pt-8 pb-12 text-center lg:grid-cols-[1.05fr_0.95fr] lg:gap-[96px] lg:pt-16 lg:pb-24 lg:text-left">
        {/* Copy column */}
        <div>
          <span
            className={`mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--rz-logo-border)] bg-[var(--rz-logo-bg)] px-[13px] py-[7px] text-[12.5px] font-semibold tracking-[1.6px] text-[var(--rz-green)] ${heroIn}`}
            style={{ animationDelay: "60ms" }}
          >
            <Sparkles size={13} /> RIZQ — ผู้ช่วยบัญชี AI
          </span>
          <h1
            className={`mb-6 font-serif text-[clamp(34px,4.6vw,56px)] font-bold leading-[1.14] tracking-[-0.01em] text-[var(--rz-text)] ${heroIn}`}
            style={{ animationDelay: "120ms" }}
          >
            จดบัญชี
            <br />
            ด้วย<span className="text-[var(--rz-green)]">ประโยคเดียว</span>
          </h1>
          <p
            className={`mx-auto mb-8 max-w-[480px] text-[17px] leading-[1.75] text-[var(--rz-muted)] lg:mx-0 ${heroIn}`}
            style={{ animationDelay: "200ms" }}
          >
            พิมพ์สิ่งที่ขาย สิ่งที่จ่าย เหมือนคุยกับเพื่อน แล้วปล่อยให้ Rizq จัดหมวดหมู่ คำนวณกำไร
            และสรุปตัวเลขให้ทั้งหมด
          </p>
          <div
            className={`mb-6 flex flex-wrap items-center justify-center gap-4 lg:justify-start ${heroIn}`}
            style={{ animationDelay: "260ms" }}
          >
            <Link href="/register" className={btnPrimary}>
              เริ่มใช้ฟรี <ArrowRight size={15} />
            </Link>
            <a href="#features" className={btnGhost}>
              ดูวิธีใช้งาน
            </a>
          </div>
          <div
            className={`flex items-center justify-center gap-2 text-[13px] text-[var(--rz-muted)] lg:justify-start ${heroIn}`}
            style={{ animationDelay: "320ms" }}
          >
            ไม่ต้องผูกบัตร <span className="h-1 w-1 rounded-full bg-[var(--rz-muted)]" /> เริ่มใช้ได้ใน 30 วินาที
          </div>
        </div>

        {/* Phone mockup column */}
        <div className="relative flex justify-center py-12">
          <div
            className="absolute top-[6%] left-[-4%] z-[3] flex animate-rz-float-a items-center gap-2.5 rounded-[14px] border border-[var(--rz-border)] bg-[var(--rz-card)] px-3.5 py-3 shadow-[0_16px_34px_-12px_rgba(0,0,0,0.55)] motion-reduce:animate-none max-lg:hidden"
            aria-hidden="true"
          >
            <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-[var(--rz-logo-bg)] text-[var(--rz-green)]">
              <TrendingUp size={16} />
            </span>
            <div>
              <div className="text-[10.5px] text-[var(--rz-muted)]">กำไรเดือนนี้</div>
              <div className="font-mono text-[15px] font-semibold text-[var(--rz-text)]">฿12,480</div>
            </div>
          </div>

          <div className="relative z-[2] w-[320px] rounded-[34px] border border-[#1c2942] bg-[#050a14] p-3.5 shadow-[0_30px_70px_-20px_rgba(0,0,0,0.65)]">
            <div className="mx-auto mb-3 h-1.5 w-[90px] rounded-md bg-[#1c2942]" />
            <div className="flex min-h-[400px] flex-col rounded-[22px] bg-[var(--rz-card)] px-4 pt-5 pb-[22px]">
              <div className="mb-[18px] flex items-center gap-2.5 border-b border-[var(--rz-border)] pb-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[var(--rz-green)] to-[var(--rz-btn)] text-[var(--rz-bg)]">
                  <Sparkles size={15} />
                </div>
                <div>
                  <div className="text-[13.5px] font-semibold text-[var(--rz-text)]">Rizq</div>
                  <div className="text-[11px] text-[var(--rz-muted)]">ผู้ช่วยบัญชี AI</div>
                </div>
              </div>

              <div className="mb-3.5 flex min-h-[38px] justify-end">
                <div className="max-w-[86%] rounded-[14px_14px_3px_14px] bg-[var(--rz-green)] px-3.5 py-2.5 text-[13.5px] font-medium leading-[1.5] text-[var(--rz-bg)]">
                  {typed}
                  {phase === "typing" && (
                    <span className="ml-0.5 inline-block h-[13px] w-0.5 -translate-y-px animate-rz-blink bg-[var(--rz-bg)] align-[-2px] motion-reduce:animate-none" />
                  )}
                </div>
              </div>

              {phase === "thinking" && (
                <div className="mb-3.5 flex w-fit gap-1.5 rounded-[14px_14px_14px_3px] bg-[var(--rz-elevated)] px-3.5 py-[11px]">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 animate-rz-bounce-dot rounded-full bg-[var(--rz-muted)] motion-reduce:animate-none"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              )}

              {showAi && (
                <div
                  className={`max-w-[88%] rounded-[14px_14px_14px_3px] border border-[var(--rz-border)] bg-[var(--rz-elevated)] px-4 py-3.5 transition-[opacity,transform] duration-[380ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
                    fading ? "-translate-y-1 scale-[0.98] opacity-0" : "translate-y-0 scale-100 opacity-100"
                  }`}
                >
                  <div className="mb-2 flex items-center gap-1.5">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--rz-logo-bg)]">
                      <Check size={10} color="#4ADE9E" />
                    </span>
                    <span className="text-[11.5px] font-semibold text-[var(--rz-green)]">บันทึกแล้ว</span>
                  </div>
                  <span
                    className={`mb-2 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                      ex.sign === "pos"
                        ? "bg-[var(--rz-logo-bg)] text-[var(--rz-green)]"
                        : "bg-[rgba(248,113,113,0.12)] text-[var(--rz-red)]"
                    }`}
                  >
                    {ex.kind}
                  </span>
                  <div className="mb-0.5 text-[11px] text-[var(--rz-muted)]">{ex.cat}</div>
                  <div
                    className={`font-mono text-[22px] font-semibold ${
                      ex.sign === "pos" ? "text-[var(--rz-green)]" : "text-[var(--rz-red)]"
                    }`}
                  >
                    {ex.amount}
                  </div>
                </div>
              )}

              <div className="mt-auto flex items-center gap-2 rounded-full border border-[var(--rz-border)] bg-[var(--rz-elevated)] px-3.5 py-2.5">
                <span className="flex-1 text-[12px] text-[var(--rz-placeholder)]">พิมพ์ เช่น ซื้อกาแฟ 100</span>
                <span className="h-[26px] w-[26px] shrink-0 rounded-full bg-[var(--rz-green)]" />
              </div>
            </div>
          </div>

          <div
            className="absolute bottom-[10%] right-[-6%] z-[3] flex animate-rz-float-b items-center gap-2 rounded-[14px] border border-[var(--rz-border)] bg-[var(--rz-card)] px-3.5 py-3 shadow-[0_16px_34px_-12px_rgba(0,0,0,0.55)] motion-reduce:animate-none max-lg:hidden"
            aria-hidden="true"
          >
            <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-[var(--rz-logo-bg)] text-[var(--rz-green)]">
              <Bell size={16} />
            </span>
            <span className="text-[12px] font-medium text-[var(--rz-text)]">บันทึกสำเร็จ ✓</span>
          </div>
        </div>
      </div>
    </div>
  );
}
