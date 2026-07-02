import { TRUST } from "./data";
import { Reveal } from "./shared/Reveal";
import { wrap } from "./shared/ui";

export function TrustStrip() {
  return (
    <section className="relative z-10 border-y border-[var(--rz-border)]">
      <div className={wrap}>
        <div className="grid grid-cols-1 gap-6 py-8 md:grid-cols-3 md:gap-8">
          {TRUST.map((t, i) => (
            <Reveal key={t.title} delay={i * 70}>
              <div className="flex items-center gap-3">
                <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] bg-[var(--rz-logo-bg)] text-[var(--rz-green)]">
                  <t.icon size={18} />
                </span>
                <div>
                  <div className="mb-0.5 text-[14px] font-semibold text-[var(--rz-text)]">{t.title}</div>
                  <div className="text-[12.5px] text-[var(--rz-muted)]">{t.desc}</div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
