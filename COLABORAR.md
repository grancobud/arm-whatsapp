# Cómo trabajamos en ARM WhatsApp (Gastón + Tomas)

Esta guía es para que los dos avancemos con la auditoría y las mejoras **sin
pisarnos, sin hacer el mismo trabajo dos veces y sin romper producción**.

- Repo: https://github.com/grancobud/arm-whatsapp
- App en producción: https://arm-whatsapp.vercel.app
- Qué es y cómo está armado: [`README.md`](README.md)
- Todo lo hecho hasta ahora y qué le toca a cada uno: [`PUESTA-AL-DIA.md`](PUESTA-AL-DIA.md)

---

## 1. Puesta en marcha (una sola vez)

1. Aceptá la invitación de colaborador en GitHub y cloná el repo:
   ```bash
   git clone https://github.com/grancobud/arm-whatsapp.git
   cd arm-whatsapp
   npm install
   ```
2. Armá **tu propio** entorno, sin usar el de producción:
   - Un proyecto de **Supabase propio** (el plan gratis alcanza) y las
     migraciones de `supabase/migrations/`. Los pasos están en
     [`INSTALAR.md`](INSTALAR.md).
   - `cp .env.local.example .env.local` y completalo con **tus** claves.
   - Modelos: tu propio FreeLLMAPI (`LLM_BASE_URL=http://localhost:31415/v1`)
     u otro endpoint compatible con OpenAI.
3. Verificá que todo ande:
   ```bash
   npm run typecheck && npm run lint && npm run test:unit
   ```

> 🔒 **Claves:** nunca se pasan por chat ni se suben al repo. Cada uno usa las
> suyas. La base de **producción** la maneja solo Gastón: si un cambio necesita
> una migración, va en el PR y Gastón la aplica.

---

## 2. Reparto del trabajo

Cada sección del curso es una tarea. La toma **una sola persona** y se anota
como *issue* en GitHub, asignado a quien la toma. Si un tema no tiene issue,
nadie lo está haciendo: antes de arrancar algo nuevo, creá el issue y asignátelo.

| Sección | Quién | Estado |
| --- | --- | --- |
| Acceso a la API, prompts, herramientas, RAG, funciones avanzadas | Gastón | ✅ hecho |
| **Model Context Protocol (MCP)** | Gastón | ✅ hecho |
| **Agentes y flujos de trabajo** | Tomas | ⏳ |
| **RAG: reranking y recuperación contextual** | Tomas | ⏳ |
| Claude Code y Computer Use | — | exclusivo de Anthropic, no se audita en la app |

---

## 3. Flujo de trabajo (siempre igual)

1. **Traer lo último antes de empezar:**
   ```bash
   git checkout main && git pull
   git checkout -b audit/<tema>      # ej.: audit/agentes, audit/rag-reranking
   ```
2. Trabajar **solo en tu rama**. Nunca subir directo a `main`.
3. Commits chicos y claros, en castellano.
4. Antes de abrir el PR, correr las pruebas (ver sección 5) y pegar los
   resultados en la descripción.
5. Abrir el PR contra `main`. **El otro lo revisa y lo aprueba** antes de
   mergear. Un PR por tema; mejor varios chicos que uno gigante.
6. Si `main` avanzó mientras trabajabas: `git pull origin main` en tu rama,
   resolvé los conflictos y volvé a correr las pruebas.

---

## 4. Archivos "calientes": avisar antes de tocarlos

Casi todas las mejoras pasan por estos archivos. Si los dos necesitan el mismo,
**avisá por el issue o por WhatsApp**: uno lo cambia primero y el otro arranca
después del merge.

- `src/features/inbox/services/prompt-builder.ts` (cómo se arma el prompt)
- `src/features/inbox/services/openrouter.ts` (llamadas al modelo, guardia, herramientas)
- `src/features/inbox/services/buffer.ts` (recorrido de cada mensaje)
- `evals/agente/casos.json` (los casos de la evaluación)
- La tabla **"✅ Auditado y mejorado"** del `README.md`

---

## 5. Las evaluaciones mandan

Ningún cambio de prompt, modelo o lógica del agente se mergea sin medirlo.

