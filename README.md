# ARM WhatsApp — Agent Relationship Management

Plataforma **multi-tenant** donde un agente de IA y tu equipo trabajan juntos la
relación con cada cliente por WhatsApp. No es solo un bot que contesta: el agente
**recuerda con fuentes**, **propone y espera aprobación** para lo importante, y
**sale a reactivar clientes** con consentimiento. Cada workspace es un negocio.

## Qué lo hace un ARM

- **Memoria con fuentes.** El agente guarda necesidades, objeciones, compromisos
  y datos del cliente citando el mensaje que los respalda. Lo que no tiene fuente
  queda marcado como *corazonada*. En la próxima charla el agente arranca sabiendo
  todo eso, y el equipo lo ve en «Lo que sabemos».
- **El agente propone, una persona decide.** Las acciones sensibles quedan en
  **Revisión** hasta que un manager las aprueba; recién ahí se ejecutan.
- **Reactivación saliente.** **Campañas** a segmentos de contactos con opt-in,
  con plantillas aprobadas por Meta, aprobación previa y envío por tandas. Cuando
  el cliente responde, el agente sigue la conversación. Métricas de enviados,
  respuestas, bajas y fallidos.
- **Los datos son tuyos.** Configuración → Datos exporta todo (JSON) o los
  contactos (CSV). Las credenciales nunca se exportan.

## La IA del agente

El agente no es un único prompt: es una cadena de piezas de IA, cada una con su
tarea y su modelo.

| Pieza | Qué hace |
| --- | --- |
| **Respuesta con herramientas** | Lee la memoria del cliente, el negocio y la Knowledge Base, y responde. Puede llamar herramientas (hasta 5 pasos por turno): consultar disponibilidad, agendar en HighLevel, guardar datos del cliente, llamar webhooks. |
| **Buffer de turnos** | Agrupa los mensajes que el cliente manda seguidos y responde una sola vez, como una persona. |
| **Notas de voz e imágenes** | Transcribe audios y describe imágenes con un modelo multimodal barato, así el agente «escucha» y «ve» sin cambiar de modelo. |
| **Knowledge Base (RAG)** | Búsqueda semántica con pgvector sobre los documentos del negocio; los fragmentos relevantes entran al prompt de cada respuesta. |
| **Memoria con fuentes** | La herramienta `remember_fact` guarda necesidades, objeciones y compromisos con la cita del cliente. |
| **Modo setter** | Califica leads con preguntas eliminatorias y un puntaje estructurado; los calificados pasan al CRM. |
| **Etiquetas y resumen automáticos** | Después de cada respuesta, etiqueta la conversación y actualiza un resumen que mantiene el contexto largo. |
| **Juez de mensajes (Jev)** | Opcional: estima intención, probabilidad de respuesta automática y de baja, y frena respuestas que no corresponden. |
| **Generador de plantillas** | Redacta plantillas de WhatsApp listas para enviar a aprobación de Meta. |
| **Playground** | Probás cada agente y su prompt en un chat de prueba antes de publicarlo. |

### Que la conversación nunca se corte

- **Cadena de modelos de respaldo:** si un modelo falla, se satura o se queda
  sin saldo, la misma charla sigue con el siguiente, con los mismos mensajes.
  Por defecto son 7 modelos gratis y uno pago barato al final
  (`OPENROUTER_FALLBACK_MODELS` la reemplaza sin tocar código).
- **Reintentos** ante errores transitorios del proveedor.
- **Control de costos por workspace:** pasado un umbral diario de tokens, pasa a
  un modelo más barato; pasado el tope, frena la IA y avisa.
- **Guardrails** por prompt: reglas que el agente cumple siempre y cosas que no
  hace nunca.

### Proveedores de modelos

