import { CAPS } from "./data";
import { Reveal } from "./shared/Reveal";
import { eyebrowSm, sectionPad, sectionSub, sectionTitle, wrap } from "./shared/ui";

export function CapabilitiesGrid() {
  return (
    <section id="features" className={sectionPad}>
      <div className={wrap}>
        <Reveal>
          <div className="mb-12">
            <span className={eyebrowSm}>สิ่งที่ Rizq ทำได้</span>
            <h2 className={sectionTitle}>งานบัญชีที่เคยยุ่ง ตอนนี้แค่พิมพ์คุย</h2>
            <p className={sectionSub}>ไม่ต้องกรอกฟอร์ม ไม่ต้องเรียนรู้อะไรใหม่ ใช้ภาษาที่คุณพูดอยู่แล้วทุกวัน</p>
          </div>
        </Reveal>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {CAPS.map((c, i) => (
            <Reveal key={c.title} delay={i * 80}>
              <div className="group h-full rounded-2xl border border-[var(--rz-border)] bg-[var(--rz-card)] p-6 transition-[transform,border-color,box-shadow] duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-[3px] hover:border-[rgba(74,222,158,0.4)] hover:shadow-[0_20px_40px_-20px_rgba(0,0,0,0.5)] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--rz-logo-bg)] text-[var(--rz-green)]">
                  <c.icon size={20} />
                </div>
                <div className="mb-2 text-[16.5px] font-semibold text-[var(--rz-text)]">{c.title}</div>
                <div className="text-[13.5px] leading-[1.65] text-[var(--rz-muted)]">{c.desc}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
