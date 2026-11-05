// Política de contenido de las páginas. Sale del middleware porque lleva un nonce
// nuevo en cada pedido: solo corren los scripts que Next o la app firmaron con él.
// Sin 'unsafe-inline' en scripts, un HTML inyectado no ejecuta nada.
//
// style-src sigue con 'unsafe-inline': los componentes usan style="" y un estilo
// inyectado no ejecuta código.

const CONNECT_SRC = [
  "'self'",
  "*.supabase.co",
  // Realtime necesita wss:// explícito: un host sin esquema no siempre cubre WebSocket.
  "wss://*.supabase.co",
  "api.ycloud.com",
  "openrouter.ai",
  "services.leadconnectorhq.com",
];

/** Pure: el encabezado para un nonce. En desarrollo suma eval y los sockets de HMR. */
export function buildCsp(nonce: string, opts: { isDev: boolean; supabaseUrl?: string }): string {
  const { isDev, supabaseUrl } = opts;
  // Un Supabase propio (o el local) no entra en *.supabase.co.
  const propio = supabaseUrl && !supabaseUrl.includes(".supabase.co") ? [supabaseUrl] : [];
  const connect = [
    ...CONNECT_SRC,
    ...propio,
    ...propio.map((url) => url.replace(/^http/, "ws")),
    ...(isDev ? ["ws://localhost:*", "http://localhost:*"] : []),
  ];
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: *.supabase.co${propio.length ? ` ${propio[0]}` : ""}`,
    `media-src 'self' blob: *.supabase.co${propio.length ? ` ${propio[0]}` : ""}`,
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Las rutas de API devuelven datos: no tienen nada que cargar ni ejecutar. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";
