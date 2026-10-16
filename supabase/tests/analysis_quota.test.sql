\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'akilli_atik_step2_test' OR inet_server_addr() IS NOT NULL
    OR current_setting('akilli_atik.test_database', true) IS DISTINCT FROM 'true'
    OR EXISTS (SELECT 1 FROM auth.users) THEN RAISE EXCEPTION 'Isolated empty DB required'; END IF;
END $$;
CREATE FUNCTION pg_temp.quota_check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
  RAISE NOTICE 'PASS: quota %',label;
END $$;
INSERT INTO auth.users(id) VALUES ('aa000000-0000-4000-8000-000000000001'),('aa000000-0000-4000-8000-000000000002');
SELECT pg_temp.quota_check((SELECT relrowsecurity FROM pg_class WHERE oid='private.analysis_requests'::regclass),'RLS enabled');
-- Existing gamification helpers need schema USAGE; table/RPC ACLs enforce isolation.
SELECT pg_temp.quota_check(NOT has_table_privilege('anon','private.analysis_requests','INSERT,UPDATE,DELETE,SELECT'),'anon has no quota table privilege');
SELECT pg_temp.quota_check(NOT has_table_privilege('authenticated','private.analysis_requests','INSERT,UPDATE,DELETE,SELECT'),'client has no quota table privilege');
SELECT pg_temp.quota_check(NOT has_table_privilege('service_role','private.analysis_requests','INSERT,UPDATE,DELETE,SELECT'),'service role uses narrow RPC only');
SELECT pg_temp.quota_check(NOT has_function_privilege('anon','public.reserve_analysis_request(uuid,uuid,text)','EXECUTE'),'anon cannot reserve');
SELECT pg_temp.quota_check(NOT has_function_privilege('authenticated','public.reserve_analysis_request(uuid,uuid,text)','EXECUTE'),'user cannot choose quota identity');
SELECT pg_temp.quota_check(NOT has_function_privilege('authenticated','public.finish_analysis_request(uuid,uuid,uuid)','EXECUTE'),'user cannot release lease');
SELECT pg_temp.quota_check(has_function_privilege('service_role','public.reserve_analysis_request(uuid,uuid,text)','EXECUTE'),'server RPC allowed');
SELECT pg_temp.quota_check((SELECT bool_and(prosecdef AND proconfig=ARRAY['search_path=""']) FROM pg_proc WHERE oid IN
  ('public.reserve_analysis_request(uuid,uuid,text)'::regprocedure,'public.finish_analysis_request(uuid,uuid,uuid)'::regprocedure)),'definer search path locked');
SET LOCAL ROLE service_role;
SELECT pg_temp.quota_check(public.reserve_analysis_request('aa000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000001',repeat('a',64))->>'status'='admitted','first admitted');
SELECT pg_temp.quota_check(public.reserve_analysis_request('aa000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000001',repeat('a',64))->>'status'='duplicate','same request never re-admitted');
SELECT pg_temp.quota_check(public.reserve_analysis_request('aa000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000001',repeat('b',64))->>'status'='conflict','same ID different photo rejected');
SELECT pg_temp.quota_check(public.reserve_analysis_request('aa000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000002',repeat('a',64))->>'status'='limited','concurrent user lease blocked');
SELECT pg_temp.quota_check(NOT public.finish_analysis_request('aa000000-0000-4000-8000-000000000002','bb000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000001'),'wrong owner cannot release');
RESET ROLE;
SELECT pg_temp.quota_check(public.finish_analysis_request(user_id,client_request_id,lease_id),'correct lease finished') FROM private.analysis_requests;
SET LOCAL ROLE service_role;
SELECT pg_temp.quota_check(public.reserve_analysis_request('aa000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000001',repeat('a',64))->>'status'='duplicate','finish does not reopen request');
SELECT pg_temp.quota_check(public.reserve_analysis_request('aa000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000002',repeat('a',64))->>'status'='limited','finish does not refund minute budget');
RESET ROLE;
UPDATE private.analysis_requests SET admitted_at=clock_timestamp()-interval '2 minutes',lease_until=clock_timestamp()-interval '1 minute',finished_at=NULL;
SET LOCAL ROLE service_role;
SELECT pg_temp.quota_check(public.reserve_analysis_request('aa000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000001',repeat('a',64))->>'status'='duplicate','crashed expired request never retried');
SELECT pg_temp.quota_check(public.reserve_analysis_request('aa000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000002',repeat('a',64))->>'status'='admitted','expired lease allows new identity');
RESET ROLE;
DELETE FROM private.analysis_requests;
-- Controlled history fixtures; no provider calls. Hour and day bounds are independent.
INSERT INTO private.analysis_requests(user_id,client_request_id,image_digest,admitted_at,lease_until,finished_at)
SELECT 'aa000000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('a',64),
 clock_timestamp()-n*interval '3 minutes',clock_timestamp()-n*interval '3 minutes'+interval '1 minute',clock_timestamp()
 FROM generate_series(1,3)n;
SELECT pg_temp.quota_check(public.reserve_analysis_request('aa000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000003',repeat('a',64))->>'status'='limited','rolling hour user limit');
DELETE FROM private.analysis_requests;
INSERT INTO private.analysis_requests(user_id,client_request_id,image_digest,admitted_at,lease_until,finished_at)
SELECT 'aa000000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('a',64),
 clock_timestamp()-n*interval '2 hours',clock_timestamp()-n*interval '2 hours'+interval '1 minute',clock_timestamp()
 FROM generate_series(1,5)n;
SELECT pg_temp.quota_check(public.reserve_analysis_request('aa000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000003',repeat('a',64))->>'status'='limited','rolling 24h limit independent of XP');
DELETE FROM private.analysis_requests;
INSERT INTO private.analysis_requests(user_id,client_request_id,image_digest,admitted_at,lease_until,finished_at)
SELECT 'aa000000-0000-4000-8000-000000000002',gen_random_uuid(),repeat('a',64),
 clock_timestamp()-interval '10 minutes',clock_timestamp()-interval '9 minutes',clock_timestamp()
 FROM generate_series(1,30);
SELECT pg_temp.quota_check(public.reserve_analysis_request('aa000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000003',repeat('a',64))->>'status'='limited','global hourly budget');
UPDATE private.analysis_requests SET admitted_at=clock_timestamp()-interval '3 hours',lease_until=clock_timestamp()-interval '3 hours'+interval '1 minute';
INSERT INTO private.analysis_requests(user_id,client_request_id,image_digest,admitted_at,lease_until,finished_at)
SELECT 'aa000000-0000-4000-8000-000000000002',gen_random_uuid(),repeat('a',64),
 clock_timestamp()-interval '3 hours',clock_timestamp()-interval '3 hours'+interval '1 minute',clock_timestamp()
 FROM generate_series(1,70);
SELECT pg_temp.quota_check(public.reserve_analysis_request('aa000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000003',repeat('a',64))->>'status'='limited','global rolling daily budget');
ROLLBACK;
