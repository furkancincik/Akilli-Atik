import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.akilliatik.app",
  appName: "Akıllı Atık",
  webDir: "dist",
  // APK web dosyalarını içerir; geliştirme sunucusuna bağımlı değildir.
  plugins: {
    SystemBars: {
      insetsHandling: "css",
      initialViewportFitValueHint: "cover",
      style: "LIGHT",
    },
  },
};

export default config;
