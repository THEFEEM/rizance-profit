import type { BoothCloseResult } from "@/types/booth";

export const BOOTH_CLOSE_REASON_MESSAGES = {
  booth_not_found: "ไม่พบงานบูธนี้",
  already_closed: "งานบูธปิดแล้ว",
} as const;

export type BoothCloseReason = keyof typeof BOOTH_CLOSE_REASON_MESSAGES;

export function boothCloseHttpStatus(reason: BoothCloseReason): number {
  switch (reason) {
    case "booth_not_found":
      return 404;
    case "already_closed":
      return 409;
  }
}

export function boothCloseErrorResponse(reason: BoothCloseReason) {
  return {
    status: boothCloseHttpStatus(reason),
    body: {
      error: {
        message: BOOTH_CLOSE_REASON_MESSAGES[reason],
        reason,
      },
    },
  };
}
