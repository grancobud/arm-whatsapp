import type { Metadata } from "next";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";

export const metadata: Metadata = {
  title: "Nueva contraseña — ARM WhatsApp",
};

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
