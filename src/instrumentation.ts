// Next llama a esto con cada error que ninguna ruta atrapó. Sin esto solo quedan en los
// logs de Vercel, que en el plan Hobby duran 1 hora y nadie mira.
export async function onRequestError(err: unknown, request: { path?: string }): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportUnexpectedError } = await import("@/features/alerts/alerts");
  await reportUnexpectedError(request?.path ?? "desconocida", err);
}
