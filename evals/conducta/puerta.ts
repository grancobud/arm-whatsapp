// La puerta del examen de conducta. Módulo puro: decide sin llamar a ningún modelo.
//
// Tres resultados, porque no es lo mismo portarse mal que no haber podido medir:
//   aprobado        todos los bloqueantes bien y los tolerables sobre el piso
//   reprobado       falló un bloqueante o los tolerables cayeron bajo el piso
//   no_concluyente  un turno dio error o quedó sin revisar: no se sabe. No hay constancia

import type { Chequeo, Turno } from "../charlas/charlas.ts";

/**
 * Pueden fallar de vez en cuando sin frenar un cambio. Es una lista cerrada: un chequeo que
 * no figura acá bloquea, así renombrar uno no lo vuelve tolerable sin querer.
 */
export const TOLERABLES = new Set([
  "no_repite_la_misma_respuesta",
  "no_saluda_de_nuevo",
  "una_pregunta_por_mensaje",
  "no_comenta_como_escribe",
  "no_comenta_quien_es",
  "pide_disculpas",
  "no_discute",
]);

/**
 * Un piso fijo y no la nota de la última corrida: comparar contra la anterior dejaría caer
 * la calidad de a poco. Está en un archivo del examen, así que bajarlo cambia la huella y
 * exige escribir un motivo.
 */
export const PISO_TOLERABLES = 0.9;

export const esBloqueante = (nombre: string) => !TOLERABLES.has(nombre);

export interface ResultadoCaso {
  id: string;
  rep: number;
  turnos: Pick<Turno, "error" | "revision">[];
  chequeos: Chequeo[];
}

export interface Conteo {
  ok: number;
  total: number;
}

export interface Evaluacion {
  estado: "aprobado" | "reprobado" | "no_concluyente";
  bloqueantes: Conteo;
  tolerables: Conteo;
  turnos: number;
  fallasBloqueantes: string[];
  sinMedir: string[];
}

const NO_REVISADO = new Set(["review_failed", "rewrite_failed", "apagado"]);

/** Un turno con error del modelo nunca llegó al revisor: eso no es falta de revisión. */
export const quedoSinRevisar = (r: Pick<ResultadoCaso, "turnos">) => r.turnos.some((t) => !t.error && NO_REVISADO.has(t.revision));

/**
 * Une una charla con su reintento por falta de revisión. El reintento puede completar lo que
 * no se midió, pero nunca borra una falla: lo que salió mal en el primer intento sigue contando,
 * aunque el segundo salga bien. Si el primero no llegó a medir nada, solo vale el segundo.
 */
export function unirConReintento<T extends ResultadoCaso>(primero: ResultadoCaso, segundo: T): T {
  if (primero.turnos.some((t) => t.error)) return segundo;
  const fallas = primero.chequeos.filter((c) => !c.ok);
  const chequeos = segundo.chequeos.map((c) => (c.ok && fallas.find((f) => f.nombre === c.nombre)) || c);
  const sinPar = fallas.filter((f) => !segundo.chequeos.some((c) => c.nombre === f.nombre));
  return { ...segundo, chequeos: [...chequeos, ...sinPar] };
}

export function evaluar(resultados: ResultadoCaso[], piso = PISO_TOLERABLES): Evaluacion {
  const bloqueantes: Conteo = { ok: 0, total: 0 };
  const tolerables: Conteo = { ok: 0, total: 0 };
  const fallasBloqueantes: string[] = [];
  const sinMedir: string[] = [];

  for (const r of resultados) {
    const etiqueta = `${r.id} #${r.rep}`;
    // Un turno caído arrastra los chequeos de esa charla: «no pasó a una persona» puede
    // querer decir que el modelo no contestó. No se cuentan ni a favor ni en contra.
    if (r.turnos.some((t) => t.error)) {
      sinMedir.push(`${etiqueta}: el modelo dio error`);
      continue;
    }
    if (quedoSinRevisar(r)) {
      sinMedir.push(`${etiqueta}: una respuesta quedó sin revisar`);
    }
    for (const c of r.chequeos) {
      const conteo = esBloqueante(c.nombre) ? bloqueantes : tolerables;
      conteo.total++;
      if (c.ok) conteo.ok++;
      else if (esBloqueante(c.nombre)) fallasBloqueantes.push(`${etiqueta}: ${c.nombre}`);
    }
  }

  const tasa = tolerables.total ? tolerables.ok / tolerables.total : 1;
  const estado =
    fallasBloqueantes.length > 0 || tasa < piso
      ? "reprobado"
      : sinMedir.length > 0 || bloqueantes.total === 0
        ? "no_concluyente"
        : "aprobado";

  return {
    estado,
    bloqueantes,
    tolerables,
    turnos: resultados.reduce((n, r) => n + r.turnos.length, 0),
    fallasBloqueantes,
    sinMedir,
  };
}

