# Servidor MCP de administración

Deja operar una instalación de ARM WhatsApp desde Claude (Claude Code, Claude
Desktop o cualquier cliente MCP). Usa el SDK oficial de Python (`FastMCP`) y
expone las tres piezas de MCP:

| Pieza | Qué hay |
| --- | --- |
| 🔧 **Herramientas** (24) | `wa_status`, `wa_workspaces`, `wa_conversations`, `wa_messages`, `wa_contacts`, `wa_claims` (memoria ARM), `wa_proposals` (revisión), `wa_campaigns`, `wa_agents`, `wa_prompt_get`, `wa_kb_documents`, `wa_templates`, `wa_events`, `wa_batches`… y 7 que **escriben**, marcadas como tales: `wa_toggle_ai`, `wa_set_state`, `wa_prompt_publish`, `wa_agent_update`, `wa_agent_activate`, `wa_business_info_set`, `wa_cron_flush` |
| 📄 **Recursos** | `arm://workspaces` (JSON) · `arm://workspaces/{workspace}/negocio` (JSON) · `arm://contacts/{contact_id}` (ficha + memoria, JSON) · `arm://conversations/{conversation_id}` (transcripción, texto) |
| 💬 **Prompts** | `resumen_cliente(contact_id)` · `preparar_reactivacion(workspace, dias_inactivo)` · `revisar_pendientes(workspace)` |

## Seguridad

Usa la clave `service_role` de Supabase: **ve todos los workspaces**. Es una
herramienta local para el dueño de la instalación, no para clientes. Por eso:

- nunca devuelve credenciales;
- no tiene SQL libre;
- **no manda WhatsApp ni aprueba propuestas**: eso pasa por la app, con sus
  controles (aprobación humana, registro de herramientas);
- cada herramienta declara si escribe (`readOnlyHint`), para que el cliente
  pida confirmación.

## Instalar

```bash
pip install -r mcp/admin/requirements.txt
```

Variables de entorno (nunca en el repo):

| Variable | Valor |
| --- | --- |
| `WSAAS_SUPABASE_URL` | `https://<proyecto>.supabase.co` |
| `WSAAS_SERVICE_ROLE_KEY` | clave secreta de Supabase |
| `WSAAS_APP_URL` | `https://<tu-app>.vercel.app` |
| `WSAAS_CRON_SECRET` | opcional, para `wa_cron_flush` |

Conectarlo a Claude Code:

```bash
claude mcp add arm-admin -- python mcp/admin/server.py
```

Cada persona lo apunta a **su** Supabase: Tomas al suyo de pruebas, Gastón al
de producción.

## Probar

- Con el inspector oficial: `mcp dev mcp/admin/server.py`.
- Con un cliente MCP real: `python mcp/admin/probar.py` lista herramientas,
  recursos y prompts, llama cada lectura, verifica que los errores lleguen con
  `isError` y que los prompts interpolen sus argumentos.
