CREATE POLICY "Users read own report exports"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'report-exports' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users write own report exports"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'report-exports' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users update own report exports"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'report-exports' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users delete own report exports"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'report-exports' AND auth.uid()::text = (storage.foldername(name))[1]);