"use client";

const MAX_INTEGER_DIGITS = 10;

/** Format the raw typed string ("1234.5") with a grouped integer part. */
export function formatTyped(raw: string): string {
  if (!raw) return "";
  const [intPart, fracPart] = raw.split(".");
  const grouped = new Intl.NumberFormat("en-US").format(Number(intPart || "0"));
  return raw.includes(".") ? `${grouped}.${fracPart ?? ""}` : grouped;
}

type Key = "7" | "8" | "9" | "back" | "4" | "5" | "6" | "00" | "1" | "2" | "3" | "." | "0";

/** Pure reducer for one keypress against the raw amount string. */
export function applyKey(prev: string, k: Key): string {
  if (k === "back") return prev.slice(0, -1);
  if (k === ".") {
    if (prev.includes(".")) return prev;
    return prev === "" ? "0." : prev + ".";
  }
  const decimals = prev.split(".")[1];
  if (decimals !== undefined && decimals.length >= 2) return prev; // max 2 dp
  if (k === "00" && decimals !== undefined) {
    return decimals.length >= 1 ? prev + "0" : prev + "00";
  }
  const intLen = prev.split(".")[0].replace(/^0+/, "").length;
  if (!prev.includes(".") && intLen >= MAX_INTEGER_DIGITS) return prev;
  return prev === "0" && k !== "00" ? k : prev + k;
}

export function QuickAmountPad({
  value,
  onChange,
  onSave,
  saving = false,
  saveLabel = "SAVE",
  accent = "green",
}: {
  value: string;
  onChange: (next: string) => void;
  onSave: () => void;
  saving?: boolean;
  saveLabel?: string;
  accent?: "green" | "amber";
}) {
  const press = (k: Key) => onChange(applyKey(value, k));
  const canSave = !!value && Number(value) > 0 && !saving;
  const saveActive =
    accent === "amber"
      ? "bg-rz-amber text-rz-bg active:opacity-90 disabled:opacity-40"
      : "bg-rz-green text-rz-bg active:opacity-90 disabled:opacity-40";

  return (
    <div className="no-select grid grid-cols-4 gap-2 p-2">
      <PadButton onClick={() => press("7")}>7</PadButton>
      <PadButton onClick={() => press("8")}>8</PadButton>
      <PadButton onClick={() => press("9")}>9</PadButton>
      <PadButton onClick={() => press("back")} variant="muted" aria-label="Delete">
        ⌫
      </PadButton>

      <PadButton onClick={() => press("4")}>4</PadButton>
      <PadButton onClick={() => press("5")}>5</PadButton>
      <PadButton onClick={() => press("6")}>6</PadButton>
      <PadButton onClick={() => press("00")} variant="muted">
        00
      </PadButton>

      <PadButton onClick={() => press("1")}>1</PadButton>
      <PadButton onClick={() => press("2")}>2</PadButton>
      <PadButton onClick={() => press("3")}>3</PadButton>
      <PadButton onClick={() => press(".")} variant="muted">
        .
      </PadButton>

      <PadButton onClick={() => press("0")} className="col-span-2">
        0
      </PadButton>
      <button
        type="button"
        onClick={() => canSave && onSave()}
        disabled={!canSave}
        className={`tap-target col-span-2 flex h-16 items-center justify-center rounded-[11px] text-[15px] font-medium transition-opacity ${saveActive}`}
      >
        {saving ? "Saving…" : saveLabel}
      </button>
    </div>
  );
}

function PadButton({
  children,
  onClick,
  className = "",
  variant = "default",
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
  variant?: "default" | "muted";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    variant === "muted"
      ? "border-[0.5px] border-rz-border bg-rz-elevated text-rz-muted active:bg-rz-card"
      : "border-[0.5px] border-rz-border bg-rz-card text-rz-text active:bg-rz-elevated";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tap-target flex h-16 items-center justify-center rounded-[11px] text-2xl font-medium transition-colors ${base} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
