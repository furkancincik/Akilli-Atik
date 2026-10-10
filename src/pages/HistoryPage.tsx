import { History } from "lucide-react";
import { PageIntro } from "../components/PageIntro";
import { EmptyState } from "../components/EmptyState";
export function HistoryPage() {
  return (
    <>
      <PageIntro
        eyebrow="ANALİZ GEÇMİŞİ"
        title="Dönüşüm yolculuğuna göz at."
        description="Önceki analizlerin, tarihleri ve ayrıştırma detayları burada yer alacak."
      />
      <EmptyState icon={History} title="Geçmiş henüz kullanıma açık değil">
        Kullanıcı girişi ve veritabanı bağlantısı tamamlandığında sana özel
        kayıtlar burada görüntülenecek.
      </EmptyState>
    </>
  );
}
