import { renderModeIcon } from "@/components/mode-icons";
import { SHOW_ORG_MODE, SHOW_PERSONAL_MODE } from "@/lib/feature-flags";
import type { RegisterMode } from "@/lib/register-mode";

const TILES: {
  mode: RegisterMode;
  label: string;
  hint?: string;
  selectedRing: string;
  selectedBg: string;
}[] = [
  {
    mode: "personal",
    label: "บุคคล",
    hint: "(เริ่มต้น)",
    selectedRing: "ring-rz-rose",
    selectedBg: "bg-rz-rose/10 border-rz-rose/50",
  },
  {
    mode: "regular",
    label: "ร้านค้า",
    selectedRing: "ring-rz-green",
    selectedBg: "bg-rz-green/10 border-rz-green/50",
  },
  {
    mode: "booth",
    label: "บูธ",
    selectedRing: "ring-rz-amber",
    selectedBg: "bg-rz-amber/10 border-rz-amber/50",
  },
  {
    mode: "org",
    label: "องค์กร",
    selectedRing: "ring-rz-purple",
    selectedBg: "bg-rz-purple/10 border-rz-purple-border",
  },
];

function visibleTiles() {
  return TILES.filter((tile) => {
    if (tile.mode === "personal" && !SHOW_PERSONAL_MODE) return false;
    if (tile.mode === "org" && !SHOW_ORG_MODE) return false;
    return true;
  });
}

export function defaultRegisterMode(): RegisterMode {
  const tiles = visibleTiles();
  return tiles[0]?.mode ?? "regular";
}

export function RegisterModeTiles({
  value,
  onChange,
}: {
  value: RegisterMode;
  onChange: (mode: RegisterMode) => void;
}) {
  const tiles = visibleTiles();

  return (
    <div
      className={`grid gap-2.5 ${
        tiles.length <= 2 ? "grid-cols-2" : "grid-cols-2"
      }`}
    >
      {tiles.map((tile) => {
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
            <span className="flex h-8 w-8 items-center justify-center">
              {renderModeIcon(tile.mode === "org" ? "org" : tile.mode, 28)}
            </span>
            <span className="mt-1.5 text-sm font-medium text-rz-text">{tile.label}</span>
            {tile.hint && <span className="mt-0.5 text-[10px] text-rz-hint">{tile.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
