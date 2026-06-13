import { forwardRef, useId } from "react";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string | null;
  accent?: "green" | "amber";
};

/** Dark-themed field for +In / −Out entry screens. */
export const EntryField = forwardRef<HTMLInputElement, Props>(function EntryField(
  { label, error, accent = "green", className = "", id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const focusBorder = accent === "amber" ? "focus:border-rz-amber" : "focus:border-rz-green";

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-xs font-normal text-rz-muted">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={`tap-target w-full rounded-[11px] border-[0.5px] bg-rz-card px-[13px] py-[13px] text-sm text-rz-text outline-none transition-colors placeholder:text-rz-placeholder ${focusBorder} ${
          error ? "border-rz-red" : "border-rz-border"
        } ${className}`}
        aria-invalid={error ? true : undefined}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-rz-red">{error}</p>}
    </div>
  );
});
