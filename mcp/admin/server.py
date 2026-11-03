"""
ARM WhatsApp — servidor MCP de administración.

Deja operar una instalación de ARM WhatsApp desde Claude (Claude Code, Claude
Desktop o cualquier cliente MCP): ver clientes, conversaciones, la memoria con
fuentes, las propuestas en revisión y las campañas, y hacer cambios puntuales.

Expone las tres piezas de MCP:
  - Herramientas (acciones y consultas): wa_*
  - Recursos (datos para meter en el prompt): arm://...
  - Prompts (tareas armadas y probadas): resumen_cliente, preparar_reactivacion,
    revisar_pendientes

Seguridad: habla con Supabase por PostgREST con la clave service_role, o sea
que saltea RLS y ve TODOS los workspaces. Es una herramienta de administración
local, para el dueño de la instalación. Por eso:
  - nunca devuelve credenciales (integrations.credentials, oauth_tokens,
    tool_configs.credentials);
  - no hay SQL libre;
  - no manda WhatsApp ni aprueba propuestas: eso pasa por la app, que aplica
    sus propios controles (registro de herramientas, aprobación humana);
  - las escrituras son puntuales y están marcadas como tales.

Configuración (variables de entorno, todas obligatorias salvo la última):
  WSAAS_SUPABASE_URL       https://<proyecto>.supabase.co
  WSAAS_SERVICE_ROLE_KEY   clave secreta de Supabase (nunca en el repo ni en el chat)
  WSAAS_APP_URL            https://<tu-app>.vercel.app
  WSAAS_CRON_SECRET        opcional: habilita wa_cron_flush

Probar con el inspector:  mcp dev mcp/admin/server.py
"""
import functools
import json
import os
from datetime import datetime, timezone
from typing import Annotated, Any, Optional

import requests
from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from mcp.server.fastmcp.prompts import base
from mcp.types import ToolAnnotations
from pydantic import Field

SUPABASE_URL = os.environ.get("WSAAS_SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("WSAAS_SERVICE_ROLE_KEY", "")
APP_URL = os.environ.get("WSAAS_APP_URL", "").rstrip("/")
CRON_SECRET = os.environ.get("WSAAS_CRON_SECRET", "")
TIMEOUT = 30

CONV_STATES = ("ai_active", "human_active", "handoff_pending", "waiting_reply", "paused", "closed")

mcp = FastMCP(
    "arm-whatsapp-admin",
    instructions=(
        "Administración de ARM WhatsApp (Agent Relationship Management por WhatsApp). "
        "Las herramientas wa_* consultan y hacen cambios puntuales; los recursos arm://... "
        "traen datos para leer (conversaciones, clientes con su memoria); los prompts "
        "resumen_cliente, preparar_reactivacion y revisar_pendientes arman tareas completas. "
        "Ve todos los workspaces: confirmá con el usuario antes de cualquier escritura."
    ),
)

LECTURA = ToolAnnotations(readOnlyHint=True, openWorldHint=False)
ESCRITURA = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=False)

# Tipos de parámetros con su descripción (lección: Field(description=...) en cada uno).
Workspace = Annotated[str, Field(description="Workspace (cliente de ARM): su UUID o su slug, ej. 'barberia-el-faro'")]
ConversationId = Annotated[str, Field(description="UUID de la conversación (sale de wa_conversations)")]
ContactId = Annotated[str, Field(description="UUID del contacto (sale de wa_contacts)")]
AgentId = Annotated[str, Field(description="UUID del agente (sale de wa_agents)")]


def Limite(defecto: int, maximo: int):  # noqa: N802 — fábrica de tipos
    return Annotated[int, Field(ge=1, le=maximo, description=f"Cantidad máxima de filas (1 a {maximo})")]


# ---------------------------------------------------------------- helpers

def _check_config() -> None:
    faltan = [n for n, v in (("WSAAS_SUPABASE_URL", SUPABASE_URL), ("WSAAS_SERVICE_ROLE_KEY", SERVICE_KEY),
                             ("WSAAS_APP_URL", APP_URL)) if not v]
    if faltan:
        raise ToolError(f"Faltan variables de entorno: {', '.join(faltan)}. Ver la cabecera de mcp/admin/server.py.")
    if SERVICE_KEY.startswith("sb_publishable_"):
        raise ToolError("WSAAS_SERVICE_ROLE_KEY tiene la clave PÚBLICA (sb_publishable_...). Hace falta la "
                        "SECRETA: Supabase → Settings → API Keys → Secret keys (sb_secret_...).")


