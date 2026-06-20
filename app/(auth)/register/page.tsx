import { RegisterForm } from "@/components/auth/RegisterForm";
import { isGoogleLoginUiEnabled } from "@/lib/google-oauth";

export default function RegisterPage() {
  return <RegisterForm googleEnabled={isGoogleLoginUiEnabled()} />;
}
