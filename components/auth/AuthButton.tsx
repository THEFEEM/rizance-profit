import { forwardRef } from "react";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement>;

export const AuthButton = forwardRef<HTMLButtonElement, Props>(function AuthButton(
  { className = "", children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled}
      className={`tap-target no-select inline-flex w-full items-center justify-center gap-2 rounded-[11px] bg-rz-btn px-5 py-[15px] text-[15px] font-medium text-white transition-opacity active:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
});