def _headers(extra: Optional[dict] = None) -> dict:
    h = {"apikey": SERVICE_KEY, "Content-Type": "application/json"}
    # Las service_role viejas son JWT y van también como Bearer; las sb_secret_ nuevas no.
    if not SERVICE_KEY.startswith("sb_"):
        h["Authorization"] = f"Bearer {SERVICE_KEY}"
    if extra:
        h.update(extra)
    return h


def _rest(method: str, table: str, params: Optional[dict] = None,
          body: Any = None, prefer: Optional[str] = None) -> Any:
    _check_config()
    extra = {"Prefer": prefer} if prefer else None
    r = requests.request(method, f"{SUPABASE_URL}/rest/v1/{table}", params=params,
                         json=body, headers=_headers(extra), timeout=TIMEOUT)
    if r.status_code >= 400:
        raise ToolError(f"{method} {table} → HTTP {r.status_code}: {r.text[:300]}")
    return r.json() if r.text else None


def _rpc(fn: str, args: Optional[dict] = None) -> Any:
    _check_config()
    r = requests.post(f"{SUPABASE_URL}/rest/v1/rpc/{fn}", json=args or {}, headers=_headers(), timeout=TIMEOUT)
    if r.status_code >= 400:
        raise ToolError(f"rpc {fn} → HTTP {r.status_code}: {r.text[:300]}")
    return r.json() if r.text else None


def _out(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, default=str, indent=1)


def _errores(fn):
    """Cualquier error inesperado sale como ToolError: el cliente recibe isError=true
    y el modelo lee un mensaje claro (antes volvía como texto normal "ERROR: ...")."""
    @functools.wraps(fn)
    def inner(*a, **kw):
        try:
            return fn(*a, **kw)
        except ToolError:
            raise
        except requests.RequestException as e:
            raise ToolError(f"No se pudo conectar: {e}") from e
        except (ValueError, KeyError) as e:
            raise ToolError(str(e)) from e
    return inner


def _workspace_id(workspace: str) -> str:
    """Acepta el UUID o el slug del workspace."""
    if len(workspace) == 36 and workspace.count("-") == 4:
        return workspace
    rows = _rest("GET", "workspaces", {"select": "id", "slug": f"eq.{workspace}"})
    if not rows:
        raise ToolError(f"No existe un workspace con slug '{workspace}'. Usá wa_workspaces para ver los que hay.")
    return rows[0]["id"]


def _uno(rows: Any, que: str) -> dict:
    if not rows:
        raise ToolError(f"No existe {que}.")
    return rows[0]


def _transcript(conversation_id: str, limit: int) -> str:
    rows = _rest("GET", "messages", {
        "select": "direction,type,body,meta,created_at",
        "conversation_id": f"eq.{conversation_id}", "order": "created_at.desc",
        "limit": str(limit)}) or []
    lineas = []
    for m in reversed(rows):
        meta = m.get("meta") or {}
        quien = "Cliente" if m["direction"] == "in" else "ARM"
        texto = m.get("body") or meta.get("transcript") or meta.get("description") or f"[{m['type']}]"
        fuentes = ", ".join(s.get("title", "") for s in meta.get("kb_sources") or [])
        lineas.append(f"[{m['created_at'][:16]}] {quien}: {texto}" + (f"  (fuentes: {fuentes})" if fuentes else ""))
    return "\n".join(lineas) or "(sin mensajes)"


# ---------------------------------------------------------------- estado

