\set ON_ERROR_STOP on

-- Yalnız yerel, ayrılmış test veritabanında çalıştırılır. Canlıya göndermeyin.
-- Ön koşul: migration uygulanmış olmalı ve test runner oturumunda
-- SET akilli_atik.test_database = 'true' açıkça ayarlanmalıdır.
-- pgTAP gerektirmez. Tüm sentetik kullanıcılar ve test değişiklikleri ROLLBACK olur.
BEGIN;

DO $guard$
BEGIN
  IF current_setting('akilli_atik.test_database', true) IS DISTINCT FROM 'true'
     OR current_database() <> 'akilli_atik_step2_test'
     OR inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCKED: Bu dosya yalnız açıkça işaretlenmiş yerel test veritabanında çalıştırılabilir.';
  END IF;
  IF to_regclass('public.waste_analyses') IS NULL THEN
    RAISE EXCEPTION 'BLOCKED: waste_analyses migration önce yerel test veritabanına uygulanmalı.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE id IN ('aaaaaaaa-0000-4000-8000-000000000001'::uuid,
                 'bbbbbbbb-0000-4000-8000-000000000002'::uuid)
  ) THEN
    RAISE EXCEPTION 'BLOCKED: Sentetik test kullanıcı kimlikleri zaten mevcut; veri değiştirilmedi.';
  END IF;
END;
$guard$;

SELECT set_config('akilli_atik.assertion_count', '0', true);

-- SECURITY INVOKER: denenen sorgular aktif istemci rolünün gerçek yetkileriyle çalışır.
CREATE FUNCTION pg_temp.assert_true(condition boolean, label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $function$
BEGIN
  IF condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: %', label;
  END IF;
  PERFORM set_config('akilli_atik.assertion_count',
    (current_setting('akilli_atik.assertion_count')::integer + 1)::text, true);
  RAISE NOTICE 'PASS: %', label;
END;
$function$;

CREATE FUNCTION pg_temp.expect_sqlstate(statement text, expected_state text, label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $function$
DECLARE actual_state text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE;
    IF actual_state <> expected_state THEN
      RAISE EXCEPTION 'FAIL: %; beklenen SQLSTATE %, alınan %',
        label, expected_state, actual_state;
    END IF;
    PERFORM pg_temp.assert_true(true, label);
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: %; beklenen SQLSTATE %, sorgu beklenmedik biçimde başarılı',
    label, expected_state;
END;
$function$;

SELECT pg_temp.assert_true(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.waste_analyses'::regclass),
  'RLS etkin');
SELECT pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.waste_analyses', 'SELECT')
  AND has_table_privilege('authenticated', 'public.waste_analyses', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.waste_analyses', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.waste_analyses', 'UPDATE'),
  'authenticated yalnız SELECT ve DELETE yetkilerine sahip');
SELECT pg_temp.assert_true(
  NOT has_table_privilege('anon', 'public.waste_analyses', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.waste_analyses', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.waste_analyses', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.waste_analyses', 'DELETE'),
  'anon tablo erişim yetkilerine sahip değil');
SELECT pg_temp.assert_true(
  has_table_privilege('service_role', 'public.waste_analyses', 'INSERT')
  AND has_table_privilege('service_role', 'public.waste_analyses', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.waste_analyses', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.waste_analyses', 'DELETE'),
  'service_role yalnız güvenilir INSERT ve SELECT yetkilerine sahip');
SELECT pg_temp.assert_true(
  (SELECT count(*) = 15 FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'waste_analyses'),
  'Şema yalnız beklenen 15 alanı içeriyor; fotoğraf/token/ham yanıt alanı yok');

INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'akilli-atik-a@example.invalid'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'akilli-atik-b@example.invalid');

-- Aynı istek kimliği farklı kullanıcılar için geçerlidir.
INSERT INTO public.waste_analyses (
  id, user_id, client_request_id, waste_name, category, description,
  sorting_instruction, recycling_advice, object_count, uncertain, hazardous, model
) VALUES
  ('11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   '99999999-0000-4000-8000-000000000001', 'Plastik şişe', 'Plastik',
   'Sentetik yerel test kaydı.', 'Ayrı toplama kutusuna bırak.',
   'Yerel toplama kurallarını kontrol et.', 'single', false, false, 'test-model'),
  ('22222222-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002',
   '99999999-0000-4000-8000-000000000001', 'Cam şişe', 'Cam',
   'Sentetik yerel test kaydı.', 'Cam toplama kutusuna bırak.',
   'Yerel toplama kurallarını kontrol et.', 'multiple', true, false, 'test-model');

SELECT pg_temp.assert_true(
  (SELECT count(*) = 2 FROM public.waste_analyses
   WHERE client_request_id = '99999999-0000-4000-8000-000000000001'),
  'Aynı client_request_id farklı kullanıcılar için kabul edilir');
SELECT pg_temp.assert_true(
  (SELECT bool_and(created_at IS NOT NULL AND schema_version = 1)
   FROM public.waste_analyses),
  'created_at ve schema_version=1 varsayılanları uygulanır');

-- A rolü ve JWT kimliği: tablo sahibi/BYPASSRLS rolü kullanılmaz.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT pg_temp.assert_true(current_user = 'authenticated', 'A testleri authenticated rolünde');
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.waste_analyses
   WHERE id = '11111111-0000-4000-8000-000000000001'),
  'Kullanıcı A kendi kaydını ID ile okuyabilir');
