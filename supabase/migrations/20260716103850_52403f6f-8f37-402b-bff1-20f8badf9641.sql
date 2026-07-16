
DROP POLICY IF EXISTS "receipts household read" ON storage.objects;
CREATE POLICY "receipts household read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'receipts'
    AND public.has_household_access(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "receipts household write" ON storage.objects;
CREATE POLICY "receipts household write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'receipts'
    AND public.has_household_access(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "receipts household delete" ON storage.objects;
CREATE POLICY "receipts household delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'receipts'
    AND public.has_household_access(((storage.foldername(name))[1])::uuid)
  );
