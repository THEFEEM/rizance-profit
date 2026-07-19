import { NextRequest, NextResponse } from "next/server";
import {
  posErrorResponse,
  posNotFoundResponse,
  requirePosSessionAndPlan,
} from "@/lib/pos-auth";
import { getPosProductImageUrl, setPosProductImageUrl } from "@/lib/pos-queries";
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

/** POST /api/pos/products/:id/image — multipart form field "file". Upserts menu image. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  if (!isSupabaseStorageConfigured()) {
    return posErrorResponse("image_storage_not_configured", 501);
  }

  const { id } = await params;

  // Ownership check (also 404 for other users' products).
  const existing = await getPosProductImageUrl(userId, id);
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
    // Cache-busting suffix — bucket objects are served with long max-age.
    const path = `${userId}/${id}-${Date.now()}.${ext}`;
    const url = await uploadPublicObject(posMenuBucket(), path, buf, file.type);

    const product = await setPosProductImageUrl(userId, id, url);
    if (!product) return posNotFoundResponse();

    // Best-effort cleanup of the previous object (different path per upload).
    if (existing) {
      const oldPath = objectPathFromPublicUrl(posMenuBucket(), existing);
      if (oldPath) void deleteObject(posMenuBucket(), oldPath).catch(() => undefined);
    }

    return NextResponse.json({ data: product });
  } catch (err) {
    if (err instanceof SupabaseStorageError) {
      return posErrorResponse("image_upload_failed", 502);
    }
    throw err;
  }
}

/** DELETE /api/pos/products/:id/image — removes image (storage + column). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  const existing = await getPosProductImageUrl(userId, id);
  if (existing === undefined) return posNotFoundResponse();

  const product = await setPosProductImageUrl(userId, id, null);
  if (!product) return posNotFoundResponse();

  if (existing && isSupabaseStorageConfigured()) {
    const oldPath = objectPathFromPublicUrl(posMenuBucket(), existing);
    if (oldPath) void deleteObject(posMenuBucket(), oldPath).catch(() => undefined);
  }

  return NextResponse.json({ data: product });
}
