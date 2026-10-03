BEGIN;
-- Upgrade the NEW OneLearn platform project, not the original single-school Westview project.
ALTER TABLE public.ol_members DROP CONSTRAINT IF EXISTS ol_members_role_check;
ALTER TABLE public.ol_members ADD CONSTRAINT ol_members_role_check CHECK(role IN ('admin','headteacher','deputy_head','assistant_head','timetable_manager','teacher','cover_teacher','office'));
ALTER TABLE public.ol_invites DROP CONSTRAINT IF EXISTS ol_invites_role_check;
ALTER TABLE public.ol_invites ADD CONSTRAINT ol_invites_role_check CHECK(role IN ('admin','headteacher','deputy_head','assistant_head','timetable_manager','teacher','cover_teacher','office'));
DO $$DECLARE src text;BEGIN
src:=pg_get_functiondef('public.ol_issue(uuid,text,text)'::regprocedure);src:=replace(src,'''admin'',''teacher''','''admin'',''headteacher'',''deputy_head'',''assistant_head'',''timetable_manager'',''teacher'',''cover_teacher'',''office''');EXECUTE src;
src:=pg_get_functiondef('public.ol_redeem(text)'::regprocedure);src:=replace(src,'USING e,i.role;','USING e,CASE WHEN i.role IN (''admin'',''headteacher'',''deputy_head'',''assistant_head'',''timetable_manager'',''office'') THEN ''admin'' ELSE ''teacher'' END;');EXECUTE src;
END$$;
CREATE OR REPLACE FUNCTION public.ol_capability(p_school uuid,p_cap text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
SELECT coalesce(CASE
WHEN public.ol_role(p_school)='admin' THEN true
WHEN public.ol_role(p_school) IN ('headteacher','deputy_head','assistant_head') THEN p_cap<>'accounts'
WHEN public.ol_role(p_school)='timetable_manager' THEN p_cap IN ('timetable','structure','staff','alerts')
WHEN public.ol_role(p_school)='office' THEN p_cap IN ('pupils','attendance','alerts')
WHEN public.ol_role(p_school)='teacher' THEN p_cap IN ('attendance','points','alerts','teaching')
WHEN public.ol_role(p_school)='cover_teacher' THEN p_cap IN ('attendance','alerts') ELSE false END,false)
$$;
CREATE OR REPLACE FUNCTION public.ol_manage_state(p_slug text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$DECLARE sid uuid;r jsonb;BEGIN SELECT id INTO sid FROM public.ol_schools WHERE slug=p_slug AND active;IF public.ol_role(sid) IS NULL THEN RAISE EXCEPTION 'School staff access required.';END IF;r:=public.ol_call(p_slug,'oe_get_state');RETURN r||jsonb_build_object('actualRole',public.ol_role(sid),'capabilities',(SELECT jsonb_object_agg(x,public.ol_capability(sid,x)) FROM unnest(ARRAY['policies','pupils','structure','staff','timetable','attendance','points','alerts','resolve','accounts','teaching']) x));END$$;
CREATE OR REPLACE FUNCTION public.ol_alerts(p_slug text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$DECLARE sid uuid;ns text;r jsonb;BEGIN SELECT id INTO sid FROM public.ol_schools WHERE slug=p_slug AND active;IF NOT public.ol_capability(sid,'alerts') THEN RAISE EXCEPTION 'School staff access required.';END IF;ns:='school_'||replace(sid::text,'-','');EXECUTE format('SELECT coalesce(jsonb_agg(x),''[]''::jsonb) FROM %I.oe_workspace w CROSS JOIN LATERAL jsonb_array_elements(w.data->''incidents'') x WHERE w.id=1 AND x->>''status'' IS DISTINCT FROM ''resolved''',ns) INTO r;RETURN r;END$$;
CREATE OR REPLACE FUNCTION public.ol_validate_timetable(p_data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$DECLARE c jsonb;m jsonb;room jsonb;teacher jsonb;week text;d integer;p integer;BEGIN
IF (SELECT count(*)-count(DISTINCT lower(value->>'email')) FROM jsonb_array_elements(p_data->'teachers') WHERE nullif(value->>'email','') IS NOT NULL)>0 THEN RAISE EXCEPTION 'Duplicate staff email. Use one staff profile per teacher.';END IF;
IF (SELECT count(*)-count(DISTINCT lower(value->>'code')) FROM jsonb_array_elements(p_data->'rooms'))>0 THEN RAISE EXCEPTION 'Duplicate room code. Use one room record per physical room.';END IF;
FOR c IN SELECT value FROM jsonb_array_elements(p_data->'classes') LOOP
IF (SELECT count(*) FROM jsonb_array_elements(p_data->'students') s WHERE NOT coalesce((s->>'archived')::boolean,false) AND s->'classIds' ? (c->>'id'))>coalesce((c->>'capacity')::integer,0) THEN RAISE EXCEPTION 'Class capacity exceeded: %',c->>'name';END IF;
FOR m IN SELECT value FROM jsonb_array_elements(coalesce(c->'meetings','[]')) LOOP
week:=coalesce(m->>'week','');d:=(m->>'day')::integer;p:=(m->>'period')::integer;
IF week NOT IN ('','A','B') OR d IS NULL OR d NOT BETWEEN 0 AND 4 OR p IS NULL OR p NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Invalid timetable week, day or lesson.';END IF;
SELECT value INTO room FROM jsonb_array_elements(p_data->'rooms') WHERE value->>'id'=m->>'roomId' AND value->>'teaching'='true';
SELECT value INTO teacher FROM jsonb_array_elements(p_data->'teachers') WHERE value->>'id'=c->>'teacherId' AND length(trim(value->>'name'))>1 AND value->>'email' ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
IF room IS NULL OR teacher IS NULL THEN RAISE EXCEPTION 'Every scheduled class needs a teaching room and named staff member with email: %',c->>'name';END IF;
IF (SELECT count(*) FROM jsonb_array_elements(p_data->'students') s WHERE NOT coalesce((s->>'archived')::boolean,false) AND s->'classIds' ? (c->>'id'))>coalesce((room->>'capacity')::integer,0) THEN RAISE EXCEPTION 'Room capacity exceeded: %',room->>'name';END IF;
END LOOP;END LOOP;
IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'tutors') a CROSS JOIN jsonb_array_elements(p_data->'tutors') b WHERE a->>'id'<b->>'id' AND (nullif(a->>'roomId','')=nullif(b->>'roomId','') OR nullif(a->>'teacherId','')=nullif(b->>'teacherId',''))) THEN RAISE EXCEPTION 'Tutor-time clash: a room or tutor is assigned to more than one tutor group.';END IF;
IF EXISTS(WITH meetings AS (SELECT cl->>'id' cid,cl->>'teacherId' tid,mt->>'roomId' rid,mt->>'day' AS lesson_day,mt->>'period' AS lesson_period,w.week,row_number() over() n FROM jsonb_array_elements(p_data->'classes') cl CROSS JOIN LATERAL jsonb_array_elements(coalesce(cl->'meetings','[]')) mt CROSS JOIN (VALUES('A'),('B')) w(week) WHERE coalesce(mt->>'week','') IN ('',w.week)) SELECT 1 FROM meetings a JOIN meetings b ON a.n<b.n AND a.week=b.week AND a.lesson_day=b.lesson_day AND a.lesson_period=b.lesson_period WHERE a.cid=b.cid OR a.rid=b.rid OR a.tid=b.tid OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'students') s WHERE NOT coalesce((s->>'archived')::boolean,false) AND s->'classIds' ? a.cid AND s->'classIds' ? b.cid)) THEN RAISE EXCEPTION 'Timetable clash: a room, teacher or student is booked twice in the same week, day and lesson.';END IF;
END$$;
REVOKE ALL ON FUNCTION public.ol_capability(uuid,text),public.ol_manage_state(text),public.ol_alerts(text),public.ol_validate_timetable(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ol_manage_state(text),public.ol_alerts(text) TO authenticated;
DO $$BEGIN IF to_regprocedure('public.ol_call_before_revamp(text,text,jsonb)') IS NULL THEN ALTER FUNCTION public.ol_call(text,text,jsonb) RENAME TO ol_call_before_revamp;END IF;END$$;
CREATE OR REPLACE FUNCTION public.ol_call(p_slug text,p_method text,p_args jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$DECLARE sid uuid;cap text;BEGIN
SELECT id INTO sid FROM public.ol_schools WHERE slug=p_slug AND active;
cap:=CASE WHEN p_method IN ('oe_staff_list','oe_audit_log') THEN 'accounts' WHEN p_method IN ('oe_hub_settings_save','ss_settings_save') THEN 'policies' WHEN p_method IN ('oe_hub_item_save','oe_hub_review','oh_create','oh_archive','ss_notice') THEN 'teaching' WHEN p_method IN ('ss_import','ss_edit_student','ss_rotate') THEN 'pupils' WHEN p_method='ss_register' THEN 'attendance' ELSE NULL END;
IF cap IS NOT NULL AND NOT public.ol_capability(sid,cap) THEN RAISE EXCEPTION 'Your role cannot perform this operation.';END IF;
RETURN public.ol_call_before_revamp(p_slug,p_method,p_args);END$$;
REVOKE ALL ON FUNCTION public.ol_call_before_revamp(text,text,jsonb),public.ol_call(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ol_call(text,text,jsonb) TO anon,authenticated;



DO $upgrade$ DECLARE s record;ns text;patch text:=$patch$-- __SCHOOL__ is replaced only by the trusted upgrade/provisioning function.
DO $m$DECLARE src text;BEGIN
IF to_regprocedure('__SCHOOL__.oe_save_state_before_revamp(jsonb,bigint,text)') IS NULL THEN
ALTER FUNCTION __SCHOOL__.oe_save_state(jsonb,bigint,text) RENAME TO oe_save_state_before_revamp;
ALTER FUNCTION __SCHOOL__.oe_get_state() RENAME TO oe_get_state_before_revamp;
END IF;
src:=pg_get_functiondef('__SCHOOL__.oe_save_state_before_revamp(jsonb,bigint,text)'::regprocedure);
src:=replace(src,'IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(nextdata->''tutors'')','IF nullif(pupil->>''tutorId'','''') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(nextdata->''tutors'')');EXECUTE src;
END$m$;
CREATE OR REPLACE FUNCTION __SCHOOL__.oe_get_state() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$DECLARE r jsonb;sid uuid:=substring('__SCHOOL__' from 8)::uuid;BEGIN r:=__SCHOOL__.oe_get_state_before_revamp();IF NOT public.ol_capability(sid,'pupils') AND r->'data' IS NOT NULL THEN r:=jsonb_set(r,'{data,students}',coalesce((SELECT jsonb_agg(x-'loginCode') FROM jsonb_array_elements(r#>'{data,students}') x),'[]'));END IF;RETURN r;END$$;
CREATE OR REPLACE FUNCTION __SCHOOL__.oe_save_state(p_data jsonb,p_revision bigint,p_action text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old jsonb;sid uuid:=substring('__SCHOOL__' from 8)::uuid;k text;permission text;r text;nextdata jsonb;item jsonb;olditem jsonb;staff jsonb;
BEGIN
r:=public.ol_role(sid);IF r IS NULL THEN RAISE EXCEPTION 'School staff access required.';END IF;
SELECT data INTO old FROM __SCHOOL__.oe_workspace WHERE id=1 FOR UPDATE;
IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid workspace.';END IF;
nextdata:=p_data;
IF NOT public.ol_capability(sid,'pupils') THEN nextdata:=jsonb_set(nextdata,'{students}',old->'students');END IF;
FOR k IN SELECT key FROM jsonb_each(nextdata) LOOP
IF nextdata->k IS NOT DISTINCT FROM old->k OR k='audit' THEN CONTINUE;END IF;
permission:=CASE k WHEN 'school' THEN 'policies' WHEN 'houses' THEN 'policies' WHEN 'students' THEN 'pupils' WHEN 'tutors' THEN 'structure' WHEN 'classes' THEN 'structure' WHEN 'rooms' THEN 'structure' WHEN 'teachers' THEN 'staff' WHEN 'attendance' THEN 'attendance' WHEN 'points' THEN 'points' WHEN 'removals' THEN 'points' WHEN 'incidents' THEN 'alerts' WHEN 'announcements' THEN 'teaching' WHEN 'covers' THEN 'teaching' WHEN 'closures' THEN 'policies' WHEN 'cycles' THEN 'timetable' WHEN 'exams' THEN 'timetable' ELSE 'policies' END;
IF NOT public.ol_capability(sid,permission) THEN RAISE EXCEPTION 'Your role cannot change %.',k;END IF;
END LOOP;
IF jsonb_array_length(nextdata->'students')-jsonb_array_length(old->'students')>1 AND NOT coalesce((old#>>'{school,options,massImport}')::boolean,false) THEN RAISE EXCEPTION 'Mass import is off. Enable it in School policies first.';END IF;
IF nextdata->'teachers' IS DISTINCT FROM old->'teachers' THEN FOR staff IN SELECT value FROM jsonb_array_elements(nextdata->'teachers') LOOP IF NOT coalesce(old->'teachers','[]') @> jsonb_build_array(staff) AND (coalesce(length(trim(staff->>'name')),0)<2 OR coalesce(staff->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN RAISE EXCEPTION 'Staff profiles require a name and valid email.';END IF;END LOOP;END IF;
IF nextdata->'teachers' IS DISTINCT FROM old->'teachers' AND (SELECT count(*)-count(DISTINCT lower(value->>'email')) FROM jsonb_array_elements(nextdata->'teachers') WHERE nullif(value->>'email','') IS NOT NULL)>0 THEN RAISE EXCEPTION 'That staff email already has a profile.';END IF;
IF nextdata->'classes' IS DISTINCT FROM old->'classes' OR nextdata->'rooms' IS DISTINCT FROM old->'rooms' OR nextdata->'students' IS DISTINCT FROM old->'students' OR nextdata->'tutors' IS DISTINCT FROM old->'tutors' THEN PERFORM public.ol_validate_timetable(nextdata);END IF;
FOR item IN SELECT value FROM jsonb_array_elements(nextdata->'points') LOOP IF NOT coalesce(old->'points','[]') @> jsonb_build_array(item) THEN
IF coalesce(item->>'kind','') NOT IN ('reward','behaviour') OR coalesce(item->>'points','') !~ '^[0-9]+$' OR (item->>'points')::integer NOT BETWEEN 1 AND 50 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(nextdata->'students') p WHERE p->>'id'=item->>'studentId') THEN RAISE EXCEPTION 'Use a current student and 1–50 behaviour or house points.';END IF;END IF;END LOOP;
IF EXISTS(SELECT 1 FROM jsonb_array_elements(nextdata->'tutors') t WHERE (SELECT count(*) FROM jsonb_array_elements(nextdata->'students') p WHERE p->>'tutorId'=t->>'id' AND NOT coalesce((p->>'archived')::boolean,false))>coalesce((t->>'capacity')::integer,0)) THEN RAISE EXCEPTION 'Tutor group capacity exceeded.';END IF;
IF nextdata->'classes' IS DISTINCT FROM old->'classes' AND NOT public.ol_capability(sid,'timetable') AND EXISTS(SELECT 1 FROM jsonb_array_elements(nextdata->'classes') c WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(old->'classes') o WHERE o->>'id'=c->>'id' AND o->'meetings' IS NOT DISTINCT FROM c->'meetings')) THEN RAISE EXCEPTION 'Your role cannot change timetables.';END IF;
IF NOT public.ol_capability(sid,'resolve') THEN
FOR olditem IN SELECT value FROM jsonb_array_elements(old->'incidents') LOOP
SELECT value INTO item FROM jsonb_array_elements(nextdata->'incidents') WHERE value->>'id'=olditem->>'id';
IF item IS NULL OR item->>'status' IS DISTINCT FROM olditem->>'status' OR (item-'acknowledgedBy') IS DISTINCT FROM (olditem-'acknowledgedBy') THEN RAISE EXCEPTION 'School leadership must resolve or edit existing emergency alerts.';END IF;
IF NOT coalesce(item->'acknowledgedBy','[]') @> coalesce(olditem->'acknowledgedBy','[]') OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(item->'acknowledgedBy','[]')) ack WHERE NOT coalesce(olditem->'acknowledgedBy','[]') @> jsonb_build_array(ack) AND ack->>'email' IS DISTINCT FROM (auth.jwt()->>'email')) THEN RAISE EXCEPTION 'You may only add your own acknowledgement.';END IF;
END LOOP;
IF EXISTS(SELECT 1 FROM jsonb_array_elements(nextdata->'incidents') i WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(old->'incidents') o WHERE o->>'id'=i->>'id') AND i->>'status' IS DISTINCT FROM 'open') THEN RAISE EXCEPTION 'New emergency alerts must be open.';END IF;
END IF;
RETURN __SCHOOL__.oe_save_state_before_revamp(nextdata,p_revision,p_action);
END$$;
REVOKE ALL ON FUNCTION __SCHOOL__.oe_save_state_before_revamp(jsonb,bigint,text),__SCHOOL__.oe_get_state_before_revamp(),__SCHOOL__.oe_save_state(jsonb,bigint,text),__SCHOOL__.oe_get_state() FROM PUBLIC,anon,authenticated;
$patch$;BEGIN FOR s IN SELECT id FROM public.ol_schools LOOP ns:='school_'||replace(s.id::text,'-','');EXECUTE replace(patch,'__SCHOOL__',ns);EXECUTE format('UPDATE %I.oe_workspace SET data=jsonb_set(data,''{school,options}'',$1||coalesce(data#>''{school,options}'',''{}''::jsonb)),revision=revision+1 WHERE id=1',ns) USING '{"massImport":false,"autoClasses":false,"autoTutors":false,"autoHouses":false,"autoClassCreation":false,"autoTimetables":false}'::jsonb;END LOOP;IF (SELECT position('ONEEDUCATION_REVAMP_TEMPLATE' in body) FROM public.ol_templates WHERE id=1)=0 THEN UPDATE public.ol_templates SET body=body||E'\n-- ONEEDUCATION_REVAMP_TEMPLATE\n'||patch||$new$
UPDATE __SCHOOL__.oe_workspace SET data=jsonb_set(jsonb_set(jsonb_set(data,'{school,options}','{"massImport":false,"autoClasses":false,"autoTutors":false,"autoHouses":false,"autoClassCreation":false,"autoTimetables":false}'::jsonb),'{rooms}','[]'),'{houses}','[]') WHERE id=1;$new$ WHERE id=1;END IF;END $upgrade$;
NOTIFY pgrst,'reload schema';
COMMIT;
