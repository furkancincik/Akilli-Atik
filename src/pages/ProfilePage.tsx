import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Award, History, Leaf, LoaderCircle, RefreshCw, ShieldCheck, Trophy, UserRound } from "lucide-react";
import { PageIntro } from "../components/PageIntro";
import { useAuth } from "../auth/useAuth";
import { useProfile } from "../hooks/useGamification";
import { useStatistics } from "../hooks/useStatistics";
import { useAnalysisHistory } from "../hooks/useAnalysisHistory";
import type { GamificationProfile, GamificationService, ProfilePreferences } from "../services/gamificationData";
import type { HistoryService } from "../services/historyData";
import type { StatisticsService } from "../services/statisticsData";

const number = new Intl.NumberFormat("tr-TR");
const date = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Istanbul" });
const badgeLabels: Record<string, { name: string; rule: string }> = {
  first_recognition: { name: "İlk Tanıma", rule: "En az bir aktif puanlı analiz." },
  category_explorer: { name: "Kategori Kaşifi", rule: "En az üç farklı puanlı kategoride aktif analiz." },
  green_pioneer: { name: "Yeşil Öncü", rule: "En az 1.000 aktif XP." },
};

function PreferencesForm({ profile, saving, error, save, onEdit }: {
  profile: GamificationProfile; saving: boolean; error: string | null;
  save: (preferences: ProfilePreferences) => Promise<boolean>;
  onEdit: () => void;
}) {
  const [nickname, setNickname] = useState(profile.nickname ?? "");
  const [optIn, setOptIn] = useState(profile.arenaOptIn);
  return <form className="card profile-preferences" noValidate onSubmit={(event) => {
    event.preventDefault();
    void save({ nickname: nickname.trim() || null, arenaOptIn: optIn });
  }} aria-labelledby="profile-preferences-title">
    <h2 id="profile-preferences-title">Profil tercihlerin</h2>
    <p>Takma adın hesabındaki e-posta veya gerçek adından otomatik oluşturulmaz.</p>
    <fieldset disabled={saving}>
      <label htmlFor="profile-nickname">Takma ad</label>
      <input id="profile-nickname" name="nickname" value={nickname} maxLength={24} autoComplete="off"
        aria-describedby="profile-nickname-help" onChange={(event) => { setNickname(event.target.value); onEdit(); }} />
      <p id="profile-nickname-help" className="game-note">3–24 karakter; bir harfle başla. Türkçe harf, rakam ve alt çizgi kullanabilirsin. Arena'ya katılmak için benzersiz bir takma ad gerekir.</p>
      <label className="profile-opt-in"><input type="checkbox" checked={optIn} onChange={(event) => { setOptIn(event.target.checked); onEdit(); }} />
        <span>Eko Arena'ya katılmak istiyorum. Takma adımın, XP ve seviye bilgilerimin diğer giriş yapmış kullanıcılara gösterilmesini kabul ediyorum.</span></label>
      <p className="game-note">Katılım isteğe bağlıdır. İşareti kaldırıp kaydederek sıralamadan ayrılabilirsin.</p>
      <button type="submit" className="button primary">{saving ? "Kaydediliyor…" : "Profil tercihlerimi kaydet"}</button>
    </fieldset>
    {error && <p className="photo-error" role="alert">{error}</p>}
  </form>;
}

