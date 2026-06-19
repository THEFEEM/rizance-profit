import { redirect } from "next/navigation";

export default function ExpenseRedirect() {
  redirect("/entry?tab=expense");
}
