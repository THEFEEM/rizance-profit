/** Shared Tailwind class-name strings for the landing page.
 *  Colors map to the project's existing CSS variables (globals.css) — no new theme. */

export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--rz-green)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--rz-bg)]";

const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-[11px] font-semibold text-[14.5px] whitespace-nowrap cursor-pointer transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none " +
  focusRing;

export const btnPrimary =
  btnBase +
  " bg-[var(--rz-green)] text-[var(--rz-bg)] px-5 py-[11px] shadow-[0_8px_24px_-8px_rgba(74,222,158,0.45)] hover:-translate-y-px hover:shadow-[0_12px_30px_-8px_rgba(74,222,158,0.6)] active:translate-y-0 active:scale-[0.97] motion-reduce:hover:translate-y-0";

export const btnGhost =
  btnBase +
  " bg-transparent text-[var(--rz-text)] border border-[var(--rz-border)] px-[18px] py-[11px] hover:border-[#3a4a72] hover:bg-white/[0.03] active:scale-[0.98] motion-reduce:hover:scale-100";

/** Surface card — matches project card token + hairline border. */
export const surfaceCard =
  "bg-[var(--rz-card)] border border-[var(--rz-border)]";

/** Tinted "mint" icon chip using the project's logo-bg/border tokens. */
export const iconChip =
  "bg-[var(--rz-logo-bg)] border border-[var(--rz-logo-border)] text-[var(--rz-green)]";

export const wrap = "relative z-10 mx-auto max-w-[1200px] px-6";

export const sectionPad = "py-[96px] max-md:py-[48px]";

export const eyebrowSm =
  "block mb-2.5 text-xs font-semibold tracking-[1.8px] uppercase text-[var(--rz-green)]";

export const sectionTitle =
  "font-serif text-[clamp(26px,3vw,36px)] font-semibold mb-4 tracking-[-0.01em] text-[var(--rz-text)]";

export const sectionSub =
  "text-[15.5px] leading-[1.7] text-[var(--rz-muted)] max-w-[520px]";
