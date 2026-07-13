
CREATE TABLE public.chat_threads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'New chat',
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_threads TO authenticated;
GRANT ALL ON public.chat_threads TO service_role;
ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Household members manage chat threads" ON public.chat_threads
  FOR ALL USING (public.has_household_access(household_id))
  WITH CHECK (public.has_household_access(household_id) AND user_id = auth.uid());
CREATE TRIGGER chat_threads_updated_at BEFORE UPDATE ON public.chat_threads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX chat_threads_household_idx ON public.chat_threads(household_id, last_message_at DESC);

CREATE TABLE public.chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id UUID NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  parts JSONB NOT NULL DEFAULT '[]'::jsonb,
  message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Household members manage chat messages" ON public.chat_messages
  FOR ALL USING (public.has_household_access(household_id))
  WITH CHECK (public.has_household_access(household_id));
CREATE INDEX chat_messages_thread_idx ON public.chat_messages(thread_id, created_at ASC);
