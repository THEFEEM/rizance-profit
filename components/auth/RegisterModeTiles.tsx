import type { RegisterMode } from "@/lib/register-mode";

const TILES: {
  mode: RegisterMode;
  emoji: string;
  label: string;
  hint?: string;
  selectedRing: string;
  selectedBg: string;
}[] = [
  {
    mode: "personal",
    emoji: "❤️",
    label: "บุคคล",
    hint: "(เริ่มต้น)",
    selectedRing: "ring-rz-rose",
    selectedBg: "bg-rz-rose/10 border-rz-rose/50",
  },
  {
    mode: "regular",
    emoji: "💚",
    label: "ร้านค้า",
    selectedRing: "ring-rz-green",
    selectedBg: "bg-rz-green/10 border-rz-green/50",
  },
  {
    mode: "booth",
    emoji: "🧡",
    label: "บูธ",
    selectedRing: "ring-rz-amber",
    selectedBg: "bg-rz-amber/10 border-rz-amber/50",
  },
  {
    mode: "org",
    emoji: "💜",
    label: "องค์กร",
    selectedRing: "ring-rz-purple",
    selectedBg: "bg-rz-purple/10 border-rz-purple-border",
  },
];

export function RegisterModeTiles({
  value,
  onChange,
}: {
  value: RegisterMode;
  onChange: (mode: RegisterMode) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {TILES.map((tile) => {
        const selected = value === tile.mode;
        return (
          <button
            key={tile.mode}
            type="button"
            onClick={() => onChange(tile.mode)}
            className={`tap-target flex flex-col items-center justify-center rounded-[12px] border-[0.5px] px-3 py-3.5 text-center transition-colors ${
              selected
                ? `${tile.selectedBg} ring-2 ${tile.selectedRing}`
                : "border-rz-border bg-rz-card active:bg-rz-elevated"
            }`}
            aria-pressed={selected}
          >
            <span className="text-xl leading-none" aria-hidden>
              {tile.emoji}
            </span>
            <span className="mt-1.5 text-sm font-medium text-rz-text">{tile.label}</span>
            {tile.hint && <span className="mt-0.5 text-[10px] text-rz-hint">{tile.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
