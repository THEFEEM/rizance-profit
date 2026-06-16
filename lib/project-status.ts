/**
 * Project lifecycle + entry payment/approval status labels (Thai).
 * payment_status is a single-user label — not a multi-user workflow.
 */

import type { PaymentStatus, ProjectStatus } from "@/types/project";

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: "วางแผน",
  active: "กำลังดำเนินงาน",
  closed: "ปิดโครงการ",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
  paid: "จ่าย/รับแล้ว",
  rejected: "ปฏิเสธ",
};

export function projectStatusLabel(status: ProjectStatus): string {
  return PROJECT_STATUS_LABELS[status];
}

export function paymentStatusLabel(status: PaymentStatus): string {
  return PAYMENT_STATUS_LABELS[status];
}