@mcp.tool(annotations=LECTURA)
@_errores
def wa_status() -> str:
    """Salud general de la instalación: si la app responde, si el cron buffer-flush corre
    (y la app lo acepta), y conteos globales (workspaces, usuarios, conversaciones,
    mensajes, propuestas pendientes, batches en cola)."""
    _check_config()
    app = {}
    for path in ("/login", "/api/cron/buffer-flush"):
        try:
            app[path] = requests.get(APP_URL + path, timeout=15, allow_redirects=False).status_code
        except requests.RequestException as e:
            app[path] = f"error: {e}"

    def count(table: str, **flt: str) -> int:
        r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}", params={"select": "id", **flt},
                         headers=_headers({"Prefer": "count=exact", "Range": "0-0"}), timeout=TIMEOUT)
        return int(r.headers.get("Content-Range", "*/0").split("/")[-1] or 0)

    return _out({
        "app_url": APP_URL,
        "app_http": app,
        "nota_cron": "/api/cron/buffer-flush sin clave tiene que dar 401: eso es correcto",
        "cron": _rpc("wsaas_admin_health"),
        "counts": {
            "workspaces": count("workspaces"),
            "users": count("users"),
            "conversations": count("conversations"),
            "messages": count("messages"),
            "propuestas_pendientes": count("agent_proposals", status="eq.pending"),
            "batches_pendientes": count("message_batches", status="in.(buffering,processing)"),
        },
    })


# ---------------------------------------------------------------- workspaces / usuarios

@mcp.tool(annotations=LECTURA)
@_errores
def wa_workspaces() -> str:
    """Lista los workspaces (cada cliente de ARM): id, nombre, slug, si está activo y cuándo se creó."""
    return _out(_rest("GET", "workspaces", {"select": "id,name,slug,is_active,created_at", "order": "created_at.desc"}))


@mcp.tool(annotations=LECTURA)
@_errores
def wa_workspace(workspace: Workspace) -> str:
    """Detalle de un workspace: datos, miembros, agentes, integraciones (solo proveedor y si está
    habilitada, NUNCA credenciales) e información del negocio."""
    ws = _workspace_id(workspace)
    return _out({
        "workspace": _uno(_rest("GET", "workspaces", {"select": "*", "id": f"eq.{ws}"}), f"el workspace {workspace}"),
        "miembros": _rest("GET", "memberships", {"select": "role,is_active,users(full_name,email)", "workspace_id": f"eq.{ws}"}),
        "agentes": _rest("GET", "agents", {"select": "id,type,name,model,is_active,prompt_id", "workspace_id": f"eq.{ws}"}),
        "integraciones": _rest("GET", "integrations", {"select": "provider,enabled,config,updated_at", "workspace_id": f"eq.{ws}"}),
        "business_info": _rest("GET", "business_info", {"select": "structured,free_text,updated_at", "workspace_id": f"eq.{ws}"}),
    })


@mcp.tool(annotations=LECTURA)
@_errores
def wa_users() -> str:
    """Usuarios de la plataforma, si son super admin y a qué workspaces pertenecen (con su rol)."""
    return _out(_rest("GET", "users", {
        "select": "id,full_name,email,is_active,is_super_admin,created_at,memberships(role,is_active,workspaces(name,slug))",
        "order": "created_at.asc"}))


# ---------------------------------------------------------------- conversaciones

@mcp.tool(annotations=LECTURA)
@_errores
def wa_conversations(
    workspace: Workspace,
    state: Annotated[str, Field(description="Filtrar por estado: " + " | ".join(CONV_STATES) + ". Vacío = todos")] = "",
    limit: Limite(20, 100) = 20,
) -> str:
    """Conversaciones de un workspace, las más recientes primero, con el contacto, el estado,
    si la IA está prendida y el resumen."""
    ws = _workspace_id(workspace)
    params = {
        "select": "id,state,ai_enabled,unread_count,last_message_at,window_expires_at,summary,contacts(id,name,phone,stage,tags)",
        "workspace_id": f"eq.{ws}", "order": "last_message_at.desc.nullslast", "limit": str(limit)}
    if state:
        if state not in CONV_STATES:
            raise ToolError(f"Estado inválido '{state}'. Opciones: {', '.join(CONV_STATES)}")
        params["state"] = f"eq.{state}"
    return _out(_rest("GET", "conversations", params))


