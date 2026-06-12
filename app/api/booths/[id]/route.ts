import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/validation";
import { boothPatchSchema, validateInvestorSplitPercents } from "@/lib/booth-validation";
import { getBooth, listBoothMembers, updateBooth } from "@/lib/booth-queries";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = boothPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  const existing = await getBooth(userId, id);
  if (!existing) {
    return NextResponse.json({ error: { message: "ไม่พบงานบูธนี้" } }, { status: 404 });
  }

  const nextMethod = parsed.data.profitSplitMethod ?? existing.profitSplitMethod;
  if (nextMethod === "custom_percent") {
    const members = await listBoothMembers(userId, id);
    const splitErr = validateInvestorSplitPercents(members, nextMethod);
    if (splitErr) {
      return NextResponse.json({ error: { message: splitErr, reason: "invalid_split_percent" } }, { status: 400 });
    }
  }

  const start = parsed.data.startDate ?? existing.startDate;
  const end = parsed.data.endDate ?? existing.endDate;
  if (end < start) {
    return NextResponse.json(
      { error: { message: "วันสิ้นสุดต้องไม่ก่อนวันเริ่ม", fields: { endDate: ["วันสิ้นสุดต้องไม่ก่อนวันเริ่ม"] } } },
      { status: 400 },
    );
  }

  const result = await updateBooth(userId, id, parsed.data);
  if (!result.ok) {
    const status =
      result.reason === "booth_not_found"
        ? 404
        : result.reason === "booth_closed"
          ? 409
          : 422;
    return NextResponse.json(
      {
        error: {
          message:
            result.reason === "entries_outside_new_range"
              ? `มีรายการ ${result.count} รายการอยู่นอกช่วงวันที่ใหม่`
              : result.reason,
          reason: result.reason,
          count: result.count,
        },
      },
      { status },
    );
  }

  return NextResponse.json({ data: result.booth });
}
