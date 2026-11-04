/**
 * help-content.ts — the user manual shown at /ayuda. Written against the real
 * screens: if a button or tab changes its name, change it here too.
 * The WhatsApp steps haven't been run yet with a real YCloud number.
 */

export interface HelpLink {
  label: string;
  href: string;
}

export type SetupKey = "whatsapp" | "business" | "knowledge" | "agent" | "template" | "team";

export interface HelpStep {
  title: string;
  why: string;
  how: string[];
  link: HelpLink;
  /** The step the app can check on its own. Without it, no status is shown. */
  setupKey?: SetupKey;
  optional?: boolean;
}

export const FIRST_STEPS: HelpStep[] = [
  {
    title: "Conectá tu número de WhatsApp",
    why: "Sin esto no entran ni salen mensajes. La conexión se hace con YCloud, sobre un número de WhatsApp Business.",
    how: [
      "En YCloud, conseguí tu API Key y tu Webhook Signing Secret.",
      "En Integraciones, completá la API Key, el número con código de país (por ejemplo +5491123456789) y el Signing Secret.",
      "Copiá la Webhook URL que te muestra esta pantalla y pegala en la configuración de webhooks de YCloud.",
      "En el perfil del número, cargá un mail, una web o un teléfono de atención: WhatsApp lo pide.",
      "Revisá que tu rubro esté permitido: WhatsApp no admite, entre otros, drogas, alcohol, tabaco, armas ni productos médicos.",
    ],
    link: { label: "Ir a Integraciones", href: "/settings?tab=integraciones" },
    setupKey: "whatsapp",
  },
  {
    title: "Contale al agente sobre tu negocio",
    why: "El agente contesta con lo que le cargues. Lo que no esté acá, no lo sabe, y no debería inventarlo.",
    how: [
      "Completá nombre, industria, horarios, país y zona horaria.",
      "En Información libre, escribí tus servicios, precios y lo que más te preguntan.",
    ],
    link: { label: "Ir a Negocio", href: "/settings?tab=negocio" },
    setupKey: "business",
  },
  {
    title: "Cargá tu base de conocimiento",
    why: "Para lo que no entra en una ficha: listas de precios, preguntas frecuentes, políticas de cambio.",
    how: [
      "Tocá Agregar documento, ponele un título y pegá el texto o una URL.",
      "Esperá a que termine de procesarse: recién ahí el agente puede usarlo.",
    ],
    link: { label: "Ir a Base de conocimiento", href: "/settings?tab=knowledge-base" },
    setupKey: "knowledge",
  },
  {
    title: "Elegí y ajustá tu agente",
    why: "Hay tres agentes (ventas, soporte y agendamiento) y solo uno puede estar activo a la vez.",
    how: [
      "En Agentes, abrí el que más se parece a lo que necesitás.",
      "En la solapa Prompt, escribí sus instrucciones: qué debe hacer y qué nunca debe hacer. Después tocá Publicar.",
      "Activalo desde su tarjeta.",
    ],
    link: { label: "Ir a Agentes", href: "/settings?tab=agentes" },
    setupKey: "agent",
  },
  {
    title: "Probalo antes de que hable con un cliente",
    why: "Es la forma segura de ver cómo contesta: no se manda nada por WhatsApp.",
    how: [
      "Abrí el agente y entrá a la solapa Prueba.",
      "Escribile como lo haría un cliente, incluso con preguntas que no debería poder responder.",
      "Si algo no te gusta, ajustá el prompt, publicá y volvé a probar.",
    ],
    link: { label: "Ir a Agentes", href: "/settings?tab=agentes" },
  },
  {
    title: "Decidí qué puede hacer solo",
    why: "Cada herramienta (por ejemplo, reservar un turno) puede hacerse sola o quedar esperando que alguien la apruebe en Revisión.",
    how: [
      "En Herramientas, activá solo las que vayas a usar.",
      "Empezá con las sensibles en modo de aprobación. Cuando el agente acumula aprobaciones seguidas, la pantalla te sugiere darle más autonomía.",
      "Si tenés un sistema propio de stock, agenda o CRM, conectalo en Sistemas (MCP).",
    ],
    link: { label: "Ir a Herramientas", href: "/settings?tab=tools" },
    optional: true,
  },
  {
    title: "Hacé aprobar una plantilla",
    why: "WhatsApp solo te deja escribirle primero a alguien, o después de 24 horas sin respuesta, con una plantilla aprobada por Meta. Sin plantilla no hay campañas.",
    how: [
      "En Plantillas, creá una nueva o partí de la Biblioteca, y mandala a aprobar.",
      "Cuando figure como Aprobado, elegila en Automatizaciones, en Promesas del agente, para que pueda cumplir lo que prometió pasadas las 24 horas.",
    ],
    link: { label: "Ir a Plantillas", href: "/settings?tab=templates" },
    setupKey: "template",
  },
  {
    title: "Sumá a tu equipo",
    why: "Cada persona entra con su propio usuario y un rol que define qué puede hacer.",
    how: [
      "Tocá Invitar miembro, poné su email y elegí el rol.",
      "Admin puede todo, Manager gestiona agentes y reportes, Agente opera la bandeja y Viewer solo mira.",
    ],
    link: { label: "Ir a Equipo", href: "/settings?tab=equipo" },
    setupKey: "team",
    optional: true,
  },
];

