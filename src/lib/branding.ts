// Per-deployment brand accent override.
//
// The design system ("Glass + Electric Lime", see globals.css) is the product
// default. A deployment dedicated to one customer can tint the accent to their
// brand without forking the stylesheet: set the env vars below in that Vercel
// project only. Unset means every deployment keeps the default look.
//
// Values are raw OKLch triplets "L C H" — the same format globals.css uses, so
// Tailwind can still inject alpha via oklch(var(--token) / <alpha-value>).
// Convert a hex with any OKLch picker; keep L high enough that
// --primary-foreground stays readable on top.
//
//   NEXT_PUBLIC_BRAND_PRIMARY            e.g. "0.4519 0.1632 346.31"
//   NEXT_PUBLIC_BRAND_PRIMARY_FOREGROUND e.g. "0.99 0 0"
//   NEXT_PUBLIC_BRAND_ACCENT             e.g. "0.6708 0.1145 194.03"

const TRIPLET = /^-?\d*\.?\d+\s+-?\d*\.?\d+\s+-?\d*\.?\d+$/;

function triplet(value: string | undefined): string | null {
  const v = value?.trim();
  return v && TRIPLET.test(v) ? v : null;
}

/** Pure: el mismo color con la luminosidad topeada para que se lea sobre blanco. */
export function inkOf(tripletValue: string): string {
  const [l, c, h] = tripletValue.trim().split(/\s+/);
  return `${Math.min(Number(l), 0.5)} ${c} ${h}`;
}

/**
 * Returns a `:root` CSS override for the brand tokens, or null when this
 * deployment has no branding configured.
 *
 * Rendered inline in the root layout so the tint is present on first paint —
 * a client-side swap would flash the default accent first.
 */
export function brandStyleOverride(): string | null {
  const primary = triplet(process.env.NEXT_PUBLIC_BRAND_PRIMARY);
  const primaryFg = triplet(process.env.NEXT_PUBLIC_BRAND_PRIMARY_FOREGROUND);
  const accent = triplet(process.env.NEXT_PUBLIC_BRAND_ACCENT);

  if (!primary && !accent) return null;

  const vars: string[] = [];
  if (primary) {
    // --ring follows --primary so focus states stay on-brand.
    vars.push(`--primary:${primary}`, `--ring:${primary}`, `--chart-1:${primary}`);
  }
  if (primaryFg) vars.push(`--primary-foreground:${primaryFg}`);
  if (accent) vars.push(`--chart-2:${accent}`);

  // Applied to both themes: these tokens are identical in :root and .dark.
  const base = `:root,.dark{${vars.join(";")}}`;
  // En tema claro el color de marca también va como texto: se oscurece si es muy claro.
  return primary ? `${base}:root:not(.dark){--primary-ink:${inkOf(primary)}}` : base;
}