@mcp.tool(annotations=LECTURA)
@_errores
def wa_messages(conversation_id: ConversationId, limit: Limite(30, 200) = 30) -> str:
    """Últimos mensajes de una conversación en orden cronológico. direction: in = cliente,
    out = IA o persona del equipo. meta trae transcripciones de audio, descripciones de
    imagen, texto de PDFs y las fuentes que citó la IA (kb_sources)."""
    rows = _rest("GET", "messages", {
        "select": "direction,type,body,status,error_message,meta,sender_user_id,created_at",
        "conversation_id": f"eq.{conversation_id}", "order": "created_at.desc", "limit": str(limit)})
    return _out(list(reversed(rows or [])))


@mcp.tool(annotations=ESCRITURA)
@_errores
def wa_toggle_ai(
    conversation_id: ConversationId,
    enabled: Annotated[bool, Field(description="true = la IA responde; false = atiende una persona del equipo")],
) -> str:
    """ESCRIBE: prende o apaga la IA en una conversación. Confirmá con el usuario antes de usarla."""
    return _out(_rest("PATCH", "conversations", {"id": f"eq.{conversation_id}"}, {"ai_enabled": enabled},
                      prefer="return=representation"))


@mcp.tool(annotations=ESCRITURA)
@_errores
def wa_set_state(
    conversation_id: ConversationId,
    state: Annotated[str, Field(description="Nuevo estado: " + " | ".join(CONV_STATES))],
) -> str:
    """ESCRIBE: cambia el estado de una conversación. Confirmá con el usuario antes de usarla."""
    if state not in CONV_STATES:
        raise ToolError(f"Estado inválido '{state}'. Opciones: {', '.join(CONV_STATES)}")
    return _out(_rest("PATCH", "conversations", {"id": f"eq.{conversation_id}"}, {"state": state},
                      prefer="return=representation"))


# ---------------------------------------------------------------- contactos y memoria ARM

@mcp.tool(annotations=LECTURA)
@_errores
def wa_contacts(
    workspace: Workspace,
    search: Annotated[str, Field(description="Texto a buscar en el nombre o el teléfono. Vacío = todos")] = "",
    limit: Limite(30, 200) = 30,
) -> str:
    """Contactos del CRM de un workspace: nombre, teléfono, etapa, etiquetas y consentimiento (opt-in)."""
    ws = _workspace_id(workspace)
    params = {"select": "id,name,phone,email,stage,tags,opt_in,opt_in_source,opt_out_at,source,created_at",
              "workspace_id": f"eq.{ws}", "order": "created_at.desc", "limit": str(limit)}
    if search:
        s = "".join(ch for ch in search if ch not in ",()*")
        params["or"] = f"(name.ilike.*{s}*,phone.ilike.*{s}*)"
    return _out(_rest("GET", "contacts", params))


@mcp.tool(annotations=LECTURA)
@_errores
def wa_claims(
    contact_id: ContactId,
    include_retracted: Annotated[bool, Field(description="Incluir también las anotaciones retiradas")] = False,
) -> str:
    """Memoria ARM de un contacto: necesidades, objetivos, objeciones, compromisos, riesgos y datos.
    Cada anotación dice si tiene fuente (la cita textual del cliente) o si es una corazonada."""
    params = {"select": "kind,text,quote,author,status,source_message_id,created_at",
              "contact_id": f"eq.{contact_id}", "order": "created_at.desc"}
    if not include_retracted:
        params["status"] = "eq.active"
    rows = _rest("GET", "contact_claims", params) or []
    for r in rows:
        r["fuente"] = "con fuente" if r.pop("source_message_id") else "corazonada"
    return _out(rows)


# ---------------------------------------------------------------- revisión y campañas ARM

@mcp.tool(annotations=LECTURA)
@_errores
def wa_proposals(
    workspace: Workspace,
    status: Annotated[str, Field(description="pending | executed | failed | rejected | all")] = "pending",
    limit: Limite(30, 200) = 30,
) -> str:
    """Propuestas del agente que esperan (o esperaron) aprobación humana: qué herramienta quiso
    usar y con qué datos. Solo lectura: aprobar o rechazar se hace en la app (/revision)."""
    ws = _workspace_id(workspace)
    params = {"select": "id,tool_name,args,status,result,conversation_id,contact_id,decided_at,created_at",
              "workspace_id": f"eq.{ws}", "order": "created_at.desc", "limit": str(limit)}
    if status != "all":
        params["status"] = f"eq.{status}"
    return _out(_rest("GET", "agent_proposals", params))


