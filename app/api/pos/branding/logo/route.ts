import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { setMerchantLogoUrl } from "@/lib/pos-branding-queries";
import { deleteOldPublicImage, readImageFromForm, uploadPublicImage } from "@/lib/pos-image-upload";

/**
 * POST /api/pos/branding/logo — อัปโหลดโลโก้ร้าน (multipart "file")
 * DELETE — ล้างโลโก้ (การ์ดกลับไปใช้ตัวอักษรย่อ)
 * bucket public เดิม path brand/<userId>/logo-<ts>.<ext> — โลโก้ร้านไม่ใช่ความลับ
 */
export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const img = await readImageFromForm(req);
  if (img instanceof NextResponse) return img;

  const url = await uploadPublicImage(`brand/${userId}/logo-${Date.now()}.${img.ext}`, img.file);
  if (url instanceof NextResponse) return url;

  const { branding, previousUrl } = await setMerchantLogoUrl(userId, url);
  deleteOldPublicImage(previousUrl);
  return NextResponse.json({ data: { branding } }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const { branding, previousUrl } = await setMerchantLogoUrl(userId, null);
  deleteOldPublicImage(previousUrl);
  return NextResponse.json({ data: { branding } });
}
