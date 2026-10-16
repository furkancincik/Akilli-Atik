\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database()<>'akilli_atik_step2_test' OR inet_server_addr() IS NOT NULL
    OR current_setting('akilli_atik.test_database',true) IS DISTINCT FROM 'true'
    OR EXISTS(SELECT 1 FROM auth.users) THEN RAISE EXCEPTION 'BLOCKED: isolated empty database required'; END IF;
END $$;
SELECT set_config('akilli_atik.game_assertions','0',true);
CREATE FUNCTION pg_temp.assert_game(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
  PERFORM set_config('akilli_atik.game_assertions',(current_setting('akilli_atik.game_assertions')::int+1)::text,true);
  RAISE NOTICE 'PASS: %',label;
END $$;
CREATE FUNCTION pg_temp.expect_game(statement text,expected text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text; BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual=RETURNED_SQLSTATE;
    IF actual<>expected THEN RAISE EXCEPTION 'FAIL: % expected %, got %',label,expected,actual; END IF;
    PERFORM pg_temp.assert_game(true,label); RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % did not raise',label;
END $$;
CREATE FUNCTION pg_temp.game_id(n integer) RETURNS uuid LANGUAGE sql AS $$
  SELECT ('90000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
CREATE FUNCTION pg_temp.add_game(n integer,actor uuid,cat text,at_time timestamptz,
  unsure boolean DEFAULT false,objects text DEFAULT 'single',request_id uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.waste_analyses(id,user_id,client_request_id,created_at,waste_name,category,
    description,sorting_instruction,recycling_advice,object_count,uncertain,hazardous,model)
  VALUES(pg_temp.game_id(n),actor,COALESCE(request_id,pg_temp.game_id(n+100000)),at_time,
    'Synthetic object',cat,'Synthetic SQL test','Separate collection','Check local rules',objects,unsure,false,'gemini-test');
$$;
INSERT INTO auth.users(id,email) SELECT pg_temp.game_id(n),'game-'||n||'@example.invalid' FROM generate_series(1,5)n;

SELECT pg_temp.assert_game((SELECT relrowsecurity FROM pg_class WHERE oid='public.profiles'::regclass),'Profiles RLS enabled');
SELECT pg_temp.assert_game((SELECT relrowsecurity FROM pg_class WHERE oid='private.xp_awards'::regclass),'Ledger RLS enabled');
DO $$ DECLARE role_name text; privilege text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      PERFORM pg_temp.assert_game(NOT has_table_privilege(role_name,'private.xp_awards',privilege),role_name||' no ledger '||privilege);
    END LOOP;
  END LOOP;
END $$;
SELECT pg_temp.assert_game(has_table_privilege('authenticated','public.profiles','SELECT') AND
  NOT has_table_privilege('authenticated','public.profiles','INSERT') AND
  NOT has_table_privilege('authenticated','public.profiles','UPDATE'),'Profiles client own-read only');
SELECT pg_temp.assert_game(NOT has_function_privilege('anon','public.get_my_profile()','EXECUTE'),'Anon RPC execute denied');
SELECT pg_temp.assert_game(NOT has_function_privilege('authenticated','private.award_analysis(uuid)','EXECUTE'),'Client award execute denied');
SELECT pg_temp.assert_game(NOT has_function_privilege('service_role','private.award_analysis(uuid)','EXECUTE'),'Service role cannot call award function directly');
SELECT pg_temp.assert_game((SELECT bool_and(n.nspname='private' AND p.proconfig @> ARRAY['search_path=""'])
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prosecdef AND n.nspname='private'),'All definers are private with fixed empty search_path');
SELECT pg_temp.assert_game((SELECT bool_and(NOT p.prosecdef) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN('get_my_profile','save_my_profile','get_eco_arena')),'Public API wrappers are invokers');

-- A read of a genuine absent profile is known zero and performs no INSERT.
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.game_id(2),'role','authenticated','is_anonymous',false)::text,true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_game(public.get_my_profile()->>'totalXp'='0' AND public.get_my_profile()->>'level'='1'
  AND public.get_my_profile()->'nickname'='null'::jsonb AND public.get_my_profile()->>'arenaOptIn'='false','Absent own profile returns verified defaults');
RESET ROLE;
SELECT pg_temp.assert_game(NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=pg_temp.game_id(2)),'Profile read did not create profile');

DO $$ DECLARE cat text; amount int; index int:=10; BEGIN
  FOR cat,amount IN SELECT * FROM (VALUES('Organik',50),('Kâğıt/Karton',75),('Cam',100),('Metal',150),
      ('Plastik',200),('Pil',250),('Elektronik',300),('Diğer',0))v(c,x) LOOP
    PERFORM pg_temp.add_game(index,pg_temp.game_id(1),cat,'2026-01-01'::timestamptz+(index||' days')::interval);
    PERFORM pg_temp.assert_game(COALESCE((SELECT xp FROM private.xp_awards WHERE source_analysis_id=pg_temp.game_id(index)),0)=amount,'Category XP '||cat);
    index:=index+1;
  END LOOP;
END $$;
SELECT pg_temp.assert_game((SELECT sum(xp)=1125 FROM private.xp_awards WHERE user_id=pg_temp.game_id(1)),'Category sum is 1125');
SELECT pg_temp.add_game(20,pg_temp.game_id(1),'Plastik','2026-02-01',true);
SELECT pg_temp.add_game(21,pg_temp.game_id(1),'Plastik','2026-02-01',false,'multiple');
SELECT pg_temp.assert_game(NOT EXISTS(SELECT 1 FROM private.xp_awards WHERE source_analysis_id IN(pg_temp.game_id(20),pg_temp.game_id(21))),'Uncertain and multiple analyses do not earn or consume slots');
SELECT pg_temp.expect_game($q$SELECT pg_temp.add_game(22,pg_temp.game_id(1),'Invalid','2026-02-01')$q$,'23514','Invalid category cannot store analysis or earn XP');
INSERT INTO public.profiles(user_id) VALUES(pg_temp.game_id(2));
SELECT pg_temp.expect_game($q$INSERT INTO private.xp_awards(user_id,analysis_id,source_analysis_id,client_request_id,award_day,daily_slot,xp)
  VALUES(pg_temp.game_id(2),pg_temp.game_id(20),pg_temp.game_id(20),pg_temp.game_id(100020),'2099-01-01',1,200)$q$,
  '23503','Composite FK rejects a different analysis owner');
SELECT pg_temp.expect_game($q$INSERT INTO private.xp_awards(user_id,analysis_id,source_analysis_id,client_request_id,award_day,daily_slot,xp)
  VALUES(pg_temp.game_id(1),pg_temp.game_id(20),pg_temp.game_id(20),pg_temp.game_id(199999),'2099-01-01',1,200)$q$,
  '23503','Composite FK rejects a different request identity');
SELECT pg_temp.expect_game($q$INSERT INTO private.xp_awards(user_id,analysis_id,source_analysis_id,client_request_id,award_day,daily_slot,xp)
  VALUES(pg_temp.game_id(1),pg_temp.game_id(20),pg_temp.game_id(21),pg_temp.game_id(100020),'2099-01-01',1,200)$q$,
  '23514','Source identity cannot differ from active analysis');
SELECT pg_temp.expect_game($q$INSERT INTO private.xp_awards(user_id,analysis_id,source_analysis_id,client_request_id,award_day,daily_slot,xp)
  VALUES(pg_temp.game_id(1),pg_temp.game_id(20),pg_temp.game_id(20),pg_temp.game_id(100020),'2099-01-01',1,1000)$q$,
  '23514','Ledger rejects an unsupported XP amount');

DO $$ DECLARE threshold bigint; expected int; i int:=0; BEGIN
  FOREACH threshold IN ARRAY ARRAY[0,100,250,500,1000,1750,2750,4000]::bigint[] LOOP
    i:=i+1;
    PERFORM pg_temp.assert_game((private.level_info(threshold)->>'level')::int=i,'Level exact threshold '||threshold);
    IF threshold>0 THEN PERFORM pg_temp.assert_game((private.level_info(threshold-1)->>'level')::int=i-1,'Level below threshold '||threshold); END IF;
    PERFORM pg_temp.assert_game((private.level_info(threshold+1)->>'level')::int=i,'Level above threshold '||threshold);
  END LOOP;
END $$;
SELECT pg_temp.assert_game(private.level_info(200)->>'remainingXp'='50' AND private.level_info(200)->>'progress'='66.67','XP 200 progress and remaining are correct');
SELECT pg_temp.assert_game(private.level_info(5000)->'nextLevelXp'='null'::jsonb AND private.level_info(5000)->>'remainingXp'='0'
  AND private.level_info(5000)->>'progress'='100','Max level has no division by zero');

SELECT pg_temp.add_game(30,pg_temp.game_id(2),'Cam','2026-01-04T20:59:59Z');
SELECT pg_temp.add_game(31,pg_temp.game_id(2),'Cam','2026-01-04T21:00:00Z');
SELECT pg_temp.assert_game((SELECT award_day='2026-01-04' FROM private.xp_awards WHERE source_analysis_id=pg_temp.game_id(30)),'Istanbul day before UTC 21:00');
SELECT pg_temp.assert_game((SELECT award_day='2026-01-05' FROM private.xp_awards WHERE source_analysis_id=pg_temp.game_id(31)),'Istanbul day changes at UTC 21:00');
DO $$ BEGIN FOR i IN 40..43 LOOP PERFORM pg_temp.add_game(i,pg_temp.game_id(3),'Plastik',statement_timestamp()); END LOOP; END $$;
SELECT pg_temp.assert_game((SELECT count(*)=4 FROM public.waste_analyses WHERE user_id=pg_temp.game_id(3)),'Fourth analysis remains saved');
SELECT pg_temp.assert_game((SELECT count(*)=3 AND sum(xp)=600 FROM private.xp_awards WHERE user_id=pg_temp.game_id(3)),'Only three awards per Istanbul day');
SELECT pg_temp.expect_game($q$SELECT pg_temp.add_game(44,pg_temp.game_id(3),'Cam',now(),false,'single',pg_temp.game_id(100040))$q$,'23505','Duplicate client request cannot store or earn twice');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.game_id(3),'role','authenticated','is_anonymous',false)::text,true);
SET LOCAL ROLE authenticated;
DELETE FROM public.waste_analyses WHERE id=pg_temp.game_id(40);
SELECT pg_temp.assert_game(public.get_my_profile()->>'totalXp'='400' AND public.get_my_profile()->>'dailySlotsUsed'='3','Own delete removes XP but retains daily quota');
RESET ROLE;
SELECT pg_temp.assert_game((SELECT analysis_id IS NULL AND source_analysis_id=pg_temp.game_id(40)
  FROM private.xp_awards WHERE source_analysis_id=pg_temp.game_id(40)),'Deleted analysis leaves private tombstone');
