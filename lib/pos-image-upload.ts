import { NextResponse } from "next/server";
import { posErrorResponse } from "@/lib/pos-auth";
import {
  SupabaseStorageError,
  deleteObject,
  isSupabaseStorageConfigured,
  objectPathFromPublicUrl,
  posMenuBucket,
  uploadPublicObject,
} from "@/lib/supabase-storage";

/**
 * ตัวช่วยอัปโหลดรูป (multipart "file") — กติกาเดียวกับ products/[id]/image และ settings/shop-qr
 * ที่ทำซ้ำอยู่ 3 ที่: 5 MB · jpeg/png/webp · bucket public เดิม (pos-menu)
 *
 * ใช้กับ branding (โลโก้ร้าน) และ voucher hero — ไม่ใช่ระบบอัปโหลดใหม่
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** อ่านไฟล์จาก form + validate — คืน NextResponse เมื่อไม่ผ่าน */
export async function readImageFromForm(
  req: Request,
): Promise<{ file: File; ext: string } | NextResponse> {
  if (!isSupabaseStorageConfigured()) {
    return posErrorResponse("image_storage_not_configured", 501);
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return posErrorResponse("invalid_form_data", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return posErrorResponse("file_required", 400);
  const ext = ALLOWED_IMAGE_TYPES[file.type];
  if (!ext) return posErrorResponse("unsupported_image_type", 400);
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    return posErrorResponse("image_too_large", 400);
  }
  return { file, ext };
}

/** อัปโหลดลง bucket public เดิม — path มี timestamp กัน cache (bucket ตั้ง max-age ปี) */
export async function uploadPublicImage(
  path: string,
  file: File,
): Promise<string | NextResponse> {
  try {
    const buf = await file.arrayBuffer();
    return await uploadPublicObject(posMenuBucket(), path, buf, file.type);
  } catch (err) {
    if (err instanceof SupabaseStorageError) return posErrorResponse("image_upload_failed", 502);
    throw err;
  }
}

/** ลบ object เก่าแบบ best-effort — เฉพาะที่อยู่ใน bucket ของเรา */
export function deleteOldPublicImage(url: string | null | undefined): void {
  if (!url) return;
  const oldPath = objectPathFromPublicUrl(posMenuBucket(), url);
  if (oldPath) void deleteObject(posMenuBucket(), oldPath).catch(() => undefined);
}
