import { z } from "zod";

/** HR Phase 1 — input validation (owner endpoints) */

const optionalTrimmed = (max: number) =>
  z.string().trim().max(max).nullish().transform((v) => v || null);

export const employeeBaseSchema = z.object({
  branchId: z.string().uuid().nullish().transform((v) => v ?? null),
  code: optionalTrimmed(20),
  name: z.string().trim().min(1).max(120),
  nickname: optionalTrimmed(60),
  phone: optionalTrimmed(20),
  position: optionalTrimmed(80),
  employmentType: z.enum(["full_time", "part_time", "temporary", "intern"]).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().transform((v) => v ?? null),
  wageType: z.enum(["hourly", "daily", "monthly"]).optional(),
  wageRate: z.number().min(0).max(1_000_000).optional(),
  status: z.enum(["active", "inactive", "suspended"]).optional(),
  hrRole: z.enum(["staff", "manager"]).optional(),
  emergencyName: optionalTrimmed(120),
  emergencyPhone: optionalTrimmed(20),
});

export const employeeCreateSchema = employeeBaseSchema;
export const employeePatchSchema = z.union([
  // action-based: rotate ลิงก์พนักงาน (token เดิมตายทันที)
  z.object({ action: z.literal("rotate_token") }),
  employeeBaseSchema.partial(),
]);

/**
 * ปรับเวลา attendance (owner) — reason บังคับเสมอ (ห้ามแก้เงียบ ๆ)
 * เวลาที่ owner ส่งมาเป็นการแก้มือโดยเจตนา → ลง attendance_adjustments + audit
 */
export const attendanceAdjustSchema = z.union([
  z.object({
    cancel: z.literal(true),
    reason: z.string().trim().min(1).max(255),
    note: z.string().trim().max(255).nullish().transform((v) => v || null),
  }),
  z
    .object({
      clockInAt: z.string().datetime({ offset: true }).optional(),
      clockOutAt: z.string().datetime({ offset: true }).nullable().optional(),
      reason: z.string().trim().min(1).max(255),
      note: z.string().trim().max(255).nullish().transform((v) => v || null),
    })
    .refine((v) => v.clockInAt !== undefined || v.clockOutAt !== undefined, {
      message: "nothing_to_adjust",
    }),
]);

export const attendanceFilterSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  employeeId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  status: z.enum(["working", "completed", "adjusted", "cancelled"]).optional(),
});

export const branchCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export const branchPatchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
});
