import pg from "pg";
import { pgClientOptions } from "./pg-config.mjs";

const client = new pg.Client(pgClientOptions(process.env.DATABASE_URL));
await client.connect();

const cols = await client.query(`
  SELECT column_name, data_type, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'booths'
    AND column_name IN ('pool_gets_share', 'profit_split_method')
  ORDER BY column_name`);

const splitCol = await client.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'booth_members' AND column_name = 'split_percent'`);

const chk = await client.query(`
  SELECT pg_get_constraintdef(oid) AS def
  FROM pg_constraint
  WHERE conrelid = 'public.booths'::regclass AND conname = 'booths_profit_split_method_check'`);

const booths = await client.query(`SELECT id, name, pool_budget, pool_gets_share, profit_split_method FROM booths`);

await client.end();

console.log("=== 0007 verification ===");
console.log("booths columns:", cols.rows);
console.log("split_percent still exists:", splitCol.rows.length > 0);
console.log("profit_split_method CHECK:", chk.rows[0]?.def ?? "MISSING");
console.log("booths rows:", booths.rows);
