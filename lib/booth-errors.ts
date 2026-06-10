export const BOOTH_ENTRY_REASON_MESSAGES = {
  booth_not_found: "ไม่พบงานบูธนี้",
  booth_closed: "งานบูธปิดแล้ว — ไม่สามารถเพิ่มรายการได้",
  date_out_of_range: "วันที่ต้องอยู่ในช่วงงานบูธ",
} as const;

export type BoothEntryReason = keyof typeof BOOTH_ENTRY_REASON_MESSAGES;

export function boothEntryHttpStatus(reason: BoothEntryReason): number {
  switch (reason) {
    case "booth_not_found":
      return 404;
    case "booth_closed":
      return 409;
    case "date_out_of_range":
      return 422;
  }
}

export function boothEntryErrorResponse(reason: BoothEntryReason) {
  return {
    status: boothEntryHttpStatus(reason),
    body: {
      error: {
        message: BOOTH_ENTRY_REASON_MESSAGES[reason],
        reason,
      },
    },
  };
}
