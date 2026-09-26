import type { z } from "zod";
import type { registerModeSchema } from "@/lib/validation";
import { SHOW_ORG_MODE, SHOW_PERSONAL_MODE } from "@/lib/feature-flags";

export type RegisterMode = z.infer<typeof registerModeSchema>;

/**
 * 4.3C: mode ที่ใช้จริงตอนสมัคร — โหมดที่ปลดระวาง (personal/org) กลายเป็น Shop เมื่อ flag ปิด
 * booth ก็เป็น Shop ตอนสมัคร (บูธสร้างทีหลังในแอป — พฤติกรรมเดิมของ route ก็เป็น regular อยู่แล้ว)
 */
export function normalizeRegisterMode(mode: RegisterMode): RegisterMode {
  if (mode === "personal" && !SHOW_PERSONAL_MODE) return "regular";
  if (mode === "org" && !SHOW_ORG_MODE) return "regular";
  if (mode === "booth") return "regular";
  return mode;
}

export function registerNameField(mode: RegisterMode): { label: string; placeholder: string } {
  if (mode === "personal") {
    return { label: "ชื่อผู้ใช้", placeholder: "ชื่อของคุณ" };
  }
  if (mode === "org") {
    return { label: "ชื่อองค์กร/ชมรม", placeholder: "ชื่อองค์กร/ชมรม" };
  }
  return { label: "ชื่อร้านค้า", placeholder: "ชื่อร้านค้า" };
}

export function registerSubmitButtonClass(mode: RegisterMode): string {
  switch (mode) {
    case "personal":
      return "bg-rz-rose text-rz-bg";
    case "booth":
      return "bg-rz-amber text-rz-bg";
    case "org":
      return "bg-rz-purple text-rz-bg";
    default:
      return "bg-rz-btn text-white";
  }
}
