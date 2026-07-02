import { RegisterForm } from "@/components/auth/RegisterForm";
import { isGoogleLoginUiEnabled } from "@/lib/google-oauth";

const PAID_PLANS = new Set(["personal_plus", "event_pass", "business"]);

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const redirect = typeof params.redirect === "string" ? params.redirect : undefined;
  const plan = typeof params.plan === "string" ? params.plan : undefined;
  const checkoutPlan = redirect === "checkout" && plan && PAID_PLANS.has(plan) ? plan : undefined;

  return <RegisterForm googleEnabled={isGoogleLoginUiEnabled()} checkoutPlan={checkoutPlan} />;
}
