-- 0052_ingredient_stock_recipes — ingredient stock + POS recipes (BOM)
--
-- Reuses the Pricing-mode `ingredients` master (0003) as the single source of
-- truth; adds a stock dimension + links to POS products/modifiers.
-- Stock unit = purchase_unit (e.g. เนื้อ stocked in grams if bought per gram
-- pack: purchase_quantity 1000 g @ ฿300 → cost/unit = 0.30/g).
--
-- Selling 1 unit of a product deducts each linked ingredient by `quantity`;
-- selected modifiers deduct additionally. Void returns everything (movement
-- trail per bill). Quantities NUMERIC(12,4) matching recipe_items.

BEGIN;

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS track_stock BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS stock_qty NUMERIC(14,4) NOT NULL DEFAULT 0;
ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS low_stock_threshold NUMERIC(14,4);

-- Recipe: POS product → ingredients used per 1 unit sold.
CREATE TABLE IF NOT EXISTS pos_product_ingredients (
  product_id    UUID NOT NULL REFERENCES pos_products(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  quantity      NUMERIC(12,4) NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (product_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_product_ingredients_ingredient
  ON pos_product_ingredients (ingredient_id);

-- Modifier → extra ingredients (e.g. "เพิ่มชีส" cuts 1 cheese slice).
CREATE TABLE IF NOT EXISTS pos_modifier_ingredients (
  modifier_id   UUID NOT NULL REFERENCES pos_modifiers(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  quantity      NUMERIC(12,4) NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (modifier_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_modifier_ingredients_ingredient
  ON pos_modifier_ingredients (ingredient_id);

-- Audit trail per gram: sale/void per bill, restock (optionally linked to the
-- expense entry it created), manual adjustment/count.
CREATE TABLE IF NOT EXISTS ingredient_stock_movements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ingredient_id    UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  bill_id          UUID REFERENCES pos_bills(id) ON DELETE SET NULL,
  expense_entry_id UUID REFERENCES expense_entries(id) ON DELETE SET NULL,
  movement_type    VARCHAR(20) NOT NULL
    CHECK (movement_type IN ('sale', 'restock', 'adjustment', 'void_return')),
  qty_change       NUMERIC(14,4) NOT NULL,
  note             VARCHAR(200),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingredient_stock_movements_ingredient
  ON ingredient_stock_movements (ingredient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingredient_stock_movements_bill
  ON ingredient_stock_movements (bill_id)
  WHERE bill_id IS NOT NULL;

COMMIT;