| Comando | Qué mide | Necesita modelos |
| --- | --- | :---: |
| `npm run test:unit` | 232 tests de calificadores, guardias, seguridad, citas, PDF, cortes, cliente MCP, aprobaciones y alertas | no |
| `npm run eval:mcp -- --reps=2` | el agente con un servidor MCP real (stock, reserva con aprobación, orden escondida, sistema caído) | sí |
| `npm run eval:agente -- --versiones=v3 --reps=2` | 18 charlas de WhatsApp, nota por código y por un juez | sí |
| `npm run eval:herramientas -- --reps=2` | uso de herramientas con la función real | sí |
| `npm run eval:produccion` | lo que recibe el cliente: `auto`, herramientas, traspaso y revisor, sin juez | sí |
| `npm run eval:conocimiento` | si la búsqueda trae el fragmento correcto | sí |
| `npm run eval:multimedia` | notas de voz, imágenes y PDFs | sí |
| `npm run eval:cache` | cuánto del prompt se reutiliza | sí |

**Línea base actual:** agente **9.7** (10/10 en código, 19 casos con repeticiones independientes), herramientas **40/42**,
multimedia **32/32**. Si tu cambio baja alguno de estos números, no se mergea
hasta entender por qué.

**Huella del examen (`eval:agente`).** Una nota solo se compara con otra si el
examen es el mismo. `evals/huella.ts` calcula un hash del runner (incluido el
prompt del juez), los casos y **todo el código que importan**, siguiendo los
imports solo (calificadores, `reply-guard.ts`, el código de producción que arma el
prompt), más la configuración (modelo, jueces, temperatura). Las versiones de los
paquetes de `node_modules` no entran. La huella aprobada
vive en `evals/agente/huella-aprobada.json`, con fecha, quién la aprobó y por qué.
Si algo de eso cambia, la eval **no corre** y dice qué componente cambió; para
seguir hay que re-aprobarla con un motivo:
```bash
npm run eval:agente -- --aprobar-huella="motivo del cambio" --aprobada-por="nombre"
```
Los prompts (`prompts.ts`) no entran en la huella porque son lo que se evalúa:
cada resultado guarda su hash aparte. El resumen muestra la nota separada por
juez, y `--juez-fijo` usa un solo juez: si falla, o si el proveedor responde con
otro modelo, el caso queda sin juez en vez de calificarlo otro. El 9.6 anterior se midió **antes** de existir la
huella y con la cadena de jueces; vale como referencia, no como comparación
controlada. Idea de Arian Z. Pendiente: llevar la huella a las otras evals.

Las evaluaciones de herramientas y multimedia necesitan estas variables (no
tocan ninguna base real):
```bash
LLM_BASE_URL=http://localhost:31415/v1 LLM_API_KEY=<tu clave> \
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 SUPABASE_SERVICE_ROLE_KEY=x \
npm run eval:herramientas
```

---

## 6. Método de auditoría (el mismo para los dos)

Para cada sección del curso:

1. **Requisitos:** sacar de las lecciones qué tiene que cumplir la app. Saltear
   lo que es exclusivo de Anthropic.
2. **Probar de verdad:** con modelos reales (FreeLLMAPI) y archivos o
   conversaciones de prueba. Siempre con datos ficticios, nunca de clientes.
3. **Tabla de resultados:** ✅ cumple · ⚠️ a medias · ❌ falla.
4. **Corregir** lo que falla y **volver a medir**. Si una técnica del curso no
   mejora los números, no se agrega: se documenta que se probó y por qué no se
   usó.
5. **PR** con la tabla, los números de antes y después, y la fila nueva del
   README.

En el README se dice "auditado y mejorado". No se nombra el curso ni sus
capítulos.

---

## 7. Si usás Claude Code

Al abrir el repo, pegale esto como primer mensaje:

> Trabajo en ARM WhatsApp con Gastón. Leé `COLABORAR.md` y seguilo al pie de la
> letra: trabajá solo en mi rama `audit/<tema>`, nunca subas a `main`, avisame
> antes de tocar los archivos calientes, corré `npm run test:unit` y las
> evaluaciones de mi área antes de proponer un PR, y respondeme en castellano.
> Mi tarea es: <tema del issue>.

---

## 8. Reglas que no se negocian

- ❌ Nada directo a `main`; todo por PR revisado por el otro.
- ❌ Sin claves en el repo ni en el chat.
- ❌ No tocar la base de producción: las migraciones van en el PR.
- ❌ No cambiar el prompt de un cliente real sin avisar.
- ✅ Antes de empezar: `git pull` y revisar los issues abiertos.
- ✅ Todo lo que lee el usuario final, en castellano.