SELECT pg_temp.assert_true(
  (SELECT count(*) = 0 FROM public.waste_analyses
   WHERE id = '22222222-0000-4000-8000-000000000002'),
  'Kullanıcı A B kaydını ID ile okuyamaz');
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.waste_analyses),
  'A listeleme sorgusu yalnız kendi kaydını döndürür');
WITH removed AS (
  DELETE FROM public.waste_analyses
  WHERE id = '22222222-0000-4000-8000-000000000002' RETURNING id
)
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM removed), 'A B kaydını silemez');
SELECT pg_temp.expect_sqlstate($sql$
  INSERT INTO public.waste_analyses (
    user_id, client_request_id, waste_name, category, description,
    sorting_instruction, recycling_advice, object_count, uncertain, hazardous, model
  ) VALUES (
    'aaaaaaaa-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000003',
    'Şişe', 'Plastik', 'Geçerli veri.', 'Ayrı topla.', 'Toplama noktasına ver.',
    'single', false, false, 'test-model'
  )
$sql$, '42501', 'authenticated doğrudan geçerli INSERT yapamaz');
SELECT pg_temp.expect_sqlstate($sql$
  UPDATE public.waste_analyses SET waste_name = 'Değişiklik'
  WHERE id = '11111111-0000-4000-8000-000000000001'
$sql$, '42501', 'authenticated kendi kaydında UPDATE yapamaz');
RESET ROLE;
SELECT pg_temp.assert_true(
  EXISTS (SELECT 1 FROM public.waste_analyses
          WHERE id = '22222222-0000-4000-8000-000000000002'),
  'A silme girişiminden sonra B kaydı gerçekten korunur');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.waste_analyses
   WHERE id = '22222222-0000-4000-8000-000000000002'),
  'Kullanıcı B kendi kaydını okuyabilir');
SELECT pg_temp.assert_true(
  (SELECT count(*) = 0 FROM public.waste_analyses
   WHERE id = '11111111-0000-4000-8000-000000000001'),
  'Kullanıcı B A kaydını ID ile okuyamaz');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT pg_temp.expect_sqlstate('SELECT * FROM public.waste_analyses', '42501',
  'Anonim kullanıcı kayıt okuyamaz');
SELECT pg_temp.expect_sqlstate('DELETE FROM public.waste_analyses', '42501',
  'Anonim kullanıcı kayıt silemez');
RESET ROLE;

-- authenticated rolü tek başına yetmez: JWT kullanıcı kimliği olmayan oturum erişemez.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.waste_analyses),
  'Kullanıcı kimliği olmayan authenticated oturumu kayıt okuyamaz');
WITH removed AS (DELETE FROM public.waste_analyses RETURNING id)
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM removed),
  'Kullanıcı kimliği olmayan authenticated oturumu kayıt silemez');
RESET ROLE;

-- Doğrulama kuralları ayrıcalıklı fixture rolüyle denenir; yetki hatası gerçek
-- CHECK/UNIQUE/varchar hatasını maskelememelidir. Reddedilen her sorgu alt işlemde geri alınır.
DO $constraints$
DECLARE
  baseline jsonb;
  candidate jsonb;
  item record;
  field_name text;
  allowed_category text;
