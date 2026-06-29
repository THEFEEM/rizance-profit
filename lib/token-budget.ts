import "server-only";

import { pool } from "@/lib/db";
import { planExpiresAt } from "@/lib/subscription-plan";

export const TOKEN_COSTS = {
  rizq_chat: 1500,
  scan_slip: 800,
  scan_receipt: 3000,
} as const;

export type TokenAction = keyof typeof TOKEN_COSTS;

export const PLAN_TOKEN_BUDGETS = {
  free: 60_000,
  personal_plus: 300_000,
  business: 900_000,
  event_pass: 200_000,
} as const;

export type TokenBudgetCheckResult =
  | { allowed: true; tokensRemaining: number; creditsDisplay: number }
  | {
      allowed: false;
      tokensUsed: number;
      tokensTotal: number;
      upgradeMessage: string;
    };

export type AppContextMode = "regular" | "personal" | "booth" | "project";

export function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function tokensToCredits(tokensRemaining: number, action: TokenAction): number {
  return Math.floor(tokensRemaining / TOKEN_COSTS[action]);
}

export function resolveTokenScope(
  mode: AppContextMode,
  plan: string,
  boothId?: string,
): string {
  if (mode === "booth" && boothId) return `booth:${boothId}`;
  if (mode === "regular" && plan === "business") return "business";
  if (mode === "personal" && plan === "personal_plus") return "personal_plus";
  return "free";
}

function budgetPeriod(scope: string): string | null {
  if (scope === "business" || scope === "personal_plus") return getCurrentPeriod();
  return null;
}

function periodKey(scope: string): string {
  return budgetPeriod(scope) ?? "none";
}

function tokensTotalForScope(scope: string): number {
  if (scope === "free") return PLAN_TOKEN_BUDGETS.free;
  if (scope === "business") return PLAN_TOKEN_BUDGETS.business;
  if (scope === "personal_plus") return PLAN_TOKEN_BUDGETS.personal_plus;
  if (scope.startsWith("booth:")) return PLAN_TOKEN_BUDGETS.event_pass;
  return PLAN_TOKEN_BUDGETS.free;
}

function boothExpiresAt(): Date {
  return planExpiresAt("event_pass");
}

type BudgetRow = {
  tokens_used: number;
  tokens_total: number;
  expires_at: Date | string | null;
};

async function ensureBudgetRow(
  client: import("pg").PoolClient,
  userId: string,
  scope: string,
): Promise<void> {
  const period = budgetPeriod(scope);
  const periodMatch = periodKey(scope);
  const total = tokensTotalForScope(scope);
  const expiresAt = scope.startsWith("booth:") ? boothExpiresAt().toISOString() : null;

  await client.query(
    `INSERT INTO token_budgets (user_id, scope, tokens_total, period, expires_at)
     SELECT $1, $2, $3, $4, $5
     WHERE NOT EXISTS (
       SELECT 1 FROM token_budgets
       WHERE user_id = $1
         AND scope = $2
         AND COALESCE(period, 'none') = $6
     )`,
    [userId, scope, total, period, expiresAt, periodMatch],
  );
}

async function lockBudgetRow(
  client: import("pg").PoolClient,
  userId: string,
  scope: string,
): Promise<BudgetRow | null> {
  const periodMatch = periodKey(scope);
  const { rows } = await client.query<BudgetRow>(
    `SELECT tokens_used, tokens_total, expires_at
     FROM token_budgets
     WHERE user_id = $1
       AND scope = $2
       AND COALESCE(period, 'none') = $3
     FOR UPDATE`,
    [userId, scope, periodMatch],
  );
  return rows[0] ?? null;
}

export async function checkAndDeductTokens(
  userId: string,
  scope: string,
  action: TokenAction,
): Promise<TokenBudgetCheckResult> {
  const cost = TOKEN_COSTS[action];
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await ensureBudgetRow(client, userId, scope);

    const row = await lockBudgetRow(client, userId, scope);
    if (!row) {
      await client.query("ROLLBACK");
      return {
        allowed: false,
        tokensUsed: 0,
        tokensTotal: tokensTotalForScope(scope),
        upgradeMessage: "AI credits หมดแล้ว — อัพเกรดเพื่อใช้ต่อ",
      };
    }

    if (scope.startsWith("booth:") && row.expires_at) {
      const expires =
        row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
      if (!Number.isNaN(expires.getTime()) && expires <= new Date()) {
        await client.query("ROLLBACK");
        return {
          allowed: false,
          tokensUsed: row.tokens_used,
          tokensTotal: row.tokens_total,
          upgradeMessage: "AI credits หมดแล้ว — อัพเกรดเพื่อใช้ต่อ",
        };
      }
    }

    const tokensUsed = Number(row.tokens_used);
    const tokensTotal = Number(row.tokens_total);

    if (tokensUsed + cost > tokensTotal) {
      await client.query("ROLLBACK");
      return {
        allowed: false,
        tokensUsed,
        tokensTotal,
        upgradeMessage: "AI credits หมดแล้ว — อัพเกรดเพื่อใช้ต่อ",
      };
    }

    const periodMatch = periodKey(scope);
    await client.query(
      `UPDATE token_budgets
       SET tokens_used = tokens_used + $1, updated_at = now()
       WHERE user_id = $2
         AND scope = $3
         AND COALESCE(period, 'none') = $4`,
      [cost, userId, scope, periodMatch],
    );

    await client.query("COMMIT");

    const remaining = tokensTotal - tokensUsed - cost;
    return {
      allowed: true,
      tokensRemaining: remaining,
      creditsDisplay: tokensToCredits(remaining, action),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export type TokenBudgetSummary = {
  used: number;
  total: number;
  remaining: number;
  creditsRemaining: Record<TokenAction, number>;
};

export async function getTokenBudgetSummary(
  userId: string,
  scope: string,
): Promise<TokenBudgetSummary> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureBudgetRow(client, userId, scope);
    const row = await lockBudgetRow(client, userId, scope);
    await client.query("COMMIT");

    const used = row ? Number(row.tokens_used) : 0;
    const total = row ? Number(row.tokens_total) : tokensTotalForScope(scope);
    const remaining = Math.max(0, total - used);

    return {
      used,
      total,
      remaining,
      creditsRemaining: {
        rizq_chat: tokensToCredits(remaining, "rizq_chat"),
        scan_slip: tokensToCredits(remaining, "scan_slip"),
        scan_receipt: tokensToCredits(remaining, "scan_receipt"),
      },
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