SELECT pg_temp.add_game(44,pg_temp.game_id(3),'Plastik',now(),false,'single',pg_temp.game_id(100040));
SELECT pg_temp.add_game(40,pg_temp.game_id(3),'Plastik',now(),false,'single',pg_temp.game_id(100045));
SELECT pg_temp.assert_game((SELECT count(*)=3 AND count(analysis_id)=2 FROM private.xp_awards WHERE user_id=pg_temp.game_id(3)),'Deleted source/request never reactivates or reopens quota');

SET LOCAL ROLE service_role;
SELECT pg_temp.add_game(50,pg_temp.game_id(4),'Plastik','2026-03-01');
SELECT pg_temp.expect_game('SELECT * FROM private.xp_awards','42501','Service role cannot select ledger directly');
RESET ROLE;
SELECT pg_temp.assert_game((SELECT xp=200 FROM private.xp_awards WHERE source_analysis_id=pg_temp.game_id(50)),'Existing service-role parent INSERT triggers trusted award');
ALTER TABLE private.xp_awards ADD CONSTRAINT injected_xp_failure CHECK(xp<>75) NOT VALID;
SELECT pg_temp.expect_game($q$SELECT pg_temp.add_game(51,pg_temp.game_id(4),'Kâğıt/Karton','2026-03-02')$q$,'23514','XP failure aborts parent INSERT atomically');
SELECT pg_temp.assert_game(NOT EXISTS(SELECT 1 FROM public.waste_analyses WHERE id=pg_temp.game_id(51)),'Failed XP transaction leaves no analysis');
ALTER TABLE private.xp_awards DROP CONSTRAINT injected_xp_failure;

SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.game_id(1),'role','authenticated','is_anonymous',false)::text,true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_game(public.save_my_profile('Işık',true)->>'nickname'='Işık','User can save Turkish nickname and opt in');
SELECT pg_temp.assert_game(public.get_my_profile()->'badges'='["first_recognition","category_explorer","green_pioneer"]'::jsonb,'Badges derived from active verified awards');
SELECT pg_temp.assert_game((SELECT count(*)=1 FROM public.profiles),'A sees only own profile');
SELECT pg_temp.expect_game('SELECT * FROM private.xp_awards','42501','Authenticated cannot read private ledger');
SELECT pg_temp.expect_game('INSERT INTO private.xp_awards DEFAULT VALUES','42501','Authenticated cannot insert XP');
SELECT pg_temp.expect_game('UPDATE private.xp_awards SET xp=300 WHERE false','42501','Authenticated cannot update XP');
SELECT pg_temp.expect_game('DELETE FROM private.xp_awards WHERE false','42501','Authenticated cannot delete XP or release quota');
SELECT pg_temp.expect_game('SELECT private.award_analysis(pg_temp.game_id(10))','42501','Authenticated cannot invoke award path');
SELECT pg_temp.expect_game('UPDATE public.profiles SET arena_opt_in=false','42501','Authenticated cannot directly mutate profile');
SELECT pg_temp.expect_game('DELETE FROM public.profiles','42501','Authenticated cannot delete profile');
SELECT pg_temp.expect_game($q$SELECT public.save_my_profile('<script>',false)$q$,'22023','Unsafe nickname rejected');
SELECT pg_temp.expect_game($q$SELECT public.save_my_profile(NULL,true)$q$,'22023','Opt in requires nickname');
SELECT pg_temp.expect_game($q$SELECT public.get_eco_arena(-20)$q$,'22023','Negative arena offset rejected');
SELECT pg_temp.expect_game($q$SELECT public.get_eco_arena(1)$q$,'22023','Non-page-aligned arena offset rejected');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.game_id(2),'role','authenticated','is_anonymous',false)::text,true);
SELECT pg_temp.expect_game($q$SELECT public.save_my_profile('ISIK',true)$q$,'23505','Normalized nickname collisions are rejected');
SELECT pg_temp.assert_game(public.save_my_profile(U&'C\0327evreci',true)->>'nickname'='Çevreci','NFD input normalizes to NFC');
SELECT pg_temp.assert_game((SELECT count(*)=1 AND bool_and(user_id=pg_temp.game_id(2)) FROM public.profiles),'B cannot read A profile');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.game_id(2),'role','authenticated','is_anonymous',true)::text,true);
SELECT pg_temp.expect_game('SELECT public.get_my_profile()','28000','Anonymous Auth user denied profile RPC');
SELECT pg_temp.expect_game('SELECT public.get_eco_arena(0)','28000','Anonymous Auth user denied arena RPC');
SELECT pg_temp.assert_game((SELECT count(*)=0 FROM public.profiles),'Anonymous Auth user cannot read profile table');
SELECT set_config('request.jwt.claims','{}',true);
SELECT pg_temp.expect_game('SELECT public.get_my_profile()','28000','Missing auth identity denied');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.expect_game('SELECT public.get_my_profile()','42501','Anon role cannot execute profile RPC');
RESET ROLE;