BEGIN
  SELECT to_jsonb(w) INTO baseline FROM public.waste_analyses AS w
  WHERE id = '11111111-0000-4000-8000-000000000001';

  FOR item IN SELECT * FROM (VALUES
    ('waste_name', 120), ('description', 1200), ('sorting_instruction', 1600),
    ('recycling_advice', 1600), ('safety_warning', 1200), ('model', 120)
  ) AS lengths(field_name, maximum_length)
  LOOP
    candidate := baseline || jsonb_build_object('id', gen_random_uuid(),
      'client_request_id', gen_random_uuid(), item.field_name, repeat('x', item.maximum_length + 1));
    PERFORM pg_temp.expect_sqlstate(format(
      'INSERT INTO public.waste_analyses SELECT * FROM jsonb_populate_record(NULL::public.waste_analyses, %L::jsonb)',
      candidate::text), '22001', item.field_name || ' uzunluk sınırı uygulanır');

    candidate := baseline || jsonb_build_object('id', gen_random_uuid(),
      'client_request_id', gen_random_uuid(), item.field_name, E' \t\n\r ');
    PERFORM pg_temp.expect_sqlstate(format(
      'INSERT INTO public.waste_analyses SELECT * FROM jsonb_populate_record(NULL::public.waste_analyses, %L::jsonb)',
      candidate::text), '23514', item.field_name || ' yalnız boşluk/tab/yeni satır olamaz');

    candidate := baseline || jsonb_build_object('id', gen_random_uuid(),
      'client_request_id', gen_random_uuid(), item.field_name, '');
    PERFORM pg_temp.expect_sqlstate(format(
      'INSERT INTO public.waste_analyses SELECT * FROM jsonb_populate_record(NULL::public.waste_analyses, %L::jsonb)',
      candidate::text), '23514', item.field_name || ' boş metin olamaz');

    candidate := baseline || jsonb_build_object('id', gen_random_uuid(),
      'client_request_id', gen_random_uuid(), item.field_name, U&'\00A0\FEFF\2003');
    PERFORM pg_temp.expect_sqlstate(format(
      'INSERT INTO public.waste_analyses SELECT * FROM jsonb_populate_record(NULL::public.waste_analyses, %L::jsonb)',
      candidate::text), '23514', item.field_name || ' yalnız Unicode boşluk olamaz');

    candidate := baseline || jsonb_build_object('id', gen_random_uuid(),
      'client_request_id', gen_random_uuid(), item.field_name, repeat('x', item.maximum_length));
    EXECUTE format(
      'INSERT INTO public.waste_analyses SELECT * FROM jsonb_populate_record(NULL::public.waste_analyses, %L::jsonb)',
      candidate::text);
    PERFORM pg_temp.assert_true(true, item.field_name || ' tam uzunluk sınırında kabul edilir');
  END LOOP;

  FOREACH field_name IN ARRAY ARRAY[
    'id', 'user_id', 'client_request_id', 'created_at', 'waste_name', 'category',
    'description', 'sorting_instruction', 'recycling_advice', 'object_count',
    'uncertain', 'hazardous', 'model', 'schema_version'
  ]
  LOOP
    candidate := baseline || jsonb_build_object('id', gen_random_uuid(),
      'client_request_id', gen_random_uuid(), field_name, NULL);
    PERFORM pg_temp.expect_sqlstate(format(
      'INSERT INTO public.waste_analyses SELECT * FROM jsonb_populate_record(NULL::public.waste_analyses, %L::jsonb)',
      candidate::text), '23502', field_name || ' NULL olamaz');
  END LOOP;

  FOR item IN SELECT * FROM (VALUES
    ('category', 'Geçersiz'), ('category', 'Paper'), ('category', ''),
    ('object_count', 'none'), ('object_count', 'invalid'),
    ('schema_version', '0'), ('schema_version', '2')
  ) AS invalid(field_name, field_value)
  LOOP
    candidate := baseline || jsonb_build_object('id', gen_random_uuid(),
      'client_request_id', gen_random_uuid(), item.field_name, item.field_value);
    PERFORM pg_temp.expect_sqlstate(format(
      'INSERT INTO public.waste_analyses SELECT * FROM jsonb_populate_record(NULL::public.waste_analyses, %L::jsonb)',
      candidate::text), '23514', item.field_name || '=' || item.field_value || ' reddedilir');
  END LOOP;

  candidate := baseline || jsonb_build_object('id', gen_random_uuid());
  PERFORM pg_temp.expect_sqlstate(format(
    'INSERT INTO public.waste_analyses SELECT * FROM jsonb_populate_record(NULL::public.waste_analyses, %L::jsonb)',
    candidate::text), '23505', 'Aynı kullanıcı/client_request_id ikinci kayıt oluşturamaz');

  candidate := baseline || jsonb_build_object('id', gen_random_uuid(),
    'client_request_id', gen_random_uuid(), 'user_id', 'cccccccc-0000-4000-8000-000000000003');
  PERFORM pg_temp.expect_sqlstate(format(
    'INSERT INTO public.waste_analyses SELECT * FROM jsonb_populate_record(NULL::public.waste_analyses, %L::jsonb)',
    candidate::text), '23503', 'Mevcut olmayan kullanıcı için kayıt oluşturulamaz');

  FOREACH allowed_category IN ARRAY ARRAY[
    'Plastik', 'Cam', 'Kâğıt/Karton', 'Metal', 'Organik', 'Elektronik', 'Pil', 'Diğer'
  ]
  LOOP
    candidate := baseline || jsonb_build_object('id', gen_random_uuid(),
      'client_request_id', gen_random_uuid(), 'category', allowed_category);
    EXECUTE format(
      'INSERT INTO public.waste_analyses SELECT * FROM jsonb_populate_record(NULL::public.waste_analyses, %L::jsonb)',
      candidate::text);
    PERFORM pg_temp.assert_true(true, 'Gerçek JSON kategorisi kabul edilir: ' || allowed_category);
  END LOOP;