Por defecto usa **[OpenRouter](https://openrouter.ai)**: cientos de modelos con
una sola clave, incluidos modelos gratis. Cada agente puede tener su propio
modelo.

La app también puede usar **cualquier endpoint compatible con la API de
OpenAI**, con dos variables de entorno:

| Variable | Valor |
| --- | --- |
| `LLM_BASE_URL` | URL del endpoint, ej. `https://llm.tu-dominio.com/v1` |
| `LLM_API_KEY` | La clave de ese endpoint |
| `OPENROUTER_DEFAULT_MODEL` | Un modelo que ese endpoint conozca (ej. `auto`) |
| `OPENROUTER_FALLBACK_MODELS` | Lista separada por comas (ej. `auto`) |

Sin `LLM_BASE_URL`, todo sigue por OpenRouter.

### Modelos gratis con FreeLLMAPI

**FreeLLMAPI** es un router local que reparte los pedidos entre proveedores con
cupo gratis y pasa al siguiente cuando uno se agota (modelo `auto`). Corre en tu
PC; para que la app en Vercel lo alcance se publica con un **túnel de
Cloudflare en Docker**:

```
WhatsApp → Vercel (ARM WhatsApp) → https://llm.tu-dominio.com/v1
        → Cloudflare Tunnel → contenedor cloudflared → FreeLLMAPI (tu PC :31415)
```

1. Levantá el túnel con [`deploy/freellmapi-tunnel/docker-compose.yml`](deploy/freellmapi-tunnel/docker-compose.yml)
   (`docker compose up -d`). Se reinicia solo con Docker.
2. En Vercel cargá `LLM_BASE_URL`, `LLM_API_KEY` y los modelos en `auto`.
3. Redeploy.

**Antes de usarlo con clientes reales:** el agente responde solo mientras tu PC
esté prendida, y los proveedores gratis pueden guardar o entrenar con lo que
reciben. Para demos y pruebas es ideal; con datos personales de clientes
conviene un modelo pago que no entrene con los datos.

## Qué más incluye

- **Inbox** tipo WhatsApp Web con buffer inteligente (agrupa mensajes y responde
  como un solo turno coherente).
- **Motor de agente** con state machine + handoff humano, prompting
  personalizable y tools activables (incluye modo setter y agendamiento).
- **CRM** con sincronización opcional a HighLevel (por workspace).
- **Knowledge Base** con búsqueda semántica (pgvector).
- **Templates** y manejo de la ventana de 24 h de Meta.
- **Multi-tenant** con roles, RLS por workspace y super admin.

## Stack

| Capa      | Tecnología                                   |
| --------- | -------------------------------------------- |
| Framework | Next.js 16 + React 19 + TypeScript           |
| Estilos   | Tailwind CSS + shadcn/ui                     |
| Backend   | Supabase (Auth + PostgreSQL + RLS + Storage) |
| IA        | OpenRouter, o cualquier endpoint compatible con OpenAI (`LLM_BASE_URL`) |
| WhatsApp  | YCloud                                       |
| Hosting   | Vercel                                       |

## Instalar

```bash
git clone https://github.com/grancobud/arm-whatsapp.git
cd arm-whatsapp
claude "lee INSTALAR.md e instálalo"
```

El agente configura Supabase, despliega a Vercel, crea el super admin y deja el
cron corriendo. Ver [`INSTALAR.md`](INSTALAR.md).

## Desarrollo local

```bash
npm install
cp .env.local.example .env.local   # completá tus keys (o: node scripts/setup.mjs env)
npm run dev                        # http://localhost:3000
```

Otros comandos: `npm run build`, `npm run lint`, `npm run typecheck`.

## El cron

Un job de **pg_cron + pg_net** llama cada minuto a `/api/cron/buffer-flush`
(autenticado con `CRON_SECRET`). Drena los mensajes entrantes agrupados y envía
la siguiente tanda de las campañas aprobadas. Ver
[`supabase/cron/schedule-buffer-flush.sql`](supabase/cron/schedule-buffer-flush.sql).

## Estructura

```
src/
├── app/        # Next.js App Router ((auth), (main), api/)
├── features/   # Feature-First (arm, inbox, settings, tools, agents, …)
└── shared/     # Reutilizable (components, lib, types)
supabase/
├── migrations/ # Schema (RLS, super admin, pg_cron, ARM, …)
└── cron/       # SQL post-deploy del cron
scripts/
├── setup.mjs       # Orquestador de instalación (secrets, env, db, cron)
└── seed-admin.mjs  # Super admin + workspace demo
```

## Variables de entorno

Ver [`.env.local.example`](.env.local.example). `ENCRYPTION_KEY`,
`BUFFER_PROCESS_SECRET` y `CRON_SECRET` las genera `scripts/setup.mjs`. YCloud y
HighLevel no son variables de entorno: se configuran por workspace en
Settings → Integraciones.

Lo que se guarda en Integraciones se cifra con **AES-256-GCM** antes de tocar la
base, ligado a su `workspace_id` + proveedor: un blob copiado de un tenant a otro
no descifra.

---

## Autores

ARM WhatsApp es un trabajo conjunto de:

- **Gastón R. Persoglia** — [@grancobud](https://github.com/grancobud)
- **Tomas Skarp** — [@thomasskarp](https://github.com/thomasskarp)

## Licencia

[MIT](LICENSE).
