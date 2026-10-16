import { Component, Suspense } from "react";
import type { ReactNode } from "react";

/** Layout/navigation stay available if a route chunk is slow or fails to load. */
export class RouteContent extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    // Never display/log an exception, URL, credential or provider response.
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <section className="card" role="alert">
        <h2>Ekran yüklenemedi</h2>
        <p>Bağlantını kontrol edip ekranı yeniden yükle. Menüden başka bir sayfaya da geçebilirsin.</p>
        <button type="button" className="button primary" onClick={() => window.location.reload()}>
          Ekranı yeniden yükle
        </button>
      </section>;
    }
    return <Suspense fallback={<p className="session-loading" role="status">Ekran yükleniyor…</p>}>
      {this.props.children}
    </Suspense>;
  }
}
