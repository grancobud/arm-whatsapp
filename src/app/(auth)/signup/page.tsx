import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignupForm } from "@/features/auth/components/signup-form";
import { isSignupOpen } from "@/features/auth/services/signup-gate";

export const metadata: Metadata = {
  title: "Crear cuenta — ARM WhatsApp",
};

// The gate depends on live data (does any user exist yet?). Without this the
// page has no dynamic API usage, so Next prerenders it at build time — when
// there are zero users — and keeps serving the signup form forever.
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  // Invite-only after bootstrap: once the admin account exists, no public signup.
  if (!(await isSignupOpen())) {
    redirect(
      "/login?message=El%20registro%20es%20solo%20por%20invitaci%C3%B3n",
    );
  }

  return <SignupForm />;
}
