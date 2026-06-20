import { LoginForm } from "@/components/auth/LoginForm";
import { isGoogleLoginUiEnabled } from "@/lib/google-oauth";

export default function LoginPage() {
  return <LoginForm googleEnabled={isGoogleLoginUiEnabled()} />;
}
