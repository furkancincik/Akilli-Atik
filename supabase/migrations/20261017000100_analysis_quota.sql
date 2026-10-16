-- Local preparation. Apply only after explicit production approval.
-- Admission attempts (including provider errors) consume budget; no automatic retry.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE private.analysis_requests (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_request_id uuid NOT NULL,
  image_digest text NOT NULL CHECK (image_digest ~ '^[a-f0-9]{64}$'),
  lease_id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  admitted_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  lease_until timestamptz NOT NULL,
  finished_at timestamptz,
  PRIMARY KEY (user_id, client_request_id),
  CHECK (lease_until > admitted_at AND lease_until <= admitted_at + interval '2 minutes'),
  CHECK (finished_at IS NULL OR finished_at >= admitted_at)
);
CREATE INDEX analysis_requests_time_idx ON private.analysis_requests (admitted_at);
CREATE INDEX analysis_requests_user_time_idx ON private.analysis_requests (user_id, admitted_at);
CREATE INDEX analysis_requests_active_idx ON private.analysis_requests (lease_until) WHERE finished_at IS NULL;
ALTER TABLE private.analysis_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.analysis_requests FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE private.analysis_requests IS
  'Private cost admission ledger; no photos, provider output, credentials or client-chosen quota. Digest binds request identity to image. Failed/expired attempts remain charged.';

CREATE FUNCTION public.reserve_analysis_request(p_user_id uuid, p_request_id uuid, p_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  stamp timestamptz;
  old private.analysis_requests%ROWTYPE;
  lease uuid;
BEGIN
  IF p_user_id IS NULL OR p_request_id IS NULL OR p_digest IS NULL
    OR p_digest !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_ADMISSION';
  END IF;
  -- All isolates serialize the short count-and-reserve transaction, not Gemini.
  PERFORM pg_catalog.pg_advisory_xact_lock(17012026, 43001);
  stamp := pg_catalog.clock_timestamp();
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'AUTH_REQUIRED';
  END IF;
  SELECT * INTO old FROM private.analysis_requests
    WHERE user_id = p_user_id AND client_request_id = p_request_id;
  IF FOUND THEN
    IF old.image_digest <> p_digest THEN
      RETURN pg_catalog.jsonb_build_object('status','conflict');
    END IF;
    -- Never re-admit even after crash, timeout, failed save or record deletion.
    RETURN pg_catalog.jsonb_build_object('status','duplicate');
  END IF;
  IF EXISTS (SELECT 1 FROM private.analysis_requests WHERE user_id = p_user_id
       AND finished_at IS NULL AND lease_until > stamp)
    OR (SELECT count(*) FROM private.analysis_requests WHERE finished_at IS NULL AND lease_until > stamp) >= 2
    OR EXISTS (SELECT 1 FROM private.analysis_requests WHERE user_id = p_user_id AND admitted_at > stamp - interval '1 minute')
    OR (SELECT count(*) FROM private.analysis_requests WHERE user_id = p_user_id AND admitted_at > stamp - interval '1 hour') >= 3
    OR (SELECT count(*) FROM private.analysis_requests WHERE user_id = p_user_id AND admitted_at > stamp - interval '24 hours') >= 5
    OR (SELECT count(*) FROM private.analysis_requests WHERE admitted_at > stamp - interval '1 hour') >= 30
    OR (SELECT count(*) FROM private.analysis_requests WHERE admitted_at > stamp - interval '24 hours') >= 100 THEN
    RETURN pg_catalog.jsonb_build_object('status','limited');
  END IF;
  INSERT INTO private.analysis_requests(user_id, client_request_id, image_digest, admitted_at, lease_until)
    VALUES (p_user_id, p_request_id, p_digest, stamp, stamp + interval '2 minutes')
    RETURNING lease_id INTO lease;
  RETURN pg_catalog.jsonb_build_object('status','admitted','leaseId',lease);
END;
$$;

CREATE FUNCTION public.finish_analysis_request(p_user_id uuid, p_request_id uuid, p_lease_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE private.analysis_requests SET finished_at = pg_catalog.clock_timestamp()
    WHERE user_id = p_user_id AND client_request_id = p_request_id
      AND lease_id = p_lease_id AND finished_at IS NULL;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_analysis_request(uuid,uuid,text),
  public.finish_analysis_request(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_analysis_request(uuid,uuid,text),
  public.finish_analysis_request(uuid,uuid,uuid) TO service_role;
COMMIT;
