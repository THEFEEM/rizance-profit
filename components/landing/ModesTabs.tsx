"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { MODES } from "./data";
import { Reveal } from "./shared/Reveal";
import { eyebrowSm, focusRing, sectionPad, sectionSub, sectionTitle, wrap } from "./shared/ui";

export function ModesTabs() {
  const [activeMode, setActiveMode] = useState(MODES[0].key);
  const active = MODES.find((m) => m.key === activeMode) ?? MODES[0];

  return (
    <section id="modes" className={sectionPad}>
      <div className={wrap}>
        <Reveal>
          <div className="mb-12">
            <span className={eyebrowSm}>โหมดการใช้งาน</span>
            <h2 className={sectionTitle}>เลือกโหมดที่ตรงกับสิ่งที่คุณทำ</h2>
            <p className={sectionSub}>ข้อมูลแต่ละโหมดแยกจากกันโดยสมบูรณ์ สลับใช้งานได้ทุกเมื่อ</p>
          </div>
        </Reveal>
        <Reveal delay={100}>
          <div className="grid grid-cols-1 gap-0 overflow-hidden rounded-[20px] border border-[var(--rz-border)] bg-[var(--rz-card)] p-2 md:grid-cols-[220px_1fr]">
            <div className="flex gap-0.5 overflow-x-auto p-2 max-md:flex-row md:flex-col" role="tablist" aria-label="โหมดการใช้งาน">
              {MODES.map((m) => {
                const isActive = activeMode === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    role="tab"
                    id={`mode-tab-${m.key}`}
                    aria-selected={isActive}
                    aria-controls="mode-panel"
                    className={`flex min-h-[44px] w-full items-center gap-2.5 whitespace-nowrap rounded-xl border-none px-3.5 py-3 text-left text-[14px] font-medium transition-[background,color,transform] duration-150 active:scale-[0.98] motion-reduce:transition-none ${focusRing} ${
                      isActive
                        ? "bg-[var(--rz-logo-bg)] text-[var(--rz-green)]"
                        : "bg-transparent text-[var(--rz-muted)] hover:bg-white/[0.03] hover:text-[var(--rz-text)]"
                    }`}
                    onClick={() => setActiveMode(m.key)}
                  >
                    <m.icon size={17} />
                    {m.label}
                  </button>
                );
              })}
            </div>
            <div
              id="mode-panel"
              role="tabpanel"
              aria-labelledby={`mode-tab-${active.key}`}
              className="flex min-h-[220px] flex-col justify-center p-6 md:p-12"
            >
              <div key={active.key} className="animate-rz-fade-up motion-reduce:animate-none">
                <div className="mb-3 font-serif text-[22px] font-semibold text-[var(--rz-text)]">{active.title}</div>
                <div className="max-w-[480px] text-[14.5px] leading-[1.8] text-[var(--rz-muted)]">{active.desc}</div>
                <Link
                  href="/register"
                  className={`mt-[18px] inline-flex items-center gap-1.5 rounded-md text-[13.5px] font-semibold text-[var(--rz-green)] ${focusRing}`}
                >
                  ลองใช้โหมด{active.label} <ChevronRight size={14} />
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
