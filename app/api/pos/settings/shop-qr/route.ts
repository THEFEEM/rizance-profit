import { NextRequest, NextResponse } from "next/server";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { upsertPosShopSettings } from "@/lib/pos-settings-queries";
import {
  SupabaseStorageError,
  isSupabaseStorageConfigured,
  posSlipBucket,
  uploadPublicObject,
} from "@/lib/supabase-storage";

/**
 * POST /api/pos/settings/shop-qr — อัปโหลดรูป Thai QR ของร้าน (multipart "file")
 *
 * ใช้ bucket เดิม (public) path `shop-qr/<userId>/` — รูป QR ไม่ใช่ความลับ
 * ตัวเลขบัญชีอยู่บนรูปแล้วซึ่งร้านตั้งใจโชว์ให้ลูกค้าสแกนอยู่แล้ว
 */

const MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  if (!isSupabaseStorageConfigured()) {
    return posErrorResponse("storage_not_configured", 501);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return posErrorResponse("invalid_form_data", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return posErrorResponse("file_required", 400);

  const ext = ALLOWED_TYPES[file.type];
  if (!ext) return posErrorResponse("unsupported_image_type", 400);
  if (file.size === 0 || file.size > MAX_BYTES) {
    return posErrorResponse("image_too_large", 400);
  }

  try {
    const buf = await file.arrayBuffer();
    const url = await uploadPublicObject(
      posSlipBucket(),
      `shop-qr/${userId}/${Date.now()}.${ext}`,
      buf,
      file.type,
    );
    const note = typeof form.get("note") === "string" ? String(form.get("note")).trim() : "";
    const settings = await upsertPosShopSettings(userId, {
      shopQrUrl: url,
      ...(note ? { shopQrNote: note } : {}),
    });
    return NextResponse.json({ data: settings }, { status: 201 });
  } catch (err) {
    if (err instanceof SupabaseStorageError) {
      return posErrorResponse("qr_upload_failed", 502);
    }
    throw err;
  }
}
