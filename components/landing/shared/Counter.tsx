"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

type CounterProps = {
  target: number;
  suffix?: string;
  prefix?: string;
  label?: string | null;
  className?: string;
  numClassName?: string;
};

/** Counts up from 0 → target when scrolled into view. */
export function Counter({
  target,
  suffix = "",
  prefix = "",
  label,
  className = "",
  numClassName = "",
}: CounterProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [val, setVal] = useState(0);
  const started = useRef(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (reduced) {
      setVal(target);
      return undefined;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !started.current) {
            started.current = true;
            const duration = 900;
            const start = performance.now();
            const tick = (now: number) => {
              const p = Math.min(1, (now - start) / duration);
              const eased = 1 - Math.pow(1 - p, 3);
              setVal(Math.round(target * eased));
              if (p < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }
        });
      },
      { threshold: 0.4 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [target, reduced]);

  return (
    <div ref={ref} className={className}>
      <div className={`font-mono ${numClassName}`}>
        {prefix}
        {val.toLocaleString("en-US")}
        {suffix}
      </div>
      {label && <div className="text-[13.5px] text-[var(--rz-muted)]">{label}</div>}
    </div>
  );
}
