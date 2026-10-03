BEGIN;
ALTER TABLE public.ol_members DROP CONSTRAINT IF EXISTS ol_members_role_check;
ALTER TABLE public.ol_members ADD CONSTRAINT ol_members_role_check CHECK(role IN ('admin','headteacher','deputy_head','assistant_head','timetable_manager','teacher','cover_teacher','office','hub','head_of_year','deputy_head_of_year','staff'));
ALTER TABLE public.ol_invites DROP CONSTRAINT IF EXISTS ol_invites_role_check;
ALTER TABLE public.ol_invites ADD CONSTRAINT ol_invites_role_check CHECK(role IN ('admin','headteacher','deputy_head','assistant_head','timetable_manager','teacher','cover_teacher','office','hub','head_of_year','deputy_head_of_year','staff'));
DO $$DECLARE src text;BEGIN
src:=pg_get_functiondef('public.ol_issue(uuid,text,text)'::regprocedure);src:=replace(src,'''office'')','''office'',''hub'',''head_of_year'',''deputy_head_of_year'',''staff'')');EXECUTE src;
src:=pg_get_functiondef('public.ol_redeem(text)'::regprocedure);src:=replace(src,'''office'')','''office'',''hub'',''head_of_year'',''deputy_head_of_year'')');EXECUTE src;
END$$;
CREATE OR REPLACE FUNCTION public.ol_capability(p_school uuid,p_cap text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
SELECT coalesce(CASE WHEN p_cap='funding' THEN public.ol_role(p_school) IN ('headteacher','deputy_head','assistant_head')
WHEN public.ol_role(p_school)='admin' THEN true
WHEN public.ol_role(p_school) IN ('headteacher','deputy_head','assistant_head') THEN p_cap<>'accounts'
WHEN public.ol_role(p_school) IN ('hub','head_of_year','deputy_head_of_year') THEN p_cap IN ('pupils','classmove','availability','attendance','points','alerts','resolve','teaching','safeguarding')
WHEN public.ol_role(p_school)='timetable_manager' THEN p_cap IN ('timetable','structure','staff','alerts','availability')
WHEN public.ol_role(p_school)='office' THEN p_cap IN ('pupils','classmove','attendance','alerts','availability')
WHEN public.ol_role(p_school)='teacher' THEN p_cap IN ('attendance','points','alerts','teaching','classmove')
WHEN public.ol_role(p_school) IN ('cover_teacher','staff') THEN p_cap IN ('attendance','alerts') ELSE false END,false)$$;
CREATE TABLE IF NOT EXISTS public.ol_school_ops(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),school_id uuid NOT NULL REFERENCES public.ol_schools(id),kind text NOT NULL CHECK(kind IN ('availability','alert','funding','lockdown','chat')),data jsonb NOT NULL,revision integer NOT NULL DEFAULT 1,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS ol_school_ops_school_kind ON public.ol_school_ops(school_id,kind);
ALTER TABLE public.ol_school_ops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ol_school_ops FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.ol_locked(sid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT EXISTS(SELECT 1 FROM public.ol_school_ops WHERE school_id=sid AND kind='lockdown' AND data->>'active'='true')$$;
CREATE OR REPLACE FUNCTION public.ol_ops_visible(sid uuid,d jsonb,actor uuid,w jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
SELECT (coalesce(d->>'type','')<>'Safeguarding' OR public.ol_capability(sid,'safeguarding') OR actor=auth.uid()) AND (
public.ol_capability(sid,'resolve') OR actor=auth.uid() OR CASE d->>'target' WHEN 'everyone' THEN true WHEN 'staff' THEN lower(d->>'targetId')=lower(auth.jwt()->>'email') WHEN 'role' THEN d->>'targetId'=public.ol_role(sid)
WHEN 'department' THEN EXISTS(SELECT 1 FROM jsonb_array_elements(w->'teachers') t WHERE lower(t->>'email')=lower(auth.jwt()->>'email') AND t->>'department'=d->>'targetId')
WHEN 'class' THEN EXISTS(SELECT 1 FROM jsonb_array_elements(w->'classes') c JOIN jsonb_array_elements(w->'teachers') t ON t->>'id'=c->>'teacherId' WHERE c->>'id'=d->>'targetId' AND lower(t->>'email')=lower(auth.jwt()->>'email'))
WHEN 'year' THEN EXISTS(SELECT 1 FROM (SELECT value FROM jsonb_array_elements(w->'classes') UNION ALL SELECT value FROM jsonb_array_elements(w->'tutors')) c JOIN jsonb_array_elements(w->'teachers') t ON t->>'id'=c.value->>'teacherId' WHERE c.value->>'year'=d->>'targetId' AND lower(t->>'email')=lower(auth.jwt()->>'email')) ELSE false END)$$;
CREATE OR REPLACE FUNCTION public.ol_operations(p_slug text,p_action text DEFAULT 'read',p_data jsonb DEFAULT '{}',p_id uuid DEFAULT NULL,p_revision bigint DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_column
DECLARE sid uuid;ns text;w jsonb;rev bigint;r text;k text;d jsonb;p jsonb;c jsonb;t jsonb;result jsonb;rec public.ol_school_ops;session_id uuid;v text;ids text[];startdate date;enddate date;lastadmin integer;newrole text;email text;
BEGIN
SELECT id INTO sid FROM public.ol_schools WHERE slug=p_slug AND active;r:=public.ol_role(sid);
IF r IS NULL THEN RAISE EXCEPTION 'School staff access required.';END IF;
ns:='school_'||replace(sid::text,'-','');
SELECT id INTO session_id FROM public.ol_school_ops WHERE school_id=sid AND kind='lockdown' AND data->>'active'='true' LIMIT 1;
IF p_action='lockdown' THEN RETURN jsonb_build_object('active',session_id IS NOT NULL,'canControl',public.ol_capability(sid,'lockdown_admin'),'session',session_id,'notice',(SELECT data->>'notice' FROM public.ol_school_ops WHERE id=session_id),'messages',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY created_at) FROM (SELECT id,data,created_at FROM public.ol_school_ops WHERE school_id=sid AND kind='chat' AND data->>'session'=session_id::text ORDER BY created_at DESC LIMIT 150)x),'[]'));END IF;
IF session_id IS NOT NULL AND p_action<>'chat' AND NOT public.ol_capability(sid,'lockdown_admin') THEN RAISE EXCEPTION 'LOCKDOWN: only the LockDown area is available.';END IF;
IF p_action='lockdown_set' THEN
 IF NOT public.ol_capability(sid,'lockdown_admin') THEN RAISE EXCEPTION 'School leadership must control lockdown.';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(sid::text));
 IF jsonb_typeof(p_data->'active') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Choose lockdown status.';END IF;
 IF p_data->>'active'='true' THEN
 IF EXISTS(SELECT 1 FROM public.ol_school_ops WHERE school_id=sid AND kind='lockdown' AND data->>'active'='true') THEN RAISE EXCEPTION 'Lockdown is already active.';END IF;
 IF length(trim(coalesce(p_data->>'notice',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Enter staff instructions.';END IF;
 INSERT INTO public.ol_school_ops(school_id,kind,data,created_by) VALUES(sid,'lockdown',jsonb_build_object('active',true,'notice',p_data->>'notice'),auth.uid());
 ELSE UPDATE public.ol_school_ops SET data=data||jsonb_build_object('active',false,'endedAt',now()),revision=revision+1 WHERE school_id=sid AND kind='lockdown' AND data->>'active'='true';END IF;
 RETURN jsonb_build_object('ok',true);
ELSIF p_action='chat' THEN
 IF session_id IS NULL THEN RAISE EXCEPTION 'There is no active lockdown.';END IF;
 IF length(trim(coalesce(p_data->>'body',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Enter a message up to 2,000 characters.';END IF;
 INSERT INTO public.ol_school_ops(school_id,kind,data,created_by) VALUES(sid,'chat',jsonb_build_object('session',session_id,'body',trim(p_data->>'body'),'email',auth.jwt()->>'email'),auth.uid());RETURN jsonb_build_object('ok',true);
END IF;
EXECUTE format('SELECT data,revision FROM %I.oe_workspace WHERE id=1 FOR UPDATE',ns) INTO w,rev;
IF p_action='read' THEN RETURN jsonb_build_object('role',r,'capabilities',(SELECT jsonb_object_agg(x,public.ol_capability(sid,x)) FROM unnest(ARRAY['policies','pupils','structure','staff','timetable','attendance','points','alerts','resolve','accounts','teaching','classmove','availability','funding','safeguarding','lockdown_admin'])x),
 'items',coalesce((SELECT jsonb_agg(to_jsonb(o)||jsonb_build_object('data',o.data-'attachment') ORDER BY o.created_at DESC) FROM public.ol_school_ops o WHERE school_id=sid AND (kind='availability' OR kind='funding' AND public.ol_capability(sid,'funding') OR kind='alert' AND public.ol_ops_visible(sid,data,created_by,w))),'[]'),
 'members',CASE WHEN public.ol_capability(sid,'accounts') THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'role',m.role)) FROM public.ol_members m JOIN auth.users u ON u.id=m.user_id WHERE school_id=sid),'[]') ELSE '[]'::jsonb END);
ELSIF p_action='role' THEN
 IF NOT public.ol_capability(sid,'accounts') THEN RAISE EXCEPTION 'Administrator access required.';END IF;newrole:=p_data->>'role';
 IF newrole IS NULL OR newrole NOT IN ('admin','headteacher','deputy_head','assistant_head','timetable_manager','teacher','cover_teacher','office','hub','head_of_year','deputy_head_of_year','staff') THEN RAISE EXCEPTION 'Choose a staff role.';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(sid::text));
 IF NOT EXISTS(SELECT 1 FROM public.ol_members WHERE school_id=sid AND user_id=p_id) THEN RAISE EXCEPTION 'School member not found.';END IF;
 IF newrole<>'admin' AND EXISTS(SELECT 1 FROM public.ol_members WHERE school_id=sid AND user_id=p_id AND role='admin') AND (SELECT count(*) FROM public.ol_members WHERE school_id=sid AND role='admin')<2 THEN RAISE EXCEPTION 'Keep at least one school administrator.';END IF;
 UPDATE public.ol_members SET role=newrole WHERE school_id=sid AND user_id=p_id;SELECT lower(u.email) INTO email FROM auth.users u WHERE u.id=p_id;
 EXECUTE format('UPDATE %I.oe_staff_access SET role=$1 WHERE email=$2',ns) USING CASE WHEN newrole IN ('teacher','cover_teacher','staff') THEN 'teacher' ELSE 'admin' END,email;
ELSIF p_action IN ('student_status','class_members') THEN
 IF NOT public.ol_capability(sid,CASE WHEN p_action='student_status' THEN 'pupils' ELSE 'classmove' END) THEN RAISE EXCEPTION 'Your role cannot change these pupils.';END IF;
 IF p_revision<>rev THEN RAISE EXCEPTION 'REVISION_CONFLICT: reload before changing pupils.';END IF;
 IF jsonb_typeof(p_data->'students') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'students') NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Select 1–500 pupils.';END IF;
 SELECT array_agg(DISTINCT x) INTO ids FROM jsonb_array_elements_text(p_data->'students')x;
 IF EXISTS(SELECT 1 FROM unnest(ids)i WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w->'students')p WHERE p->>'id'=i)) THEN RAISE EXCEPTION 'Unknown pupil.';END IF;
 IF p_action='student_status' THEN
 v:=p_data->>'status';IF v IS NULL OR v NOT IN ('current','graduated','left','archived') THEN RAISE EXCEPTION 'Choose a pupil status.';END IF;
 IF v='graduated' AND EXISTS(SELECT 1 FROM jsonb_array_elements(w->'students')p WHERE p->>'id'=ANY(ids) AND p->>'year'<>'11') THEN RAISE EXCEPTION 'Only Year 11 pupils can graduate.';END IF;
 SELECT jsonb_agg(CASE WHEN p->>'id'=ANY(ids) THEN p||jsonb_build_object('status',v,'archived',v<>'current','statusChangedAt',now()) ELSE p END) INTO result FROM jsonb_array_elements(w->'students')p;
 ELSE
 SELECT value INTO c FROM jsonb_array_elements(w->'classes') WHERE value->>'id'=p_data->>'classId';
 IF c IS NULL OR p_data->>'mode' IS NULL OR p_data->>'mode' NOT IN ('add','remove','move') THEN RAISE EXCEPTION 'Choose a class and operation.';END IF;
 IF nullif(c->>'teacherId','') IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w->'teachers')t WHERE t->>'id'=c->>'teacherId' AND nullif(t->>'email','') IS NOT NULL) THEN RAISE EXCEPTION 'Assign a named teacher with email before allocating pupils.';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(w->'students')p WHERE p->>'id'=ANY(ids) AND (coalesce((p->>'archived')::boolean,false) OR p->>'year'<>c->>'year')) THEN RAISE EXCEPTION 'Use current pupils from the class year.';END IF;
 IF p_data->>'mode'='move' AND (p_data->>'fromClass'=c->>'id' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w->'classes')s WHERE s->>'id'=p_data->>'fromClass') OR EXISTS(SELECT 1 FROM jsonb_array_elements(w->'students')p WHERE p->>'id'=ANY(ids) AND NOT p->'classIds' ? (p_data->>'fromClass'))) THEN RAISE EXCEPTION 'Every selected pupil must belong to a different source class.';END IF;
 SELECT jsonb_agg(CASE WHEN p->>'id'=ANY(ids) THEN jsonb_set(p,'{classIds}',CASE WHEN p_data->>'mode'='remove' THEN (p->'classIds')-(c->>'id') ELSE (CASE WHEN p_data->>'mode'='move' THEN (p->'classIds')-(p_data->>'fromClass') ELSE p->'classIds' END)-(c->>'id')||jsonb_build_array(c->>'id') END) ELSE p END) INTO result FROM jsonb_array_elements(w->'students')p;
 END IF;
 w:=jsonb_set(w,'{students}',result);PERFORM public.ol_validate_timetable(w);
 EXECUTE format('UPDATE %I.oe_workspace SET data=$1,revision=revision+1,updated_at=now() WHERE id=1',ns) USING w;
