-- SADECE scripts/test-database.mjs tarafından oluşturulan ağsız geçici konteyner.
-- Supabase platformunun testte gereken minimum auth sözleşmesi; gerçek Auth servisi değildir.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claim.sub', true), ''),
        NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    )::uuid;
$$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
      jsonb_build_object('sub',NULLIF(current_setting('request.jwt.claim.sub', true),''),'role','authenticated','is_anonymous',false));
$$;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role;
ALTER DATABASE akilli_atik_step2_test SET akilli_atik.test_database = 'true';
