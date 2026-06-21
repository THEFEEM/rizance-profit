import { redirect } from "next/navigation";

/** Pricing UI hidden (Fix Pack I) — DB/API preserved for later. */
export default function PricingLayout() {
  redirect("/summary");
}
