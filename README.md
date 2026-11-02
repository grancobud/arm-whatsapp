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

## Licencia

[MIT](LICENSE).