@mcp.tool(annotations=LECTURA)
@_errores
def wa_campaigns(workspace: Workspace, limit: Limite(20, 100) = 20) -> str:
    """Campañas de reactivación del workspace: estado, plantilla, segmento y cuántos destinatarios
    hay por estado (enviados, fallidos, salteados). Solo lectura: se crean y aprueban en la app."""
    ws = _workspace_id(workspace)
    camps = _rest("GET", "campaigns", {
        "select": "id,name,status,template_name,template_language,segment,recipient_count,decided_at,created_at",
        "workspace_id": f"eq.{ws}", "order": "created_at.desc", "limit": str(limit)}) or []
    for c in camps:
        recips = _rest("GET", "campaign_recipients", {"select": "status", "campaign_id": f"eq.{c['id']}"}) or []
        c["destinatarios"] = {s: sum(1 for r in recips if r["status"] == s) for s in {r["status"] for r in recips}}
    return _out(camps)


# ---------------------------------------------------------------- agentes / prompts

@mcp.tool(annotations=LECTURA)
@_errores
def wa_agents(workspace: Workspace) -> str:
    """Agentes del workspace (ventas, soporte, turnos) con su modelo, configuración y prompt activo."""
    ws = _workspace_id(workspace)
    return _out(_rest("GET", "agents", {
        "select": "id,type,name,avatar_key,model,is_active,config,prompts(id,name,active_version_id)",
        "workspace_id": f"eq.{ws}"}))


@mcp.tool(annotations=LECTURA)
@_errores
def wa_prompt_get(agent_id: AgentId) -> str:
    """Texto del prompt publicado y activo de un agente, con su número de versión."""
    ag = _uno(_rest("GET", "agents", {"select": "prompt_id,name", "id": f"eq.{agent_id}"}), f"el agente {agent_id}")
    if not ag["prompt_id"]:
        raise ToolError("El agente no tiene un prompt asociado.")
    pr = _uno(_rest("GET", "prompts", {"select": "active_version_id", "id": f"eq.{ag['prompt_id']}"}), "el prompt")
    if not pr["active_version_id"]:
        raise ToolError("El prompt no tiene una versión activa.")
    v = _uno(_rest("GET", "prompt_versions", {"select": "version,body,published_at", "id": f"eq.{pr['active_version_id']}"}), "la versión")
    return _out({"agente": ag["name"], **v})


@mcp.tool(annotations=ESCRITURA)
@_errores
def wa_prompt_publish(
    agent_id: AgentId,
    body: Annotated[str, Field(description="Texto completo del prompt nuevo. Variables: {{agent_name}}, {{business_name}}")],
) -> str:
    """ESCRIBE: publica una versión NUEVA del prompt de un agente y la deja activa (las anteriores
    quedan en el historial). Antes de cambiar el prompt de un cliente real, confirmá con el usuario
    y medí el cambio con npm run eval:agente."""
    ag = _uno(_rest("GET", "agents", {"select": "workspace_id,prompt_id", "id": f"eq.{agent_id}"}), f"el agente {agent_id}")
    if not ag["prompt_id"]:
        raise ToolError("El agente no tiene un prompt asociado.")
    ws, pid = ag["workspace_id"], ag["prompt_id"]
    last = _rest("GET", "prompt_versions", {"select": "version", "prompt_id": f"eq.{pid}", "order": "version.desc", "limit": "1"})
    nxt = (last[0]["version"] + 1) if last else 1
    ver = _rest("POST", "prompt_versions", body={
        "workspace_id": ws, "prompt_id": pid, "version": nxt, "state": "published",
        "body": body, "published_at": datetime.now(timezone.utc).isoformat()}, prefer="return=representation")
    _rest("PATCH", "prompts", {"id": f"eq.{pid}"}, {"active_version_id": ver[0]["id"]})
    return _out({"ok": True, "version": nxt})


