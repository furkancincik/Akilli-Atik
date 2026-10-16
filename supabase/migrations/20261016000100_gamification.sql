-- STEP 2B: local preparation only. No automatic historical backfill.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.nickname_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT pg_catalog.translate(pg_catalog.normalize(value, 'NFC'),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZÇĞİÖŞÜçğıöşü',
    'abcdefghijklmnopqrstuvwxyzcgiosucgiosu') COLLATE "C";
$$;

CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname varchar(24),
  nickname_key text GENERATED ALWAYS AS (private.nickname_key(nickname)) STORED UNIQUE,
  arena_opt_in boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_nickname_check CHECK (nickname IS NULL OR
    (nickname = pg_catalog.normalize(nickname, 'NFC') AND
     nickname ~ '^[A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü0-9_]{2,23}$')),
  CONSTRAINT profiles_opt_in_check CHECK (NOT arena_opt_in OR nickname IS NOT NULL)
);

-- Composite ownership/request identity, including a column-selective SET NULL.
ALTER TABLE public.waste_analyses ADD CONSTRAINT waste_analyses_source_identity_key
  UNIQUE (id, user_id, client_request_id);
CREATE TABLE private.xp_awards (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  analysis_id uuid UNIQUE,
  source_analysis_id uuid NOT NULL UNIQUE,
  client_request_id uuid NOT NULL,
  award_day date NOT NULL,
  daily_slot smallint NOT NULL CHECK (daily_slot BETWEEN 1 AND 3),
  xp smallint NOT NULL CHECK (xp IN (50,75,100,150,200,250,300)),
  rule_version smallint NOT NULL DEFAULT 1 CHECK (rule_version = 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT xp_awards_request_key UNIQUE (user_id, client_request_id),
  CONSTRAINT xp_awards_daily_slot_key UNIQUE (user_id, award_day, daily_slot),
  CONSTRAINT xp_awards_source_check CHECK (analysis_id IS NULL OR analysis_id = source_analysis_id),
  CONSTRAINT xp_awards_analysis_fkey FOREIGN KEY (analysis_id, user_id, client_request_id)
    REFERENCES public.waste_analyses(id, user_id, client_request_id)
    MATCH SIMPLE ON DELETE SET NULL (analysis_id)
);
CREATE INDEX xp_awards_active_user_idx ON private.xp_awards(user_id) WHERE analysis_id IS NOT NULL;
COMMENT ON TABLE private.xp_awards IS
  'Private XP ledger. Deleted analyses leave quota/request tombstones; never store photos or provider payloads.';
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.xp_awards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles, private.xp_awards FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.profiles TO authenticated;
CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id AND NOT COALESCE((SELECT (auth.jwt()->>'is_anonymous')::boolean), false));

CREATE FUNCTION private.require_game_user() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR auth.jwt()->>'role' IS DISTINCT FROM 'authenticated'
    OR COALESCE((auth.jwt()->>'is_anonymous')::boolean, false)
    OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = actor) THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'AUTH_REQUIRED';
  END IF;
  RETURN actor;
END;
$$;

CREATE FUNCTION private.xp_for_category(category text) RETURNS smallint
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE category WHEN 'Organik' THEN 50 WHEN 'Kâğıt/Karton' THEN 75
    WHEN 'Cam' THEN 100 WHEN 'Metal' THEN 150 WHEN 'Plastik' THEN 200
    WHEN 'Pil' THEN 250 WHEN 'Elektronik' THEN 300 ELSE 0 END::smallint;
$$;

CREATE FUNCTION private.level_info(total bigint) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  thresholds bigint[] := ARRAY[0,100,250,500,1000,1750,2750,4000]::bigint[];
  titles text[] := ARRAY['Doğa Meraklısı','Geri Dönüşüm Çırağı','Çevre Dostu','Eko Kaşif',
    'Yeşil Öncü','Doğa Koruyucusu','Sürdürülebilirlik Elçisi','Çevre Şampiyonu'];
  current_level integer := 1;
  next_xp bigint;
