import { ROLE_STYLES } from "@/components/booth/summary/role-styles";

export function BoothSummaryLegend() {
  return (
    <p className="mt-4 px-4 text-center text-xs text-rz-hint">
      <span className={`inline-block h-2 w-2 rounded-full ${ROLE_STYLES.investor.dot}`} />{" "}
      นักลงทุน ·{" "}
      <span className={`inline-block h-2 w-2 rounded-full ${ROLE_STYLES.manager.dot}`} />{" "}
      ผู้จัดการ (แบ่ง+ค่าแรง) ·{" "}
      <span className={`inline-block h-2 w-2 rounded-full ${ROLE_STYLES.employee.dot}`} />{" "}
      พนักงาน (ค่าแรง)
    </p>
  );
}
