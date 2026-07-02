"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "./useReducedMotion";

/** Two blurred ambient glows with subtle scroll parallax (rAF-throttled). */
export function ParallaxGlows() {
  const glow1 = useRef<HTMLDivElement>(null);
  const glow2 = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return undefined;
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const y = window.scrollY;
          if (glow1.current) glow1.current.style.transform = `translate3d(0, ${y * 0.06}px, 0)`;
          if (glow2.current) glow2.current.style.transform = `translate3d(0, ${y * -0.04}px, 0)`;
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [reduced]);

  return (
    <>
      <div
        ref={glow1}
        aria-hidden="true"
        className="pointer-events-none absolute -top-[180px] -right-[140px] z-0 h-[560px] w-[560px] rounded-full blur-[90px] will-change-transform"
        style={{ background: "radial-gradient(circle,rgba(74,222,158,0.14),transparent 70%)" }}
      />
      <div
        ref={glow2}
        aria-hidden="true"
        className="pointer-events-none absolute top-[640px] -left-[160px] z-0 h-[440px] w-[440px] rounded-full blur-[90px] will-change-transform"
        style={{ background: "radial-gradient(circle,rgba(239,159,39,0.09),transparent 70%)" }}
      />
    </>
  );
}
