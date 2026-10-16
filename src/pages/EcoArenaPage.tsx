import { Link } from "react-router";
import { ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, ShieldCheck, Trophy } from "lucide-react";
import { PageIntro } from "../components/PageIntro";
import { useArena } from "../hooks/useGamification";
import type { ArenaEntry, GamificationService } from "../services/gamificationData";

const number = new Intl.NumberFormat("tr-TR");
function Entry({ entry, podium = false }: { entry: ArenaEntry; podium?: boolean }) {
  return <li className={`${podium ? "arena-podium-card" : "arena-row"}${entry.isMe ? " arena-me" : ""}`} data-testid={`arena-entry-${entry.rank}`}>
    <span className="arena-position" aria-label={`${entry.rank}. sıra`}>{podium && <Trophy size={22} aria-hidden="true" />}#{number.format(entry.rank)}</span>
    <div className="arena-person"><strong>{entry.nickname}{entry.isMe && <span className="arena-you">Sen</span>}</strong><span>Seviye {entry.level} · {entry.levelTitle}</span></div>
    <strong className="arena-xp">{number.format(entry.totalXp)} <span>XP</span></strong>
  </li>;
}
export function EcoArenaPage({ service }: { service?: GamificationService } = {}) {
  const game = useArena(service);
  const arena = game.arena;
  const rows = arena?.entries.filter((entry) => arena.offset !== 0 || entry.rank > 3) ?? [];
  return <div className="game-page arena-page">
    <PageIntro eyebrow="EKO ARENA" title="Birlikte öğren, kendi adımını büyüt."
      description="Katılmayı seçen kullanıcıların doğrulanmış atık tanıma etkinliklerinden oluşan sıralama." />
    <div className="history-toolbar"><span className="history-private"><ShieldCheck size={18} aria-hidden="true" />Yalnız takma ad, XP ve seviye</span>
      <button className="button secondary" type="button" disabled={game.loading} onClick={() => void game.reload()}><RefreshCw size={17} aria-hidden="true" />Yenile</button></div>
    <p className="game-scope-note">XP gerçek geri dönüşümün kanıtı değildir. Katılım isteğe bağlıdır; <Link to="/profil">Profilim</Link> sayfasından istediğin zaman ayrılabilirsin.</p>
    {game.error && <p className="history-error" role="alert">{game.error}</p>}
    {game.loading ? <section className="card history-loading" role="status" data-testid="arena-loading"><LoaderCircle size={23} aria-hidden="true" /><p>Eko Arena yükleniyor…</p></section>
      : arena && <>
        <section className="card arena-summary" aria-label="Sıralama özeti"><div><span>Katılımcı</span><strong>{number.format(arena.totalParticipants)}</strong></div>
          <div><span>Senin sıran</span><strong data-testid="arena-self-rank">{arena.myRank === null ? "Sıralama dışında" : `#${number.format(arena.myRank)}`}</strong></div></section>
        {!arena.totalParticipants ? <section className="card history-empty" data-testid="arena-empty"><Trophy size={38} aria-hidden="true" /><h2>Arena henüz yeni.</h2><p>Henüz sıralamaya katılmış kullanıcı yok. Profil tercihlerinden katılmayı seçebilirsin.</p><Link className="button primary" to="/profil">Profilime git</Link></section> : <>
          <section aria-labelledby="arena-podium-title"><div className="section-heading"><h2 id="arena-podium-title">Öne çıkan üç adım</h2></div>
            <ol className="arena-podium" data-testid="arena-podium">{arena.podium.map((entry) => <Entry key={entry.rank} entry={entry} podium />)}</ol></section>
          <section className="card arena-ranking" aria-labelledby="arena-list-title"><div className="game-section-heading"><h2 id="arena-list-title">Genel sıralama</h2>{rows.length > 0 && <span>{rows[0].rank}–{rows[rows.length - 1].rank}. sıralar</span>}</div>
            {rows.length ? <ol className="arena-list" start={arena.offset === 0 ? 4 : arena.offset + 1} data-testid="arena-list">{rows.map((entry) => <Entry key={entry.rank} entry={entry} />)}</ol> : <p className="game-note">Bu sayfadaki tüm katılımcılar yukarıda gösteriliyor.</p>}
            <nav className="arena-pagination" aria-label="Sıralama sayfaları"><button className="button secondary" type="button" disabled={arena.offset === 0} onClick={() => void game.loadPage(Math.max(0, arena.offset - 20))}><ChevronLeft size={18} aria-hidden="true" />Önceki</button>
              <span>Sayfa {Math.floor(arena.offset / 20) + 1}</span><button className="button secondary" type="button" disabled={arena.nextOffset === null} onClick={() => { if (arena.nextOffset !== null) void game.loadPage(arena.nextOffset); }}>Sonraki<ChevronRight size={18} aria-hidden="true" /></button></nav>
          </section>
        </>}
        <p className="game-note">Eşit XP'de normalize edilmiş benzersiz takma ad sırası kullanılır. Katılım ve puanlar değişebildiği için sayfalar arasında sıra değişebilir; yenileme ilk sayfaya döner.</p>
      </>}
  </div>;
}