export const DAILY_TASKS: HelpStep[] = [
  {
    title: "Mirá la Bandeja",
    why: "Acá están todas las conversaciones. El filtro Handoff te muestra las que esperan a una persona: empezá por esas.",
    how: [
      "Tomar: agarrás la conversación y la IA deja de contestar.",
      "Devolver a IA: cuando terminás, el agente sigue la charla.",
      "Nota interna: un comentario para tu equipo que el cliente no ve.",
      "Ver contacto: la etapa, las etiquetas y si aceptó recibir promociones.",
    ],
    link: { label: "Ir a la Bandeja", href: "/inbox" },
  },
  {
    title: "Resolvé lo pendiente en Revisión",
    why: "Lo sensible no sale sin tu visto bueno: acciones que propone el agente y campañas por aprobar.",
    how: [
      "Aprobá para que se ejecute. Si la conversación está con la IA, el cliente recibe un aviso de que quedó confirmado.",
      "Si rechazás, escribí qué tendría que haber hecho: el agente lo aprende, y la conversación pasa a una persona para que le responda al cliente.",
    ],
    link: { label: "Ir a Revisión", href: "/revision" },
  },
  {
    title: "Corregí al agente cuando se equivoque",
    why: "Cada corrección queda como regla, así no repite el error.",
    how: [
      "En la Bandeja, tocá Corregir sobre la respuesta de la IA y explicá qué tendría que haber dicho.",
      "Lo aprendido se ve en Agentes, en Lo que aprendió el agente, y desde ahí podés quitarlo.",
    ],
    link: { label: "Ir a la Bandeja", href: "/inbox" },
  },
  {
    title: "Escribile a quien se está enfriando",
    why: "El Panel te dice qué logró el agente y a quién conviene escribirle hoy.",
    how: [
      "Revisá Para escribirle hoy: son los contactos que conviene retomar.",
      "Mirá los resultados: turnos, leads calificados, lo que resolvió la IA sola, promesas cumplidas y bajas.",
    ],
    link: { label: "Ir al Panel", href: "/dashboard" },
  },
  {
    title: "Lanzá una campaña para reactivar clientes",
    why: "Sirve para volver a hablar con contactos que aceptaron recibir promociones. Cuando responden, el agente sigue la charla.",
    how: [
      "En Campañas, ponele un nombre y elegí una plantilla aprobada.",
      "Definí a quién le llega por etiquetas o por días sin mensajes, y tocá Ver a quiénes llega.",
      "Tocá Crear y mandar a Revisión. Sale recién cuando alguien la aprueba.",
    ],
    link: { label: "Ir a Campañas", href: "/campanas" },
  },
];

export const SCREENS: { name: string; text: string; href: string }[] = [
  { name: "Bandeja", text: "Las conversaciones con tus clientes, en tiempo real.", href: "/inbox" },
  { name: "Revisión", text: "Lo que espera tu aprobación antes de ejecutarse.", href: "/revision" },
  { name: "Campañas", text: "Mensajes de reactivación a grupos de contactos con consentimiento.", href: "/campanas" },
  { name: "Panel", text: "Resultados del agente, actividad de hoy y a quién escribirle.", href: "/dashboard" },
  { name: "Agentes", text: "Los tres agentes, sus instrucciones, la prueba, lo que aprendieron y Jev, el juez de mensajes opcional.", href: "/settings?tab=agentes" },
  { name: "Integraciones", text: "La conexión con YCloud y HighLevel, el modelo de IA y el tope diario de consumo.", href: "/settings?tab=integraciones" },
  { name: "Negocio", text: "Los datos del negocio que el agente usa para contestar.", href: "/settings?tab=negocio" },
  { name: "Herramientas", text: "Qué puede hacer el agente, y si lo hace solo o lo propone.", href: "/settings?tab=tools" },
  { name: "Sistemas (MCP)", text: "Conectar sistemas propios, como stock, agenda o CRM.", href: "/settings?tab=sistemas" },
  { name: "Plantillas", text: "Los mensajes aprobados por Meta, y su estado.", href: "/settings?tab=templates" },
  { name: "Base de conocimiento", text: "Documentos que el agente consulta para responder.", href: "/settings?tab=knowledge-base" },
  { name: "Equipo", text: "Quién tiene acceso y con qué rol.", href: "/settings?tab=equipo" },
  { name: "Automatizaciones", text: "Reglas que se disparan solas, y la plantilla para las promesas del agente.", href: "/settings?tab=automatizaciones" },
  { name: "Datos", text: "Descargar todo en JSON o los contactos en CSV. Las credenciales nunca salen.", href: "/settings?tab=datos" },
];