BEGIN
  IF total IS NULL OR total < 0 THEN RAISE EXCEPTION 'INVALID_XP'; END IF;
  FOR i IN 1..8 LOOP
    IF total >= thresholds[i] THEN current_level := i; END IF;
  END LOOP;
  next_xp := thresholds[current_level + 1];
  RETURN pg_catalog.jsonb_build_object('level',current_level,'levelTitle',titles[current_level],
    'levelFloor',thresholds[current_level],'nextLevelXp',next_xp,
    'remainingXp',CASE WHEN next_xp IS NULL THEN 0 ELSE next_xp-total END,
    'progress',CASE WHEN next_xp IS NULL THEN 100::numeric
      ELSE pg_catalog.round((total-thresholds[current_level])*100.0/(next_xp-thresholds[current_level]),2) END);
END;
$$;

-- The only award path; callable by owner/trigger/backfill, never by API roles.
CREATE FUNCTION private.award_analysis(source_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE analysis public.waste_analyses%ROWTYPE; amount smallint; day_key date; slot smallint;
BEGIN
  SELECT * INTO analysis FROM public.waste_analyses WHERE id = source_id FOR KEY SHARE;
  IF NOT FOUND OR analysis.uncertain OR analysis.object_count <> 'single' OR analysis.schema_version <> 1 THEN RETURN false; END IF;
  amount := private.xp_for_category(analysis.category);
  IF amount = 0 THEN RETURN false; END IF;
  INSERT INTO public.profiles(user_id) VALUES(analysis.user_id) ON CONFLICT(user_id) DO NOTHING;
  PERFORM 1 FROM public.profiles WHERE user_id = analysis.user_id FOR NO KEY UPDATE;
  IF EXISTS (SELECT 1 FROM private.xp_awards WHERE source_analysis_id = analysis.id OR
    (user_id = analysis.user_id AND client_request_id = analysis.client_request_id)) THEN RETURN false; END IF;
  day_key := (analysis.created_at AT TIME ZONE 'Europe/Istanbul')::date;
  SELECT candidate::smallint INTO slot FROM pg_catalog.generate_series(1,3) AS candidate
    WHERE NOT EXISTS (SELECT 1 FROM private.xp_awards WHERE user_id = analysis.user_id
      AND award_day = day_key AND daily_slot = candidate) ORDER BY candidate LIMIT 1;
  IF slot IS NULL THEN RETURN false; END IF;
  INSERT INTO private.xp_awards(user_id,analysis_id,source_analysis_id,client_request_id,award_day,daily_slot,xp)
    VALUES(analysis.user_id,analysis.id,analysis.id,analysis.client_request_id,day_key,slot,amount);
  RETURN true;
END;
$$;
CREATE FUNCTION private.award_inserted_analysis() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.award_analysis(NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER waste_analyses_award_xp AFTER INSERT ON public.waste_analyses
  FOR EACH ROW EXECUTE FUNCTION private.award_inserted_analysis();

CREATE FUNCTION private.arena_rows()
RETURNS TABLE(rank bigint,user_id uuid,nickname text,total_xp bigint)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT pg_catalog.row_number() OVER (ORDER BY totals.total_xp DESC,p.nickname_key COLLATE "C" ASC),
    p.user_id,p.nickname::text,totals.total_xp
  FROM public.profiles p
  CROSS JOIN LATERAL (
    SELECT COALESCE(pg_catalog.sum(x.xp),0)::bigint AS total_xp
    FROM private.xp_awards x JOIN public.waste_analyses a
      ON a.id=x.analysis_id AND a.user_id=x.user_id AND a.client_request_id=x.client_request_id
    WHERE x.user_id=p.user_id
  ) totals WHERE p.arena_opt_in AND p.nickname IS NOT NULL;
$$;

CREATE FUNCTION private.my_profile() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := private.require_game_user(); profile public.profiles%ROWTYPE;
  total bigint; analyses integer; categories integer; slots integer; arena_rank bigint; badges jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO profile FROM public.profiles WHERE user_id=actor;
  SELECT COALESCE(pg_catalog.sum(x.xp),0),pg_catalog.count(*)::integer,pg_catalog.count(DISTINCT a.category)::integer
    INTO total,analyses,categories FROM private.xp_awards x JOIN public.waste_analyses a
      ON a.id=x.analysis_id AND a.user_id=x.user_id AND a.client_request_id=x.client_request_id WHERE x.user_id=actor;
  SELECT pg_catalog.count(*)::integer INTO slots FROM private.xp_awards
    WHERE user_id=actor AND award_day=(pg_catalog.statement_timestamp() AT TIME ZONE 'Europe/Istanbul')::date;
  SELECT rank INTO arena_rank FROM private.arena_rows() WHERE user_id=actor;
  IF analyses >= 1 THEN badges := badges || '["first_recognition"]'::jsonb; END IF;
  IF categories >= 3 THEN badges := badges || '["category_explorer"]'::jsonb; END IF;
  IF total >= 1000 THEN badges := badges || '["green_pioneer"]'::jsonb; END IF;
  RETURN pg_catalog.jsonb_build_object('version',1,'nickname',profile.nickname,
    'arenaOptIn',COALESCE(profile.arena_opt_in,false),'totalXp',total,'rank',arena_rank,
    'badges',badges,'awardedAnalyses',analyses,'dailySlotsUsed',slots) || private.level_info(total);
END;
$$;

CREATE FUNCTION private.save_profile(p_nickname text,p_arena_opt_in boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := private.require_game_user(); normalized text := NULLIF(pg_catalog.btrim(pg_catalog.normalize(p_nickname,'NFC')),'');
BEGIN
  IF p_arena_opt_in IS NULL OR (p_arena_opt_in AND normalized IS NULL) OR
    (normalized IS NOT NULL AND normalized !~ '^[A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü0-9_]{2,23}$') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_PROFILE';
  END IF;
  BEGIN
    INSERT INTO public.profiles(user_id,nickname,arena_opt_in) VALUES(actor,normalized,p_arena_opt_in)
      ON CONFLICT(user_id) DO UPDATE SET nickname=EXCLUDED.nickname,arena_opt_in=EXCLUDED.arena_opt_in,updated_at=pg_catalog.clock_timestamp();
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='NICKNAME_TAKEN';
  END;
  RETURN private.my_profile();
END;
$$;

CREATE FUNCTION private.eco_arena(p_offset integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := private.require_game_user(); output jsonb;
BEGIN
  IF p_offset IS NULL OR p_offset < 0 OR p_offset % 20 <> 0 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_OFFSET';
  END IF;
  WITH ranked AS MATERIALIZED (SELECT * FROM private.arena_rows()),
  entries AS (SELECT r.rank,pg_catalog.jsonb_build_object('rank',r.rank,'nickname',r.nickname,
    'totalXp',r.total_xp,'level',(l.info->>'level')::integer,'levelTitle',l.info->>'levelTitle','isMe',r.user_id=actor) AS item
    FROM ranked r CROSS JOIN LATERAL (SELECT private.level_info(r.total_xp) AS info) l),
  page AS (SELECT * FROM entries WHERE rank>p_offset::bigint AND rank<=p_offset::bigint+20)
  SELECT pg_catalog.jsonb_build_object('version',1,
    'podium',COALESCE((SELECT pg_catalog.jsonb_agg(item ORDER BY rank) FROM entries WHERE rank<=3),'[]'::jsonb),
    'entries',COALESCE((SELECT pg_catalog.jsonb_agg(item ORDER BY rank) FROM page),'[]'::jsonb),
    'myRank',(SELECT rank FROM ranked WHERE user_id=actor),'offset',p_offset,
    'nextOffset',CASE WHEN (SELECT pg_catalog.count(*) FROM ranked)>p_offset::bigint+20 THEN p_offset+20 ELSE NULL END,
    'totalParticipants',(SELECT pg_catalog.count(*) FROM ranked),
    'fetchedAt',pg_catalog.to_char(pg_catalog.statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) INTO output;
  RETURN output;
END;
$$;

CREATE FUNCTION public.get_my_profile() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ SELECT private.my_profile(); $$;
CREATE FUNCTION public.save_my_profile(p_nickname text,p_arena_opt_in boolean) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$ SELECT private.save_profile(p_nickname,p_arena_opt_in); $$;
CREATE FUNCTION public.get_eco_arena(p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ SELECT private.eco_arena(p_offset); $$;

-- New functions default to PUBLIC EXECUTE unless explicitly revoked in this transaction.
REVOKE ALL ON FUNCTION private.nickname_key(text),private.require_game_user(),private.xp_for_category(text),
  private.level_info(bigint),private.award_analysis(uuid),private.award_inserted_analysis(),private.arena_rows(),
  private.my_profile(),private.save_profile(text,boolean),private.eco_arena(integer),
  public.get_my_profile(),public.save_my_profile(text,boolean),public.get_eco_arena(integer)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.my_profile(),private.save_profile(text,boolean),private.eco_arena(integer),
  public.get_my_profile(),public.save_my_profile(text,boolean),public.get_eco_arena(integer) TO authenticated;
COMMIT;
