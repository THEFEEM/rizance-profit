import { z } from "zod";
import { isValidDate } from "@/lib/date";

const moneyNonNegative = z
  .number()
  .finite()
  .gte(0)
  .max(9_999_999_999.99)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
    message: "Amount can have at most 2 decimal places",
  });

const boothDate = z.string().refine(isValidDate, "วันที่ต้องเป็น YYYY-MM-DD");

export const boothSchema = z
  .object({
    name: z.preprocess(
      (v) => (typeof v === "string" ? v.trim() : v),
      z.string().min(1, "กรุณาระบุชื่องาน").max(120),
    ),
    startingBudget: moneyNonNegative,
    startDate: boothDate,
    endDate: boothDate,
    note: z.preprocess(
      (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
      z.string().max(255).optional(),
    ),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: "วันสิ้นสุดต้องไม่ก่อนวันเริ่ม",
    path: ["endDate"],
  });

export type BoothSchemaInput = z.infer<typeof boothSchema>;
