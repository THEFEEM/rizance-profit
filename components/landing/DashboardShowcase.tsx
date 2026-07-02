import { Sparkles, ArrowUpRight, Check } from "lucide-react";
import { MODES } from "./data";
import { Reveal } from "./shared/Reveal";
import { Counter } from "./shared/Counter";
import { MiniChart } from "./shared/MiniChart";
import { eyebrowSm, sectionPad, sectionSub, sectionTitle, wrap } from "./shared/ui";

export function DashboardShowcase() {
  return (
    <section className={`${sectionPad} pt-0`}>
      <div className={wrap}>
        <Reveal>
          <div className="mb-12">
            <span className={eyebrowSm}>ภาพรวมธุรกิจ</span>
            <h2 className={sectionTitle}>เห็นตัวเลขจริง ไม่ใช่แค่บันทึกไว้เฉยๆ</h2>
            <p className={sectionSub}>Rizq สรุปกำไร แนวโน้ม และข้อสังเกตให้ทุกวัน อ่านแล้วตัดสินใจได้ทันที</p>
          </div>
        </Reveal>
        <Reveal delay={100}>
          <div className="relative py-8">
            <div className="relative z-[2] overflow-hidden rounded-[18px] border border-[var(--rz-border)] bg-[var(--rz-card)] shadow-[0_40px_80px_-30px_rgba(0,0,0,0.6)]">
              <div className="flex items-center gap-1.5 border-b border-[var(--rz-border)] bg-[var(--rz-elevated)] px-[18px] py-3.5">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-[9px] w-[9px] rounded-full bg-[var(--rz-border)]" />
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[180px_1fr]">
                <div className="hidden flex-col gap-1 border-r border-[var(--rz-border)] px-4 py-6 md:flex">
                  {MODES.map((m) => (
                    <div
                      key={m.key}
                      className={`flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] ${
                        m.key === "shop"
                          ? "bg-[var(--rz-logo-bg)] font-semibold text-[var(--rz-green)]"
                          : "text-[var(--rz-muted)]"
                      }`}
                    >
                      <m.icon size={16} />
                      {m.label}
                    </div>
                  ))}
                </div>
                <div className="p-8">
                  <div className="mb-6 flex flex-wrap items-center justify-between gap-2.5">
                    <span className="text-[14px] text-[var(--rz-muted)]">ภาพรวมสัปดาห์นี้</span>
                  </div>
                  <div className="mb-8 flex flex-wrap items-baseline gap-3">
                    <Counter
                      target={12480}
                      prefix="฿"
                      numClassName="text-[36px] font-semibold text-[var(--rz-green)]"
                    />
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--rz-logo-bg)] px-2.5 py-1 text-[12.5px] font-semibold text-[var(--rz-green)]">
                      <ArrowUpRight size={13} /> +18%
                    </span>
                  </div>
                  <MiniChart />
                  <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-[var(--rz-border)] bg-[var(--rz-elevated)] px-4 py-3.5">
                    <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-[var(--rz-logo-bg)] text-[var(--rz-green)]">
                      <Sparkles size={15} />
                    </span>
                    <p className="text-[13px] leading-[1.6] text-[var(--rz-muted)]">
                      <b className="font-semibold text-[var(--rz-text)]">Rizq:</b> กำไรสัปดาห์นี้ดีขึ้น 18%
                      จากสัปดาห์ก่อน ส่วนใหญ่มาจากยอดขายวันเสาร์ที่เพิ่มขึ้น
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="z-[3] flex items-center gap-2.5 rounded-[14px] border border-[var(--rz-border)] bg-[var(--rz-card)] px-4 py-3 shadow-[0_20px_40px_-14px_rgba(0,0,0,0.6)] max-md:mt-4 md:absolute md:bottom-[-18px] md:right-[-16px] md:animate-rz-float-b md:motion-reduce:animate-none">
              <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-[var(--rz-logo-bg)] text-[var(--rz-green)]">
                <Check size={16} />
              </span>
              <span className="text-[12px] font-medium text-[var(--rz-text)]">ปิดยอดวันนี้แล้ว</span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