@mcp.tool(annotations=ESCRITURA)
@_errores
def wa_agent_update(
    agent_id: AgentId,
    name: Annotated[str, Field(description="Nombre nuevo. Vacío = no cambia")] = "",
    model: Annotated[str, Field(description="Modelo nuevo (ej. auto, mistral-medium-3.5). 'default' = el de la instalación. Vacío = no cambia")] = "",
) -> str:
    """ESCRIBE: cambia el nombre y/o el modelo de un agente."""
    patch: dict[str, Any] = {}
    if name:
        patch["name"] = name
    if model:
        patch["model"] = None if model == "default" else model
    if not patch:
        raise ToolError("No hay nada para cambiar: pasá name o model.")
    return _out(_rest("PATCH", "agents", {"id": f"eq.{agent_id}"}, patch, prefer="return=representation"))


@mcp.tool(annotations=ESCRITURA)
@_errores
def wa_agent_activate(workspace: Workspace, agent_id: AgentId) -> str:
    """ESCRIBE: deja activo este agente en el workspace y desactiva los otros (hay uno solo activo)."""
    ws = _workspace_id(workspace)
    _rpc("set_active_agent", {"p_workspace": ws, "p_agent": agent_id})
    return _out(_rest("GET", "agents", {"select": "id,type,name,is_active", "workspace_id": f"eq.{ws}"}))


# ---------------------------------------------------------------- negocio / conocimiento

@mcp.tool(annotations=LECTURA)
@_errores
def wa_business_info_get(workspace: Workspace) -> str:
    """Información del negocio que usa el agente: horarios, servicios, precios, dirección, etc."""
    ws = _workspace_id(workspace)
    return _out(_rest("GET", "business_info", {"select": "structured,free_text,updated_at", "workspace_id": f"eq.{ws}"}))


@mcp.tool(annotations=ESCRITURA)
@_errores
def wa_business_info_set(
    workspace: Workspace,
    free_text: Annotated[str, Field(description="Texto libre nuevo (reemplaza el anterior). Vacío = no cambia")] = "",
    structured_json: Annotated[str, Field(description="Objeto JSON con los datos estructurados (reemplaza los anteriores). Vacío = no cambia")] = "",
) -> str:
    """ESCRIBE: actualiza la información del negocio que lee el agente. Confirmá con el usuario."""
    ws = _workspace_id(workspace)
    row: dict[str, Any] = {"workspace_id": ws}
    if free_text:
        row["free_text"] = free_text
    if structured_json:
        try:
            row["structured"] = json.loads(structured_json)
        except json.JSONDecodeError as e:
            raise ToolError(f"structured_json no es un JSON válido: {e}") from e
    if len(row) == 1:
        raise ToolError("No hay nada para cambiar: pasá free_text o structured_json.")
    return _out(_rest("POST", "business_info", {"on_conflict": "workspace_id"}, row,
                      prefer="resolution=merge-duplicates,return=representation"))


@mcp.tool(annotations=LECTURA)
@_errores
def wa_kb_documents(workspace: Workspace) -> str:
    """Documentos de la base de conocimiento y cuántos fragmentos tiene cada uno. Para cargar
    documentos nuevos se usa la app (calcula los embeddings)."""
    ws = _workspace_id(workspace)
    return _out(_rest("GET", "kb_documents", {
        "select": "id,title,source_type,meta,created_at,kb_chunks(count)",
        "workspace_id": f"eq.{ws}", "order": "created_at.desc"}))


@mcp.tool(annotations=LECTURA)
@_errores
def wa_templates(workspace: Workspace) -> str:
    """Plantillas de WhatsApp del workspace y su estado de aprobación en Meta."""
    ws = _workspace_id(workspace)
    return _out(_rest("GET", "templates", {
        "select": "id,name,language,category,status,body_template,rejection_reason,approved_at",
        "workspace_id": f"eq.{ws}", "order": "created_at.desc"}))


@mcp.tool(annotations=LECTURA)
@_errores
def wa_events(
    workspace: Workspace,
    level: Annotated[str, Field(description="Filtrar por nivel: debug | info | warn | error. Vacío = todos")] = "",
    limit: Limite(30, 200) = 30,
) -> str:
    """Registro de eventos del workspace (auditoría y errores): llamadas a herramientas, cambios de
    modelo, fallas de envío, etc."""
    ws = _workspace_id(workspace)
    params = {"select": "type,level,payload,conversation_id,created_at",
              "workspace_id": f"eq.{ws}", "order": "created_at.desc", "limit": str(limit)}
    if level:
        params["level"] = f"eq.{level}"
    return _out(_rest("GET", "events", params))


