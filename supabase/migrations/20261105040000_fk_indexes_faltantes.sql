-- Tres índices de la migración anterior no se crearon: sus nombres ya existían en
-- índices compuestos que empiezan por workspace_id, e IF NOT EXISTS los saltó.
-- Esos compuestos no cubren la clave foránea, así que van con nombre propio.
CREATE INDEX IF NOT EXISTS idx_contact_claims_contact_fk ON public.contact_claims(contact_id);
CREATE INDEX IF NOT EXISTS idx_contacts_owner_fk ON public.contacts(owner_id);
CREATE INDEX IF NOT EXISTS idx_conversations_assigned_fk ON public.conversations(assigned_to);
