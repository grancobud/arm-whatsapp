"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Pure: ¿esta ruta es la sección en la que está parada la persona? */
export function isCurrentSection(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Enlace de navegación que sabe si es la sección actual. La barra tiene que
 * decir dónde estás: sin esto las siete entradas pesan lo mismo.
 */
export function NavLink({
  href,
  label,
  shortLabel,
  variant,
  children,
}: {
  href: string;
  label: string;
  shortLabel?: string;
  variant: "bar" | "tabs";
  children: React.ReactNode;
}) {
  const current = isCurrentSection(usePathname(), href);

  if (variant === "tabs") {
    return (
      <Link
        href={href}
        aria-current={current ? "page" : undefined}
        className={cn(
          "flex min-w-11 flex-col items-center gap-0.5 text-xs transition-colors duration-150",
          current ? "font-medium text-primary" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {children}
        <span>{shortLabel ?? label}</span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "hidden h-8 items-center gap-2 rounded-md px-3 text-xs font-medium md:inline-flex",
        "transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97]",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        current
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {children}
      <span className="sr-only lg:not-sr-only">{label}</span>
    </Link>
  );
}
