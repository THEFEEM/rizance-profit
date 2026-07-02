import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Reveal } from "./shared/Reveal";
import { btnGhost, btnPrimary, sectionPad, wrap } from "./shared/ui";

export function FinalCta() {
  return (
    <section className={`${sectionPad} pt-0`}>
      <div className={wrap}>
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-[var(--rz-border)] bg-[linear-gradient(135deg,var(--rz-card),var(--rz-elevated))] px-8 py-24 text-center">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-[140px] left-1/2 h-[340px] w-[340px] -translate-x-1/2"
              style={{ background: "radial-gradient(circle,rgba(74,222,158,0.18),transparent 70%)" }}
            />
            <h2 className="relative mb-4 font-serif text-[clamp(24px,3.4vw,34px)] font-semibold text-[var(--rz-text)]">
              พร้อมเลิกเดาเรื่องเงินหรือยัง
            </h2>
            <p className="relative mb-8 text-[15px] text-[var(--rz-muted)]">
              เริ่มพิมพ์ประโยคแรก แล้วให้ Rizq จัดการที่เหลือ
            </p>
            <div className="relative flex flex-wrap items-center justify-center gap-4">
              <Link href="/register" className={btnPrimary}>
                เริ่มใช้ฟรีวันนี้ <ArrowRight size={15} />
              </Link>
              <Link href="/pricing" className={btnGhost}>
                ดูแพ็กเกจทั้งหมด
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
