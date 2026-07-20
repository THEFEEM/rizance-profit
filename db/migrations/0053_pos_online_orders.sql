-- 0053_pos_online_orders — QR pre-order (ลูกค้าสแกนสั่งล่วงหน้า รับ+จ่ายที่ร้าน)
--
-- Orders are RESERVATIONS ONLY: no stock, no income, no journal until staff
-- converts to a bill at pickup (existing closeBill path). Cancelling a
-- no-show order therefore has zero accounting impact.
-- Prices are snapshotted server-side at order time (client sends ids only).
--
-- Public access: shop menu exposed via pos_shop_settings.public_menu_token;
-- customers track their order via pos_orders.access_token (unguessable UUID).

BEGIN;

ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS public_menu_token UUID DEFAULT gen_random_uuid();
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS online_ordering_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_shop_settings_public_menu_token
  ON pos_shop_settings (public_menu_token)
  WHERE public_menu_token IS NOT NULL;

-- Daily queue counter → order_no "Q<yymmdd>-001" (same pattern as bills).
CREATE TABLE IF NOT EXISTS pos_order_counters (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  counter_date DATE NOT NULL,
  last_seq     INTEGER NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  PRIMARY KEY (user_id, counter_date)
);

CREATE TABLE IF NOT EXISTS pos_orders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_no       VARCHAR(32) NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'ready', 'completed', 'cancelled')),
  customer_name  VARCHAR(80) NOT NULL,
  customer_phone VARCHAR(20),
  note           VARCHAR(200),
  pickup_at_text VARCHAR(40),
  total_amount   NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
  access_token   UUID NOT NULL DEFAULT gen_random_uuid(),
  bill_id        UUID REFERENCES pos_bills(id) ON DELETE SET NULL,
  cancel_reason  VARCHAR(200),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, order_no)
);

CREATE INDEX IF NOT EXISTS idx_pos_orders_user_status
  ON pos_orders (user_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_orders_access_token
  ON pos_orders (access_token);

CREATE TABLE IF NOT EXISTS pos_order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES pos_orders(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES pos_products(id) ON DELETE SET NULL,
  product_name    VARCHAR(160) NOT NULL,
  unit_sell_price NUMERIC(12,2) NOT NULL CHECK (unit_sell_price >= 0),
  quantity        NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  line_total      NUMERIC(12,2) NOT NULL CHECK (line_total >= 0),
  sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pos_order_items_order
  ON pos_order_items (order_id);

CREATE TABLE IF NOT EXISTS pos_order_item_modifiers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id UUID NOT NULL REFERENCES pos_order_items(id) ON DELETE CASCADE,
  modifier_id   UUID REFERENCES pos_modifiers(id) ON DELETE SET NULL,
  modifier_name VARCHAR(80) NOT NULL,
  price_delta   NUMERIC(12,2) NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pos_order_item_modifiers_item
  ON pos_order_item_modifiers (order_item_id);

COMMIT;
