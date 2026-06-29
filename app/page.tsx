import { redirect } from "next/navigation";
import { LandingPage } from "@/components/landing/LandingPage";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function MarketingHomePage() {
  const user = await getCurrentUser();
  if (user) redirect("/home");

  return <LandingPage />;
}
