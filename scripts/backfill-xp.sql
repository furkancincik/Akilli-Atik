-- STEP 2B LOCAL TOOL ONLY. Default is read-only dry-run + ROLLBACK.
-- This file refuses every remote/live database, even when apply is requested.
-- A future live backfill requires a separately reviewed STEP 2C tool and consent.
-- Local apply: psql ... -v apply_xp_backfill=true -v expected_manifest=<dry-run hash> -f scripts/backfill-xp.sql
\set ON_ERROR_STOP on
\if :{?apply_xp_backfill}
\else
  \set apply_xp_backfill false
\endif
BEGIN;
\if :apply_xp_backfill
\else
  SET TRANSACTION READ ONLY;
\endif
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
DO $$ BEGIN
  IF current_database()<>'akilli_atik_step2_test' OR inet_server_addr() IS NOT NULL OR
    current_setting('akilli_atik.test_database',true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'BLOCKED: This STEP 2B tool permits only the disposable local test database';
  END IF;
END $$;
\if :apply_xp_backfill
  \if :{?expected_manifest}
    SELECT set_config('akilli_atik.expected_xp_manifest', :'expected_manifest', true);
  \else
    DO $$ BEGIN RAISE EXCEPTION 'BLOCKED: expected_manifest must be explicitly supplied'; END $$;
  \endif
  -- Lock before rechecking consent's candidate manifest. Do not broaden consent.
  LOCK TABLE public.waste_analyses IN SHARE ROW EXCLUSIVE MODE;
\endif

WITH eligible AS (
  SELECT a.id,a.user_id,a.client_request_id,a.created_at,(a.created_at AT TIME ZONE 'Europe/Istanbul')::date AS day_key,
    private.xp_for_category(a.category) AS amount,
    row_number() OVER(PARTITION BY a.user_id,(a.created_at AT TIME ZONE 'Europe/Istanbul')::date ORDER BY a.created_at,a.id) AS ordinal,
    (SELECT count(*) FROM private.xp_awards x WHERE x.user_id=a.user_id AND
      x.award_day=(a.created_at AT TIME ZONE 'Europe/Istanbul')::date) AS occupied
  FROM public.waste_analyses a
  WHERE NOT a.uncertain AND a.object_count='single' AND a.schema_version=1 AND private.xp_for_category(a.category)>0
    AND NOT EXISTS(SELECT 1 FROM private.xp_awards x WHERE x.source_analysis_id=a.id OR
      (x.user_id=a.user_id AND x.client_request_id=a.client_request_id))
), candidates AS (SELECT * FROM eligible WHERE ordinal<=3-occupied)
SELECT count(*) AS candidate_count,COALESCE(sum(amount),0) AS proposed_xp,
  md5(COALESCE(string_agg(id::text||'|'||user_id::text||'|'||client_request_id::text||'|'||created_at::text||'|'||day_key::text||'|'||amount::text,',' ORDER BY created_at,id),'')) AS manifest
FROM candidates
\gset xp_
\echo candidate_count=:xp_candidate_count proposed_xp=:xp_proposed_xp manifest=:xp_manifest

\if :apply_xp_backfill
  SELECT set_config('akilli_atik.actual_xp_manifest', :'xp_manifest', true);
  DO $$ BEGIN
    IF current_setting('akilli_atik.expected_xp_manifest',true) IS DISTINCT FROM current_setting('akilli_atik.actual_xp_manifest',true)
      THEN RAISE EXCEPTION 'BLOCKED: approved candidates changed; no award was created'; END IF;
  END $$;
  -- Same stable ordering as dry-run. Already-awarded and quota-full rows return false.
  SELECT private.award_analysis(a.id) FROM public.waste_analyses a
    WHERE NOT a.uncertain AND a.object_count='single' AND a.schema_version=1 AND private.xp_for_category(a.category)>0
    ORDER BY a.created_at,a.id;
  COMMIT;
\else
  ROLLBACK;
\endif
