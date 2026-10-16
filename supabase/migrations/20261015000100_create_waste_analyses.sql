-- Phase 4 / STEP 2: Yalnız doğrulanmış başarılı analizlerin geçmişi.
-- Canlıya otomatik uygulanmaz. Önce şema envanteri ve izolasyon testleri incelenir.
BEGIN;

CREATE TABLE public.waste_analyses (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_request_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    waste_name varchar(120) NOT NULL,
    category text NOT NULL,
    description varchar(1200) NOT NULL,
    sorting_instruction varchar(1600) NOT NULL,
    recycling_advice varchar(1600) NOT NULL,
    safety_warning varchar(1200),
    object_count text NOT NULL,
    uncertain boolean NOT NULL,
    hazardous boolean NOT NULL,
    model varchar(120) NOT NULL,
    schema_version integer NOT NULL DEFAULT 1,

    -- İstemci JSON sözleşmesindeki Türkçe kategoriler birebir korunur.
    CONSTRAINT waste_analyses_category_check CHECK (
        category IN ('Plastik', 'Cam', 'Kâğıt/Karton', 'Metal',
                     'Organik', 'Elektronik', 'Pil', 'Diğer')
    ),
    CONSTRAINT waste_analyses_object_count_check CHECK (object_count IN ('single', 'multiple')),
    CONSTRAINT waste_analyses_schema_version_check CHECK (schema_version = 1),
    CONSTRAINT waste_analyses_user_request_key UNIQUE (user_id, client_request_id),

    -- JS trim() ile uyumlu boşluklar: space/tab/yeni satır ve Unicode boşlukları.
    -- Sadece bu karakterlerden oluşan metinler geçerli analiz sayılmaz.
    CONSTRAINT waste_analyses_waste_name_check CHECK (
        waste_name ~ U&'[^[:space:]\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF]'
    ),
    CONSTRAINT waste_analyses_description_check CHECK (
        description ~ U&'[^[:space:]\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF]'
    ),
    CONSTRAINT waste_analyses_sorting_check CHECK (
        sorting_instruction ~ U&'[^[:space:]\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF]'
    ),
    CONSTRAINT waste_analyses_recycling_check CHECK (
        recycling_advice ~ U&'[^[:space:]\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF]'
    ),
    CONSTRAINT waste_analyses_safety_check CHECK (
        safety_warning IS NULL OR
        safety_warning ~ U&'[^[:space:]\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF]'
    ),
    CONSTRAINT waste_analyses_model_check CHECK (
        model ~ U&'[^[:space:]\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF]'
    )
);

CREATE INDEX waste_analyses_user_created_id_idx
    ON public.waste_analyses (user_id, created_at DESC, id DESC);

COMMENT ON TABLE public.waste_analyses IS
    'Yalnız güvenilir sunucunun doğruladığı başarılı analizler. Fotoğraf/token/ham Gemini yanıtı saklanmaz.';

ALTER TABLE public.waste_analyses ENABLE ROW LEVEL SECURITY;

-- Supabase varsayılan yetkilerine güvenilmez: bütün başlangıç yetkileri kaldırılır.
REVOKE ALL ON TABLE public.waste_analyses FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, DELETE ON TABLE public.waste_analyses TO authenticated;
-- İleride Edge Function için INSERT ... RETURNING; UPDATE/DELETE verilmez.
GRANT INSERT, SELECT ON TABLE public.waste_analyses TO service_role;

CREATE POLICY waste_analyses_select_own
    ON public.waste_analyses FOR SELECT TO authenticated
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY waste_analyses_delete_own
    ON public.waste_analyses FOR DELETE TO authenticated
    USING ((SELECT auth.uid()) = user_id);

-- INSERT/UPDATE için authenticated/anon politikası veya yetkisi yoktur.
-- Service role RLS'yi atlar: user_id ileride doğrulanmış JWT'den sunucuda alınmalıdır.
COMMIT;
