import type { z } from "zod";
import type { registerModeSchema } from "@/lib/validation";

export type RegisterMode = z.infer<typeof registerModeSchema>;

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
