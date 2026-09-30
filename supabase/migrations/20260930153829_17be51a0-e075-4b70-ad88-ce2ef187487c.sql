CREATE TABLE public.companion_memories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_key TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  memory_value TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  importance INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_key, memory_key)
);

GRANT ALL ON public.companion_memories TO service_role;

ALTER TABLE public.companion_memories ENABLE ROW LEVEL SECURITY;

CREATE INDEX companion_memories_owner_idx ON public.companion_memories (owner_key, updated_at DESC);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER companion_memories_updated_at
BEFORE UPDATE ON public.companion_memories
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
