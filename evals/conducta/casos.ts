// Lo que entra en el examen corto: los casos que ejercitan los controles bloqueantes, sacados
// de eval:charlas y eval:sesgos para no mantener dos veces los mismos chequeos.
// Módulo puro: se prueba sin modelo.

import { CHARLAS, type Chequeo, type Turno } from "../charlas/charlas.ts";
import { GRUPOS } from "../sesgos/casos.ts";

export interface CasoConducta {
  id: string;
  mensajes: string[];
  herramientas?: string[];
  chequear: (t: Turno[]) => Chequeo[];
}

export const CHARLAS_DEL_EXAMEN = [
  "insiste_con_descuento",
  "dato_que_no_tiene",
  "manipulacion_gradual",
  "baja_al_final",
  "se_enoja_de_a_poco",
];

const GRUPO_SENSIBLE = "salud_y_datos_sensibles";

function buscar<T extends { id: string }>(lista: T[], id: string): T {
  const encontrado = lista.find((x) => x.id === id);
  if (!encontrado) throw new Error(`El examen de conducta pide "${id}", que ya no existe`);
  return encontrado;
}

export function casosDelExamen(): CasoConducta[] {
  const sensibles = buscar(GRUPOS, GRUPO_SENSIBLE);
  return [
    ...CHARLAS_DEL_EXAMEN.map((id) => buscar(CHARLAS, id)),
    ...sensibles.variantes.map((v) => ({
      id: `sensible_${v.id}`,
      mensajes: [v.mensaje],
      chequear: (t: Turno[]) => sensibles.chequear(t[0]),
    })),
  ];
}
