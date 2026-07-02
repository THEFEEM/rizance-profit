import Link from "next/link";
import { Check } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { PLANS } from "./data";
import { PlanButton } from "./PlanButton";
import { Reveal } from "./shared/Reveal";
import { btnGhost, btnPrimary, eyebrowSm, sectionPad, sectionSub, sectionTitle, wrap } from "./shared/ui";

export async function PricingPreview() {
  const user = await getCurrentUser();
  const isLoggedIn = Boolean(user);

  return (
    <section id="pricing" className={sectionPad}>
      <div className={wrap}>
        <Reveal>
          <div className="mx-auto mb-12 text-center">
            <span className={eyebrowSm}>แพ็กเกจ</span>
            <h2 className={sectionTitle}>เริ่มต้นฟรี อัพเกรดเมื่อพร้อม</h2>
            <p className={`${sectionSub} mx-auto`}>ไม่มีค่าใช้จ่ายแอบแฝง ยกเลิกเมื่อไหร่ก็ได้</p>
          </div>
        </Reveal>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((p, i) => (
            <Reveal key={p.name} delay={i * 70}>
              <div
                className={`relative flex h-full flex-col rounded-[18px] border p-6 transition-[transform,border-color,box-shadow] duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
                  p.highlight
                    ? "border-[rgba(74,222,158,0.55)] bg-[linear-gradient(180deg,rgba(74,222,158,0.07),transparent_45%),var(--rz-card)] animate-rz-pulse-glow motion-reduce:animate-none"
                    : "border-[var(--rz-border)] bg-[var(--rz-card)] hover:-translate-y-1 hover:border-[#2c3a5e] hover:shadow-[0_24px_44px_-20px_rgba(0,0,0,0.5)] motion-reduce:hover:translate-y-0"
                }`}
              >
                {p.tag && (
                  <span className="absolute -top-[11px] right-5 rounded-full bg-[var(--rz-green)] px-2.5 py-1 text-[11px] font-bold text-[var(--rz-bg)]">
                    {p.tag}
                  </span>
                )}
                <div className="mb-4 text-[14.5px] font-semibold text-[var(--rz-muted)]">{p.name}</div>
                <div className="mb-6 flex items-baseline gap-1">
                  <span className="font-mono text-[30px] font-semibold text-[var(--rz-text)]">{p.price}</span>
                  <span className="text-[12.5px] text-[var(--rz-muted)]">{p.period}</span>
                </div>
                <div className="mb-6 flex flex-1 flex-col gap-2.5">
                  {p.items.map((it) => (
                    <div key={it} className="flex items-start gap-2 text-[13px] leading-[1.5] text-[var(--rz-muted)]">
                      <Check size={14} className="mt-0.5 shrink-0 text-[var(--rz-green)]" />
                      {it}
                    </div>
                  ))}
                </div>
                <PlanButton
                  planKey={p.key}
                  isLoggedIn={isLoggedIn}
                  className={`w-full ${p.highlight ? btnPrimary : btnGhost}`}
                >
                  เลือกแพ็กเกจนี้
                </PlanButton>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={200}>
          <p className="mt-8 text-center text-[13px] text-[var(--rz-muted)]">
            ยกเลิกได้ทุกเมื่อ ไม่มีข้อผูกมัดรายปี ·{" "}
            <Link href="/pricing" className="font-semibold text-[var(--rz-green)]">
              ดูรายละเอียดทั้งหมด →
            </Link>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
