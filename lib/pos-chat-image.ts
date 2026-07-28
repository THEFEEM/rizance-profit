import {
  isSupabaseStorageConfigured,
  posSlipBucket,
  uploadPublicObject,
} from "@/lib/supabase-storage";

/** อัปโหลดรูปในแชทออเดอร์ — ใช้ bucket เดียวกับสลิป (public, path แยกโฟลเดอร์ chat/) */

const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export class ChatImageError extends Error {
  constructor(public code: "not_configured" | "unsupported_type" | "too_large") {
    super(code);
    this.name = "ChatImageError";
  }
}

export async function uploadChatImage(orderId: string, file: File): Promise<string> {
  if (!isSupabaseStorageConfigured()) throw new ChatImageError("not_configured");
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) throw new ChatImageError("unsupported_type");
  if (file.size === 0 || file.size > MAX_CHAT_IMAGE_BYTES) {
    throw new ChatImageError("too_large");
  }
  const buf = await file.arrayBuffer();
  return uploadPublicObject(
    posSlipBucket(),
    `chat/${orderId}/${Date.now()}.${ext}`,
    buf,
    file.type,
  );
}
