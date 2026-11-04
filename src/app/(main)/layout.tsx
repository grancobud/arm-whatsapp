import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/features/auth/services/actions";
import {
  getActiveWorkspace,
  listMemberships,
} from "@/features/workspace/services/active-workspace";
import { WorkspaceSwitcher } from "@/features/workspace/components/workspace-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Building2,
  CircleHelp,
  ClipboardCheck,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageCircle,
  Settings,
} from "lucide-react";
import Link from "next/link";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Super admin flag + active workspace context + membership list (for switcher)
  const [{ data: userRow }, active, memberships] = await Promise.all([
    supabase
      .from("users")
      .select("is_super_admin")
      .eq("id", user.id)
      .maybeSingle(),
    getActiveWorkspace(supabase, user.id),
    listMemberships(supabase, user.id),
  ]);

  const isSuperAdmin = userRow?.is_super_admin ?? false;
  const activeId = active?.workspace_id ?? null;
  const workspaceName =
    memberships.find((m) => m.workspace_id === activeId)?.name ?? null;

  return (
    <div className="min-h-screen flex flex-col">
      <header
        className={cn(
          "glass-strong sticky top-0 z-50 h-14 shrink-0",
          "flex items-center justify-between px-3 sm:px-6",
          "border-b border-border/50",
        )}
      >
        {/* Left: brand + workspace name */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-display text-base font-semibold text-primary tracking-tight shrink-0">
            ARM WhatsApp
          </span>
          {workspaceName && (
            <>
              <span
                className="text-border/70 select-none shrink-0"
                aria-hidden="true"
              >
                /
              </span>
              {memberships.length > 1 && activeId ? (
                <WorkspaceSwitcher
                  workspaces={memberships.map((m) => ({
                    workspace_id: m.workspace_id,
                    name: m.name,
                  }))}
                  activeId={activeId}
                />
              ) : (
                <span
                  className="font-mono text-xs text-muted-foreground truncate max-w-[120px] sm:max-w-[200px]"
                  title={workspaceName}
                >
                  {workspaceName}
                </span>
              )}
            </>
          )}
        </div>

        {/* Right: agency link (super admin only) + dashboard + settings + logout.
            On phones the bottom nav has these links, so only theme + logout stay
            here (with all the icons the bar overflowed onto the logo). */}
        <div className="flex items-center gap-1 shrink-0">
          <ThemeToggle />

          {isSuperAdmin && (
            <Link href="/workspaces" className="hidden md:inline-flex">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
              >
                <Building2 className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only sm:ml-2">Agencia</span>
              </Button>
            </Link>
          )}

          <Link href="/inbox" className="hidden md:inline-flex">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only sm:ml-2">Bandeja</span>
            </Button>
          </Link>

          <Link href="/revision" className="hidden md:inline-flex">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
            >
              <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only sm:ml-2">Revisión</span>
            </Button>
          </Link>

          <Link href="/campanas" className="hidden md:inline-flex">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
            >
              <Megaphone className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only sm:ml-2">Campañas</span>
            </Button>
          </Link>

          <Link href="/dashboard" className="hidden md:inline-flex">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
            >
              <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only sm:ml-2">Panel</span>
            </Button>
          </Link>

          <Link href="/settings" className="hidden md:inline-flex">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
            >
              <Settings className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only sm:ml-2">Configuración</span>
            </Button>
          </Link>

          <Link href="/ayuda" className="hidden md:inline-flex">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
            >
              <CircleHelp className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only sm:ml-2">Ayuda</span>
            </Button>
          </Link>

          <form action={logout}>
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only sm:ml-2">Salir</span>
            </Button>
          </form>
        </div>
      </header>

      <div className="flex-1 pb-14 md:pb-0">{children}</div>

      {/* Mobile bottom nav — hidden on md+ */}
      <nav
        className={cn(
          "md:hidden fixed bottom-0 inset-x-0 z-50 h-14",
          "glass-strong border-t border-border/50",
          "flex items-center justify-around px-4",
        )}
        aria-label="Navegación móvil"
      >
        <Link
          href="/inbox"
          className="flex flex-col items-center gap-0.5 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <MessageCircle className="h-5 w-5" aria-hidden="true" />
          <span>Bandeja</span>
        </Link>

        <Link
          href="/revision"
          className="flex flex-col items-center gap-0.5 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
          <span>Revisión</span>
        </Link>

        <Link
          href="/campanas"
          className="flex flex-col items-center gap-0.5 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <Megaphone className="h-5 w-5" aria-hidden="true" />
          <span>Campañas</span>
        </Link>

        <Link
          href="/dashboard"
          className="flex flex-col items-center gap-0.5 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <LayoutDashboard className="h-5 w-5" aria-hidden="true" />
          <span>Panel</span>
        </Link>

        <Link
          href="/settings"
          className="flex flex-col items-center gap-0.5 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <Settings className="h-5 w-5" aria-hidden="true" />
          <span>Ajustes</span>
        </Link>

        <Link
          href="/ayuda"
          className="flex flex-col items-center gap-0.5 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <CircleHelp className="h-5 w-5" aria-hidden="true" />
          <span>Ayuda</span>
        </Link>

        {isSuperAdmin && (
          <Link
            href="/workspaces"
            className="flex flex-col items-center gap-0.5 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            <Building2 className="h-5 w-5" aria-hidden="true" />
            <span>Agencia</span>
          </Link>
        )}
      </nav>
    </div>
  );
}
