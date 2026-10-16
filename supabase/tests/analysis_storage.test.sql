\set ON_ERROR_STOP on

-- STEP 4: storage.ts REST adaptörünün beklediği SQL sözleşmesinin ek kontrolleri.
-- Gerçek PostgreSQL, sentetik kullanıcılar ve service_role kullanılır; PostgREST
-- veya Supabase Auth servisinin çalıştığı iddia edilmez. Önceki 88 kontrol korunur.
BEGIN;

DO $guard$
BEGIN
  IF current_setting('akilli_atik.test_database', true) IS DISTINCT FROM 'true'
     OR current_database() <> 'akilli_atik_step2_test'
     OR inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCKED: Yalnız ağsız ve geçici yerel test veritabanı kullanılabilir.';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users) OR EXISTS (SELECT 1 FROM public.waste_analyses) THEN
    RAISE EXCEPTION 'BLOCKED: Test başlangıcında veritabanı boş olmalı; mevcut veri değiştirilmedi.';
  END IF;
END;
$guard$;

SELECT set_config('akilli_atik.storage_assertions', '0', true);
CREATE FUNCTION pg_temp.assert_storage(condition boolean, label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $function$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  PERFORM set_config('akilli_atik.storage_assertions',
    (current_setting('akilli_atik.storage_assertions')::integer + 1)::text, true);
  RAISE NOTICE 'PASS: %', label;
END;
$function$;
CREATE FUNCTION pg_temp.expect_storage_state(statement text, expected_state text, label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $function$
DECLARE actual_state text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE;
    IF actual_state <> expected_state THEN
      RAISE EXCEPTION 'FAIL: %; beklenen SQLSTATE %, alınan %', label, expected_state, actual_state;
    END IF;
    PERFORM pg_temp.assert_storage(true, label);
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: %; beklenen hata oluşmadı', label;
END;
$function$;

-- auth.users burada yalnız FK için asgari yerel fixture'dır. Gerçek e-posta
-- doğrulaması/JWT doğrulaması yerine geçmez; bunlar ayrı Auth testleridir.
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'storage-a@example.invalid'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'storage-b@example.invalid');

SET LOCAL ROLE service_role;
SELECT pg_temp.assert_storage(current_user = 'service_role', 'Saklama sözleşmesi gerçek service_role yetkileriyle denenir');

-- storage.ts ile aynı dar INSERT alanları; id/tarih DB varsayılanlarıdır.
WITH inserted AS (
  INSERT INTO public.waste_analyses (
    user_id, client_request_id, waste_name, category, description,
    sorting_instruction, recycling_advice, safety_warning, object_count,
    uncertain, hazardous, model, schema_version
  ) VALUES (
    'aaaaaaaa-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000001',
    'İlk plastik şişe', 'Plastik', 'Yalnız sentetik test.', 'Ayrı topla.',
    'Yerel toplama kurallarını kontrol et.', NULL, 'single', false, false, 'first-model', 1
  ) RETURNING id, created_at, user_id, client_request_id, waste_name, model, schema_version
)
SELECT pg_temp.assert_storage(
  (SELECT count(*) = 1 AND bool_and(id IS NOT NULL AND created_at IS NOT NULL
     AND waste_name = 'İlk plastik şişe' AND model = 'first-model' AND schema_version = 1) FROM inserted),
  'service_role INSERT RETURNING kanonik kaydı ve DB varsayılanlarını döndürür');

SELECT pg_temp.expect_storage_state($sql$
  INSERT INTO public.waste_analyses (
    user_id, client_request_id, waste_name, category, description,
    sorting_instruction, recycling_advice, object_count, uncertain, hazardous, model
  ) VALUES (
    'aaaaaaaa-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000001',
    'İkinci cevap', 'Cam', 'Yeni model cevabı.', 'Başka talimat.', 'Başka öneri.',
    'single', false, false, 'second-model'
  )
$sql$, '23505', 'Aynı kullanıcı/istek ile farklı sonuç ekleme 23505 üretir');
SELECT pg_temp.assert_storage(
  (SELECT count(*) = 1 AND bool_and(waste_name = 'İlk plastik şişe' AND category = 'Plastik'
    AND description = 'Yalnız sentetik test.' AND model = 'first-model')
   FROM public.waste_analyses WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000000001'
     AND client_request_id = '99999999-0000-4000-8000-000000000001'),
  'Duplicate sonrası scoped SELECT ilk sonucu/modeli değiştirmeden döndürür');

INSERT INTO public.waste_analyses (
  user_id, client_request_id, waste_name, category, description,
  sorting_instruction, recycling_advice, object_count, uncertain, hazardous, model
) VALUES (
  'bbbbbbbb-0000-4000-8000-000000000002', '99999999-0000-4000-8000-000000000001',
  'B kullanıcısının cam şişesi', 'Cam', 'Sentetik B kaydı.', 'Ayrı topla.',
  'Toplama kurallarını kontrol et.', 'single', false, false, 'b-model'
);
SELECT pg_temp.assert_storage(
  (SELECT count(*) = 2 FROM public.waste_analyses
   WHERE client_request_id = '99999999-0000-4000-8000-000000000001'),
  'İstek UUID tekilliği kullanıcıya özeldir');
SELECT pg_temp.assert_storage(
  (SELECT count(*) = 1 AND bool_and(model = 'b-model') FROM public.waste_analyses
   WHERE user_id = 'bbbbbbbb-0000-4000-8000-000000000002'
     AND client_request_id = '99999999-0000-4000-8000-000000000001'),
  'Sunucu scoped sorgusu aynı istek UUID ile başka kullanıcının sonucunu karıştırmaz');
SELECT pg_temp.assert_storage(
  (SELECT count(*) = 0 FROM public.waste_analyses
   WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000000001'
     AND client_request_id = '99999999-0000-4000-8000-000000000099'),
  'Bulunmayan kullanıcı/istek çifti sonuç üretmez');

SELECT pg_temp.expect_storage_state(
  'UPDATE public.waste_analyses SET waste_name = ''Üzerine yaz''', '42501',
  'service_role ilk sonucu UPDATE ile değiştiremez');
SELECT pg_temp.expect_storage_state(
  'DELETE FROM public.waste_analyses', '42501', 'service_role kayıt silemez');

SELECT pg_temp.expect_storage_state($sql$
  INSERT INTO public.waste_analyses SELECT (jsonb_populate_record(NULL::public.waste_analyses,
    to_jsonb(w) || jsonb_build_object('id', gen_random_uuid(), 'client_request_id', gen_random_uuid(),
      'category', 'Unknown'))).* FROM public.waste_analyses w LIMIT 1
$sql$, '23514', 'service_role için de kategori CHECK uygulanır');
SELECT pg_temp.expect_storage_state($sql$
  INSERT INTO public.waste_analyses SELECT (jsonb_populate_record(NULL::public.waste_analyses,
    to_jsonb(w) || jsonb_build_object('id', gen_random_uuid(), 'client_request_id', gen_random_uuid(),
      'waste_name', NULL, 'category', NULL, 'object_count', 'none'))).* FROM public.waste_analyses w LIMIT 1
$sql$, '23502', 'Atık bulunmayan başarısız sonuç saklanabilir başarı biçiminde değildir');
SELECT pg_temp.expect_storage_state($sql$
  INSERT INTO public.waste_analyses SELECT (jsonb_populate_record(NULL::public.waste_analyses,
    to_jsonb(w) || jsonb_build_object('id', gen_random_uuid(), 'client_request_id', gen_random_uuid(),
      'user_id', 'cccccccc-0000-4000-8000-000000000003'))).* FROM public.waste_analyses w LIMIT 1
$sql$, '23503', 'Olmayan kullanıcıya kayıt FK ile reddedilir');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
SELECT pg_temp.assert_storage(
  (SELECT count(*) = 1 AND bool_and(model = 'first-model') FROM public.waste_analyses),
  'A yalnız güvenilir sunucunun kendi adına kaydettiği sonucu okuyabilir');
SELECT pg_temp.assert_storage(
  (SELECT count(*) = 0 FROM public.waste_analyses
   WHERE user_id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  'A güvenilir sunucunun B için kaydettiği sonucu okuyamaz');
SELECT pg_temp.expect_storage_state($sql$
  INSERT INTO public.waste_analyses (user_id, client_request_id)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001', gen_random_uuid())
$sql$, '42501', 'İstemci INSERT yetkisi sunucu kaydından sonra da kapalıdır');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.expect_storage_state('SELECT * FROM public.waste_analyses', '42501',
  'Anonim istemci sunucunun oluşturduğu kayıtları okuyamaz');
RESET ROLE;

SELECT format('PASS: %s ek PostgreSQL saklama sözleşmesi kontrolü başarılı; sentetik veriler geri alınacak.',
  current_setting('akilli_atik.storage_assertions')) AS result;
ROLLBACK;
