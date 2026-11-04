<div align="center">

# 🤝 ARM WhatsApp

### Agent Relationship Management por WhatsApp

**Un agente de IA y tu equipo trabajando juntos la relación con cada cliente.**
No es un bot que contesta: recuerda con fuentes, propone y espera tu aprobación,
y sale a reactivar clientes con consentimiento.

![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-RLS%20%2B%20pgvector-3ECF8E?logo=supabase&logoColor=white)
![WhatsApp](https://img.shields.io/badge/WhatsApp-YCloud-25D366?logo=whatsapp&logoColor=white)
![FreeLLMAPI](https://img.shields.io/badge/IA-FreeLLMAPI%20gratis-8A2BE2)
![Cloudflare](https://img.shields.io/badge/T%C3%BAnel-Cloudflare-F38020?logo=cloudflare&logoColor=white)
![Vercel](https://img.shields.io/badge/Deploy-Vercel-000000?logo=vercel&logoColor=white)
![Licencia](https://img.shields.io/badge/licencia-MIT-blue)

**[🌐 arm-whatsapp.vercel.app](https://arm-whatsapp.vercel.app)**

</div>

---

## 🧠 ¿Qué es un ARM y por qué esto es uno?

Un **CRM** guarda lo que tu equipo carga a mano. Un **ARM** (*Agent Relationship
Management*) pone a un agente de IA a trabajar la relación **junto** al equipo:
conversa, recuerda, propone y actúa, siempre con una persona al mando de lo
importante.

| | Pilar | Cómo lo hace ARM WhatsApp |
| :---: | --- | --- |
| 🧾 | **Memoria con fuentes** | El agente guarda necesidades, objeciones, compromisos y datos citando el mensaje del cliente que los respalda. Lo que no tiene fuente queda como *corazonada*. En la próxima charla arranca sabiendo todo, y el equipo lo ve en «Lo que sabemos». |
| ✋ | **El agente propone, una persona decide** | Las acciones sensibles quedan en **Revisión** hasta que un manager las aprueba. Recién ahí se ejecutan. |
| 📣 | **Reactivación saliente** | **Campañas** a segmentos con opt-in, plantillas aprobadas por Meta, aprobación previa y envío por tandas. Cuando el cliente responde, el agente sigue la charla. |
| 🤝 | **Cumple lo que promete** | Si el agente le dice a un cliente «te escribo el jueves», lo agenda y el jueves le escribe. Pasadas las 24 h de WhatsApp usa la plantilla aprobada que elijas en Automatizaciones; si no hay, le llega un mail al equipo para que escriba una persona. Las promesas se ven en la ficha del contacto. |
| 🎚️ | **Autonomía que se gana** | Cada herramienta tiene su modo: «Lo hace solo» o «Lo propone y alguien aprueba». Con 10 aprobaciones seguidas sin un rechazo, la pantalla sugiere darle más autonomía en esa tarea. |
| 🎓 | **Aprende de las correcciones** | «Corregir» en una respuesta de la IA, o rechazar una propuesta en Revisión explicando por qué, deja una lección. El agente sigue las 15 más nuevas en cada charla, y el equipo las ve en «Lo que aprendió el agente». |
| 🌡️ | **Sabe con quién hablar hoy** | Cada contacto tiene un puntaje de relación de 0 a 100 (cuándo escribió, cuánto escribe, si responde, su etapa y los riesgos abiertos) y un estado: activa, enfriándose, fría o perdida. El Panel sugiere «Para escribirle hoy». |
| 🚫 | **Respeta la baja** | Si el cliente escribe «BAJA», se la confirma y nadie le vuelve a escribir: ni la IA, ni las campañas, ni las automatizaciones. Con «ALTA» vuelve. |
| 📊 | **Mide resultados, no mensajes** | El Panel cuenta turnos agendados, leads calificados, el porcentaje que resolvió la IA sola, promesas cumplidas, bajas y respuestas a campañas, también por agente. |
| 📦 | **Los datos son tuyos** | Configuración → Datos exporta todo en JSON o los contactos en CSV. Las credenciales nunca salen. |

```mermaid
flowchart LR
    C([📱 Cliente]) -->|WhatsApp| B[⏳ Buffer de turnos]
    B --> A{🤖 Agente}
    M[(🧾 Memoria<br/>con fuentes)] --> A
    K[(📚 Knowledge<br/>Base)] --> A
    A -->|respuesta| C
    A -->|acción sensible| R[✋ Revisión]
    R -->|manager aprueba| X[⚙️ Se ejecuta]
    A -->|dato nuevo| M
    CA[📣 Campañas] -->|plantilla con opt-in| C
    A -->|«te escribo el jueves»| P[🤝 Promesa]
    P -->|el jueves| C
    E[🎓 Correcciones<br/>del equipo] --> A

    style A fill:#8A2BE2,color:#fff
    style R fill:#F38020,color:#fff
    style M fill:#3ECF8E,color:#000
    style CA fill:#25D366,color:#000
    style P fill:#0EA5E9,color:#fff
    style E fill:#E5484D,color:#fff
```

---

## ⚡ La IA: modelos gratis con FreeLLMAPI

El agente corre con **FreeLLMAPI**, un router
local que reparte cada pedido entre proveedores con cupo gratis y salta al
siguiente cuando uno se agota (modelo `auto`). **Costo de IA: cero.**

Corre en tu PC y la app en Vercel lo alcanza por un **túnel de Cloudflare dentro
de Docker**, que arranca solo junto con Docker:

```mermaid
flowchart LR
    W([📱 WhatsApp]) --> V[▲ Vercel<br/>ARM WhatsApp]
    V -->|HTTPS + clave| T[☁️ Cloudflare Tunnel]
    T --> D[🐳 cloudflared<br/>en Docker]
    D --> F[⚡ FreeLLMAPI<br/>tu PC :31415]
    F --> P1[Gemini]
    F --> P2[Qwen]
    F --> P3[Mistral]
    F --> P4[…y más]

    style F fill:#8A2BE2,color:#fff
    style T fill:#F38020,color:#fff
    style V fill:#000,color:#fff
```

**Conectarlo en 3 pasos**

1. 🐳 Levantá el túnel: [`deploy/freellmapi-tunnel/docker-compose.yml`](deploy/freellmapi-tunnel/docker-compose.yml) → `docker compose up -d`.
2. 🔑 En Vercel cargá las variables:

   | Variable | Valor |
   | --- | --- |
   | `LLM_BASE_URL` | `https://llm.tu-dominio.com/v1` |
   | `LLM_API_KEY` | la clave de FreeLLMAPI |
   | `OPENROUTER_DEFAULT_MODEL` | `auto` |
   | `OPENROUTER_FALLBACK_MODELS` | `auto,auto:fast` |

3. 🚀 Redeploy.

> [!IMPORTANT]
> **Respaldo:** si `LLM_BASE_URL` no responde (la PC apagada, el túnel caído o
> FreeLLMAPI sin cupo), la misma consulta va a OpenRouter con
> `OPENROUTER_API_KEY` y un modelo gratis (`google/gemma-4-31b-it:free` y
> después `openrouter/free`; `LLM_BACKUP_MODELS` los cambia). Durante un minuto
> se usa directo el respaldo y llega un mail de alerta. Sin `OPENROUTER_API_KEY`
> no hay respaldo.

> [!NOTE]
> Sirve cualquier endpoint compatible con la API de OpenAI: cambiás `LLM_BASE_URL`
> y listo. Las variables `OPENROUTER_*` conservan ese nombre por compatibilidad,
> pero apuntan al endpoint que configures. Los embeddings de la Knowledge Base
> también salen de ahí (`gemini-embedding-001`, fijo; `KB_EMBEDDING_MODEL` lo
> cambia, pero hay que volver a cargar los documentos). Las imágenes también (`MEDIA_IMAGE_MODEL`,
> por defecto `mistral-medium-3.5`) y las notas de voz (`MEDIA_AUDIO_MODEL`, por
> defecto `whisper-large-v3`, por `/audio/transcriptions`).

> [!WARNING]
> **Antes de usarlo con clientes reales:** el agente responde solo mientras tu PC
> esté prendida, y los proveedores gratis pueden guardar o entrenar con lo que
> reciben. Ideal para demos y pruebas. Con datos personales de clientes, conviene
> un modelo pago que no entrene con los datos.

### 🧩 Las piezas de IA

Así recorre un mensaje del cliente todas las piezas.

**1 · Llega el mensaje**

```mermaid
flowchart LR
    C([📱 Cliente]) --> T{¿Audio o<br/>imagen?}
    T -->|sí| V[🎙️ Transcribe<br/>o describe]
    T -->|no| B
    V --> B[⏳ Buffer<br/>junta mensajes]
    B --> J{⚖️ Juez Jev<br/>¿responder?}
    J -->|no| H[🙋 Pasa a<br/>una persona]
    J -->|sí| A{{🤖 Agente}}

    style C fill:#25D366,color:#000
    style B fill:#0EA5E9,color:#fff
    style J fill:#F38020,color:#fff
    style A fill:#8A2BE2,color:#fff
```

**2 · El agente responde**

```mermaid
flowchart LR
    M[(🧾 Memoria)] --> A{{🤖 Agente}}
    K[(📚 Knowledge<br/>Base)] --> A
    N[(🏪 Negocio)] --> A
    A <-->|hasta 5 pasos| HR[🔧 Herramientas]
    A --> G{🚫 Guardia}
    G -->|texto roto| A
    G -->|ok| R([💬 WhatsApp])
    R --> E[🏷️ Etiquetas<br/>y resumen]
    A -.->|dato nuevo| M

    style A fill:#8A2BE2,color:#fff
    style G fill:#E5484D,color:#fff
    style M fill:#3ECF8E,color:#000
    style K fill:#3ECF8E,color:#000
    style N fill:#3ECF8E,color:#000
    style R fill:#25D366,color:#000
```

| | Pieza | Qué hace |
| :---: | --- | --- |
| 💬 | **Respuesta con herramientas** | Lee memoria, negocio y Knowledge Base y responde. Hasta 5 pasos de herramientas por turno: disponibilidad, agendar en HighLevel, guardar datos del cliente, webhooks. |
| ⏳ | **Buffer de turnos** | Junta los mensajes que el cliente manda seguidos y responde una sola vez, como una persona. |
| 🎙️ | **Notas de voz e imágenes** | Transcribe audios y describe imágenes, así el agente «escucha» y «ve». |
| 📚 | **Knowledge Base (RAG)** | Búsqueda semántica con pgvector sobre los documentos del negocio. |
| 🎯 | **Modo setter** | Califica leads con preguntas eliminatorias y puntaje; los calificados pasan al CRM. |
| 🏷️ | **Etiquetas y resumen** | Etiqueta cada conversación y mantiene un resumen para el contexto largo. |
| ⚖️ | **Juez de mensajes (Jev)** | Opcional: estima intención y probabilidad de baja, y frena lo que no corresponde. Gratis con FreeLLMAPI (12/12 en `npm run eval:jev`) o con TypeSafe si hay `TYPESAFE_API_KEY`. |
| 📝 | **Generador de plantillas** | Redacta plantillas listas para la aprobación de Meta. |
| 🧪 | **Playground** | Probás cada agente y su prompt antes de publicarlo. |

### 🔌 Los sistemas del negocio, por MCP

En **Configuración → Sistemas (MCP)** cada negocio conecta el servidor MCP de su
stock, su agenda o su CRM. El agente usa esas herramientas en la charla sin que
haya que programar la integración, y un manager decide cuáles quedan libres y
cuáles piden aprobación.

```mermaid
flowchart LR
    C([📱 Cliente]) --> A{{🤖 Agente}}
    A -->|consulta libre| S1[(📦 Stock<br/>servidor MCP)]
    A -->|acción| R[✋ Revisión]
    R -->|un manager aprueba| S1
    A -->|consulta| S2[(📅 Agenda / CRM<br/>servidor MCP)]
    S1 -->|datos, no órdenes| A
    S2 -->|datos, no órdenes| A
    A -->|respuesta| C

    style A fill:#8A2BE2,color:#fff
    style R fill:#F38020,color:#fff
    style S1 fill:#3ECF8E,color:#000
    style S2 fill:#3ECF8E,color:#000
    style C fill:#25D366,color:#000
```

- 🔐 La clave de cada sistema se guarda cifrada y nunca llega al navegador.
- ✋ Toda acción de un sistema externo pide aprobación, salvo las que un manager marque como libres.
- 🧾 Lo que devuelve un sistema es dato: una orden escondida en la respuesta no se cumple.
- 📴 Si un sistema no responde, el agente avisa que ahora no lo puede consultar en vez de inventar.

### 🛡️ Que la conversación nunca se corte ni se rompa

```mermaid
flowchart LR
    P[📝 Pedido] --> M1[🥇 Modelo 1]
    M1 -->|responde| G{🚫 Guardia}
    M1 -->|falla o se satura| M2[🥈 Modelo 2]
    M2 -->|responde| G
    M2 -->|falla| M3[🥉 Modelo 3…]
    M3 --> G
    G -->|cortado, vacío o<br/>razonamiento filtrado| M1
    G -->|ok| OK([✅ Al cliente])

    style G fill:#E5484D,color:#fff
    style OK fill:#25D366,color:#000
    style M1 fill:#8A2BE2,color:#fff
    style M2 fill:#A855F7,color:#fff
    style M3 fill:#C084FC,color:#000
```

- 🔁 **Cadena de respaldo:** si un modelo falla o se satura, la misma charla sigue con el siguiente, con los mismos mensajes.
- 🚫 **Guardia de respuestas:** nunca le llega al cliente un texto cortado, vacío o con el razonamiento interno del modelo. Se reintenta o se pasa a otro modelo.
- 🌡️ **Temperatura baja (0.3):** respuestas consistentes de un mensaje al otro.
- 💰 **Control de costos por workspace:** pasado un umbral diario baja a un modelo más barato; pasado el tope, frena y avisa.
- 📏 **Guardrails** por prompt: lo que el agente hace siempre y lo que no hace nunca.

---

## ✅ Auditado y mejorado

ARM WhatsApp se audita área por área con pruebas reales contra los modelos de
FreeLLMAPI. Cada falla que aparece se corrige en el repo. Las funciones del ARM
(de Automatizaciones para abajo) se construyeron con sus pruebas: `npm run test:unit`
corre 120.

| Área | Estado | Qué se mejoró |
| --- | :---: | --- |
| 💬 Respuestas de la IA | ✅ | Guardia contra respuestas cortadas o con razonamiento filtrado, temperatura fija y system prompt por el canal correcto. |
| 📊 Evaluación del agente | ✅ | Set de 14 conversaciones de WhatsApp con calificación automática por código y por modelo (`npm run eval:agente`). Encontró y se corrigió que una anotación en la memoria del cliente podía hacer que el agente ofreciera descuentos inexistentes. |
| ✍️ Prompts | ✅ | Prompts de arranque nuevos para los 4 tipos de agente: reglas claras con su porqué, etiquetas XML y ejemplos para los casos difíciles. En la evaluación pasó de 9.1 a 9.6: respeta la baja, usa la memoria del cliente y no revela sus instrucciones. |
| 🔧 Herramientas | ✅ | Prueba con la función real y herramientas simuladas (`npm run eval:herramientas`): de 14/20 a 40/42 chequeos. Ahora consulta la agenda antes de ofrecer turnos, no tapa un error del calendario, guarda la memoria del cliente desde la primera charla, siempre responde con texto después de usar una herramienta, no reintenta acciones que podrían reservar dos veces y cuenta bien los tokens de los turnos con herramientas. |
| 📚 Base de conocimiento | ✅ | Embeddings gratis por FreeLLMAPI con un modelo fijo, corte de documentos por secciones (sin partir palabras ni precios) y fragmentos marcados como datos para que una página importada no pueda dar órdenes. Medido con `npm run eval:conocimiento`: el fragmento correcto queda primero en 15 de 17 preguntas (antes 11). Se quitó una búsqueda de respaldo que armaba SQL pegando texto. |
| 🎙️ Audios, imágenes, documentos y caché | ✅ | Notas de voz transcriptas por FreeLLMAPI, sin clave aparte: el chat del router descartaba el audio, así que van por el endpoint de transcripción con un modelo fijo y salen palabra por palabra, números incluidos. Imágenes por FreeLLMAPI con modelo fijo, que copian exactos importes y números de operación de un comprobante. PDFs leídos del lado del servidor: antes el agente decía «no puedo leer su contenido», ahora responde el total y la seña exactos. Imágenes y documentos entran marcados como datos (un cartel con una orden no la hace cumplir). El prompt pone primero lo fijo de cada cliente: el comienzo reutilizable entre mensajes pasó del 1% al 72% y un proveedor con caché ya lee el 83% desde caché (`npm run eval:multimedia`, `npm run eval:cache`). |
| 📌 Citas y razonamiento | ✅ | Cada respuesta que usa la base de conocimiento deja rastro del fragmento que la respalda: el agente lo marca, la marca se saca antes de llegar al cliente y el inbox muestra «Fuentes» con el texto citado. En la evaluación citó bien 8 de 8 (incluido no citar cuando el fragmento no servía). El razonamiento extendido no se activa: el agente ya saca 9.6 y la guardia descarta el razonamiento que algunos modelos mezclan en la respuesta. |
| 🔌 MCP | ✅ | **Servidor:** el MCP de administración pasó al repo (`mcp/admin/`) con herramientas descriptas parámetro por parámetro, errores que el cliente reconoce, 4 recursos, 3 prompts probados y las funciones del ARM: 28/28 con un cliente MCP real. **Cliente:** cada negocio conecta el servidor MCP de su stock, agenda o CRM y el agente lo usa, con aprobación humana por defecto, resultados marcados como datos y aviso honesto si el sistema no responde: 28/28 en `npm run eval:mcp`. Encontró que el agente decía «no tenemos» sin consultar sus herramientas: corregido sin bajar la evaluación (agente 9.6, herramientas 40/42). |
| 🎯 RAG: Reranking y recuperación contextual | ✅ | **Recuperación contextual:** cada fragmento incorpora su jerarquía de documento y sección (`[Documento · Sección]`) para no perder contexto situacional al aislarse. **Reranking híbrido:** ampliación de candidatos iniciales a 10 y reordenamiento con BM25 y Reciprocal Rank Fusion (RRF) en memoria: prioriza términos específicos y códigos exactos (como `PROMO-DIC-05` o `ESTUDIANTE-15`) con cero costo de tokens y latencia imperceptible. En `npm run eval:conocimiento`: pasó de 15/17 a **17 de 17 aciertos (100%)** en el top 3, manteniendo el rechazo de consultas fuera de dominio. 6 tests unitarios nuevos. |
| 🧭 Agentes y flujos de trabajo | ✅ | **Enrutamiento:** validación de máquina de estados (`ai_active`, `human_active`, `handoff_pending`, etc.) y detección normalizada de pedidos de operador humano sin falsos positivos en consultas de negocio (6 tests unitarios). **Encadenamiento protegido:** se eliminó el riesgo de terminación prematura en entornos serverless/Vercel esperando el auto-etiquetado y resumen (`maybeAutoProcess`) con captura de errores aislada; blindaje de la etapa `customer` contra degradaciones a `lost` y freno de costos en calificación (4 tests unitarios). **Paralelización:** carga concurrente de memoria, agente activo, datos de negocio y base de conocimiento en un único `Promise.all`, ahorrando 25–35 ms de latencia por turno. **Observabilidad:** registro estructurado del evento `dispatch_failure` en la tabla `events` ante fallos de entrega en WhatsApp. |
| ⚙️ Automatizaciones | ✅ | Reglas «cuando pase X, hacé Y» que el cron revisa cada minuto. Cada disparo se reserva una sola vez en `automation_runs` (aunque el cron corra dos veces no se repite), solo reacciona a lo que pasó después de guardar la regla y los seguimientos salen de 9 a 21 en la hora del negocio. 9 tests en `evals/automatizaciones`. |
| 🚫 Consentimiento | ✅ | «BAJA» y «ALTA» se reconocen antes de que conteste la IA, con palabras exactas o frases claras en mensajes cortos, para no dar de baja a quien solo menciona la palabra. A un contacto dado de baja no le contesta nadie, y un mensaje nuevo ya no lo vuelve a dar de alta solo. 5 tests en `evals/consentimiento`. |
| 🤝 Promesas | ✅ | La herramienta «Cumplir lo prometido» agenda el seguimiento con la zona horaria obligatoria (una hora sin zona saldría corrida). Al vencer decide si escribir texto (ventana abierta), mandar la plantilla elegida, dejárselo a una persona (la charla la lleva un humano o pasaron 24 h sin plantilla) o cancelarlo (conversación cerrada o el cliente pidió la baja). 8 tests en `evals/compromisos`. |
| 🎚️ Autonomía graduada | ✅ | Cada herramienta pasa de «propone» a «lo hace solo» según el historial de aprobaciones; un rechazo reinicia la cuenta y cada cambio queda registrado. 4 tests en `evals/autonomia`. |
| 🎓 Aprender de las correcciones | ✅ | Las correcciones y los rechazos explicados entran al prompt como lecciones cortas, marcadas como reglas del equipo (no como mensajes del cliente) y con tope de 15. 4 tests en `evals/correcciones`. |
| 🌡️ Puntaje de la relación | ✅ | Puntaje de 0 a 100 y estado por contacto, calculado con funciones puras y probado con casos de borde (contacto nuevo, dado de baja, con riesgos abiertos). 6 tests en `evals/relacion`. |
| 📊 Resultados y métricas por agente | ✅ | El Panel mide resultados en vez de volumen, y cada resultado se cuenta para el agente que estaba activo en ese momento (cada activación queda registrada). 6 tests en `evals/metricas`. |
| ⚖️ Jev gratis | ✅ | El juez de mensajes corre gratis por FreeLLMAPI cuando no hay clave de TypeSafe: lee el último JSON de la respuesta, acota los valores y no cuesta nada. En `npm run eval:jev`: 12 de 12, incluido un intento de manipular al agente. 5 tests más en `evals/jev`. |
| 🔁 Respaldo de la IA | ✅ | Si FreeLLMAPI no responde (PC apagada, túnel caído, sin cupo o más de 45 s), la misma charla sigue por OpenRouter con un modelo gratis, salta al siguiente si ese no está, deja de probar el principal por un minuto y avisa por mail. 8 tests en `evals/respaldo`. |
| 👀 Inspección del entorno | ✅ | Después de cada acción el agente mira qué pasó de verdad. Al reservar, la herramienta le devuelve la hora que **guardó el calendario** (antes devolvía la que pidió el agente: si HighLevel la corría, el cliente recibía una hora equivocada) y un error si el turno quedó cancelado aunque la API diga 200. `npm run eval:herramientas` suma 4 escenarios donde la acción sale mal (la reserva falla, se corre de hora, el horario se ocupa entre la consulta y la reserva, el seguimiento no se guarda): 22 de 22 chequeos, sin confirmar nada que no pasó y ofreciendo el horario libre. 4 tests en `evals/herramientas`. |
| 🧐 Revisor de respuestas (evaluador-optimizador) | ✅ | Antes de mandar cada respuesta, un segundo modelo la compara con todo lo que sabía el agente (negocio, base de conocimiento, memoria del cliente y lo que devolvieron las herramientas en ese turno). Si encuentra un dato inventado o una acción que no se hizo ("te agendé" sin reserva, una reserva que falló o quedó pendiente), la reescribe sin volver a usar herramientas y revisa la corrección, con tope de 2 vueltas y 25 s en total. Si la acción no se hizo, ofrece pasar con una persona en vez de prometer que el equipo confirma. Si el revisor falla, sale el borrador: nunca deja al cliente sin respuesta. En `npm run eval:revisor` (24 borradores fijos: trampas y respuestas correctas, 8 de ellos distintos a los ejemplos del prompt), con llama-3.3-70b: **12 de 13 trampas corregidas y 11 de 11 respuestas correctas sin tocar**. Con "auto" los modelos que razonan se cortaban o tardaban de más, y mistral-small corregía todas las trampas pero tocaba respuestas correctas. El chat de prueba muestra qué se corrigió. 11 tests en `evals/revisor`. |

### 🔎 Cómo se auditó y se mejoró cada área

Todas siguieron el mismo camino: se **prueba de verdad**, se encuentra la
**falla**, se **corrige** y se **vuelve a medir**.

```mermaid
flowchart LR
    P[🔍 Prueba real]:::p --> F[❌ Falla]:::f
    F --> M[🔧 Mejora]:::m
    M --> R[✅ Medido<br/>de nuevo]:::r
    R -.->|si bajó algo| M
    classDef p fill:#0EA5E9,color:#fff
    classDef f fill:#E5484D,color:#fff
    classDef m fill:#8A2BE2,color:#fff
    classDef r fill:#25D366,color:#000
```

**💬 Respuestas de la IA**

```mermaid
flowchart LR
    P[🔍 Charlas con<br/>modelos gratis]:::p --> F1[❌ Cortadas<br/>o vacías]:::f
    P --> F2[❌ Razonamiento<br/>filtrado]:::f
    P --> F3[❌ Cambian<br/>cada vez]:::f
    F1 & F2 --> M1[🔧 Guardia<br/>+ otro modelo]:::m
    F3 --> M2[🔧 Temperatura<br/>0.3]:::m
    M1 & M2 --> R[✅ Nunca llega<br/>texto roto]:::r
    classDef p fill:#0EA5E9,color:#fff
    classDef f fill:#E5484D,color:#fff
    classDef m fill:#8A2BE2,color:#fff
    classDef r fill:#25D366,color:#000
```

**📊 Evaluación del agente**

```mermaid
flowchart LR
    P[🔍 Charlas de<br/>WhatsApp]:::p --> C[🧮 Nota por código<br/>⚖️ y por un juez]:::p
    C --> F[❌ Una nota en la<br/>memoria daba<br/>descuentos falsos]:::f
    F --> M[🔧 Memoria citada<br/>sin autorizar<br/>precios]:::m
    M --> R[✅ Ese caso<br/>4.7 → 10]:::r
    classDef p fill:#0EA5E9,color:#fff
    classDef f fill:#E5484D,color:#fff
    classDef m fill:#8A2BE2,color:#fff
    classDef r fill:#25D366,color:#000
```

**✍️ Prompts**

```mermaid
flowchart LR
    P[🔍 Prompts de<br/>los 4 agentes]:::p --> F[❌ Reglas<br/>sin porqué]:::f
    F --> M1[🔧 Reglas<br/>con porqué]:::m
    F --> M2[🔧 Etiquetas<br/>XML]:::m
    F --> M3[🔧 Ejemplos<br/>difíciles]:::m
    M1 & M2 & M3 --> R[✅ Nota<br/>9.1 → 9.6]:::r
    classDef p fill:#0EA5E9,color:#fff
    classDef f fill:#E5484D,color:#fff
    classDef m fill:#8A2BE2,color:#fff
    classDef r fill:#25D366,color:#000
```

**🔧 Herramientas**

```mermaid
flowchart LR
    P[🔍 Función real<br/>+ herramientas<br/>simuladas]:::p --> F1[❌ Turnos sin<br/>mirar la agenda]:::f
    P --> F2[❌ Tapaba errores<br/>del calendario]:::f
    P --> F3[❌ Sin respuesta<br/>tras usar una]:::f
    P --> F4[❌ Reintento que<br/>reserva dos veces]:::f
    F1 & F2 & F3 & F4 --> M[🔧 Uno por uno<br/>midiendo]:::m
    M --> R[✅ 14/20<br/>→ 40/42]:::r
    classDef p fill:#0EA5E9,color:#fff
    classDef f fill:#E5484D,color:#fff
    classDef m fill:#8A2BE2,color:#fff
    classDef r fill:#25D366,color:#000
```

**📚 Base de conocimiento**

```mermaid
flowchart LR
    P[🔍 17 preguntas<br/>sobre un<br/>documento]:::p --> F1[❌ Cortes que<br/>partían precios]:::f
    P --> F2[❌ SQL armado<br/>pegando texto]:::f
    P --> F3[❌ Una página<br/>podía dar órdenes]:::f
    F1 --> M1[🔧 Corte por<br/>secciones]:::m
    F2 --> M2[🔧 Respaldo<br/>quitado]:::m
    F3 --> M3[🔧 Marcados<br/>como datos]:::m
    M1 & M2 & M3 --> R[✅ Primero en<br/>11 → 15 de 17]:::r
    P -.-> X[🧪 Búsqueda híbrida:<br/>ver Reranking]:::x
    classDef p fill:#0EA5E9,color:#fff
    classDef f fill:#E5484D,color:#fff
    classDef m fill:#8A2BE2,color:#fff
    classDef r fill:#25D366,color:#000
    classDef x fill:#64748B,color:#fff
```

**🎙️ Audios, imágenes, documentos y caché**

```mermaid
flowchart LR
    P[🔍 Notas de voz,<br/>fotos y PDFs]:::p --> F0[❌ El audio no<br/>llegaba al modelo]:::f
    F0 --> M0[🔧 Endpoint de<br/>transcripción]:::m
    M0 --> R0[✅ Palabra por<br/>palabra]:::r
    P --> F1[❌ No podía<br/>leer el PDF]:::f
    P --> F2[⚠️ Imagen con una<br/>orden escrita]:::f
    P --> F3[❌ Solo 1% del<br/>prompt reutilizable]:::f
    F1 --> M1[🔧 PDF leído<br/>en el servidor]:::m
    F2 --> M2[🔧 Marcada<br/>como dato]:::m
    F3 --> M3[🔧 Lo fijo<br/>va primero]:::m
    M1 --> R1[✅ Total y seña<br/>exactos]:::r
    M2 --> R2[✅ 32/32]:::r
    M3 --> R3[✅ 72% reutilizable<br/>83% de caché]:::r
    classDef p fill:#0EA5E9,color:#fff
    classDef f fill:#E5484D,color:#fff
    classDef m fill:#8A2BE2,color:#fff
    classDef r fill:#25D366,color:#000
```

**📌 Citas y razonamiento**

```mermaid
flowchart LR
    P[🔍 Preguntas<br/>a la base]:::p --> F[❌ Sin rastro<br/>de la fuente]:::f
    F --> M1[🔧 Marca el<br/>fragmento]:::m
    M1 --> M2[🔧 Se saca antes<br/>del cliente]:::m
    M2 --> M3[🔧 Inbox muestra<br/>Fuentes]:::m
    M3 --> R[✅ 8 de 8]:::r
    P -.-> X[🧪 Razonamiento<br/>extendido: no<br/>hizo falta]:::x
    classDef p fill:#0EA5E9,color:#fff
    classDef f fill:#E5484D,color:#fff
    classDef m fill:#8A2BE2,color:#fff
    classDef r fill:#25D366,color:#000
    classDef x fill:#64748B,color:#fff
```

**🔌 MCP**

```mermaid
flowchart LR
    P[🔍 Servidor de stock<br/>+ cliente MCP real]:::p --> F1[❌ No tenemos<br/>sin consultar]:::f
    P --> F2[❌ Sistema caído:<br/>inventaba]:::f
    P --> F3[❌ Prometía una<br/>reserva no guardada]:::f
    F1 --> M1[🔧 Consultar antes<br/>de responder]:::m
    F2 --> M2[🔧 Aviso de<br/>no disponible]:::m
    F3 --> M3[🔧 Sin propuesta<br/>no promete]:::m
    M1 & M2 & M3 --> R[✅ 28/28<br/>y en vivo]:::r
    classDef p fill:#0EA5E9,color:#fff
    classDef f fill:#E5484D,color:#fff
    classDef m fill:#8A2BE2,color:#fff
    classDef r fill:#25D366,color:#000
```

**🎯 RAG: reranking y recuperación contextual** · por [Tomas Skarp](https://github.com/thomasskarp)

```mermaid
flowchart LR
    P[🔍 Las 2 preguntas<br/>que fallaban]:::p --> F1[❌ Fragmento sin<br/>su documento]:::f
    P --> F2[❌ Códigos exactos<br/>PROMO-DIC-05]:::f
    F1 --> M1[🔧 Prefijo<br/>Documento · Sección]:::m
    F2 --> M2[🔧 10 candidatos<br/>BM25 + RRF]:::m
    M1 & M2 --> R[✅ 15 → 17 de 17<br/>0 tokens extra]:::r
    classDef p fill:#0EA5E9,color:#fff
    classDef f fill:#E5484D,color:#fff
    classDef m fill:#8A2BE2,color:#fff
    classDef r fill:#25D366,color:#000
```

**🧭 Agentes y flujos** · por [Tomas Skarp](https://github.com/thomasskarp)

```mermaid
flowchart LR
    P[🔍 Enrutamiento,<br/>cadena, paralelo<br/>y depuración]:::p --> F1[❌ Resumen cortado<br/>por Vercel]:::f
    P --> F2[❌ Consultas<br/>una tras otra]:::f
    P --> F3[❌ Envío fallido<br/>sin registro]:::f
    F1 --> M1[🔧 await con<br/>try/catch]:::m
    F2 --> M2[🔧 Promise.all]:::m
    F3 --> M3[🔧 Evento<br/>dispatch_failure]:::m
    M1 & M2 & M3 --> R[✅ Sin pases falsos<br/>~30 ms menos]:::r
    classDef p fill:#0EA5E9,color:#fff
    classDef f fill:#E5484D,color:#fff
    classDef m fill:#8A2BE2,color:#fff
    classDef r fill:#25D366,color:#000
```

---

## 📦 Qué más incluye

- 📥 **Inbox** tipo WhatsApp Web con buffer inteligente.
- 🔀 **Motor de agente** con state machine, handoff humano, prompts personalizables y herramientas activables.
- 👥 **CRM** con sincronización opcional a HighLevel.
- 🕐 **Templates** y manejo de la ventana de 24 h de Meta.
- 🏢 **Multi-tenant** con roles, RLS por workspace y super admin.
- 🔌 **Cliente MCP**: los sistemas del negocio (stock, agenda, CRM) conectados por MCP, con permisos por herramienta.
- 🔌 **Servidor MCP de administración** ([`mcp/admin/`](mcp/admin/README.md)): operás la instalación desde Claude con 24 herramientas, 4 recursos y 3 prompts.

## 🛠️ Stack

| Capa | Tecnología |
| --- | --- |
| ⚛️ Framework | Next.js 16 + React 19 + TypeScript |
| 🎨 Estilos | Tailwind CSS + shadcn/ui |
| 🗄️ Backend | Supabase (Auth + PostgreSQL + RLS + Storage + pgvector) |
| ⚡ IA | FreeLLMAPI (o cualquier endpoint compatible con OpenAI) |
| 💚 WhatsApp | YCloud |
| ▲ Hosting | Vercel |

## 🚀 Instalar

```bash
git clone https://github.com/grancobud/arm-whatsapp.git
cd arm-whatsapp
claude "lee INSTALAR.md e instálalo"
```

El agente configura Supabase, despliega a Vercel, crea el super admin y deja el
cron corriendo. Ver [`INSTALAR.md`](INSTALAR.md).

## 💻 Desarrollo local

```bash
npm install
cp .env.local.example .env.local   # completá tus keys (o: node scripts/setup.mjs env)
npm run dev                        # http://localhost:3000
```

Otros comandos: `npm run build`, `npm run lint`, `npm run typecheck`.

## ⏱️ El cron

Un job de **pg_cron + pg_net** llama cada minuto a `/api/cron/buffer-flush`
(autenticado con `CRON_SECRET`). Drena los mensajes agrupados y envía la
siguiente tanda de las campañas aprobadas. Ver
[`supabase/cron/schedule-buffer-flush.sql`](supabase/cron/schedule-buffer-flush.sql).

## 🚨 Alertas por mail

Cada 5 minutos el cron revisa si hubo problemas nuevos y, si los hay, manda
**un solo mail** con el resumen por cliente: mensajes que quedaron sin
responder, herramientas que fallaron, sistemas MCP caídos o el umbral diario de
costo. Después espera 30 minutos antes del próximo aviso. Lo normal del negocio
(un lead descartado, una acción esperando aprobación) no avisa, y el mail nunca
lleva mensajes de clientes.

| Variable | Valor |
| --- | --- |
| `RESEND_API_KEY` | clave de [Resend](https://resend.com) (el plan gratis alcanza) |
| `ALERT_EMAIL_TO` | a quién avisar (varios, separados por coma) |
| `ALERT_EMAIL_FROM` | opcional; sin dominio propio en Resend, dejala vacía y solo se puede avisar al mail de la cuenta de Resend |

Sin `RESEND_API_KEY` o `ALERT_EMAIL_TO`, las alertas quedan apagadas.

## ⚙️ Automatizaciones

En **Configuración → Automatizaciones** cada cliente arma reglas del tipo
«cuando pase X, hacé Y». El cron las revisa cada minuto:

| Cuando… | Se dispara |
| --- | --- |
| Primer mensaje | una vez por conversación nueva en la que el contacto escribió |
| Palabra clave | una vez por mensaje que la contenga (sin importar tildes ni mayúsculas) |
| Pide una persona | cada vez que la conversación pasa a esperar un asesor |
| Lead calificado | una vez por contacto |
| Sin respuesta | si hablamos último y el contacto no contesta en 24 h (configurable): un solo seguimiento por silencio, y solo de 9 a 21 en la hora del negocio |
| Ventana por cerrar | cuando le quedan 2 h a la ventana de 24 h de WhatsApp |

Las acciones son mandar una plantilla aprobada (respeta a quien pidió no recibir
mensajes), poner una etiqueta, cerrar la conversación o pasarla a una persona.
Una regla solo reacciona a lo que pasó **después** de guardarla, cada disparo
queda en `automation_runs` y nunca se repite, y un pase a persona hecho por una
automatización no dispara otra.

## 🗂️ Estructura

```
src/
├── app/        # Next.js App Router ((auth), (main), api/)
├── features/   # Feature-First (arm, inbox, settings, tools, agents, …)
└── shared/     # Reutilizable (components, lib, types)
supabase/
├── migrations/ # Schema (RLS, super admin, pg_cron, ARM, …)
└── cron/       # SQL post-deploy del cron
deploy/
└── freellmapi-tunnel/  # Túnel de Cloudflare en Docker
mcp/
└── admin/          # Servidor MCP de administración (herramientas, recursos, prompts)
scripts/
├── setup.mjs       # Orquestador de instalación (secrets, env, db, cron)
└── seed-admin.mjs  # Super admin + workspace demo
```

## 🔐 Variables de entorno y seguridad

Ver [`.env.local.example`](.env.local.example). `ENCRYPTION_KEY`,
`BUFFER_PROCESS_SECRET` y `CRON_SECRET` las genera `scripts/setup.mjs`. YCloud y
HighLevel se configuran por workspace en Settings → Integraciones.

Lo que se guarda en Integraciones se cifra con **AES-256-GCM** antes de tocar la
base, ligado a su `workspace_id` y proveedor: un blob copiado de un tenant a otro
no descifra.

---

## 👥 Autores

ARM WhatsApp es un trabajo conjunto de:

| | |
| :---: | --- |
| <img src="https://github.com/grancobud.png" width="56" alt="Gastón" /> | **Gastón R. Persoglia** · [@grancobud](https://github.com/grancobud) |
| <img src="https://github.com/thomasskarp.png" width="56" alt="Tomas" /> | **Tomas Skarp** · [@thomasskarp](https://github.com/thomasskarp) |

## 📄 Licencia

[MIT](LICENSE).
