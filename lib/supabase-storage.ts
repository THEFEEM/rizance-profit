/**
 * Supabase Storage — REST client (no SDK dependency).
 * Used for POS menu images. Bucket must be PUBLIC (menu images are not sensitive).
 *
 * Required env:
 *   SUPABASE_URL              e.g. https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY service role key (server-only, never NEXT_PUBLIC)
 * Optional:
 *   SUPABASE_POS_MENU_BUCKET  default "pos-menu"
 */

export class SupabaseStorageError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "SupabaseStorageError";
  }
}

function supabaseUrl(): string {
  const url = process.env.SUPABASE_URL?.trim();
  if (!url) throw new SupabaseStorageError("supabase_not_configured", 500);
  return url.replace(/\/$/, "");
}

function serviceKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new SupabaseStorageError("supabase_not_configured", 500);
  return key;
}

export function posMenuBucket(): string {
  return process.env.SUPABASE_POS_MENU_BUCKET?.trim() || "pos-menu";
}

export function isSupabaseStorageConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

/** Upload (upsert) an object. Returns the public URL. */
export async function uploadPublicObject(
  bucket: string,
  path: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<string> {
  const res = await fetch(`${supabaseUrl()}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey()}`,
      "Content-Type": contentType,
      "x-upsert": "true",
      "Cache-Control": "public, max-age=31536000",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SupabaseStorageError(`storage_upload_failed: ${res.status} ${text.slice(0, 200)}`, res.status);
  }
  return publicObjectUrl(bucket, path);
}

export async function deleteObject(bucket: string, path: string): Promise<void> {
  const res = await fetch(`${supabaseUrl()}/storage/v1/object/${bucket}/${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${serviceKey()}` },
  });
  // 404 = already gone — treat as success (idempotent delete).
  if (!res.ok && res.status !== 404) {
    throw new SupabaseStorageError(`storage_delete_failed: ${res.status}`, res.status);
  }
}

export function publicObjectUrl(bucket: string, path: string): string {
  return `${supabaseUrl()}/storage/v1/object/public/${bucket}/${path}`;
}

/** Extract the object path from a public URL of the given bucket (or null). */
export function objectPathFromPublicUrl(bucket: string, url: string): string | null {
  const prefix = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(prefix);
  if (idx === -1) return null;
  return url.slice(idx + prefix.length);
}
