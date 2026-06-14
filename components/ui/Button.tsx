import { forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary:
    "rz-btn-primary border-[0.5px] border-transparent bg-rz-btn text-rz-bg active:opacity-90 disabled:opacity-40",
  secondary:
    "border-[0.5px] border-rz-border bg-rz-card text-rz-muted active:bg-rz-elevated disabled:opacity-40",
  ghost: "bg-transparent text-rz-muted active:bg-rz-elevated disabled:opacity-40",
  danger:
    "border-[0.5px] border-transparent bg-[#991B1B] text-rz-text active:opacity-90 disabled:opacity-40",
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
      data-variant={variant}
      className={`tap-target no-select inline-flex items-center justify-center gap-2 rounded-[11px] px-5 text-sm font-medium transition-opacity ${
        fullWidth ? "w-full" : ""
      } ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
});
