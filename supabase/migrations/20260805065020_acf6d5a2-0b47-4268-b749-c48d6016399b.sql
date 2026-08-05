-- 1. Chat policies: restrict to authenticated role
DROP POLICY IF EXISTS "Household members manage chat threads" ON public.chat_threads;
CREATE POLICY "Household members manage chat threads"
ON public.chat_threads FOR ALL TO authenticated
USING (public.has_household_access(household_id))
WITH CHECK (public.has_household_access(household_id));

DROP POLICY IF EXISTS "Household members manage chat messages" ON public.chat_messages;
CREATE POLICY "Household members manage chat messages"
ON public.chat_messages FOR ALL TO authenticated
USING (public.has_household_access(household_id))
WITH CHECK (public.has_household_access(household_id));

-- 2. Explicit admin-only write policies on user_roles
CREATE POLICY "Admins can assign roles"
ON public.user_roles FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update roles"
ON public.user_roles FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete roles"
ON public.user_roles FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 3. Internal SECURITY DEFINER routines must not be callable by API users
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.seed_default_categories(uuid) FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM anon, authenticated, public;