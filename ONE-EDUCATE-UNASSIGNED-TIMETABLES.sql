-- Run once in the current OneLearn Supabase project, before uploading the JS update.
-- No student records, roles or permissions are changed. Safe to run again.
BEGIN;
DO $patch$
DECLARE src text; original text;
BEGIN
 IF to_regprocedure('public.ol_validate_timetable(jsonb)') IS NULL THEN
  RAISE EXCEPTION 'Existing ONE EDUCATE school-management upgrade is required first.';
 END IF;
 src := pg_get_functiondef('public.ol_validate_timetable(jsonb)'::regprocedure);
 original := src;
 IF position('ONE_EDUCATE_OPTIONAL_TEACHER' in src)>0 THEN RETURN; END IF;
 IF position('IF room IS NULL OR teacher IS NULL THEN' in src)=0
    OR position('OR a.tid=b.tid OR EXISTS' in src)=0 THEN
  RAISE EXCEPTION 'Timetable validator differs from the expected version. Nothing changed; request a compatible update.';
 END IF;
 src := replace(src,'IF room IS NULL OR teacher IS NULL THEN',
  '/* ONE_EDUCATE_OPTIONAL_TEACHER */ IF room IS NULL OR (nullif(c->>''teacherId'','''') IS NOT NULL AND teacher IS NULL) THEN');
 src := replace(src,'Every scheduled class needs a teaching room and named staff member with email:',
  'Every scheduled class needs a teaching room; an assigned teacher needs a valid staff name and email:');
 src := replace(src,'OR a.tid=b.tid OR EXISTS',
  'OR (nullif(a.tid,'''') IS NOT NULL AND a.tid=b.tid) OR EXISTS');
 IF src=original THEN RAISE EXCEPTION 'No compatible changes were applied.'; END IF;
 EXECUTE src;
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