END;
$constraints$;

-- İleride güvenilir Edge Function için tanımlanan rol fixture kaydı ekleyebilir.
SET LOCAL ROLE service_role;
INSERT INTO public.waste_analyses (
  user_id, client_request_id, waste_name, category, description,
  sorting_instruction, recycling_advice, object_count, uncertain, hazardous, model
) VALUES (
  'bbbbbbbb-0000-4000-8000-000000000002', '99999999-0000-4000-8000-000000000004',
  'Metal kutu', 'Metal', 'Güvenilir sunucu rolünün sentetik kaydı.',
  'Ayrı topla.', 'Toplama noktasına ver.', 'single', false, false, 'test-model'
);
SELECT pg_temp.assert_true(
  EXISTS (SELECT 1 FROM public.waste_analyses
          WHERE client_request_id = '99999999-0000-4000-8000-000000000004'
            AND id IS NOT NULL AND created_at IS NOT NULL AND schema_version = 1),
  'service_role INSERT yapabilir; id, tarih ve schema_version varsayılanları geçerli');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
WITH removed AS (
  DELETE FROM public.waste_analyses
  WHERE id = '11111111-0000-4000-8000-000000000001' RETURNING id
)
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM removed), 'A kendi kaydını silebilir');
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM public.waste_analyses
              WHERE id = '11111111-0000-4000-8000-000000000001'),
  'Silinen kendi kaydı artık görünmez');
RESET ROLE;

SELECT pg_temp.assert_true(
  (SELECT count(*) > 0 FROM public.waste_analyses
   WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'CASCADE öncesi A kullanıcısına bağlı kayıtlar mevcut');
DELETE FROM auth.users WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(
  (SELECT count(*) = 0 FROM public.waste_analyses
   WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'Kullanıcı silinince bağlı analizler ON DELETE CASCADE ile kaldırılır');
SELECT pg_temp.assert_true(
  (SELECT count(*) = 2 FROM public.waste_analyses
   WHERE user_id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  'A silinince B kullanıcısının kayıtları korunur');

SELECT format('PASS: %s SQL güvenlik/doğrulama kontrolü başarılı; tüm sentetik değişiklikler geri alınacak.',
  current_setting('akilli_atik.assertion_count')) AS result;
ROLLBACK;
