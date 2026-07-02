"use client";

import { useEffect, useRef, useState } from "react";
import { CHART_DATA } from "../data";
import { useReducedMotion } from "./useReducedMotion";

/** Animated weekly bar chart for the dashboard showcase. */
export function MiniChart() {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) {
      setOn(true);
      return undefined;
    }
    const el = ref.current;
    if (!el) return undefined;
    const obs = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setOn(true);
            obs.disconnect();
          }
        }),
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [reduced]);

  const max = Math.max(...CHART_DATA.map((d) => d.v));

  return (
    <div ref={ref} className="mb-2 flex h-[140px] items-end gap-2.5">
      {CHART_DATA.map((d, i) => (
        <div key={d.d} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
          <div className="flex h-[100px] w-full items-end">
            <div
              className="h-[100px] w-full origin-bottom rounded-t-md bg-gradient-to-b from-[var(--rz-green)] to-[var(--rz-btn)] transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
              style={{
                transform: `scaleY(${on ? d.v / max : 0})`,
                transitionDelay: `${i * 60}ms`,
              }}
            />
          </div>
          <span className="text-[11px] text-[var(--rz-muted)]">{d.d}</span>
        </div>
      ))}
    </div>
  );
}
