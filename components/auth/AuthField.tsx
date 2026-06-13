import { forwardRef, useId, type ReactNode } from "react";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string | null;
  leadingIcon?: ReactNode;
  trailing?: ReactNode;
};

export const AuthField = forwardRef<HTMLInputElement, Props>(function AuthField(
  { label, error, leadingIcon, trailing, className = "", id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hasError = Boolean(error);

  return (
    <div className="w-full">
      <label htmlFor={inputId} className="mb-1.5 block text-xs font-normal text-rz-muted">
        {label}
      </label>
      <div className="relative">
        {leadingIcon && (
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-rz-hint">
            {leadingIcon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`tap-target w-full rounded-[11px] border-[0.5px] bg-rz-card py-[13px] text-sm text-rz-text outline-none transition-colors placeholder:text-rz-placeholder focus:border-rz-green ${
            leadingIcon ? "pl-10" : "px-[13px]"
          } ${trailing ? "pr-12" : leadingIcon ? "pr-[13px]" : ""} ${
            hasError ? "border-rz-red" : "border-rz-border"
          } ${className}`}
          aria-invalid={hasError ? true : undefined}
          {...props}
        />
        {trailing}
      </div>
      <p
        className={`mt-1 min-h-[1.125rem] text-xs ${hasError ? "text-rz-red" : "text-transparent"}`}
        aria-live="polite"
      >
        {error ?? "\u00a0"}
      </p>
    </div>
  );
});
