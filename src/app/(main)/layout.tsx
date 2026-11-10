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
import { NavLink } from "@/components/nav-link";
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

type Section = { href: string; label: string; shortLabel?: string; icon: typeof Settings };

const SECTIONS: Section[] = [
  { href: "/inbox", label: "Bandeja", icon: MessageCircle },
  { href: "/revision", label: "Revisión", icon: ClipboardCheck },
  { href: "/campanas", label: "Campañas", icon: Megaphone },
  { href: "/dashboard", label: "Panel", icon: LayoutDashboard },
  { href: "/settings", label: "Configuración", shortLabel: "Config.", icon: Settings },
  { href: "/ayuda", label: "Ayuda", icon: CircleHelp },
];
const AGENCY: Section = { href: "/workspaces", label: "Agencia", icon: Building2 };

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
  const barSections = isSuperAdmin ? [AGENCY, ...SECTIONS] : SECTIONS;
  const tabSections = isSuperAdmin ? [...SECTIONS, AGENCY] : SECTIONS;

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

          {barSections.map(({ href, label, icon: Icon }) => (
            <NavLink key={href} href={href} label={label} variant="bar">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </NavLink>
          ))}

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
          "flex items-center justify-around px-2",
        )}
        aria-label="Navegación móvil"
      >
        {tabSections.map(({ href, label, shortLabel, icon: Icon }) => (
          <NavLink key={href} href={href} label={label} shortLabel={shortLabel} variant="tabs">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
