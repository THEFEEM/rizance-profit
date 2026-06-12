export const BOOTH_ENTRY_REASON_MESSAGES = {
  booth_not_found: "ไม่พบงานบูธนี้",
  booth_closed: "งานบูธปิดแล้ว — ไม่สามารถเพิ่มรายการได้",
  date_out_of_range: "วันที่ต้องอยู่ในช่วงงานบูธ",
  invalid_payer: "ไม่พบสมาชิกที่จ่ายแทน",
} as const;

export const BOOTH_MEMBER_REASON_MESSAGES = {
  booth_not_found: "ไม่พบงานบูธนี้",
  booth_closed: "งานบูธปิดแล้ว — ไม่สามารถแก้สมาชิกได้",
  member_not_found: "ไม่พบสมาชิก",
  invalid_split_percent: "สัดส่วน % แบ่งกำไรไม่ถูกต้อง",
  invalid_payer: "ไม่พบสมาชิกที่จ่ายแทน",
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
    case "invalid_payer":
      return 400;
  }
}

export type BoothMemberReason = keyof typeof BOOTH_MEMBER_REASON_MESSAGES;

export function boothMemberHttpStatus(reason: BoothMemberReason): number {
  switch (reason) {
    case "booth_not_found":
    case "member_not_found":
      return 404;
    case "booth_closed":
      return 409;
    case "invalid_split_percent":
    case "invalid_payer":
      return 400;
  }
}

export function boothMemberErrorResponse(reason: BoothMemberReason) {
  return {
    status: boothMemberHttpStatus(reason),
    body: {
      error: {
        message: BOOTH_MEMBER_REASON_MESSAGES[reason],
        reason,
      },
    },
  };
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
