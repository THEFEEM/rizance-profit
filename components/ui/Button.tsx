import { forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-emerald-600 text-white active:bg-emerald-700 disabled:bg-emerald-300",
  secondary: "bg-slate-100 text-slate-900 active:bg-slate-200 disabled:opacity-50",
  ghost: "bg-transparent text-slate-600 active:bg-slate-100 disabled:opacity-50",
  danger: "bg-red-600 text-white active:bg-red-700 disabled:bg-red-300",
};

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  fullWidth?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", fullWidth = true, className = "", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`tap-target no-select inline-flex items-center justify-center gap-2 rounded-2xl px-5 text-base font-semibold transition-colors ${
        fullWidth ? "w-full" : ""
      } ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
});
