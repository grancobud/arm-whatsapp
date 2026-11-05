"use client";

import dynamic from "next/dynamic";

// Import estático en el layout: 393 KB de una herramienta de desarrollo, el archivo más
// grande de la app, llegaban a todos los usuarios aunque nunca se mostrara.
const Agentation =
  process.env.NODE_ENV === "development"
    ? dynamic(() => import("agentation").then((m) => m.Agentation), { ssr: false })
    : null;

export function DevTools() {
  return Agentation ? <Agentation /> : null;
}
