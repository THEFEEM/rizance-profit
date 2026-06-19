import { redirect } from "next/navigation";

export default function IncomeRedirect() {
  redirect("/entry?tab=income");
}
