import { NextRequest, NextResponse } from "next/server";
import {
  posErrorResponse,
  posNotFoundResponse,
  requirePosSessionAndPlan,
} from "@/lib/pos-auth";
import { getPosComboImageUrl, setPosComboImageUrl } from "@/lib/pos-combo-queries";
import {
  SupabaseStorageError,
  deleteObject,
  isSupabaseStorageConfigured,
  objectPathFromPublicUrl,
  posMenuBucket,
  uploadPublicObject,
} from "@/lib/supabase-storage";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * POST /api/pos/combos/:id/image — multipart field "file"
 * ใช้ bucket และรูปแบบ path เดียวกับรูปสินค้า (prefix combo- กันชนกับ id ของสินค้า)
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  if (!isSupabaseStorageConfigured()) {
    return posErrorResponse("image_storage_not_configured", 501);
  }

  const { id } = await params;

  // เช็คความเป็นเจ้าของก่อนแตะ storage — คอมโบของร้านอื่นต้องได้ 404
  const existing = await getPosComboImageUrl(userId, id);
  if (existing === undefined) return posNotFoundResponse();

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
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    return posErrorResponse("image_too_large", 400);
  }

  try {
    const buf = await file.arrayBuffer();
    // ต่อท้ายด้วยเวลา — object ถูกเสิร์ฟด้วย max-age ยาว ต้องเปลี่ยน path ทุกครั้ง
    const path = `${userId}/combo-${id}-${Date.now()}.${ext}`;
    const url = await uploadPublicObject(posMenuBucket(), path, buf, file.type);

    const combo = await setPosComboImageUrl(userId, id, url);
    if (!combo) return posNotFoundResponse();

    // ลบรูปเก่าแบบ best-effort (คนละ path ทุกครั้งที่อัปโหลด)
    if (existing) {
      const oldPath = objectPathFromPublicUrl(posMenuBucket(), existing);
      if (oldPath) void deleteObject(posMenuBucket(), oldPath).catch(() => undefined);
    }

    return NextResponse.json({ data: { combo } });
  } catch (err) {
    if (err instanceof SupabaseStorageError) {
      return posErrorResponse("image_upload_failed", 502);
    }
    throw err;
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  const existing = await getPosComboImageUrl(userId, id);
  if (existing === undefined) return posNotFoundResponse();

  const combo = await setPosComboImageUrl(userId, id, null);
  if (!combo) return posNotFoundResponse();

  if (existing && isSupabaseStorageConfigured()) {
    const oldPath = objectPathFromPublicUrl(posMenuBucket(), existing);
    if (oldPath) void deleteObject(posMenuBucket(), oldPath).catch(() => undefined);
  }

  return NextResponse.json({ data: { combo } });
}
