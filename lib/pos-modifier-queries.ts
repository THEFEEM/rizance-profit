import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import type { PosModifier, PosModifierGroup } from "@/types/pos";

type GroupRow = {
  id: string;
  name: string;
  min_select: number;
  max_select: number;
  is_active: boolean;
  sort_order: number;
};

type ModifierRow = {
  id: string;
  group_id: string;
  name: string;
  price_delta: string;
  is_active: boolean;
  sort_order: number;
};

const GROUP_RETURN = `id, name, min_select, max_select, is_active, sort_order`;
const MODIFIER_RETURN = `id, group_id, name, price_delta::text AS price_delta, is_active, sort_order`;

function mapGroup(r: GroupRow, modifiers: PosModifier[]): PosModifierGroup {
  return {
    id: r.id,
    name: r.name,
    minSelect: r.min_select,
    maxSelect: r.max_select,
    isActive: r.is_active,
    sortOrder: r.sort_order,
    modifiers,
  };
}

function mapModifier(r: ModifierRow): PosModifier {
  return {
    id: r.id,
    groupId: r.group_id,
    name: r.name,
    priceDelta: r.price_delta,
    isActive: r.is_active,
    sortOrder: r.sort_order,
  };
}

export class PosModifierGroupNameExistsError extends Error {
  constructor() {
    super("pos modifier group name exists");
    this.name = "PosModifierGroupNameExistsError";
  }
}

