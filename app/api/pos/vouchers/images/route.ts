import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { readImageFromForm, uploadPublicImage } from "@/lib/pos-image-upload";

/**
 * POST /api/pos/vouchers/images?kind=hero — อัปโหลดภาพหน้าปก voucher (multipart "file")
 *
 * ไม่ผูกกับ campaign id เพราะฟอร์ม "สร้างแคมเปญ" ยังไม่มี id — คืน URL ให้ฟอร์มเก็บลง
 * design_config.heroImageUrl แล้วบันทึกไปกับแคมเปญ (schema ยังบังคับ https เหมือนเดิม)
 * bucket public เดิม path voucher/<userId>/hero-<ts>.<ext>
 * ภาพที่อัปโหลดแล้วไม่บันทึกแคมเปญ = orphan ใน bucket (ยอมรับได้ · Known Limitation)
 */
export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const kind = req.nextUrl.searchParams.get("kind") ?? "hero";
  if (kind !== "hero") return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const img = await readImageFromForm(req);
  if (img instanceof NextResponse) return img;

  const url = await uploadPublicImage(`voucher/${userId}/hero-${Date.now()}.${img.ext}`, img.file);
  if (url instanceof NextResponse) return url;
  return NextResponse.json({ data: { url } }, { status: 201 });
}
