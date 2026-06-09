-- 0003_cost_pricing — ingredients, recipes, overheads, pricing settings
-- Money: NUMERIC(12,2). Quantities: NUMERIC(12,4). All scoped by user_id.

CREATE TABLE IF NOT EXISTS ingredients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              VARCHAR(120) NOT NULL,
  purchase_quantity NUMERIC(12,4) NOT NULL CHECK (purchase_quantity > 0),
  purchase_unit     VARCHAR(20) NOT NULL,
  purchase_price    NUMERIC(12,2) NOT NULL CHECK (purchase_price >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingredients_user ON ingredients (user_id);

CREATE TABLE IF NOT EXISTS menu_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           VARCHAR(120) NOT NULL,
  desired_profit NUMERIC(12,2) CHECK (desired_profit IS NULL OR desired_profit >= 0),
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menu_items_user ON menu_items (user_id);

CREATE TABLE IF NOT EXISTS recipe_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id  UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  quantity      NUMERIC(12,4) NOT NULL CHECK (quantity > 0),
  UNIQUE (menu_item_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_recipe_items_menu ON recipe_items (menu_item_id);
CREATE INDEX IF NOT EXISTS idx_recipe_items_ingredient ON recipe_items (ingredient_id);

CREATE TABLE IF NOT EXISTS overheads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category        VARCHAR(40) NOT NULL,
  label           VARCHAR(120),
  monthly_amount  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (monthly_amount >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_overheads_user ON overheads (user_id);

-- Fixed overhead categories: one row per (user, category). "other" may repeat.
CREATE UNIQUE INDEX IF NOT EXISTS idx_overheads_user_fixed_category
  ON overheads (user_id, category)
  WHERE category <> 'other';

CREATE TABLE IF NOT EXISTS pricing_settings (
  user_id                  UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  estimated_cups_per_month INTEGER NOT NULL DEFAULT 0 CHECK (estimated_cups_per_month >= 0),
  default_profit_per_cup   NUMERIC(12,2) CHECK (default_profit_per_cup IS NULL OR default_profit_per_cup >= 0),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