# ---------------------------------------------------------------- cola

@mcp.tool(annotations=LECTURA)
@_errores
def wa_batches(
    status: Annotated[str, Field(description="Estados separados por coma: buffering, processing, flushed, processed, cancelled")] = "buffering,processing",
    limit: Limite(20, 100) = 20,
) -> str:
    """Batches de la cola de mensajes (por defecto, los pendientes de procesar)."""
    estados = [s.strip() for s in status.split(",") if s.strip()]
    validos = {"buffering", "processing", "flushed", "processed", "cancelled"}
    if not estados or not set(estados) <= validos:
        raise ToolError(f"status inválido. Opciones: {', '.join(sorted(validos))}")
    return _out(_rest("GET", "message_batches", {
        "select": "id,status,message_count,flush_at,updated_at,meta,workspaces(slug)",
        "status": f"in.({','.join(estados)})", "order": "updated_at.desc", "limit": str(limit)}))


@mcp.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=True))
@_errores
def wa_cron_flush() -> str:
    """Procesa ya la cola de mensajes y la siguiente tanda de campañas aprobadas (lo mismo que hace
    el cron cada minuto). Requiere WSAAS_CRON_SECRET."""
    _check_config()
    if not CRON_SECRET:
        raise ToolError("Falta WSAAS_CRON_SECRET (el mismo valor que CRON_SECRET en Vercel).")
    r = requests.get(f"{APP_URL}/api/cron/buffer-flush", headers={"Authorization": f"Bearer {CRON_SECRET}"}, timeout=60)
    if r.status_code >= 400:
        raise ToolError(f"El cron respondió HTTP {r.status_code}: {r.text[:300]}")
    return f"HTTP {r.status_code}: {r.text[:300]}"


# ---------------------------------------------------------------- recursos (datos para el prompt)

@mcp.resource("arm://workspaces", name="workspaces", description="Lista de workspaces (clientes de ARM)",
              mime_type="application/json")
def recurso_workspaces() -> list[dict]:
    return _rest("GET", "workspaces", {"select": "id,name,slug,is_active", "order": "name.asc"}) or []


@mcp.resource("arm://workspaces/{workspace}/negocio", name="negocio",
              description="Información del negocio y agentes de un workspace (UUID o slug)", mime_type="application/json")
def recurso_negocio(workspace: str) -> dict:
    ws = _workspace_id(workspace)
    return {
        "business_info": _rest("GET", "business_info", {"select": "structured,free_text", "workspace_id": f"eq.{ws}"}),
        "agentes": _rest("GET", "agents", {"select": "type,name,model,is_active", "workspace_id": f"eq.{ws}"}),
    }


@mcp.resource("arm://contacts/{contact_id}", name="contacto",
              description="Ficha de un contacto con su memoria ARM activa (necesidades, objeciones, compromisos...)",
              mime_type="application/json")
def recurso_contacto(contact_id: str) -> dict:
    c = _uno(_rest("GET", "contacts", {"select": "id,name,phone,stage,tags,opt_in,opt_in_source,created_at",
                                       "id": f"eq.{contact_id}"}), f"el contacto {contact_id}")
    claims = _rest("GET", "contact_claims", {"select": "kind,text,quote,source_message_id,created_at",
                                            "contact_id": f"eq.{contact_id}", "status": "eq.active",
                                            "order": "created_at.desc"}) or []
    c["memoria"] = [{"tipo": x["kind"], "texto": x["text"], "cita": x["quote"],
                     "fuente": "con fuente" if x["source_message_id"] else "corazonada"} for x in claims]
    return c


@mcp.resource("arm://conversations/{conversation_id}", name="conversacion",
              description="Transcripción de una conversación (últimos 50 mensajes, en orden)", mime_type="text/plain")
def recurso_conversacion(conversation_id: str) -> str:
    return _transcript(conversation_id, 50)


# ---------------------------------------------------------------- prompts (tareas armadas)

