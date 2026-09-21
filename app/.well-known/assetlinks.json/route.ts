import { NextResponse } from "next/server";

/**
 * Digital Asset Links — ผูกเว็บ https://rizance.com กับแอป Android `app.rizance`
 *
 * Google ดึงไฟล์นี้จากภายนอกโดยไม่มี cookie เพื่อยืนยันว่าเจ้าของเว็บอนุญาตให้
 * แอปนั้นเปิด URL ของโดเมนนี้แบบเต็มจอ (Trusted Web Activity)
 * ถ้า verify ไม่ผ่าน แอปจะยังเปิดได้ แต่มีแถบ URL ของ Chrome ค้างอยู่ด้านบน
 *
 * ═══ ⚠️ ต้องลงครบทุก fingerprint ไม่ใช่แค่ตัวเดียว ═══════════════════
 *
 * บทเรียนจากของจริง: เคยลงไว้ตัวเดียว (FF:60:…) แล้ว verification ล้มเหลว
 * เพราะ APK ที่ติดตั้งจริงบนเครื่อง Samsung เซ็นด้วยอีกใบหนึ่ง (F7:A9:…)
 * ตรวจด้วย ADB ได้ state `www.rizance.com: 1024` = verifier ปฏิเสธ ไม่ใช่ verified
 *
 * Android จับคู่แบบ "ตรงตัวใดตัวหนึ่งก็พอ" — การลงครบทุกใบที่ Play Console
 * รับรองจึงปลอดภัยที่สุด และไม่ต้องเดาว่าใบไหนคือ app signing / upload /
 * ใบเก่าที่หมุนไปแล้ว การเดาผิดหนึ่งครั้ง = แถบ URL ของ Chrome โผล่ทั้งแอป
 *
 *   ที่มา: Play Console → Release → Setup → App integrity
 *          (รายการ fingerprint ที่ยืนยันแล้วของ app.rizance)
 *
 * ⚠️ เพิ่มหรือหมุนใบรับรองเมื่อใด ต้องกลับมาเติมที่นี่ด้วยเสมอ
 *
 * ⚠️ ไฟล์นี้ต้องเสิร์ฟ 200 บน **ทุก host ที่ TWA ประกาศ** โดยห้าม redirect
 *    วันนี้ TWA ผูกกับ `www.rizance.com` (ยืนยันแล้วว่าเสิร์ฟตรงไม่ redirect)
 *
 * หลัง deploy ยืนยันด้วย Statement List Generator and Tester ของ Google และ
 * `curl -i https://www.rizance.com/.well-known/assetlinks.json`
 *
 * ไฟล์นี้เป็นข้อมูลสาธารณะล้วน — ไม่มีความลับใด ๆ ทั้งสิ้น
 * (fingerprint ของใบรับรองเป็นข้อมูลที่ต้องเปิดเผยโดยนิยามของ Digital Asset Links)
 */

/**
 * ทุก SHA-256 ที่ Play Console ยืนยันแล้วสำหรับ `app.rizance`
 * ลำดับไม่มีผลต่อการ verify — Android ผ่านถ้าตรงตัวใดตัวหนึ่ง
 */
const PLAY_CERT_SHA256_FINGERPRINTS = [
  "FF:60:AD:69:0F:CF:7E:1D:85:FD:4C:60:A0:CD:26:80:EE:98:89:E3:33:4E:DA:D8:91:F3:04:AC:9C:32:49:C9",
  "5F:C7:C8:5E:23:E3:83:9D:48:73:B0:5D:5F:85:D5:E8:20:4A:97:39:A3:08:6E:EF:16:94:65:F7:DD:AE:E0:55",
  // ใบที่ APK บนเครื่อง Samsung ใช้จริง (ยืนยันด้วย ADB) — ขาดตัวนี้คือสาเหตุที่ verify ไม่ผ่าน
  "F7:A9:8A:50:90:12:31:5E:00:A7:9E:BA:1B:2F:72:5E:50:4D:63:37:37:66:F1:68:32:62:4D:97:86:51:93:D1",
];

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
        sha256_cert_fingerprints: PLAY_CERT_SHA256_FINGERPRINTS,
      },
    },
  ];

  // ยืนยันว่ารายการใช้ได้จริง ไม่ใช่แค่ "ไม่ใช่ placeholder":
  //   · มีอย่างน้อยหนึ่งใบ
  //   · ทุกใบเป็น 32 ไบต์ hex ตัวพิมพ์ใหญ่คั่นด้วย :
  //   · ไม่มีใบซ้ำ (ซ้ำ = มีคนแก้ผิดพลาด ไม่ควรปล่อยให้ cache ยาว)
  // ถ้าผิดข้อใดข้อหนึ่ง header จะตกไป placeholder + no-store ให้เห็นทันทีตอน curl
  const FINGERPRINT_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
  const verified =
    PLAY_CERT_SHA256_FINGERPRINTS.length > 0 &&
    PLAY_CERT_SHA256_FINGERPRINTS.every((fp) => FINGERPRINT_RE.test(fp)) &&
    new Set(PLAY_CERT_SHA256_FINGERPRINTS).size ===
      PLAY_CERT_SHA256_FINGERPRINTS.length;

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