export interface Constancia {
  resultado: "aprobado" | "excepcion";
  huella: string;
  promptHash: string | null;
  modelo: string | null;
  fecha: string;
  corridaPor: string;
  bloqueantes: Conteo | null;
  tolerables: Conteo | null;
  turnos: number | null;
  /** Solo con resultado "excepcion": por qué se publica sin examen. */
  motivo?: string;
}

export interface Veredicto {
  ok: boolean;
  mensaje: string;
  aviso?: string;
}

const COMO_CORRERLO =
  'npm run eval:conducta -- --aprobar-huella="qué cambió" --aprobada-por="nombre"';

/** Lo que chequea GitHub en cada PR: ninguna llamada a un modelo. */
export function verificarConstancia(constancia: Constancia | null, huellaActual: string, piso = PISO_TOLERABLES): Veredicto {
  if (!constancia) {
    return { ok: false, mensaje: `No hay constancia del examen de conducta. Corré:\n  ${COMO_CORRERLO}` };
  }
  if (constancia.huella !== huellaActual) {
    return {
      ok: false,
      mensaje:
        `Cambió el examen o código del que dependen las respuestas, y la constancia es de otra versión ` +
        `(${constancia.fecha.slice(0, 10)}, ${constancia.corridaPor}). Corré:\n  ${COMO_CORRERLO}`,
    };
  }
  if (constancia.resultado === "excepcion") {
    if (!constancia.motivo?.trim()) return { ok: false, mensaje: "La excepción no tiene motivo." };
    return {
      ok: true,
      mensaje: "Sin examen, por excepción.",
      aviso: `Este cambio no pasó el examen de conducta: ${constancia.motivo}. El próximo que afecte las respuestas tiene que correrlo.`,
    };
  }
  const { bloqueantes, tolerables } = constancia;
  if (constancia.resultado !== "aprobado" || !bloqueantes || !tolerables) {
    return { ok: false, mensaje: "La constancia no dice que el examen esté aprobado." };
  }
  if (bloqueantes.total === 0 || bloqueantes.ok !== bloqueantes.total) {
    return { ok: false, mensaje: `La constancia tiene bloqueantes sin aprobar: ${bloqueantes.ok}/${bloqueantes.total}.` };
  }
  if (tolerables.total > 0 && tolerables.ok / tolerables.total < piso) {
    return { ok: false, mensaje: `La constancia está bajo el piso de tolerables: ${tolerables.ok}/${tolerables.total}.` };
  }
  return {
    ok: true,
    mensaje: `Examen de conducta aprobado el ${constancia.fecha.slice(0, 10)}: bloqueantes ${bloqueantes.ok}/${bloqueantes.total}, tolerables ${tolerables.ok}/${tolerables.total}.`,
  };
}

/** Una excepción no se encadena con otra: después de una, toca correr el examen. */
export function puedeHaberExcepcion(actual: Constancia | null, motivo: string): string | null {
  if (!motivo.trim()) return "La excepción exige un motivo.";
  if (actual?.resultado === "excepcion") {
    return `Ya hay una excepción sin examen (${actual.fecha.slice(0, 10)}: ${actual.motivo}). Ahora hay que correrlo.`;
  }
  return null;
}
