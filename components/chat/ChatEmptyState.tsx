export function ChatEmptyState() {
  return (
    <div className="py-12 text-center">
      <p className="text-sm font-medium text-rz-text">สวัสดีค่ะ ผู้ช่วยจดบัญชี</p>
      <p className="mt-2 text-xs text-rz-muted">พิมพ์รายการ หรือแนบสลิป</p>
      <div className="mt-3 flex flex-col gap-1.5 text-xs text-rz-hint">
        <span>&quot;ซื้อกาแฟ 100&quot;</span>
        <span>&quot;ขายของได้ 500&quot;</span>
        <span>&quot;จ่ายค่าเช่า 3000 โอน&quot;</span>
        <span className="mt-1">📷 ถ่ายสลิปแล้วให้ AI อ่านให้</span>
      </div>
    </div>
  );
}
