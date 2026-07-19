-- 0050_pos_modifiers — product modifiers (Loyverse-style options)
-- e.g. cheese +10, fried egg +10, sauce choice +0 (forced select via min_select).
--
-- Design notes:
-- * pos_bill_item_modifiers stores NAME + PRICE_DELTA AS SNAPSHOT — editing a
--   modifier later must never change historical bills (immutable ledger).
-- * The effective unit price (base + deltas) is stored in
--   pos_bill_items.unit_sell_price, so SUM(line_total) = bills.total_amount
--   = journal debit = credit stays intact with NO posting-adapter change.
-- * price_delta may be negative (discount-style options). NUMERIC(12,2) always.

BEGIN;

CREATE TABLE IF NOT EXISTS pos_modifier_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(80) NOT NULL,
  min_select  INTEGER NOT NULL DEFAULT 0 CHECK (min_select >= 0),
  max_select  INTEGER NOT NULL DEFAULT 1 CHECK (max_select >= 1),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (min_select <= max_select),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_pos_modifier_groups_user
  ON pos_modifier_groups (user_id, sort_order, name);

CREATE TABLE IF NOT EXISTS pos_modifiers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES pos_modifier_groups(id) ON DELETE CASCADE,
  name        VARCHAR(80) NOT NULL,
  price_delta NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, name)
);

CREATE INDEX IF NOT EXISTS idx_pos_modifiers_group
  ON pos_modifiers (group_id, sort_order, name);

-- M:N — one group (e.g. "ชีส") reused across many products.
CREATE TABLE IF NOT EXISTS pos_product_modifier_groups (
  product_id  UUID NOT NULL REFERENCES pos_products(id) ON DELETE CASCADE,
  group_id    UUID NOT NULL REFERENCES pos_modifier_groups(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_product_modifier_groups_group
  ON pos_product_modifier_groups (group_id);

-- Snapshot per sold line — modifier_id nullable (SET NULL if master deleted).
CREATE TABLE IF NOT EXISTS pos_bill_item_modifiers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_item_id  UUID NOT NULL REFERENCES pos_bill_items(id) ON DELETE CASCADE,
  modifier_id   UUID REFERENCES pos_modifiers(id) ON DELETE SET NULL,
  modifier_name VARCHAR(80) NOT NULL,
  price_delta   NUMERIC(12,2) NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pos_bill_item_modifiers_item
  ON pos_bill_item_modifiers (bill_item_id);

COMMIT;