-- Historical fixtures are deliberately inserted without the new trigger.
ALTER TABLE public.waste_analyses DISABLE TRIGGER waste_analyses_award_xp;
SELECT pg_temp.add_game(60,pg_temp.game_id(5),'Plastik','2026-04-01');
ALTER TABLE public.waste_analyses ENABLE TRIGGER waste_analyses_award_xp;
SELECT pg_temp.assert_game(private.award_analysis(pg_temp.game_id(60)),'Approved local backfill grants first award');
SELECT pg_temp.assert_game(NOT private.award_analysis(pg_temp.game_id(60)),'Backfill rerun is idempotent');
SELECT pg_temp.assert_game((SELECT count(*)=1 AND max(xp)=200 AND min(award_day)='2026-04-01'
  FROM private.xp_awards WHERE user_id=pg_temp.game_id(5)),'Backfill preserves original analysis day');

UPDATE public.profiles SET arena_opt_in=false;
INSERT INTO auth.users(id,email) SELECT pg_temp.game_id(100+n),'arena-'||n||'@example.invalid' FROM generate_series(1,25)n;
INSERT INTO public.profiles(user_id,nickname,arena_opt_in)
  SELECT pg_temp.game_id(100+n),'Oyuncu'||lpad(n::text,2,'0'),true FROM generate_series(1,25)n;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.game_id(107),'role','authenticated','is_anonymous',false)::text,true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_game(jsonb_array_length(public.get_eco_arena(0)->'podium')=3 AND
  jsonb_array_length(public.get_eco_arena(0)->'entries')=20,'Arena API page one has 20 entries; UI removes podium duplicates');
