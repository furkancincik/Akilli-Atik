import { ChartNoAxesCombined } from "lucide-react";
import { PageIntro } from "../components/PageIntro";
import { EmptyState } from "../components/EmptyState";
export function StatisticsPage() {
  return (
    <>
      <PageIntro
        eyebrow="İSTATİSTİKLER"
        title="Her adımını takip et."
        description="Toplam analiz sayın ve atık kategorilerinin dağılımı burada yer alacak."
      />
      <EmptyState
        icon={ChartNoAxesCombined}
        title="İstatistikler için henüz veri kaynağı yok"
      >
        Gerçek analiz kayıtları bağlandığında kategori dağılımları ve basit
        grafikler eklenecek.
      </EmptyState>
    </>
  );
}
