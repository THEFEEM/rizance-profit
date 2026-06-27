export function ChatEmptyState() {
  return (
    <div className="py-12 text-center">
      <p className="text-sm font-medium text-rz-text">สวัสดีค่ะ Rizq ผู้ช่วยการเงินของคุณ</p>
      <p className="mt-2 text-xs text-rz-muted">พิมพ์ หรือ แนบสลิปได้เลย เช่น</p>
      <div className="mt-3 flex flex-col gap-1.5 text-xs text-rz-hint">
        <span>&quot;ซื้อกาแฟ 100&quot;</span>
        <span>&quot;ขายของได้ 500&quot;</span>
        <span>&quot;เดือนนี้กำไรเท่าไหร่?&quot;</span>
        <span className="mt-1">&quot;📷 แนบสลิปให้ Rizq อ่าน&quot;</span>
      </div>
    </div>
  );
}
