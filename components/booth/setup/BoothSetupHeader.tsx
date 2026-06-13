import { BoothBack } from "@/components/booth/BoothBack";
import { TentIcon } from "@/components/booth/setup/icons";

export function BoothSetupHeader({
  mode,
  backHref,
}: {
  mode: "create" | "edit";
  backHref: string;
}) {
  const title = mode === "create" ? "สร้างงานบูธ" : "ตั้งค่าบูธ";

  return (
    <header className="px-4 pb-4 pt-2">
      <BoothBack href={backHref} />
      <div className="mt-1 flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border-[0.5px] border-[#5A3F12] bg-[#2E2310] text-rz-amber">
          <TentIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-medium text-rz-text">{title}</h1>
          <p className="mt-0.5 text-sm text-rz-hint">
            ตั้งค่าทุน สมาชิก และงบ — หน้าเดียวจบ
          </p>
        </div>
      </div>
    </header>
  );
}
