import type { Metadata } from "next";
import { LoginForm } from "@/features/auth/components/login-form";
import { ArmExplainer } from "@/features/arm/components/arm-explainer";

export const metadata: Metadata = {
  title: "Iniciar sesión — ARM WhatsApp",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;
  return (
    <div className="w-full max-w-md space-y-4 py-8">
      <LoginForm message={message} />
      <ArmExplainer compact />
    </div>
  );
}