export class PosModifierNameExistsError extends Error {
  constructor() {
    super("pos modifier name exists");
    this.name = "PosModifierNameExistsError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}

/** All groups (active only unless includeInactive) with their modifiers. */
export async function listPosModifierGroups(
  userId: string,
  opts?: { includeInactive?: boolean },
): Promise<PosModifierGroup[]> {
  const groupFilter = opts?.includeInactive ? "" : " AND is_active = true";
  const modifierFilter = opts?.includeInactive ? "" : " AND m.is_active = true";

  const [groupsResult, modifiersResult] = await Promise.all([
    pool.query<GroupRow>(
      `SELECT ${GROUP_RETURN}
       FROM pos_modifier_groups
       WHERE user_id = $1${groupFilter}
       ORDER BY sort_order ASC, name ASC`,
      [userId],
    ),
    pool.query<ModifierRow>(
      `SELECT ${MODIFIER_RETURN}
       FROM pos_modifiers m
       WHERE m.group_id IN (SELECT id FROM pos_modifier_groups WHERE user_id = $1)${modifierFilter}
       ORDER BY m.sort_order ASC, m.name ASC`,
      [userId],
    ),
  ]);

  const byGroup = new Map<string, PosModifier[]>();
  for (const r of modifiersResult.rows) {
    const arr = byGroup.get(r.group_id) ?? [];
    arr.push(mapModifier(r));
    byGroup.set(r.group_id, arr);
  }

  return groupsResult.rows.map((g) => mapGroup(g, byGroup.get(g.id) ?? []));
}

/** product_id → group_id[] for all of a user's products. */
export async function listProductModifierGroupLinks(
  userId: string,
): Promise<Map<string, string[]>> {
  const { rows } = await pool.query<{ product_id: string; group_id: string }>(
    `SELECT pmg.product_id, pmg.group_id
     FROM pos_product_modifier_groups pmg
     JOIN pos_products p ON p.id = pmg.product_id
     WHERE p.user_id = $1
     ORDER BY pmg.sort_order ASC`,
    [userId],
  );
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const arr = map.get(r.product_id) ?? [];
    arr.push(r.group_id);
    map.set(r.product_id, arr);
  }
  return map;
}

export async function createPosModifierGroup(
  userId: string,
  input: { name: string; minSelect: number; maxSelect: number; sortOrder: number },
): Promise<PosModifierGroup> {
  try {
    const { rows } = await pool.query<GroupRow>(
      `INSERT INTO pos_modifier_groups (user_id, name, min_select, max_select, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${GROUP_RETURN}`,
      [userId, input.name, input.minSelect, input.maxSelect, input.sortOrder],
    );
    return mapGroup(rows[0], []);
  } catch (err) {
    if (isUniqueViolation(err)) throw new PosModifierGroupNameExistsError();
    throw err;
  }
}

export async function updatePosModifierGroup(
  userId: string,
  groupId: string,
  input: {
    name?: string;
    minSelect?: number;
    maxSelect?: number;
    sortOrder?: number;
    isActive?: boolean;
  },
): Promise<PosModifierGroup | null> {
  const sets: string[] = [];
  const params: (string | number | boolean)[] = [userId, groupId];
  let idx = 3;

  if (input.name !== undefined) {
    sets.push(`name = $${idx}`);
    params.push(input.name);
    idx += 1;
  }
  if (input.minSelect !== undefined) {
    sets.push(`min_select = $${idx}`);
    params.push(input.minSelect);
    idx += 1;
  }
  if (input.maxSelect !== undefined) {
    sets.push(`max_select = $${idx}`);
    params.push(input.maxSelect);
    idx += 1;
  }
  if (input.sortOrder !== undefined) {
    sets.push(`sort_order = $${idx}`);
    params.push(input.sortOrder);
    idx += 1;
  }
  if (input.isActive !== undefined) {
    sets.push(`is_active = $${idx}`);
    params.push(input.isActive);
    idx += 1;
  }
  if (sets.length === 0) return null;
  sets.push("updated_at = now()");

  try {
    const { rows } = await pool.query<GroupRow>(
      `UPDATE pos_modifier_groups SET ${sets.join(", ")}
       WHERE id = $2 AND user_id = $1
       RETURNING ${GROUP_RETURN}`,
      params,
    );
    if (!rows[0]) return null;

    const { rows: mods } = await pool.query<ModifierRow>(
      `SELECT ${MODIFIER_RETURN} FROM pos_modifiers m
       WHERE m.group_id = $1
       ORDER BY m.sort_order ASC, m.name ASC`,
      [groupId],
    );
    return mapGroup(rows[0], mods.map(mapModifier));
  } catch (err) {
    if (isUniqueViolation(err)) throw new PosModifierGroupNameExistsError();
    throw err;
  }
}

export async function isModifierGroupOwned(
  userId: string,
  groupId: string,
): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pos_modifier_groups WHERE id = $1 AND user_id = $2
     ) AS ok`,
    [groupId, userId],
  );
  return rows[0]?.ok === true;
}

export async function createPosModifier(
  userId: string,
  groupId: string,
  input: { name: string; priceDelta: number; sortOrder: number },
): Promise<PosModifier | null> {
  const owned = await isModifierGroupOwned(userId, groupId);
  if (!owned) return null;

  try {
    const { rows } = await pool.query<ModifierRow>(
      `INSERT INTO pos_modifiers (group_id, name, price_delta, sort_order)
       VALUES ($1, $2, $3, $4)
       RETURNING ${MODIFIER_RETURN}`,
      [groupId, input.name, input.priceDelta.toFixed(2), input.sortOrder],
    );
    return mapModifier(rows[0]);
  } catch (err) {
    if (isUniqueViolation(err)) throw new PosModifierNameExistsError();
    throw err;
  }
}

export async function updatePosModifier(
  userId: string,
  modifierId: string,
  input: { name?: string; priceDelta?: number; sortOrder?: number; isActive?: boolean },
): Promise<PosModifier | null> {
  const sets: string[] = [];
  const params: (string | number | boolean)[] = [userId, modifierId];
  let idx = 3;

  if (input.name !== undefined) {
    sets.push(`name = $${idx}`);
    params.push(input.name);
    idx += 1;
  }
  if (input.priceDelta !== undefined) {
    sets.push(`price_delta = $${idx}`);
    params.push(input.priceDelta.toFixed(2));
    idx += 1;
  }
  if (input.sortOrder !== undefined) {
    sets.push(`sort_order = $${idx}`);
    params.push(input.sortOrder);
    idx += 1;
  }
  if (input.isActive !== undefined) {
    sets.push(`is_active = $${idx}`);
    params.push(input.isActive);
    idx += 1;
  }
  if (sets.length === 0) return null;
  sets.push("updated_at = now()");

  try {
    const { rows } = await pool.query<ModifierRow>(
      `UPDATE pos_modifiers m SET ${sets.join(", ")}
       WHERE m.id = $2
         AND m.group_id IN (SELECT id FROM pos_modifier_groups WHERE user_id = $1)
       RETURNING ${MODIFIER_RETURN}`,
      params,
    );
    return rows[0] ? mapModifier(rows[0]) : null;
  } catch (err) {
    if (isUniqueViolation(err)) throw new PosModifierNameExistsError();
    throw err;
  }
}

/** Replace the set of modifier groups attached to a product (order preserved). */
export async function setProductModifierGroups(
  userId: string,
  productId: string,
  groupIds: string[],
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: owned } = await client.query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pos_products WHERE id = $1 AND user_id = $2
       ) AS ok`,
      [productId, userId],
    );
    if (!owned[0]?.ok) {
      await client.query("ROLLBACK");
      return false;
    }

    if (groupIds.length > 0) {
      const { rows: cnt } = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM pos_modifier_groups
         WHERE user_id = $1 AND id = ANY($2::uuid[])`,
        [userId, groupIds],
      );
      if (parseInt(cnt[0].n, 10) !== new Set(groupIds).size) {
        await client.query("ROLLBACK");
        return false;
      }
    }

    await client.query(`DELETE FROM pos_product_modifier_groups WHERE product_id = $1`, [
      productId,
    ]);
    for (let i = 0; i < groupIds.length; i++) {
      await client.query(
        `INSERT INTO pos_product_modifier_groups (product_id, group_id, sort_order)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [productId, groupIds[i], i],
      );
    }

    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Checkout-time validation (runs inside the closePosBill transaction).
