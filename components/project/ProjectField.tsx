import { useId } from "react";

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: React.ReactNode;
  error?: string | null;
};

export function ProjectField({ label, error, className = "", id, ...props }: FieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-xs font-normal text-rz-muted">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`tap-target w-full rounded-[11px] border-[0.5px] bg-rz-card px-[13px] py-[13px] text-sm text-rz-text outline-none transition-colors placeholder:text-rz-placeholder focus:border-rz-blue ${
          error ? "border-rz-red" : "border-rz-border"
        } ${className}`}
        aria-invalid={error ? true : undefined}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-rz-red">{error}</p>}
    </div>
  );
}

export function ProjectTextArea({
  label,
  error,
  className = "",
  id,
  rows = 3,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: React.ReactNode;
  error?: string | null;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-xs font-normal text-rz-muted">
          {label}
        </label>
      )}
      <textarea
        id={inputId}
        rows={rows}
        className={`tap-target w-full resize-y rounded-[11px] border-[0.5px] bg-rz-card px-[13px] py-[13px] text-sm text-rz-text outline-none transition-colors placeholder:text-rz-placeholder focus:border-rz-blue ${
          error ? "border-rz-red" : "border-rz-border"
        } ${className}`}
        aria-invalid={error ? true : undefined}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-rz-red">{error}</p>}
    </div>
  );
}
