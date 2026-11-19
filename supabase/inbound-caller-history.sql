-- Persistent caller counts for the MG Express inbound call inbox.
-- Detailed call summaries still expire after four days.
CREATE TABLE IF NOT EXISTS public.inbound_caller_history (
  caller_phone text PRIMARY KEY CHECK (caller_phone ~ '^\+[1-9][0-9]{7,14}$'),
  total_calls integer NOT NULL DEFAULT 0 CHECK (total_calls >= 0),
  first_call_at timestamptz NOT NULL DEFAULT now(),
  last_call_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.inbound_caller_history_events (
  provider_call_id text PRIMARY KEY,
  caller_phone text NOT NULL REFERENCES public.inbound_caller_history(caller_phone),
  prior_call_count integer NOT NULL CHECK (prior_call_count >= 0),
  call_at timestamptz NOT NULL
);
ALTER TABLE public.inbound_caller_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_caller_history_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbound_caller_history, public.inbound_caller_history_events FROM anon, authenticated;
GRANT ALL ON public.inbound_caller_history, public.inbound_caller_history_events TO service_role;

WITH ranked AS (
  SELECT provider_call_id, caller_phone,
         row_number() OVER (PARTITION BY caller_phone ORDER BY COALESCE(started_at, created_at), provider_call_id) - 1 AS prior_call_count,
         COALESCE(started_at, created_at, now()) AS call_at
  FROM public.inbound_calls WHERE caller_phone IS NOT NULL
)
INSERT INTO public.inbound_caller_history(caller_phone, total_calls, first_call_at, last_call_at)
SELECT caller_phone, 0, min(call_at), max(call_at) FROM ranked
GROUP BY caller_phone ON CONFLICT (caller_phone) DO NOTHING;
WITH ranked AS (
  SELECT provider_call_id, caller_phone,
         row_number() OVER (PARTITION BY caller_phone ORDER BY COALESCE(started_at, created_at), provider_call_id) - 1 AS prior_call_count,
         COALESCE(started_at, created_at, now()) AS call_at
  FROM public.inbound_calls WHERE caller_phone IS NOT NULL
)
INSERT INTO public.inbound_caller_history_events(provider_call_id, caller_phone, prior_call_count, call_at)
SELECT provider_call_id, caller_phone, prior_call_count, call_at FROM ranked
ON CONFLICT (provider_call_id) DO NOTHING;
UPDATE public.inbound_caller_history h
SET total_calls = x.total_calls, first_call_at = x.first_call_at, last_call_at = x.last_call_at
FROM (
  SELECT caller_phone, count(*)::integer AS total_calls, min(call_at) AS first_call_at, max(call_at) AS last_call_at
  FROM public.inbound_caller_history_events GROUP BY caller_phone
) x WHERE h.caller_phone = x.caller_phone;

CREATE OR REPLACE FUNCTION public.record_inbound_caller_call(
  p_caller_phone text, p_provider_call_id text, p_call_at timestamptz
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_prior integer; v_existing integer; v_call_at timestamptz := COALESCE(p_call_at, now());
BEGIN
  IF p_caller_phone IS NULL OR p_caller_phone !~ '^\+[1-9][0-9]{7,14}$' THEN RAISE EXCEPTION 'Invalid caller phone'; END IF;
  IF p_provider_call_id IS NULL OR p_provider_call_id !~ '^[A-Za-z0-9_-]{6,128}$' THEN RAISE EXCEPTION 'Invalid call identifier'; END IF;
  INSERT INTO public.inbound_caller_history(caller_phone, total_calls, first_call_at, last_call_at)
  VALUES (p_caller_phone, 0, v_call_at, v_call_at) ON CONFLICT (caller_phone) DO NOTHING;
  SELECT total_calls INTO v_prior FROM public.inbound_caller_history WHERE caller_phone = p_caller_phone FOR UPDATE;
  SELECT prior_call_count INTO v_existing FROM public.inbound_caller_history_events WHERE provider_call_id = p_provider_call_id;
  IF FOUND THEN RETURN v_existing; END IF;
  INSERT INTO public.inbound_caller_history_events(provider_call_id, caller_phone, prior_call_count, call_at)
  VALUES (p_provider_call_id, p_caller_phone, v_prior, v_call_at) ON CONFLICT (provider_call_id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT prior_call_count INTO v_existing FROM public.inbound_caller_history_events WHERE provider_call_id = p_provider_call_id;
    RETURN COALESCE(v_existing, v_prior);
  END IF;
  UPDATE public.inbound_caller_history SET total_calls = v_prior + 1,
    first_call_at = LEAST(first_call_at, v_call_at), last_call_at = GREATEST(last_call_at, v_call_at)
  WHERE caller_phone = p_caller_phone;
  RETURN v_prior;
END;
$$;
REVOKE ALL ON FUNCTION public.record_inbound_caller_call(text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_inbound_caller_call(text, text, timestamptz) TO service_role;
