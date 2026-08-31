import { NextRequest, NextResponse } from "next/server";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { EXPORT_KINDS, buildSalesCsv, type ExportKind } from "@/lib/pos-export-queries";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

/**
 * GET /api/pos/summary/export?kind=daily|bills|products|items&start=&end=
 * → ไฟล์ CSV (ดาวน์โหลดตรง ไม่ผ่าน JSON)
 *
 * ยึดกติกาเดียวกับ /api/pos/summary: ช่วงไม่เกิน 366 วัน · ต้องมีเซสชัน POS
 * ตัวเลขทุกตัว server ดึงจาก DB ตามช่วงที่ขอ — client ไม่ประกอบตัวเลขเอง
 *
 * BOM: Excel ภาษาไทยบน Windows ต้องมี UTF-8 BOM ไม่งั้นสระ/วรรณยุกต์เพี้ยน
 */
export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const params = req.nextUrl.searchParams;
  const kind = (params.get("kind") ?? "daily") as ExportKind;
  if (!EXPORT_KINDS.includes(kind)) return posErrorResponse("invalid_kind", 400);

  const date = params.get("date");
  const start = params.get("start") ?? date;
  const end = params.get("end") ?? date;
  if (!start || !end || !DATE_RE.test(start) || !DATE_RE.test(end)) {
    return posErrorResponse("invalid_date", 400);
  }
  if (start > end) return posErrorResponse("invalid_range", 400);
  const spanDays =
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
  if (spanDays > MAX_RANGE_DAYS) return posErrorResponse("range_too_large", 400);

  const { csv, filename } = await buildSalesCsv(userId, kind, start, end);

  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // ชื่อไฟล์เป็นภาษาไทย → ต้องใช้ filename* (RFC 5987) ไม่งั้นเบราว์เซอร์ตั้งชื่อมั่ว
      "Content-Disposition": `attachment; filename="rizance-sales.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
