BEGIN;
CREATE TABLE IF NOT EXISTS public.ol_detention_settings(school_id uuid PRIMARY KEY REFERENCES public.ol_schools(id),reasons jsonb NOT NULL DEFAULT '["Disruption","Missed homework","Late to lesson","Uniform"]');
CREATE TABLE IF NOT EXISTS public.ol_detention_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),school_id uuid NOT NULL REFERENCES public.ol_schools(id),student_id text NOT NULL,reason text NOT NULL,day date NOT NULL,start_time time NOT NULL,minutes integer NOT NULL CHECK(minutes BETWEEN 5 AND 180),location text NOT NULL,status text NOT NULL DEFAULT 'Scheduled',created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ol_detention_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ol_detention_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ol_detention_settings,public.ol_detention_records FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.ol_detentions(p_slug text,p_action text DEFAULT 'list',p_data jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid uuid;ns text;reasons jsonb;valid boolean;
BEGIN
SELECT id INTO sid FROM public.ol_schools WHERE slug=p_slug AND active;
IF NOT public.ol_capability(sid,'attendance') THEN RAISE EXCEPTION 'School staff access required.';END IF;
SELECT s.reasons INTO reasons FROM public.ol_detention_settings s WHERE school_id=sid;
reasons:=coalesce(reasons,'["Disruption","Missed homework","Late to lesson","Uniform"]');
IF p_action='policy' THEN
 IF NOT public.ol_capability(sid,'policies') THEN RAISE EXCEPTION 'School leadership must edit reasons.';END IF;
 IF jsonb_typeof(p_data->'reasons') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Provide a list of reasons.';END IF;
 IF jsonb_array_length(p_data->'reasons') NOT BETWEEN 1 AND 50 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'reasons') v WHERE jsonb_typeof(v)<>'string' OR length(trim(v#>>'{}')) NOT BETWEEN 1 AND 120) THEN RAISE EXCEPTION 'Use 1–50 reasons, each 1–120 characters.';END IF;
 reasons:=p_data->'reasons';INSERT INTO public.ol_detention_settings VALUES(sid,reasons) ON CONFLICT(school_id) DO UPDATE SET reasons=excluded.reasons;
ELSIF p_action='create' THEN
 IF NOT public.ol_capability(sid,'points') THEN RAISE EXCEPTION 'Your role cannot add detentions.';END IF;
 ns:='school_'||replace(sid::text,'-','');
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.oe_workspace w CROSS JOIN LATERAL jsonb_array_elements(w.data->''students'') p WHERE w.id=1 AND p->>''id''=$1 AND NOT coalesce((p->>''archived'')::boolean,false))',ns) INTO valid USING p_data->>'studentId';
 IF NOT valid OR NOT (reasons ? coalesce(p_data->>'reason','')) THEN RAISE EXCEPTION 'Choose a current student and configured reason.';END IF;
 IF coalesce(p_data->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(p_data->>'time','') !~ '^\d{2}:\d{2}$' OR coalesce(p_data->>'minutes','') !~ '^[0-9]+$' OR coalesce(length(trim(p_data->>'location')),0) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Enter date, time, duration and location.';END IF;
 INSERT INTO public.ol_detention_records(school_id,student_id,reason,day,start_time,minutes,location,created_by) VALUES(sid,p_data->>'studentId',p_data->>'reason',(p_data->>'date')::date,(p_data->>'time')::time,(p_data->>'minutes')::integer,trim(p_data->>'location'),auth.uid());
ELSIF p_action='status' THEN
 IF NOT public.ol_capability(sid,'points') THEN RAISE EXCEPTION 'Your role cannot update detentions.';END IF;
 IF coalesce(p_data->>'status','') NOT IN ('Scheduled','Attended','Missed','Cancelled') THEN RAISE EXCEPTION 'Choose a valid detention status.';END IF;
 UPDATE public.ol_detention_records SET status=p_data->>'status' WHERE school_id=sid AND id=(p_data->>'id')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Detention not found in your school.';END IF;
ELSIF p_action<>'list' THEN RAISE EXCEPTION 'Unknown detention action.';
END IF;
RETURN jsonb_build_object('reasons',reasons,'canEdit',public.ol_capability(sid,'points'),'canPolicy',public.ol_capability(sid,'policies'),'records',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY day,start_time,created_at) FROM public.ol_detention_records d WHERE school_id=sid),'[]'));
END$$;
REVOKE ALL ON FUNCTION public.ol_detentions(text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ol_detentions(text,text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
