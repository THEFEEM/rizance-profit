-- 0039_pos_categories_and_settings — POS product categories + per-shop settings
-- Requires 0038_pos_core.sql. Additive only; existing pos_products stay valid (category_id NULL).
--
-- pos_categories: user-scoped product grouping for POS sell screen
-- pos_shop_settings: 1 row per user (shop) — payment defaults, receipt header
-- pos_products.category_id: optional FK (NULL = uncategorized)

BEGIN;

CREATE TABLE IF NOT EXISTS pos_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(80) NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  color       VARCHAR(20),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_pos_categories_user_sort
  ON pos_categories (user_id, sort_order, name);

CREATE TABLE IF NOT EXISTS pos_shop_settings (
  user_id                UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_payment_method VARCHAR(20) NOT NULL DEFAULT 'cash'
    CHECK (default_payment_method IN ('cash', 'promptpay')),
  promptpay_id           VARCHAR(20),
  receipt_header         VARCHAR(160),
  allow_negative_stock   BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pos_products
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES pos_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pos_products_category
  ON pos_products (user_id, category_id)
  WHERE category_id IS NOT NULL;

COMMIT;
