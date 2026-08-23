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

// ── Shifts (Phase 3) ──────────────────────────────────────────

const minuteOfDay = z.number().int().min(0).max(1439);

export const shiftTemplateCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  startMin: minuteOfDay,
  endMin: minuteOfDay,
  breakMinutes: z.number().int().min(0).max(480).optional(),
  branchId: z.string().uuid().nullish().transform((v) => v ?? null),
});

export const shiftTemplatePatchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(60).optional(),
  startMin: minuteOfDay.optional(),
  endMin: minuteOfDay.optional(),
  breakMinutes: z.number().int().min(0).max(480).optional(),
  isActive: z.boolean().optional(),
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const shiftCreateSchema = z.union([
  // คัดลอกตาราง — day (1 วัน) / week (7 วัน)
  z.object({
    action: z.enum(["copy_day", "copy_week"]),
    from: z.string().regex(DATE_RE),
    to: z.string().regex(DATE_RE),
  }),
  z.object({
    employeeId: z.string().uuid(),
    businessDate: z.string().regex(DATE_RE),
    startMin: minuteOfDay,
    endMin: minuteOfDay,
    breakMinutes: z.number().int().min(0).max(480).optional(),
    branchId: z.string().uuid().nullish().transform((v) => v ?? null),
    templateId: z.string().uuid().nullish().transform((v) => v ?? null),
    note: z.string().trim().max(255).nullish().transform((v) => v || null),
  }),
]);

export const shiftPatchSchema = z.object({
  employeeId: z.string().uuid().optional(),
  businessDate: z.string().regex(DATE_RE).optional(),
  startMin: minuteOfDay.optional(),
  endMin: minuteOfDay.optional(),
  breakMinutes: z.number().int().min(0).max(480).optional(),
  note: z.string().trim().max(255).nullish().transform((v) => (v === undefined ? undefined : v || null)),
  status: z.enum(["scheduled", "working", "completed", "absent", "cancelled"]).optional(),
});

// ── Payroll (Phase 4) ─────────────────────────────────────────

export const payrollCreateSchema = z.object({
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** action-based ทั้งหมด — client ไม่มีทางส่งตัวเลขเงินตรง ๆ ยกเว้น bonus/deduction ที่มีเหตุผลกำกับ */
export const payrollPatchSchema = z.union([
  z.object({
    action: z.enum(["submit_review", "back_to_draft", "cancel", "regenerate", "approve"]),
  }),
  z.object({
    action: z.literal("add_line"),
    itemId: z.string().uuid(),
    kind: z.enum(["bonus", "deduction"]),
    amount: z.number().positive().max(1_000_000),
    reason: z.string().trim().min(1).max(255),
  }),
  z.object({
    action: z.literal("remove_line"),
    lineId: z.string().uuid(),
  }),
]);

// ── Leave (Phase 5) ───────────────────────────────────────────

const DATE_ONLY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const leaveCreateSchema = z
  .object({
    // ประเภทลามาจาก hr_settings.leave_types — ไม่ hardcode รายชื่อที่นี่
    leaveType: z.string().trim().min(1).max(20),
    startDate: DATE_ONLY,
    endDate: DATE_ONLY,
    reason: z.string().trim().max(255).nullish().transform((v) => v || null),
  })
  .refine((v) => v.endDate >= v.startDate, { message: "bad_range" });

/** owner สร้างใบลาแทนพนักงาน (โทรมาลา) — ต้องระบุตัวพนักงาน */
export const leaveOwnerCreateSchema = z
  .object({
    employeeId: z.string().uuid(),
    leaveType: z.string().trim().min(1).max(20),
    startDate: DATE_ONLY,
    endDate: DATE_ONLY,
    reason: z.string().trim().max(255).nullish().transform((v) => v || null),
  })
  .refine((v) => v.endDate >= v.startDate, { message: "bad_range" });

export const leaveReviewSchema = z.union([
  z.object({
    action: z.literal("approve"),
    note: z.string().trim().max(255).nullish().transform((v) => v || null),
  }),
  z.object({
    action: z.literal("reject"),
    note: z.string().trim().min(1).max(255), // ปฏิเสธต้องมีเหตุผล
  }),
  z.object({ action: z.literal("cancel") }),
]);

export const branchCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export const branchPatchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
});
