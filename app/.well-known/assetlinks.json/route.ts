import { NextResponse } from "next/server";

/**
 * Digital Asset Links — ผูกเว็บ https://rizance.com กับแอป Android `app.rizance`
 *
 * Google ดึงไฟล์นี้จากภายนอกโดยไม่มี cookie เพื่อยืนยันว่าเจ้าของเว็บอนุญาตให้
 * แอปนั้นเปิด URL ของโดเมนนี้แบบเต็มจอ (Trusted Web Activity)
 * ถ้า verify ไม่ผ่าน แอปจะยังเปิดได้ แต่มีแถบ URL ของ Chrome ค้างอยู่ด้านบน
 *
 * ═══ 🔴 ยังใช้งานจริงไม่ได้ — fingerprint เป็น placeholder ═══════════
 *
 * SHA-256 ที่ถูกต้องต้องมาจาก Play App Signing เท่านั้น และได้มาหลังจาก
 * อัปโหลด AAB ตัวแรกแล้วเท่านั้น:
 *
 *   Play Console → Release → Setup → App integrity
 *                → App signing key certificate → SHA-256 certificate fingerprint
 *
 * ลำดับที่หลีกเลี่ยงไม่ได้ (chicken-and-egg ของ Play App Signing):
 *   1. build AAB ด้วย upload keystore ของเราเอง
 *   2. อัปโหลดขึ้น Internal testing
 *   3. คัดลอก SHA-256 จาก Play Console
 *   4. แทนที่ placeholder ข้างล่าง
 *   5. deploy rizance.com
 *   6. verify ด้วย Statement List Generator and Tester ของ Google
 *
 * ⚠️ ห้ามเดาค่า fingerprint · ห้าม deploy ไฟล์นี้ตราบใดที่ยังเป็น placeholder
 *    (deploy ไปก็ไม่เสียหาย แต่ verify จะไม่ผ่านและทำให้เข้าใจผิดว่าตั้งค่าแล้ว)
 *
 * ไฟล์นี้เป็นข้อมูลสาธารณะล้วน — ไม่มีความลับใด ๆ ทั้งสิ้น
 */

/** เปลี่ยนเป็น SHA-256 จริงจาก Play Console แล้วค่อย deploy */
const PLAY_APP_SIGNING_SHA256 = "<PLAY_APP_SIGNING_SHA256>";

/** package id ของแอป Android production — ต้องตรงกับที่ตั้งใน Bubblewrap เป๊ะ */
const ANDROID_PACKAGE_NAME = "app.rizance";

export const dynamic = "force-static";

export async function GET() {
  const statements = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: ANDROID_PACKAGE_NAME,
        sha256_cert_fingerprints: [PLAY_APP_SIGNING_SHA256],
      },
    },
  ];

  const verified = !PLAY_APP_SIGNING_SHA256.startsWith("<");

  return NextResponse.json(statements, {
    headers: {
      "Content-Type": "application/json",
      // ยังเป็น placeholder → ห้าม cache เด็ดขาด เผื่อเผลอ deploy ไปแล้วต้องแก้ทันที
      // เมื่อใส่ fingerprint จริงแล้วค่อยให้ cache ได้ 1 ชั่วโมง (Google ดึงซ้ำเป็นระยะ)
      "Cache-Control": verified
        ? "public, max-age=3600"
        : "no-store, must-revalidate",
      // สัญญาณให้คนที่ curl ดูเห็นทันทีว่ายังไม่พร้อม — ไม่กระทบตัว parser ของ Google
      "X-Rizance-Assetlinks-Status": verified ? "configured" : "placeholder",
    },
  });
}
