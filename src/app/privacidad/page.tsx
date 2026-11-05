import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacidad — ARM WhatsApp" };

// Los datos de quien opera el servicio se cargan por variables de entorno. Hasta
// que un abogado revise el texto, la página avisa que es un borrador.
const OPERATOR = process.env.NEXT_PUBLIC_LEGAL_NAME?.trim() || "[nombre a completar]";
const ADDRESS = process.env.NEXT_PUBLIC_LEGAL_ADDRESS?.trim() || "[domicilio a completar]";
const CONTACT = process.env.NEXT_PUBLIC_LEGAL_EMAIL?.trim() || "[correo a completar]";
const REVIEWED = process.env.NEXT_PUBLIC_LEGAL_REVIEWED === "true";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-base font-semibold text-foreground">{title}</h2>
      <div className="space-y-2 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="font-display text-2xl font-semibold text-foreground">Política de privacidad</h1>

        {!REVIEWED && (
          <p className="rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-400" role="note">
            Borrador pendiente de revisión legal.
          </p>
        )}

        <Section title="Quién es responsable de tus datos">
          <p>
            Si le escribiste a un negocio por WhatsApp, ese negocio es el responsable de tus datos y es
            quien decide para qué los usa.
          </p>
          <p>
            ARM WhatsApp es la herramienta que usa ese negocio para atenderte. La opera {OPERATOR}, con
            domicilio en {ADDRESS}. Contacto: {CONTACT}.
          </p>
        </Section>

        <Section title="Qué datos se guardan">
          <ul className="list-disc space-y-1 pl-5">
            <li>Tu número de teléfono y tu nombre de perfil de WhatsApp.</li>
            <li>Tu correo u otros datos, si los das.</li>
            <li>Los mensajes, audios, fotos y documentos que mandás.</li>
            <li>Lo que el agente anota para recordarte, como tus necesidades o tus turnos.</li>
            <li>Si aceptaste recibir promociones o pediste la baja.</li>
          </ul>
          <p>
            Darlos es voluntario, pero sin ellos no se te puede atender por este medio. Si los datos son
            inexactos, la atención puede fallar.
          </p>
          <p>
            No mandes datos de salud, tarjetas, claves ni cuentas bancarias por este chat: el agente no
            los necesita.
          </p>
        </Section>

        <Section title="Para qué se usan">
          <p>
            Para responderte, sacar turnos, recordar lo que ya contaste y hacer seguimiento de lo que el
            negocio te prometió. Solo te llegan promociones si las aceptaste.
          </p>
        </Section>

        <Section title="Quién más los recibe">
          <ul className="list-disc space-y-1 pl-5">
            <li>WhatsApp (Meta) y YCloud, para enviar y recibir los mensajes.</li>
            <li>Proveedores de inteligencia artificial, que reciben los mensajes para generar las respuestas.</li>
            <li>Supabase y Vercel, donde se guardan los datos y funciona la aplicación.</li>
            <li>Resend, para los avisos por correo al equipo del negocio.</li>
            <li>HighLevel u otros sistemas, solo si el negocio los conectó.</li>
          </ul>
          <p>
            Algunos están fuera de Argentina, por ejemplo en Brasil y en Estados Unidos, países que la
            Agencia de Acceso a la Información Pública no incluye entre los de protección adecuada.
          </p>
        </Section>

        <Section title="Cuánto tiempo se guardan">
          <p>
            Si no hay actividad, se borran después del plazo que fijó el negocio, que es de 12 meses salvo
            que lo haya cambiado. Las copias de seguridad de los proveedores pueden conservarlos un tiempo
            más hasta vencer.
          </p>
        </Section>

        <Section title="Qué podés pedir">
          <p>
            Podés pedir ver tus datos, corregirlos o borrarlos. Escribile al negocio por el mismo WhatsApp
            o a {CONTACT}. Por ley, el acceso se responde en 10 días corridos y es gratis cada 6 meses; la
            corrección o el borrado, en 5 días hábiles. Para no recibir más mensajes, escribí BAJA.
          </p>
          <p>
            La{" "}
            <a
              href="https://www.argentina.gob.ar/aaip"
              className="text-primary underline-offset-4 hover:underline"
              rel="noreferrer"
              target="_blank"
            >
              Agencia de Acceso a la Información Pública
            </a>
            , órgano de control de la Ley 25.326, atiende las denuncias y los reclamos por incumplimiento
            de las normas de protección de datos personales.
          </p>
        </Section>

        <p className="text-sm">
          <Link href="/login" className="text-primary underline-offset-4 hover:underline">
            Volver
          </Link>
        </p>
      </div>
    </main>
  );
}
