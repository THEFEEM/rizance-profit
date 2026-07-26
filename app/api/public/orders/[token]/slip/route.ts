import { NextRequest, NextResponse } from "next/server";
import { authRateLimitExceeded, clientIp } from "@/lib/rate-limit";
import { PosSlipNotAllowedError, attachOrderSlip } from "@/lib/pos-order-queries";
import {
  SupabaseStorageError,
  isSupabaseStorageConfigured,
  posSlipBucket,
  uploadPublicObject,
} from "@/lib/supabase-storage";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SLIP_BYTES = 5 * 1024 * 1024;

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * POST /api/public/orders/:accessToken/slip — ลูกค้าอัปโหลดสลิปโอนเงิน (multipart "file")
 * ไม่สร้างรายรับ/journal — เป็นแค่หลักฐานให้ร้านตรวจ รายรับเกิดตอนปิดบิล
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const retryIn = authRateLimitExceeded(`slip:${clientIp(req)}`);
  if (retryIn !== null) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { token } = await params;
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (!isSupabaseStorageConfigured()) {
    return NextResponse.json({ error: "slip_storage_not_configured" }, { status: 501 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return NextResponse.json({ error: "unsupported_image_type" }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_SLIP_BYTES) {
    return NextResponse.json({ error: "image_too_large" }, { status: 400 });
  }

  try {
    const buf = await file.arrayBuffer();
    const objectPath = `${token}/${Date.now()}.${ext}`;
    const url = await uploadPublicObject(posSlipBucket(), objectPath, buf, file.type);

    const result = await attachOrderSlip(token, url);
    if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });

    return NextResponse.json({ data: { slipUrl: url, orderNo: result.orderNo } }, { status: 201 });
  } catch (err) {
    if (err instanceof PosSlipNotAllowedError) {
      return NextResponse.json({ error: "slip_not_allowed" }, { status: 409 });
    }
    if (err instanceof SupabaseStorageError) {
      return NextResponse.json({ error: "slip_upload_failed" }, { status: 502 });
    }
    throw err;
  }
}
