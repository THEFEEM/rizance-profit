import { NextResponse } from "next/server";

/**
 * Digital Asset Links — ผูกเว็บ https://rizance.com กับแอป Android `app.rizance`
 *
 * Google ดึงไฟล์นี้จากภายนอกโดยไม่มี cookie เพื่อยืนยันว่าเจ้าของเว็บอนุญาตให้
 * แอปนั้นเปิด URL ของโดเมนนี้แบบเต็มจอ (Trusted Web Activity)
 * ถ้า verify ไม่ผ่าน แอปจะยังเปิดได้ แต่มีแถบ URL ของ Chrome ค้างอยู่ด้านบน
 *
 * ═══ ✅ ตั้งค่าแล้ว — ใช้ SHA-256 จริงจาก Play App Signing ═══════════
 *
 * ที่มาของค่า (ค่าเดียวที่ถูกต้อง — ไม่ใช่ upload key ของเราเอง):
 *
 *   Play Console → Release → Setup → App integrity
 *                → App signing key certificate → SHA-256 certificate fingerprint
 *
 * ⚠️ ถ้า Google หมุน App Signing key เมื่อใด ต้องกลับมาแก้ค่านี้ ไม่อย่างนั้น
 *    verification จะพังเงียบ ๆ และผู้ใช้จะเห็นแถบ URL ของ Chrome โผล่ขึ้นมา
 *
 * หลัง deploy ให้ยืนยันด้วย Statement List Generator and Tester ของ Google
 * และ `curl -i https://rizance.com/.well-known/assetlinks.json`
 *
 * ไฟล์นี้เป็นข้อมูลสาธารณะล้วน — ไม่มีความลับใด ๆ ทั้งสิ้น
 * (fingerprint ของใบรับรองเป็นข้อมูลที่ต้องเปิดเผยโดยนิยามของ Digital Asset Links)
 */

/** SHA-256 จาก Play App Signing ของ app.rizance */
const PLAY_APP_SIGNING_SHA256 =
  "FF:60:AD:69:0F:CF:7E:1D:85:FD:4C:60:A0:CD:26:80:EE:98:89:E3:33:4E:DA:D8:91:F3:04:AC:9C:32:49:C9";

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

  // ยืนยันรูปแบบจริง (32 ไบต์ hex ตัวพิมพ์ใหญ่ คั่นด้วย :) ไม่ใช่แค่ "ไม่ใช่ placeholder"
  // ถ้าวันหน้ามีคนวางค่าผิดรูปแบบ header จะกลับไปเป็น placeholder + no-store ทันที
  const verified = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(
    PLAY_APP_SIGNING_SHA256,
  );

  return NextResponse.json(statements, {
    headers: {
      "Content-Type": "application/json",
      // fingerprint ถูกต้องแล้ว → cache ได้ 1 ชั่วโมง (Google ดึงไฟล์นี้ซ้ำเป็นระยะ)
      // ถ้าค่าผิดรูปแบบเมื่อใด จะตกไป no-store ทันทีเพื่อให้แก้แล้วเห็นผลเลย
      "Cache-Control": verified
        ? "public, max-age=3600"
        : "no-store, must-revalidate",
      // สัญญาณให้คนที่ curl ดูเห็นสถานะได้ทันที — ไม่กระทบตัว parser ของ Google
      "X-Rizance-Assetlinks-Status": verified ? "configured" : "placeholder",
    },
  });
}