// Dependency ports are for isolated tests; production uses the authenticated SDK.
export function ProfilePage({ service, historyService, statisticsService }: {
  service?: GamificationService; historyService?: HistoryService; statisticsService?: StatisticsService;
} = {}) {
  const { user, identityVersion } = useAuth();
  const identity = `${user?.id ?? "guest"}:${identityVersion}`;
  const [savedIdentity, setSavedIdentity] = useState<string | null>(null);
  const [editingIdentity, setEditingIdentity] = useState<string | null>(null);
  // A focus refresh must not discard an unfinished nickname/consent draft.
  const game = useProfile(service, editingIdentity !== identity);
  const statistics = useStatistics(statisticsService);
  const history = useAnalysisHistory(undefined, historyService);
  const profile = game.profile;
  const busy = game.loading || game.saving || statistics.loading || history.loading;
  return <div className="game-page profile-page">
    <PageIntro eyebrow="PROFİLİM" title="Bilinçli adımların, kişisel yolculuğun."
      description="Doğrulanmış atık tanıma etkinliklerinden kazandığın XP, seviyen ve analizlerin." />
    <div className="history-toolbar"><span className="history-private"><ShieldCheck size={18} aria-hidden="true" />Hesabına özel alan</span>
      <button className="button secondary" type="button" disabled={busy} onClick={() => {
        setSavedIdentity(null);
        setEditingIdentity(null);
        void Promise.all([game.reload(), statistics.reload(), history.reload()]);
      }}><RefreshCw size={17} aria-hidden="true" />Yenile</button></div>
    <p className="game-scope-note">XP, atık tanıma ve çevresel farkındalık etkinliğini temsil eder; gerçek geri dönüşümün veya çevresel katkının kanıtı değildir.</p>
    {game.error && <p className="history-error" role="alert">{game.error}</p>}
    {game.loading ? <section className="card history-loading" role="status" data-testid="profile-loading"><LoaderCircle size={23} aria-hidden="true" /><p>Profilin yükleniyor…</p></section>
      : profile && <div data-testid="profile-content">
        <section className="profile-overview" aria-label="XP ve seviye">
          <article className="profile-xp-card">
            <div className="profile-identity"><span className="game-avatar" aria-hidden="true"><UserRound size={27} /></span><div>
              <span className="game-overline">KİŞİSEL YOLCULUĞUN</span><h2>{profile.nickname ?? "Takma adını belirle"}</h2></div></div>
            <div className="profile-xp"><strong data-testid="profile-xp">{number.format(profile.totalXp)}</strong><span>XP</span></div>
            <p className="profile-level" data-testid="profile-level">Seviye {profile.level} · {profile.levelTitle}</p>
            <label htmlFor="profile-progress" className="sr-only">Bir sonraki seviyeye ilerleme</label>
            <progress id="profile-progress" data-testid="profile-progress" max={100} value={profile.progress} aria-valuetext={profile.nextLevelXp === null ? "En yüksek seviyedesin" : `Sonraki seviyeye ${profile.remainingXp} XP kaldı`} />
            <p data-testid="profile-remaining">{profile.nextLevelXp === null ? "En yüksek seviyedesin. Yolculuğun devam ediyor!" : `Sonraki seviyeye ${number.format(profile.remainingXp)} XP kaldı.`}</p>
            {profile.totalXp === 0 && <p className="profile-first-step">Henüz aktif XP kazanımın yok. Uygun ve hesabına kaydedilmiş analizler yolculuğunu başlatır.</p>}
          </article>
          <article className="card profile-rank"><Trophy size={29} aria-hidden="true" /><h2>Eko Arena'daki yerin</h2>
            <strong data-testid="profile-rank">{profile.rank === null ? "Sıralama dışında" : `#${number.format(profile.rank)}`}</strong>
            <p>{profile.arenaOptIn ? "Katılımı açık kullanıcılar arasındaki güncel sıran." : "Profil tercihlerinden katılmayı seçebilirsin."}</p>
            <Link className="game-text-link" to="/eko-arena">Eko Arena'yı gör <ArrowRight size={17} aria-hidden="true" /></Link>
            <dl className="profile-award-summary"><div><dt>Puanlı aktif analiz</dt><dd>{number.format(profile.awardedAnalyses)}</dd></div><div><dt>Bugün kullanılan puan hakkı</dt><dd>{profile.dailySlotsUsed} / 3</dd></div></dl>
          </article>
        </section>
        <section className="card profile-badges" aria-labelledby="profile-badges-title" data-testid="profile-badges">
          <h2 id="profile-badges-title">Kazandığın rozetler</h2>
          {profile.badges.length ? <ul>{profile.badges.map((id) => <li key={id}><Award size={26} aria-hidden="true" /><div><strong>{badgeLabels[id].name}</strong><p>{badgeLabels[id].rule}</p></div></li>)}</ul>
            : <p>Henüz rozet kazanmadın. İlk aktif puanlı analizinle İlk Tanıma rozeti açılır.</p>}
          <p className="game-note">Rozetler ve seviyen aktif kazanımlarından hesaplanır. Analiz silmek ilgili XP'yi kaldırır; o gün kullanılan puan hakkını geri açmaz.</p>
        </section>
        <PreferencesForm key={`${identity}:${profile.nickname}:${profile.arenaOptIn}`} profile={profile} saving={game.saving} error={game.saveError} onEdit={() => { setSavedIdentity(null); setEditingIdentity(identity); }} save={async (preferences) => {
          setSavedIdentity(null);
          const success = await game.save(preferences);
          if (success) { setSavedIdentity(identity); setEditingIdentity(null); }
          return success;
        }} />
        {savedIdentity === identity && !game.saveError && <p className="game-success" role="status">Profil tercihlerin kaydedildi.</p>}
      </div>}
    <section className="card profile-analysis-summary" aria-labelledby="profile-summary-title" data-testid="profile-summary">
      <div className="game-section-heading"><span className="statistics-icon" aria-hidden="true"><Leaf size={23} /></span><h2 id="profile-summary-title">Analizlerine kısa bir bakış</h2></div>
      {statistics.loading ? <p role="status">Analiz özetin yükleniyor…</p> : statistics.error ? <p role="alert" className="photo-error">{statistics.error}</p> : statistics.summary && <dl className="profile-summary-grid">
        <div><dt>Toplam kayıtlı analiz</dt><dd>{number.format(statistics.summary.totalAnalyses)}</dd></div>
        <div><dt>Farklı kategori</dt><dd>{statistics.summary.distinctCategories} / 8</dd></div>
        <div><dt>En sık tanınan</dt><dd>{statistics.summary.topCategories.join(", ") || "Henüz yok"}</dd></div>
      </dl>}
      <h3>Son analizlerin</h3>
      {history.loading ? <p role="status">Son analizlerin yükleniyor…</p> : history.error ? <p role="alert" className="photo-error">{history.error}</p> : history.items.length ? <ul className="profile-recent">
        {history.items.slice(0, 3).map((record) => <li key={record.id}><Link to={`/gecmis/${record.id}`}><span><strong>{record.analysis.wasteName}</strong><span>{record.analysis.category} · <time dateTime={record.createdAt}>{date.format(new Date(record.createdAt))}</time></span></span><ArrowRight size={18} aria-hidden="true" /></Link></li>)}
      </ul> : <p>Henüz hesabına kaydedilmiş analiz yok.</p>}
      <Link className="game-text-link" to="/gecmis"><History size={17} aria-hidden="true" />Tüm analiz geçmişim <ArrowRight size={17} aria-hidden="true" /></Link>
    </section>
  </div>;
}
