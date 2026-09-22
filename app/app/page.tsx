import { redirect } from "next/navigation";
import { getUserId } from "@/lib/session";

/**
 * /app — ทางเข้าของแอปที่ติดตั้ง (Android TWA · PWA)
 *
 * ปกติ request ไม่มาถึงไฟล์นี้เลย: middleware ตัดสินและ redirect ที่ edge ก่อน
 * (ดู APP_ENTRY_PATH ใน middleware.ts) ไฟล์นี้เป็นชั้นสำรองเผื่อวันหน้ามีคน
 * แก้ matcher ของ middleware แล้ว /app หลุดออกมา — พฤติกรรมต้องเหมือนกันเป๊ะ
 *
 * ไม่ render อะไรเลย · ไม่แตะ DB (ใช้ getUserId ที่ verify JWT อย่างเดียว)
 * เว็บปกติที่ / ยังเป็น landing เหมือนเดิม
 */
export const dynamic = "force-dynamic";

export default async function AppEntryPage(): Promise<never> {
  const userId = await getUserId();
  redirect(userId ? "/home" : "/login");
}