export const FAQ: { question: string; answer: string[]; link?: HelpLink }[] = [
  {
    question: "La IA no contesta. ¿Qué reviso?",
    answer: [
      "Que haya un agente activo y con el prompt publicado.",
      "El estado de la conversación: si dice Humano o Handoff, la tiene una persona. Tocá Devolver a IA.",
      "Si alguien del equipo escribió a mano: por defecto eso pausa a la IA en esa charla.",
      "Si el cliente pidió la baja, o si se llegó al tope diario de consumo en Integraciones.",
    ],
    link: { label: "Ir a Agentes", href: "/settings?tab=agentes" },
  },
  {
    question: "No me deja escribirle a un cliente.",
    answer: [
      "Pasaron más de 24 horas desde su último mensaje. Es una regla de WhatsApp: solo podés mandarle una plantilla aprobada.",
    ],
    link: { label: "Ir a Plantillas", href: "/settings?tab=templates" },
  },
  {
    question: "Un cliente pidió que no le escribamos más.",
    answer: [
      "Si escribe BAJA, se le confirma y nadie le vuelve a escribir: ni la IA, ni las campañas, ni las automatizaciones.",
      "Si escribe ALTA, vuelve a estar habilitado.",
    ],
  },
  {
    question: "Un cliente quiere hablar con una persona.",
    answer: [
      "Cuando lo pide, la conversación pasa a Handoff y la IA deja de contestar. Entrá a la Bandeja y tocá Tomar.",
    ],
    link: { label: "Ir a la Bandeja", href: "/inbox" },
  },
  {
    question: "Mi campaña no sale.",
    answer: [
      "Tiene que estar aprobada en Revisión, y usar una plantilla aprobada por Meta.",
      "Solo llega a contactos que aceptaron promociones. Que alguien le escriba al negocio no alcanza: activá Aceptó promociones en Ver contacto y anotá cómo aceptó.",
    ],
    link: { label: "Ir a Revisión", href: "/revision" },
  },
  {
    question: "El agente prometió escribir otro día. ¿Qué pasa si ya pasaron las 24 horas?",
    answer: [
      "Usa la plantilla que elijas en Automatizaciones, en Promesas del agente. Si no hay ninguna, le avisa a tu equipo para que lo haga una persona.",
    ],
    link: { label: "Ir a Automatizaciones", href: "/settings?tab=automatizaciones" },
  },
  {
    question: "¿Por qué se frenó mi campaña o sale de a poco?",
    answer: [
      "Un número nuevo llega a 250 personas por día: lo demás sale en los días siguientes.",
      "Se frena sola si fallan muchos envíos o si Meta pausa la plantilla. Revisá la plantilla y creá una campaña nueva para los que faltaron.",
    ],
    link: { label: "Ir a Campañas", href: "/campanas" },
  },
  {
    question: "Un cliente me mandó su tarjeta o su documento.",
    answer: [
      "WhatsApp no permite pedir ni compartir tarjetas, cuentas bancarias ni documentos. El agente no los pide ni los guarda en su memoria, pero el mensaje queda en la conversación.",
    ],
  },
  {
    question: "¿Cómo pruebo un cambio sin molestar a mis clientes?",
    answer: ["En la solapa Prueba de cada agente. Usa el prompt publicado y no manda nada por WhatsApp."],
    link: { label: "Ir a Agentes", href: "/settings?tab=agentes" },
  },
  {
    question: "¿Cómo me llevo mis datos?",
    answer: ["Desde Configuración, en Datos. Las claves y credenciales de las integraciones nunca se incluyen."],
    link: { label: "Ir a Datos", href: "/settings?tab=datos" },
  },
];
