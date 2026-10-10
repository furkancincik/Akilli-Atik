import { Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/HomePage";
import { ScanPage } from "./pages/ScanPage";
import { HistoryPage } from "./pages/HistoryPage";
import { StatisticsPage } from "./pages/StatisticsPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { usePhotoCapture } from "./hooks/usePhotoCapture";
export function App() {
  const photoCapture = usePhotoCapture();
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="tara" element={<ScanPage capture={photoCapture} />} />
        <Route path="gecmis" element={<HistoryPage />} />
        <Route path="istatistikler" element={<StatisticsPage />} />
        <Route path="giris" element={<LoginPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
