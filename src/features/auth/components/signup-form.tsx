"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signup } from "@/features/auth/services/actions";
import { cn } from "@/lib/utils";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="default"
      className="w-full"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Creando cuenta...
        </>
      ) : (
        "Crear cuenta"
      )}
    </Button>
  );
}

export function SignupForm() {
  const [state, formAction] = useActionState(signup, null);

  return (
    <div className={cn("glass rounded-xl p-8 w-full max-w-md space-y-6")}>
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Crear cuenta
        </h1>
        <p className="text-sm text-muted-foreground">
          Empezá a atender tu WhatsApp con IA
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="tu@email.com"
            autoComplete="email"
            aria-required="true"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Contraseña</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••"
            autoComplete="new-password"
            aria-required="true"
            required
          />
        </div>

        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input type="checkbox" name="privacy" required className="mt-0.5" />
          <span>
            Leí y acepto la{" "}
            <Link href="/privacidad" className="text-primary underline-offset-4 hover:underline">
              política de privacidad
            </Link>
            .
          </span>
        </label>

        {state?.error && (
          <p className="text-sm text-destructive" role="alert">
            {state.error}
          </p>
        )}

        <SubmitButton />
      </form>

      <p className="text-center text-sm text-muted-foreground">
        ¿Ya tenés cuenta?{" "}
        <Link
          href="/login"
          className="text-primary underline-offset-4 hover:underline transition-colors duration-150"
        >
          Iniciar sesión
        </Link>
      </p>
    </div>
  );
}