// ---------------------------------------------------------------------------

export type SelectedModifier = {
  id: string;
  groupId: string;
  name: string;
  priceDelta: string;
};

export class PosInvalidModifierError extends Error {
  constructor() {
    super("pos invalid modifier");
    this.name = "PosInvalidModifierError";
  }
}

export class PosModifierRuleError extends Error {
  constructor(public groupName: string) {
    super(`pos modifier rule violation: ${groupName}`);
    this.name = "PosModifierRuleError";
  }
}

type CheckoutModifierRow = {
  id: string;
  group_id: string;
  name: string;
  price_delta: string;
  min_select: number;
  max_select: number;
  group_name: string;
};

type ProductGroupRuleRow = {
  product_id: string;
  group_id: string;
  min_select: number;
  group_name: string;
};

/**
 * Validate selected modifiers for a cart and return per-selection details.
 * Rules enforced per line:
 *  - every modifierId exists, is active, belongs to this user
 *  - the modifier's group is linked to the line's product
 *  - per group: count <= max_select
 *  - every group linked to the product with min_select > 0 is satisfied
 */
export async function resolveCartModifiers(
  client: PoolClient,
  userId: string,
  lines: { productId: string; modifierIds?: string[] }[],
): Promise<Map<number, SelectedModifier[]>> {
  const allIds = [...new Set(lines.flatMap((l) => l.modifierIds ?? []))];
  const productIds = [...new Set(lines.map((l) => l.productId))];

  const modifiersById = new Map<string, CheckoutModifierRow>();
  if (allIds.length > 0) {
    const { rows } = await client.query<CheckoutModifierRow>(
      `SELECT m.id, m.group_id, m.name, m.price_delta::text AS price_delta,
              g.min_select, g.max_select, g.name AS group_name
       FROM pos_modifiers m
       JOIN pos_modifier_groups g ON g.id = m.group_id
       WHERE g.user_id = $1 AND m.id = ANY($2::uuid[])
         AND m.is_active = true AND g.is_active = true`,
      [userId, allIds],
    );
    for (const r of rows) modifiersById.set(r.id, r);
    if (modifiersById.size !== allIds.length) throw new PosInvalidModifierError();
  }

  // Product ↔ group links incl. required groups (min_select > 0).
  const { rows: linkRows } = await client.query<ProductGroupRuleRow>(
    `SELECT pmg.product_id, pmg.group_id, g.min_select, g.name AS group_name
     FROM pos_product_modifier_groups pmg
     JOIN pos_modifier_groups g ON g.id = pmg.group_id
     WHERE g.user_id = $1 AND g.is_active = true
       AND pmg.product_id = ANY($2::uuid[])`,
    [userId, productIds],
  );
  const linksByProduct = new Map<string, ProductGroupRuleRow[]>();
  for (const r of linkRows) {
    const arr = linksByProduct.get(r.product_id) ?? [];
    arr.push(r);
    linksByProduct.set(r.product_id, arr);
  }

  const result = new Map<number, SelectedModifier[]>();

  lines.forEach((line, lineIndex) => {
    const productLinks = linksByProduct.get(line.productId) ?? [];
    const linkedGroupIds = new Set(productLinks.map((l) => l.group_id));
    const selected = (line.modifierIds ?? []).map((id) => modifiersById.get(id)!);

    // Selected modifier's group must be linked to this product.
    for (const m of selected) {
      if (!linkedGroupIds.has(m.group_id)) throw new PosInvalidModifierError();
    }

    // Per-group max_select.
    const countByGroup = new Map<string, number>();
    for (const m of selected) {
      countByGroup.set(m.group_id, (countByGroup.get(m.group_id) ?? 0) + 1);
    }
    for (const m of selected) {
      if ((countByGroup.get(m.group_id) ?? 0) > m.max_select) {
        throw new PosModifierRuleError(m.group_name);
      }
    }

    // Required groups (min_select > 0) must be satisfied.
    for (const link of productLinks) {
      if (link.min_select > 0 && (countByGroup.get(link.group_id) ?? 0) < link.min_select) {
        throw new PosModifierRuleError(link.group_name);
      }
    }

    result.set(
      lineIndex,
      selected.map((m) => ({
        id: m.id,
        groupId: m.group_id,
        name: m.name,
        priceDelta: m.price_delta,
      })),
    );
  });

  return result;
}
