import { forwardRef, useId } from "react";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string | null;
  icon?: React.ReactNode;
  iconTone?: "hint" | "blue";
};

export const SetupField = forwardRef<HTMLInputElement, Props>(function SetupField(
  { label, hint, error, icon, iconTone = "hint", className = "", id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const iconColor = iconTone === "blue" ? "text-rz-blue" : "text-rz-hint";

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 flex items-center gap-2 text-xs text-rz-muted">
          {icon && <span className={iconColor}>{icon}</span>}
          {label}
        </label>
      )}
      {hint && <p className="mb-1.5 text-xs text-rz-hint">{hint}</p>}
      <input
        ref={ref}
        id={inputId}
        className={`tap-target w-full rounded-[11px] border-[0.5px] bg-rz-elevated px-[13px] py-[13px] text-sm text-rz-text outline-none transition-colors placeholder:text-rz-placeholder focus:border-rz-amber ${
          error ? "border-rz-red" : "border-rz-border"
        } ${className}`}
        aria-invalid={error ? true : undefined}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-rz-red">{error}</p>}
    </div>
  );
});

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  error?: string | null;
};

export const SetupTextarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function SetupTextarea({ label, error, className = "", id, ...props }, ref) {
    const generatedId = useId();
    const inputId = id ?? generatedId;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="mb-1.5 block text-xs text-rz-muted">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          className={`min-h-[96px] w-full resize-y rounded-[11px] border-[0.5px] bg-rz-elevated px-[13px] py-[13px] text-sm text-rz-text outline-none transition-colors placeholder:text-rz-placeholder focus:border-rz-amber ${
            error ? "border-rz-red" : "border-rz-border"
          } ${className}`}
          aria-invalid={error ? true : undefined}
          {...props}
        />
        {error && <p className="mt-1 text-xs text-rz-red">{error}</p>}
      </div>
    );
  },
);

export function SetupPrimaryButton({
  children,
  disabled,
  onClick,
  type = "button",
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="tap-target flex w-full items-center justify-center gap-2 rounded-[11px] bg-[#BA7517] px-4 py-3.5 text-sm font-medium text-rz-text transition-opacity active:opacity-90 disabled:opacity-40"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M20 6 9 17l-5-5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {children}
    </button>
  );
}

export function SetupSecondaryButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="tap-target w-full rounded-[11px] border-[0.5px] border-rz-border bg-rz-card px-4 py-3 text-sm font-medium text-rz-muted transition-colors active:bg-rz-elevated disabled:opacity-40"
    >
      {children}
    </button>
  );
}
