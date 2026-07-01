import Link from "next/link";
import Image from "next/image";
import { StickyHeader } from "./StickyHeader";
import { HeroSection } from "./HeroSection";
import { TrustStrip } from "./TrustStrip";
import { CapabilitiesGrid } from "./CapabilitiesGrid";
import { DashboardShowcase } from "./DashboardShowcase";
import { ModesTabs } from "./ModesTabs";
import { StatsRow } from "./StatsRow";
import { PricingPreview } from "./PricingPreview";
import { FaqAccordion } from "./FaqAccordion";
import { ContactFeedbackSection } from "./ContactFeedbackSection";
import { FinalCta } from "./FinalCta";
import { ParallaxGlows } from "./shared/ParallaxGlows";
import { focusRing, wrap } from "./shared/ui";

export function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[var(--rz-bg)] text-[var(--rz-text)] font-[family-name:var(--font-sans-th)]">
      <ParallaxGlows />
      <StickyHeader />

      <main>
        <HeroSection />
        <TrustStrip />
        <CapabilitiesGrid />
        <DashboardShowcase />
        <ModesTabs />
        <StatsRow />
        <PricingPreview />
        <FaqAccordion />
        <ContactFeedbackSection />
        <FinalCta />
      </main>

      <div className={wrap}>
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--rz-border)] py-8">
          <Link href="/" className={`flex items-center gap-2.5 rounded-md font-serif font-bold ${focusRing}`}>
            <span className="flex h-[30px] w-[30px] items-center justify-center overflow-hidden rounded-[9px] border-[0.5px] border-[var(--rz-logo-border)] bg-[var(--rz-logo-bg)]">
              <Image src="/Logo.png" alt="Rizance" width={20} height={20} style={{ objectFit: "contain" }} />
            </span>
            Rizance
          </Link>
          <div className="text-[12.5px] text-[var(--rz-muted)]">
            © {new Date().getFullYear()} Rizance — สร้างขึ้นเพื่อผู้ประกอบการรายย่อย
          </div>
          <div className="flex gap-6">
            <a href="#features" className={`rounded-md text-[13px] text-[var(--rz-muted)] transition-colors hover:text-[var(--rz-text)] ${focusRing}`}>
              ฟีเจอร์
            </a>
            <a href="#pricing" className={`rounded-md text-[13px] text-[var(--rz-muted)] transition-colors hover:text-[var(--rz-text)] ${focusRing}`}>
              แพ็กเกจ
            </a>
            <a href="#contact" className={`rounded-md text-[13px] text-[var(--rz-muted)] transition-colors hover:text-[var(--rz-text)] ${focusRing}`}>
              ติดต่อ
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
