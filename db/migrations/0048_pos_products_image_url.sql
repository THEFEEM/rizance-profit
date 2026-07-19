-- 0048_pos_products_image_url — menu image for POS product tiles (Loyverse-style)
-- Additive only. NULL = no image (frontend falls back to colored initial tile).
-- Image files live in Supabase Storage (public bucket, see SUPABASE_POS_MENU_BUCKET);
-- this column stores the public URL only.

BEGIN;

ALTER TABLE pos_products
  ADD COLUMN IF NOT EXISTS image_url TEXT;

COMMIT;