ELSIF p_action='funding_get' THEN
 IF NOT public.ol_capability(sid,'funding') THEN RAISE EXCEPTION 'Headteacher or assistant/deputy headteacher access required.';END IF;
 SELECT data->'attachment' INTO result FROM public.ol_school_ops WHERE id=p_id AND school_id=sid AND kind='funding' AND coalesce(data->>'cancelled','false')<>'true';IF result IS NULL THEN RAISE EXCEPTION 'File unavailable.';END IF;RETURN result;
ELSIF p_action IN ('availability','alert','funding','cancel','resolve') THEN
 IF p_action IN ('cancel','resolve') THEN
 SELECT * INTO rec FROM public.ol_school_ops WHERE id=p_id AND school_id=sid FOR UPDATE;
 IF rec.id IS NULL OR rec.revision<>p_revision THEN RAISE EXCEPTION 'Record changed or missing. Refresh.';END IF;k:=rec.kind;
 IF k NOT IN ('availability','funding','alert') OR NOT public.ol_capability(sid,CASE k WHEN 'availability' THEN 'availability' WHEN 'funding' THEN 'funding' ELSE 'resolve' END) THEN RAISE EXCEPTION 'Your role cannot close this record.';END IF;
 UPDATE public.ol_school_ops SET data=data||jsonb_build_object('cancelled',true,'outcome',left(coalesce(p_data->>'outcome',''),2000),'closedAt',now()),revision=revision+1 WHERE id=p_id;
 ELSE
 k:=p_action;IF NOT public.ol_capability(sid,CASE k WHEN 'alert' THEN 'alerts' ELSE k END) THEN RAISE EXCEPTION 'Your role cannot create this record.';END IF;d:=p_data;
 IF k='availability' THEN
 IF d->>'personType' IS NULL OR d->>'personType' NOT IN ('teacher','student') THEN RAISE EXCEPTION 'Choose pupil or teacher.';END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w->CASE WHEN d->>'personType'='teacher' THEN 'teachers' ELSE 'students' END)p WHERE p->>'id'=d->>'personId' AND NOT coalesce((p->>'archived')::boolean,false)) THEN RAISE EXCEPTION 'Choose a current person.';END IF;
 startdate:=(d->>'start')::date;enddate:=nullif(d->>'end','')::date;
 IF startdate IS NULL OR enddate<startdate OR coalesce(d->>'week','') NOT IN ('A','B','both') OR jsonb_typeof(d->'periods') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Choose valid dates, week and lessons.';END IF;
 IF jsonb_array_length(d->'periods') NOT BETWEEN 1 AND 5 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(d->'periods')x WHERE x NOT IN ('1','2','3','4','5')) THEN RAISE EXCEPTION 'Choose lessons 1–5.';END IF;
 IF jsonb_typeof(d->'recurring') IS DISTINCT FROM 'boolean' OR d->>'recurring'='true' AND coalesce(d->>'day','') NOT IN ('0','1','2','3','4') THEN RAISE EXCEPTION 'Choose a weekday for recurring absence.';END IF;
 IF coalesce(length(trim(d->>'reason')),0) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Enter a reason.';END IF;
 ELSIF k='alert' THEN
 IF coalesce(d->>'type','') NOT IN ('Emergency','Assistance','Safeguarding','Removal follow-up') OR coalesce(d->>'priority','') NOT IN ('Information','Important','Urgent','Emergency') OR coalesce(length(trim(d->>'body')),0) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'Enter alert type, priority and message.';END IF;
 IF coalesce(d->>'target','') NOT IN ('everyone','staff','role','department','class','year') THEN RAISE EXCEPTION 'Choose alert recipients.';END IF;
 IF d->>'target'<>'everyone' AND nullif(d->>'targetId','') IS NULL THEN RAISE EXCEPTION 'Choose a recipient.';END IF;
 IF d->>'target'='staff' AND NOT EXISTS(SELECT 1 FROM public.ol_members m JOIN auth.users u ON u.id=m.user_id WHERE m.school_id=sid AND lower(u.email)=lower(d->>'targetId')) THEN RAISE EXCEPTION 'That email has no school staff account.';END IF;
 IF d->>'target'='class' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w->'classes')c WHERE c->>'id'=d->>'targetId') OR d->>'target'='year' AND d->>'targetId' NOT IN ('7','8','9','10','11') THEN RAISE EXCEPTION 'Choose a school class or year.';END IF;
 ELSE
 IF coalesce(length(trim(d->>'title')),0) NOT BETWEEN 1 AND 160 OR coalesce(d#>>'{attachment,name}','') !~* '\.(xlsx|xls|csv|pdf|png)$' OR coalesce(octet_length(decode(d#>>'{attachment,base64}','base64')),0) NOT BETWEEN 1 AND 2097152 THEN RAISE EXCEPTION 'Upload an Excel, CSV, PDF or PNG file under 2 MB and enter a title.';END IF;
 END IF;
 IF octet_length(d::text)>3000000 THEN RAISE EXCEPTION 'Record too large.';END IF;
 INSERT INTO public.ol_school_ops(school_id,kind,data,created_by) VALUES(sid,k,(d-'cancelled')||jsonb_build_object('cancelled',false),auth.uid());
 END IF;
ELSE RAISE EXCEPTION 'Unknown action.';END IF;
INSERT INTO public.ol_events(actor,school_id,action) VALUES(auth.uid(),sid,'OneEducation: '||p_action);
RETURN jsonb_build_object('ok',true);
END$$;
REVOKE ALL ON FUNCTION public.ol_locked(uuid),public.ol_ops_visible(uuid,jsonb,uuid,jsonb),public.ol_operations(text,text,jsonb,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ol_operations(text,text,jsonb,uuid,bigint) TO authenticated;


CREATE OR REPLACE FUNCTION public.ol_check_available(sid uuid,fresh jsonb,old jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cl jsonb;mt jsonb;wk text;cv jsonb;a jsonb;dt date;anchor date:=coalesce(nullif(fresh#>>'{school,weekAStart}','')::date,'2026-09-07');cycle text;BEGIN
FOR cl IN SELECT value FROM jsonb_array_elements(fresh->'classes') LOOP
FOR mt IN SELECT value FROM jsonb_array_elements(coalesce(cl->'meetings','[]')) LOOP
IF EXISTS(SELECT 1 FROM jsonb_array_elements(old->'classes')x WHERE x->>'id'=cl->>'id' AND x->>'teacherId'=cl->>'teacherId' AND x->'meetings' @> jsonb_build_array(mt)) THEN CONTINUE;END IF;
FOR a IN SELECT data FROM public.ol_school_ops WHERE school_id=sid AND kind='availability' AND data->>'cancelled'='false' AND (nullif(data->>'end','') IS NULL OR (data->>'end')::date>=current_date) LOOP
IF NOT (a->'periods' @> jsonb_build_array((mt->>'period')::integer)) OR NOT (a->>'personType'='teacher' AND a->>'personId'=cl->>'teacherId' OR a->>'personType'='student' AND EXISTS(SELECT 1 FROM jsonb_array_elements(fresh->'students')p WHERE p->>'id'=a->>'personId' AND NOT coalesce((p->>'archived')::boolean,false) AND p->'classIds' ? (cl->>'id'))) THEN CONTINUE;END IF;
IF a->>'recurring'='true' THEN
 IF a->>'day'=mt->>'day' AND (coalesce(mt->>'week','')='' OR a->>'week'='both' OR a->>'week'=mt->>'week') THEN RAISE EXCEPTION 'Scheduled absence conflicts with new lesson for %.',cl->>'name';END IF;
ELSE
dt:=(a->>'start')::date;cycle:=CASE WHEN mod(mod(floor((dt-anchor)::numeric/7)::integer,2)+2,2)=0 THEN 'A' ELSE 'B' END;
IF dt>=current_date AND ((extract(isodow FROM dt)::integer)-1)=(mt->>'day')::integer AND coalesce(mt->>'week',cycle)=cycle AND (a->>'week'='both' OR a->>'week'=cycle) THEN RAISE EXCEPTION 'A dated absence conflicts with this new weekly lesson. Arrange it manually around the absence.';END IF;
END IF;END LOOP;END LOOP;END LOOP;
FOR cv IN SELECT value FROM jsonb_array_elements(fresh->'covers') LOOP
IF coalesce(old->'covers','[]') @> jsonb_build_array(cv) THEN CONTINUE;END IF;
dt:=(cv->>'date')::date;cycle:=CASE WHEN mod(mod(floor((dt-anchor)::numeric/7)::integer,2)+2,2)=0 THEN 'A' ELSE 'B' END;
IF EXISTS(SELECT 1 FROM public.ol_school_ops o WHERE school_id=sid AND kind='availability' AND data->>'cancelled'='false' AND data->>'personType'='teacher' AND data->>'personId'=cv->>'teacherId' AND data->'periods' @> jsonb_build_array((cv->>'period')::integer) AND dt>=(data->>'start')::date AND (nullif(data->>'end','') IS NULL OR dt<=(data->>'end')::date) AND (data->>'week'='both' OR data->>'week'=cycle) AND (data->>'recurring'='true' AND (data->>'day')::integer=extract(isodow FROM dt)::integer-1 OR data->>'recurring'='false' AND dt=(data->>'start')::date)) THEN RAISE EXCEPTION 'That cover teacher is scheduled out of lesson.';END IF;
END LOOP;END$$;
REVOKE ALL ON FUNCTION public.ol_check_available(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;

DO $$BEGIN IF to_regprocedure('public.ol_call_before_integrated(text,text,jsonb)') IS NULL THEN ALTER FUNCTION public.ol_call(text,text,jsonb) RENAME TO ol_call_before_integrated;END IF;END$$;
CREATE OR REPLACE FUNCTION public.ol_call(p_slug text,p_method text,p_args jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid uuid;r jsonb;role text;cap text;student text;ns text;w jsonb;nextdata jsonb;BEGIN
SELECT id INTO sid FROM public.ol_schools WHERE slug=p_slug AND active;role:=public.ol_role(sid);
IF public.ol_locked(sid) AND (p_method IN ('oe_student_portal','oe_hub_student_action','oh_student','oh_open','oh_save','ss_student','ss_choose') OR NOT public.ol_capability(sid,'lockdown_admin')) THEN RAISE EXCEPTION 'LOCKDOWN: only the LockDown area is available. Follow school instructions.';END IF;
cap:=CASE WHEN p_method IN ('oe_set_staff','oe_staff_list','oe_audit_log') THEN 'accounts' WHEN p_method IN ('oe_hub_settings_save') THEN 'policies' ELSE NULL END;
IF cap IS NOT NULL AND NOT public.ol_capability(sid,cap) THEN RAISE EXCEPTION 'Your role cannot access administration.';END IF;
IF p_method='oe_set_staff' THEN RAISE EXCEPTION 'Manage staff roles in the integrated Staff & roles screen.';END IF;
IF p_method='oe_save_state' THEN
nextdata:=p_args->'p_data';
ns:='school_'||replace(sid::text,'-','');EXECUTE format('SELECT data FROM %I.oe_workspace WHERE id=1 FOR UPDATE',ns) INTO w;
IF nextdata->'classes' IS DISTINCT FROM w->'classes' OR nextdata->'covers' IS DISTINCT FROM w->'covers' THEN PERFORM public.ol_check_available(sid,nextdata,w);END IF;
IF EXISTS(SELECT 1 FROM jsonb_array_elements(nextdata->'students')p WHERE p->>'status'='graduated' AND p->>'year'<>'11') THEN RAISE EXCEPTION 'Only Year 11 pupils can graduate.';END IF;
IF EXISTS(SELECT 1 FROM jsonb_array_elements(nextdata->'students')p WHERE p ? 'status' AND (p->>'status' NOT IN ('current','graduated','left','archived') OR (p->>'status'<>'current') IS DISTINCT FROM coalesce((p->>'archived')::boolean,false))) THEN RAISE EXCEPTION 'Pupil status must match active/archive state.';END IF;
END IF;
r:=public.ol_call_before_integrated(p_slug,p_method,p_args);
IF p_method IN ('oe_get_state','oe_save_state') AND r->'data' IS NOT NULL THEN
 r:=r||jsonb_build_object('actualRole',role,'capabilities',(SELECT jsonb_object_agg(x,public.ol_capability(sid,x)) FROM unnest(ARRAY['policies','pupils','structure','staff','timetable','attendance','points','alerts','resolve','accounts','teaching','classmove','availability','funding','safeguarding','lockdown_admin'])x));
 IF NOT public.ol_capability(sid,'accounts') THEN r:=jsonb_set(r,'{data,audit}','[]');END IF;
 r:=jsonb_set(r,'{data,availability}',coalesce((SELECT jsonb_agg(data||jsonb_build_object('id',id)) FROM public.ol_school_ops WHERE school_id=sid AND kind='availability' AND data->>'cancelled'='false'),'[]'));
 r:=jsonb_set(r,'{data,detentions}',coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM public.ol_detention_records d WHERE school_id=sid),'[]'));
ELSIF p_method='oe_student_portal' THEN
student:=r#>>'{student,id}';
IF r#>>'{permissions,timetable}'='true' THEN
r:=r||jsonb_build_object('detentions',coalesce((SELECT jsonb_agg(to_jsonb(d)-'school_id'-'created_by') FROM public.ol_detention_records d WHERE school_id=sid AND student_id=student AND status<>'Cancelled'),'[]'),
'availability',coalesce((SELECT jsonb_agg((data-'reason'-'notes')||jsonb_build_object('id',id)) FROM public.ol_school_ops WHERE school_id=sid AND kind='availability' AND data->>'cancelled'='false' AND (data->>'personType'='student' AND data->>'personId'=student OR data->>'personType'='teacher' AND EXISTS(SELECT 1 FROM jsonb_array_elements(r->'classes')c WHERE c->>'teacherId'=data->>'personId'))),'[]'));
END IF;
END IF;
RETURN r;END$$;
REVOKE ALL ON FUNCTION public.ol_call_before_integrated(text,text,jsonb),public.ol_call(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ol_call(text,text,jsonb) TO anon,authenticated;
CREATE OR REPLACE FUNCTION public.ol_alerts(p_slug text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$DECLARE sid uuid;ns text;w jsonb;r jsonb;BEGIN
SELECT id INTO sid FROM public.ol_schools WHERE slug=p_slug AND active;IF NOT public.ol_capability(sid,'alerts') THEN RAISE EXCEPTION 'School staff access required.';END IF;
IF public.ol_locked(sid) AND NOT public.ol_capability(sid,'lockdown_admin') THEN RETURN '[]';END IF;
ns:='school_'||replace(sid::text,'-','');EXECUTE format('SELECT data FROM %I.oe_workspace WHERE id=1',ns) INTO w;
SELECT coalesce(jsonb_agg(data||jsonb_build_object('id',id,'notes',data->>'body')),'[]') INTO r FROM public.ol_school_ops WHERE school_id=sid AND kind='alert' AND data->>'cancelled'='false' AND public.ol_ops_visible(sid,data,created_by,w);
RETURN r||coalesce((SELECT jsonb_agg(i) FROM jsonb_array_elements(w->'incidents')i WHERE i->>'status' IS DISTINCT FROM 'resolved'),'[]');END$$;
DO $$BEGIN IF to_regprocedure('public.ol_detentions_before_integrated(text,text,jsonb)') IS NULL THEN ALTER FUNCTION public.ol_detentions(text,text,jsonb) RENAME TO ol_detentions_before_integrated;END IF;END$$;
CREATE OR REPLACE FUNCTION public.ol_detentions(p_slug text,p_action text DEFAULT 'list',p_data jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$DECLARE sid uuid;BEGIN SELECT id INTO sid FROM public.ol_schools WHERE slug=p_slug AND active;IF public.ol_locked(sid) AND NOT public.ol_capability(sid,'lockdown_admin') THEN RAISE EXCEPTION 'LOCKDOWN: only the LockDown area is available.';END IF;RETURN public.ol_detentions_before_integrated(p_slug,p_action,p_data);END$$;
REVOKE ALL ON FUNCTION public.ol_detentions_before_integrated(text,text,jsonb),public.ol_detentions(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ol_detentions(text,text,jsonb) TO authenticated;

DO $upgrade$ DECLARE row record;ns text;patch text:=$private$CREATE OR REPLACE FUNCTION __SCHOOL__.oe_portal_permissions(p_student text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
SELECT '{"timetable":true,"classes":true,"exams":true,"notices":true,"homework":true,"reports":true,"evenings":true,"helpdesk":true,"activities":true,"revision":true}'::jsonb||coalesce(s.data->'global','{}')||coalesce(s.data->'years'->(SELECT p->>'year' FROM __SCHOOL__.oe_workspace w CROSS JOIN LATERAL jsonb_array_elements(w.data->'students')p WHERE w.id=1 AND p->>'id'=p_student),'{}') FROM __SCHOOL__.oe_portal_settings s WHERE id=1$$;
CREATE OR REPLACE FUNCTION __SCHOOL__.oe_hub_settings_save(p_data jsonb,p_revision integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$DECLARE rev integer;rules jsonb;kv record;yr text;BEGIN
IF NOT public.ol_capability(substring('__SCHOOL__' from 8)::uuid,'policies') THEN RAISE EXCEPTION 'School leadership controls portal settings.';END IF;
SELECT revision INTO rev FROM __SCHOOL__.oe_portal_settings WHERE id=1 FOR UPDATE;IF rev<>p_revision THEN RAISE EXCEPTION 'Settings changed elsewhere. Reload.';END IF;
IF jsonb_typeof(p_data->'global') IS DISTINCT FROM 'object' OR jsonb_typeof(p_data->'years') IS DISTINCT FROM 'object' OR octet_length(p_data::text)>500000 THEN RAISE EXCEPTION 'Invalid year settings.';END IF;
FOR yr IN SELECT jsonb_object_keys(p_data->'years') LOOP IF yr NOT IN ('7','8','9','10','11') THEN RAISE EXCEPTION 'Choose Year 7–11.';END IF;END LOOP;
FOR rules IN SELECT p_data->'global' UNION ALL SELECT value FROM jsonb_each(p_data->'years') LOOP
IF jsonb_typeof(rules)<>'object' THEN RAISE EXCEPTION 'Invalid year visibility.';END IF;
FOR kv IN SELECT * FROM jsonb_each(rules) LOOP IF kv.key NOT IN ('timetable','classes','exams','notices','homework','reports','evenings','helpdesk','activities','revision') OR jsonb_typeof(kv.value)<>'boolean' THEN RAISE EXCEPTION 'Invalid portal section.';END IF;END LOOP;END LOOP;
UPDATE __SCHOOL__.oe_portal_settings SET data=p_data-'students',revision=revision+1 WHERE id=1;RETURN (SELECT to_jsonb(s) FROM __SCHOOL__.oe_portal_settings s WHERE id=1);END$$;
-- Convert legacy individual restrictions conservatively: any hidden section stays hidden for its year until leadership reviews it.
UPDATE __SCHOOL__.oe_portal_settings s SET data=(s.data-'students')||jsonb_build_object('legacyStudentOverrides',coalesce(s.data->'students','{}'),'years',coalesce((SELECT jsonb_object_agg(yr,rules) FROM (SELECT yr,jsonb_object_agg(section,visible) rules FROM (SELECT p->>'year' yr,v.key section,bool_and(v.value::text::boolean) visible FROM __SCHOOL__.oe_workspace w CROSS JOIN LATERAL jsonb_array_elements(w.data->'students')p JOIN LATERAL jsonb_each(coalesce(s.data->'students'->(p->>'id'),'{}'))v ON true WHERE w.id=1 GROUP BY p->>'year',v.key)x GROUP BY yr)y),'{}')),revision=revision+1 WHERE id=1 AND NOT data ? 'years';
-- Enriched fields are read-only; saving an old browser snapshot must not persist them in the workspace.
DO $$DECLARE src text;BEGIN src:=pg_get_functiondef('__SCHOOL__.oe_save_state(jsonb,bigint,text)'::regprocedure);src:=replace(src,'nextdata:=p_data;','nextdata:=p_data-''availability''-''detentions'';');EXECUTE src;END$$;
REVOKE ALL ON FUNCTION __SCHOOL__.oe_portal_permissions(text),__SCHOOL__.oe_hub_settings_save(jsonb,integer) FROM PUBLIC,anon,authenticated;
$private$;BEGIN FOR row IN SELECT id FROM public.ol_schools LOOP ns:='school_'||replace(row.id::text,'-','');EXECUTE replace(patch,'__SCHOOL__',ns);END LOOP;IF position('ONEEDUCATION_INTEGRATED_V3' in (SELECT body FROM public.ol_templates WHERE id=1))=0 THEN UPDATE public.ol_templates SET body=body||E'\n-- ONEEDUCATION_INTEGRATED_V3\n'||patch WHERE id=1;END IF;END $upgrade$;
NOTIFY pgrst,'reload schema';
COMMIT;
