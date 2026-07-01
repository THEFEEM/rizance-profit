"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { FAQS } from "./data";
import { Reveal } from "./shared/Reveal";
import { eyebrowSm, focusRing, sectionPad, sectionTitle, wrap } from "./shared/ui";

export function FaqAccordion() {
  const [open, setOpen] = useState(0);

  return (
    <section className={`${sectionPad} pt-0`}>
      <div className={wrap}>
        <Reveal>
          <div className="mx-auto mb-12 text-center">
            <span className={eyebrowSm}>คำถามที่พบบ่อย</span>
            <h2 className={sectionTitle}>ยังไม่แน่ใจ? อ่านตรงนี้ก่อน</h2>
          </div>
        </Reveal>
        <Reveal delay={100}>
          <div className="mx-auto max-w-[720px]">
            {FAQS.map((f, i) => {
              const isOpen = open === i;
              return (
                <div key={f.q} className="border-b border-[var(--rz-border)]">
                  <button
                    type="button"
                    className={`flex min-h-[44px] w-full items-center justify-between gap-3 px-1 py-5 text-left text-[15px] font-semibold text-[var(--rz-text)] ${focusRing}`}
                    onClick={() => setOpen(isOpen ? -1 : i)}
                    aria-expanded={isOpen}
                  >
                    {f.q}
                    <ChevronDown
                      size={18}
                      aria-hidden="true"
                      className={`shrink-0 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
                        isOpen ? "rotate-180 text-[var(--rz-green)]" : "text-[var(--rz-muted)]"
                      }`}
                    />
                  </button>
                  <div
                    className={`grid transition-[grid-template-rows] duration-[350ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
                      isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <p className="px-1 pb-5 text-[14px] leading-[1.7] text-[var(--rz-muted)]">{f.a}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