@mcp.prompt(name="resumen_cliente", description="Resumen accionable de un cliente: quién es, qué necesita, qué se le prometió y qué hacer ahora")
def prompt_resumen_cliente(
    contact_id: Annotated[str, Field(description="UUID del contacto a resumir")],
) -> list[base.Message]:
    return [base.UserMessage(f"""Armá un resumen accionable del cliente con id {contact_id} de ARM WhatsApp.

Pasos:
1. Leé su ficha y su memoria con el recurso arm://contacts/{contact_id} (o la herramienta wa_claims).
2. Buscá su conversación más reciente (wa_conversations del workspace, o el recurso arm://conversations/<id>) y leé los últimos mensajes.

Respondé en castellano, en este formato:
- *Quién es:* nombre, etapa y desde cuándo es contacto.
- *Qué necesita:* las necesidades y objetivos de la memoria. Marcá cuáles tienen fuente (cita del cliente) y cuáles son corazonadas.
- *Compromisos pendientes:* lo que se le prometió o lo que él prometió, con fecha si la hay.
- *Riesgos u objeciones:* lo que podría hacer que se pierda.
- *Próximo paso recomendado:* una sola acción concreta para el equipo.

Usá solo datos que hayas leído. Si algo no está, decí "sin datos" en vez de suponer. No cambies nada: es solo lectura.""")]


@mcp.prompt(name="preparar_reactivacion", description="Propone una campaña de reactivación para clientes inactivos, lista para crear y aprobar en la app")
def prompt_preparar_reactivacion(
    workspace: Annotated[str, Field(description="Workspace (UUID o slug)")],
    dias_inactivo: Annotated[str, Field(description="Cuántos días sin hablar cuenta como inactivo, ej. 30")] = "30",
) -> list[base.Message]:
    return [base.UserMessage(f"""Prepará una propuesta de campaña de reactivación para el workspace {workspace} de ARM WhatsApp, apuntada a clientes con más de {dias_inactivo} días sin conversar.

Pasos:
1. Leé el negocio con el recurso arm://workspaces/{workspace}/negocio.
2. Mirá las campañas anteriores (wa_campaigns) para no repetir una que ya se mandó o se rechazó.
3. Revisá las plantillas aprobadas por Meta (wa_templates): solo se puede usar una con status "approved".
4. Estimá el segmento con wa_contacts: solo cuentan los contactos con opt_in = true y sin opt_out_at. Nunca incluyas a quien se dio de baja.

Respondé en castellano:
- *Segmento:* criterio y cantidad aproximada de destinatarios (con opt-in).
- *Plantilla:* cuál usar y con qué variables. Si no hay ninguna aprobada que sirva, decilo y proponé el texto de una para mandar a aprobación.
- *Por qué ahora:* en una o dos oraciones.
- *Riesgos:* bajas, quejas o costo de mensajes de marketing.

No crees ni mandes nada: la campaña se crea y se aprueba en la app (Campañas), donde una persona decide.""")]


@mcp.prompt(name="revisar_pendientes", description="Repasa lo que espera una decisión humana en un workspace: propuestas del agente y conversaciones derivadas")
def prompt_revisar_pendientes(
    workspace: Annotated[str, Field(description="Workspace (UUID o slug)")],
) -> list[base.Message]:
    return [base.UserMessage(f"""Repasá todo lo que espera una decisión humana en el workspace {workspace} de ARM WhatsApp.

Pasos:
1. Propuestas pendientes del agente: wa_proposals con status "pending".
2. Conversaciones derivadas a una persona: wa_conversations con state "handoff_pending".
3. Para cada caso, leé el contexto necesario (wa_messages o el recurso arm://conversations/<id>, y la memoria del contacto con arm://contacts/<id>).

Respondé en castellano, con una lista ordenada por urgencia. Para cada ítem:
- qué pasó y qué pide el cliente (con sus palabras si están),
- qué propone el agente, si propuso algo,
- tu recomendación: aprobar, rechazar o responder a mano, y por qué.

No apruebes ni rechaces nada: las propuestas se deciden en la app (Revisión), donde quedan registradas.""")]


if __name__ == "__main__":
    mcp.run()
