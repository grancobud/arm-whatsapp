-- Marketing consent, apart from opt_in.
--
-- opt_in means "may receive messages": it starts true when someone writes to the
-- business and BAJA turns it off. It can't also mean "accepted promotions": Meta
-- asks for explicit permission per message category, and writing with a question
-- isn't that. Campaigns and marketing templates need marketing_opt_in.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS marketing_opt_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_opt_in_source TEXT;

-- Only consent someone recorded by hand counts. opt_in set by writing to the
-- business, or by ALTA, leaves no source or a "WhatsApp:" one.
UPDATE public.contacts
SET marketing_opt_in = TRUE,
    marketing_opt_in_at = COALESCE(opt_in_at, now()),
    marketing_opt_in_source = opt_in_source
WHERE opt_in = TRUE
  AND opt_out_at IS NULL
  AND opt_in_source IS NOT NULL
  AND btrim(opt_in_source) <> ''
  AND opt_in_source NOT LIKE 'WhatsApp:%';

-- Whatever turns opt_in off (BAJA, the team) also withdraws marketing consent,
-- and ALTA doesn't bring it back: asking for it again is a new decision.
CREATE OR REPLACE FUNCTION public.contacts_withdraw_marketing_consent()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.opt_in = FALSE THEN
    NEW.marketing_opt_in := FALSE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contacts_withdraw_marketing_consent ON public.contacts;
CREATE TRIGGER trg_contacts_withdraw_marketing_consent
  BEFORE INSERT OR UPDATE OF opt_in, marketing_opt_in ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_withdraw_marketing_consent();