SELECT pg_temp.assert_game(public.get_eco_arena(0)->>'totalParticipants'='25' AND
  public.get_eco_arena(0)->>'nextOffset'='20','Arena participant count and next page');
SELECT pg_temp.assert_game(public.get_eco_arena(0)->>'myRank'='7','Tie ordering is deterministic normalized nickname order');
SELECT pg_temp.assert_game(jsonb_array_length(public.get_eco_arena(20)->'entries')=5 AND
  public.get_eco_arena(20)->'entries'->0->>'rank'='21' AND public.get_eco_arena(20)->'nextOffset'='null'::jsonb,'Second arena page starts at rank 21');
SELECT pg_temp.assert_game((SELECT count(*)=6 FROM jsonb_object_keys(public.get_eco_arena(0)->'podium'->0)), 'Arena entries have exactly six public fields');
SELECT pg_temp.assert_game(public.get_eco_arena(0)::text NOT LIKE '%'||pg_temp.game_id(107)::text||'%'
  AND public.get_eco_arena(0)::text NOT LIKE '%@example.invalid%','Arena response contains no Auth UUID or email');
SELECT pg_temp.assert_game(public.save_my_profile('Oyuncu07',false)->>'arenaOptIn'='false','User can opt out explicitly');
SELECT pg_temp.assert_game(public.get_my_profile()->'rank'='null'::jsonb AND public.get_eco_arena(0)->>'totalParticipants'='24','Opt out immediately removes public rank');
RESET ROLE;
DELETE FROM auth.users WHERE id=pg_temp.game_id(5);
SELECT pg_temp.assert_game(NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=pg_temp.game_id(5)) AND
  NOT EXISTS(SELECT 1 FROM private.xp_awards WHERE user_id=pg_temp.game_id(5)),'Account cascade removes profile and all ledger tombstones');

-- Synthetic cross-layer samples, safe to feed to the TypeScript DTO decoders.
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.game_id(1),'role','authenticated','is_anonymous',false)::text,true);
SET LOCAL ROLE authenticated;
\pset format unaligned
\t on
SELECT 'GAME_PROFILE_JSON='||public.get_my_profile()::text;
SELECT 'GAME_ARENA_JSON='||public.get_eco_arena(0)::text;
RESET ROLE;

SELECT 'GAMIFICATION_ASSERTIONS='||current_setting('akilli_atik.game_assertions') AS result;
ROLLBACK;
