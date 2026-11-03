"""Prueba del servidor MCP con una ClientSession real (stdio): herramientas, errores, recursos y prompts."""
import asyncio, json, os, sys
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from pydantic import AnyUrl

# Lanza server.py con este mismo Python y las variables WSAAS_* del entorno.
# Solo LEE: las herramientas que escriben no se llaman.
SERVER = str(Path(__file__).with_name("server.py"))
PARAMS = StdioServerParameters(command=sys.executable, args=[SERVER], env=dict(os.environ))
NADA = "00000000-0000-0000-0000-000000000000"
ok_total = [0, 0]
def chk(nombre, ok, detalle=""):
    ok_total[0] += ok; ok_total[1] += 1
    print(f"  {'✅' if ok else '❌'} {nombre}{(' — ' + detalle) if detalle else ''}")

async def main():
    async with stdio_client(PARAMS) as (r, w):
        async with ClientSession(r, w) as s:
            init = await s.initialize()
            print("servidor:", init.serverInfo.name)
            tools = (await s.list_tools()).tools
            sin_desc = [f"{t.name}.{p}" for t in tools for p, spec in t.inputSchema.get("properties", {}).items() if not spec.get("description")]
            chk("herramientas listadas", len(tools) >= 24, f"{len(tools)}")
            chk("todos los parámetros con descripción", not sin_desc, ", ".join(sin_desc[:5]))
            sin_anot = [t.name for t in tools if not t.annotations]
            chk("todas con anotación lectura/escritura", not sin_anot, ", ".join(sin_anot))
            escrituras = sorted(t.name for t in tools if t.annotations and t.annotations.readOnlyHint is False)
            print("    escriben:", ", ".join(escrituras))
            # lecturas reales
            for name, args in [("wa_status", {}), ("wa_workspaces", {}), ("wa_conversations", {"workspace": NADA}),
                               ("wa_messages", {"conversation_id": NADA}), ("wa_contacts", {"workspace": NADA, "search": "ana"}),
                               ("wa_claims", {"contact_id": NADA}), ("wa_proposals", {"workspace": NADA}),
                               ("wa_campaigns", {"workspace": NADA}), ("wa_kb_documents", {"workspace": NADA}),
                               ("wa_templates", {"workspace": NADA}), ("wa_events", {"workspace": NADA}), ("wa_batches", {})]:
                res = await s.call_tool(name, args)
                txt = " ".join(c.text for c in res.content if hasattr(c, "text"))
                chk(f"{name} responde", not res.isError, txt[:90].replace("\n", " ") if res.isError else "")
            # errores: tienen que llegar como isError con mensaje claro
            for name, args, espera in [("wa_workspace", {"workspace": "no-existe"}, "No existe un workspace"),
                                       ("wa_conversations", {"workspace": NADA, "state": "volando"}, "Estado inválido"),
                                       ("wa_batches", {"status": "cualquiera"}, "status inválido"),
                                       ("wa_messages", {"conversation_id": NADA, "limit": 999}, "")]:
                res = await s.call_tool(name, args)
                txt = " ".join(c.text for c in res.content if hasattr(c, "text"))
                chk(f"error de {name} llega como isError", res.isError and espera in txt, txt[:90].replace("\n", " "))
            # recursos
            rs = (await s.list_resources()).resources
            ts = (await s.list_resource_templates()).resourceTemplates
            chk("recursos directos", [str(x.uri) for x in rs] == ["arm://workspaces"], str([str(x.uri) for x in rs]))
            chk("recursos con plantilla", len(ts) == 3, ", ".join(t.uriTemplate for t in ts))
            rr = await s.read_resource(AnyUrl("arm://workspaces"))
            c0 = rr.contents[0]
            chk("arm://workspaces devuelve JSON", c0.mimeType == "application/json" and isinstance(json.loads(c0.text), list), c0.mimeType)
            rr = await s.read_resource(AnyUrl(f"arm://conversations/{NADA}"))
            chk("arm://conversations/{id} devuelve texto", rr.contents[0].mimeType == "text/plain", rr.contents[0].text[:40])
            try:
                await s.read_resource(AnyUrl(f"arm://contacts/{NADA}"))
                chk("contacto inexistente da error", False)
            except Exception as e:
                chk("contacto inexistente da error", "No existe" in str(e), str(e)[:80])
            # prompts
            ps = (await s.list_prompts()).prompts
            chk("prompts listados", sorted(p.name for p in ps) == ["preparar_reactivacion", "resumen_cliente", "revisar_pendientes"], str([p.name for p in ps]))
            sin_arg_desc = [f"{p.name}.{a.name}" for p in ps for a in (p.arguments or []) if not a.description]
            chk("argumentos de prompts con descripción", not sin_arg_desc, str(sin_arg_desc))
            g = await s.get_prompt("resumen_cliente", {"contact_id": "abc-123"})
            texto = g.messages[0].content.text
            chk("get_prompt interpola el argumento", "abc-123" in texto and "arm://contacts/abc-123" in texto)
            g = await s.get_prompt("preparar_reactivacion", {"workspace": "barberia"})
            chk("argumento opcional toma su valor por defecto", "más de 30 días" in g.messages[0].content.text)
    print(f"\nTotal: {ok_total[0]}/{ok_total[1]} chequeos OK")

asyncio.run(main())
