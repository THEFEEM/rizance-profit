-- 0038_pos_core — POS products, bills, stock movements, daily bill counter
-- Shop mode only (user_id → users). Links paid bills to income_entries.

BEGIN;

CREATE TABLE IF NOT EXISTS pos_products (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         VARCHAR(160) NOT NULL,
  sell_price   NUMERIC(12,2) NOT NULL CHECK (sell_price >= 0),
  cost_price   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  stock_qty    NUMERIC(12,3) NOT NULL DEFAULT 0,
  track_stock  BOOLEAN NOT NULL DEFAULT true,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_products_user
  ON pos_products (user_id);

CREATE TABLE IF NOT EXISTS pos_bill_counters (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  counter_date DATE NOT NULL,
  last_seq     INTEGER NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  PRIMARY KEY (user_id, counter_date)
);

CREATE TABLE IF NOT EXISTS pos_bills (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bill_no          VARCHAR(32) NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'paid'
    CHECK (status IN ('paid', 'voided')),
  total_amount     NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
  payment_method   VARCHAR(20) NOT NULL
    CHECK (payment_method IN ('cash', 'transfer')),
  entry_date       DATE NOT NULL,
  income_entry_id  UUID REFERENCES income_entries(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, bill_no)
);

CREATE INDEX IF NOT EXISTS idx_pos_bills_user_date
  ON pos_bills (user_id, entry_date DESC);

CREATE TABLE IF NOT EXISTS pos_bill_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id          UUID NOT NULL REFERENCES pos_bills(id) ON DELETE CASCADE,
  product_id       UUID REFERENCES pos_products(id) ON DELETE SET NULL,
  product_name     VARCHAR(160) NOT NULL,
  unit_sell_price  NUMERIC(12,2) NOT NULL CHECK (unit_sell_price >= 0),
  unit_cost_price  NUMERIC(12,2) NOT NULL CHECK (unit_cost_price >= 0),
  quantity         NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  line_total       NUMERIC(12,2) NOT NULL CHECK (line_total >= 0),
  line_cost        NUMERIC(12,2) NOT NULL CHECK (line_cost >= 0),
  sort_order       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pos_bill_items_bill
  ON pos_bill_items (bill_id);

CREATE TABLE IF NOT EXISTS pos_stock_movements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id     UUID NOT NULL REFERENCES pos_products(id) ON DELETE CASCADE,
  bill_id        UUID REFERENCES pos_bills(id) ON DELETE SET NULL,
  movement_type  VARCHAR(20) NOT NULL
    CHECK (movement_type IN ('sale', 'adjustment', 'restock')),
  qty_change     NUMERIC(12,3) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_stock_movements_product
  ON pos_stock_movements (product_id, created_at DESC);

COMMIT;
