CREATE TABLE public.companion_ai_pause (
  model text PRIMARY KEY,
  status integer NOT NULL,
  reason text NOT NULL,
  paused_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companion_ai_pause TO service_role;
ALTER TABLE public.companion_ai_pause ENABLE ROW LEVEL SECURITY;