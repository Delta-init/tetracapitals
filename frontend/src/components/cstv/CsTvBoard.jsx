import { useEffect, useRef, useState } from 'react';
import { Maximize, Minimize, RotateCw, Trophy, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { setSoundPref, soundUnlocked, unlockSound, useSoundPref, useSoundUnlocked } from './saleAnnouncement';
import { SaleCelebration, celebrate } from './SaleCelebration';

/*
 * The CS TV board (the user, 2026-10-22: "exact same as the Sales TV") — the Root portal's
 * web/components/sales-tv/SalesTvBoard.tsx, ported: the same warm dark-brown theme in solid colours, the Outfit type,
 * each column opening with a podium (the top three on 3D steps, their HRMS photos and a gold, silver or bronze
 * trophy) and the standings from 4th down, drifting by themselves; the side panels; the header with the live status,
 * clock, Test, sound and full screen; and every newly approved course payment celebrated with confetti, a sparkle and
 * a voice. Where the Sales TV has a column per CRM, this has one per team (its CSs); the side panels are the teams'
 * standings and the latest payments. And it turns 0 / 90 / 180 / 270° for a screen on its side.
 * Data: backend functions/csTv.ts (GET /api/public/cs-tv).
 */

const POLL_MS = 15_000;
const OPEN_SLACK_MS = 60_000;

const CSS = `
.stv{--bg:#0f0a07;--panel:#160e09;--panel2:#1d130c;--head:#24180f;--line:#2f2117;--ink:#f8f1ea;--ink2:#dccbbd;--mute:#9d8776;
--accent:#ff6b1a;--good:#5ad17f;--warn:#f5a524;--bad:#ff5a4f;--money:#ffc861;
--gold:#ecd27c;--gold-on:#6b4d00;--silver:#dfe2e6;--silver-on:#4a5361;--bronze:#e0a96d;--bronze-on:#5c3410;
--step-top:#3a271a;--step-front:#25190f;--step-edge:#4b3324;
background:var(--bg);color:var(--ink);font-family:'Outfit',ui-sans-serif,system-ui,sans-serif}
.stv .num{font-variant-numeric:tabular-nums lining-nums}
@keyframes stv-blink{0%,55%{opacity:1}56%,100%{opacity:.3}}
.stv-blink{animation:stv-blink 1.2s steps(1,end) infinite}
@media (prefers-reduced-motion:reduce){.stv-blink{animation:none}}
.stv-scroll{scrollbar-width:none}.stv-scroll::-webkit-scrollbar{display:none}
`;

const PLACES = ['gold', 'silver', 'bronze'];
const T = {
  tiny: 'text-[clamp(0.62rem,0.66vw,0.92rem)]',
  small: 'text-[clamp(0.72rem,0.78vw,1.08rem)]',
  body: 'text-[clamp(0.9rem,1vw,1.45rem)]',
  title: 'text-[clamp(1.05rem,1.25vw,1.8rem)]',
};
const INR_PER_AED = 1 / (3.67 * 0.01);
const fmtInt = (n) => Math.round(n || 0).toLocaleString('en-US');
const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?';
const dubaiTime = (at) => new Date(at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dubaiHm = (at) => new Date(at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' });
const dubaiDate = (at) => new Date(at).toLocaleDateString('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
}
function monthLabel(m) {
  if (!m || !/^\d{4}-\d{2}$/.test(m)) return 'This month';
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
}
/** A team's colour, like a team's livery on a timing tower — the same team, the same colour, every time. */
const TEAM_TONES = ['#e8002d', '#27f4d2', '#ff8000', '#3671c6', '#229971', '#ff87bc', '#64c4ff', '#b6babd', '#52e252', '#ffd12e'];
function teamTone(team) {
  if (!team) return '#3a3f4a';
  let h = 0;
  for (const ch of team.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TEAM_TONES[h % TEAM_TONES.length];
}

function useFont() {
  useEffect(() => {
    if (document.getElementById('stv-outfit')) return;
    const link = document.createElement('link');
    link.id = 'stv-outfit';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);
}

/** fetcher(): the board's data; location: "dubai" | "bangalore"; rotate + onRotate: the screen's turn. */
export default function CsTvBoard({ fetcher, location, rotate = 0, onRotate }) {
  useFont();
  const [data, setData] = useState(null);
  const [lastOk, setLastOk] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const offset = useRef(0);
  const openedAt = useRef(null);
  const seen = useRef(new Set());
  const root = useRef(null);
  const currency = location === 'bangalore' ? 'INR' : 'AED';
  const money = (aed) => (currency === 'INR' ? Math.round((Number(aed) || 0) * INR_PER_AED) : Math.round(Number(aed) || 0));
  const fmtMoney = (aed) => `${currency} ${money(aed).toLocaleString('en-US')}`;

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      try {
        const d = await fetcher();
        const serverNow = Date.parse(d.generated_at) || Date.now();
        offset.current = serverNow - Date.now();
        const first = openedAt.current === null;
        if (first) openedAt.current = serverNow;
        const fresh = (d.recent || []).filter(c => !seen.current.has(c.id));
        for (const c of fresh) seen.current.add(c.id);
        if (!first) {
          const from = (openedAt.current ?? serverNow) - OPEN_SLACK_MS;
          fresh.filter(c => Date.parse(c.at) >= from).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).forEach(c => celebrate({
            id: c.id, closer: c.cs, courses: c.product ? [c.product] : [], amount: money(c.aed), currency, crmName: c.team, tone: teamTone(c.team), at: c.at,
          }));
        }
        setData(d);
        setLastOk(Date.now());
        setFetchError(null);
      } catch (e) {
        setFetchError(e?.message || "Can't reach the portal");
      }
      if (!stopped) timer = window.setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => { stopped = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher]);

  const serverNow = now + offset.current;
  const gap = 'gap-[clamp(0.5rem,0.7vw,1.1rem)]';
  // The board's first layout (the user, 2026-10-22: "the old UI, in this theme, with the 3D steps"): the whole location's
  // top three on the podium with the teams under it, every CS in a list beside it that scrolls by itself (the latest
  // payments panel hidden, 2026-10-22 — each one still pops up). Side by side on a wide screen; one under the other on a narrow or turned one.
  const [width, setWidth] = useState(1600);
  useEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const wide = width >= 1000;
  const people = data?.cs ?? [];
  const box = 'flex min-h-0 flex-col overflow-hidden rounded-[clamp(1rem,1.2vw,1.6rem)] border border-[color:var(--line)] bg-[color:var(--panel)]';

  return (
    <div ref={root} className="stv relative flex h-full w-full flex-col overflow-hidden p-[clamp(0.5rem,0.7vw,1.1rem)]">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <Header serverNow={serverNow} lastOk={lastOk} now={now} fetchError={fetchError} rootRef={root} location={location} rotate={rotate} onRotate={onRotate} />

      {!data ? (
        <section className={cn(box, 'mt-[clamp(0.5rem,0.7vw,1.1rem)] flex-1 place-items-center justify-center')}>
          <p className={cn('text-center text-[color:var(--mute)]', T.small)}>{fetchError || 'Loading…'}</p>
        </section>
      ) : (
        <div className={cn('mt-[clamp(0.5rem,0.7vw,1.1rem)] grid min-h-0 flex-1', gap, wide ? 'grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]' : 'grid-cols-1 grid-rows-[auto_minmax(0,1fr)]')}>
          <div className={cn('flex min-h-0 flex-col', gap)}>
            {/* The podium, for the whole location */}
            <section className={cn(box, wide && 'flex-[3]')}>
              <div className="flex flex-wrap items-center gap-2.5 px-[clamp(0.8rem,1vw,1.4rem)] pt-[clamp(0.6rem,0.8vw,1.1rem)]">
                <span className="h-[0.7em] w-[0.7em] shrink-0 rounded-full bg-[color:var(--accent)]" />
                <h2 className={cn('truncate font-semibold', T.title)}>Top CSs</h2>
                <span className={cn('rounded-full border border-[color:var(--line)] px-3 py-0.5 text-[color:var(--mute)]', T.small)}>{monthLabel(data.month)}</span>
                <span className="ml-auto flex items-center gap-2">
                  <span className={cn('num rounded-full bg-[color:var(--head)] px-3 py-0.5 font-semibold text-[color:var(--money)]', T.body)} title="Collected this month">{fmtMoney(data.totals?.month_aed)}</span>
                  <span className={cn('num rounded-full bg-[color:var(--head)] px-3 py-0.5 font-semibold text-[color:var(--good)]', T.body)} title="Collected today">{fmtMoney(data.totals?.today_aed)} today</span>
                </span>
              </div>
              {people.length === 0
                ? <p className={cn('px-3 py-10 text-center text-[color:var(--mute)]', T.small)}>No CSs on this board yet.</p>
                : <div className="flex flex-1 items-end"><div className="w-full"><Podium people={people.slice(0, 3)} fmtMoney={fmtMoney} big /></div></div>}
            </section>
            {wide && <TeamsPanel teams={data.teams ?? []} fmtMoney={fmtMoney} />}
          </div>

          <div className={cn('flex min-h-0 flex-col', gap)}>
            <AllCs people={people} money={money} />
            {!wide && <TeamsPanel teams={data.teams ?? []} fmtMoney={fmtMoney} />}
          </div>
        </div>
      )}

      <SoundPrompt />
      <SaleCelebration />
    </div>
  );
}

// ── Header ─────────────────────────────────────────────────────────────────────

function Header({ serverNow, lastOk, now, fetchError, rootRef, location, rotate, onRotate }) {
  const pref = useSoundPref();
  const soundOn = pref !== 'off';
  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const stale = !lastOk || now - lastOk > 45_000;
  const down = Boolean(fetchError) || stale;
  const btn = cn('inline-flex h-[clamp(1.9rem,2vw,2.6rem)] items-center gap-1.5 rounded-full border border-[color:var(--line)] px-3.5 font-medium text-[color:var(--ink2)] hover:border-[color:var(--step-edge)] hover:text-[color:var(--ink)]', T.small);

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-3">
        <span className="grid h-[clamp(2.1rem,2.3vw,3.1rem)] w-[clamp(2.1rem,2.3vw,3.1rem)] place-items-center rounded-xl bg-[color:var(--accent)] text-white">
          <Trophy className="h-[55%] w-[55%]" />
        </span>
        <div className="leading-tight">
          <h1 className={cn('font-bold tracking-tight', T.title)}>CS TV</h1>
          <p className={cn('text-[color:var(--mute)]', T.small)}>{location === 'bangalore' ? 'Bangalore' : 'Dubai'} · course payments</p>
        </div>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2 sm:gap-3">
        <span
          className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1 font-medium', T.small,
            down ? 'border-[color:var(--warn)] text-[color:var(--warn)]' : 'border-[color:var(--line)] text-[color:var(--ink2)]')}
          title={fetchError ?? undefined}
        >
          <span className={cn('inline-block h-2 w-2 rounded-full', down ? 'bg-[color:var(--warn)]' : 'stv-blink bg-[color:var(--accent)]')} />
          {!lastOk ? (fetchError ? "Can't reach the portal — retrying" : 'Connecting…')
            : down ? `Reconnecting · last update ${ago(now - lastOk)}`
            : `Live · ${ago(now - lastOk)}`}
        </span>
        <span className={cn('hidden text-[color:var(--mute)] md:inline', T.small)}>{dubaiDate(serverNow)}</span>
        <span className={cn('num hidden min-w-[5.5ch] font-semibold sm:inline', T.title)}>{dubaiTime(serverNow)}</span>
        <button
          type="button"
          onClick={() => celebrate({ id: `test-${Date.now()}`, closer: 'Test', courses: ['Sample course'], amount: location === 'bangalore' ? 54496 : 2000, currency: location === 'bangalore' ? 'INR' : 'AED', crmName: 'CS TV', at: new Date().toISOString(), test: true })}
          className={btn}
          title="Show a test celebration on this screen"
        >
          Test
        </button>
        <button
          type="button"
          onClick={() => { if (soundOn) setSoundPref('off'); else { unlockSound(); setSoundPref('on'); } }}
          className={btn}
          aria-pressed={!soundOn}
        >
          {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          {soundOn ? 'Sound on' : 'Muted'}
        </button>
        {onRotate && (
          <button type="button" onClick={onRotate} className={btn} title="Turn the screen (R)">
            <RotateCw className="h-4 w-4" />{rotate}°
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
            else void (document.documentElement).requestFullscreen?.().catch(() => undefined);
          }}
          className={btn}
          aria-label={full ? 'Leave full screen' : 'Full screen'}
        >
          {full ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
}

// ── A team: the podium, then the standings ─────────────────────────────────────

/* #, CS, payments this month and today, collected this month, collected today. */
const COLS = 'grid grid-cols-[clamp(1.7rem,1.9vw,2.9rem)_minmax(0,1fr)_repeat(2,minmax(0,clamp(1.7rem,1.9vw,2.9rem)))_minmax(0,clamp(4.2rem,4.6vw,6.8rem))_minmax(0,clamp(3.8rem,4.2vw,6.2rem))] items-center whitespace-nowrap gap-x-[clamp(0.15rem,0.25vw,0.45rem)]';

function Podium({ people, fmtMoney, big = false }) {
  const order = [1, 0, 2];
  return (
    <div className="grid grid-cols-3 items-end gap-[clamp(0.25rem,0.35vw,0.6rem)] px-[clamp(0.6rem,0.8vw,1.2rem)] pb-[clamp(0.5rem,0.7vw,1rem)] pt-[clamp(0.4rem,0.6vw,0.9rem)]">
      {order.map(i => {
        const p = people[i];
        return p ? <Step key={p.id} p={p} rank={i + 1} fmtMoney={fmtMoney} big={big} /> : <span key={`empty-${i}`} />;
      })}
    </div>
  );
}

function Step({ p, rank, fmtMoney, big = false }) {
  const first = rank === 1;
  // A coloured trophy only with something to show for it.
  const place = p.month_aed > 0 ? PLACES[rank - 1] : undefined;
  return (
    <div className="flex min-w-0 flex-col items-center">
      <Photo
        name={p.name}
        url={p.photo ?? null}
        className={cn(big
          ? (first ? 'h-[clamp(5rem,6.2vw,9rem)] w-[clamp(5rem,6.2vw,9rem)]' : 'h-[clamp(4rem,4.8vw,7rem)] w-[clamp(4rem,4.8vw,7rem)]')
          : (first ? 'h-[clamp(3.4rem,3.9vw,5.6rem)] w-[clamp(3.4rem,3.9vw,5.6rem)]' : 'h-[clamp(2.8rem,3.1vw,4.5rem)] w-[clamp(2.8rem,3.1vw,4.5rem)]'), 'rounded-[24%]')}
        ring={place ? `var(--${place})` : 'var(--step-edge)'}
      />
      <p className={cn('mt-1.5 w-full truncate text-center font-semibold leading-tight', first ? T.title : T.body)} title={p.name}>{p.name}</p>
      <p className={cn('w-full truncate text-center text-[color:var(--mute)]', T.tiny)}>{p.team || '—'}</p>

      <div className="mt-[clamp(0.3rem,0.45vw,0.7rem)] w-full">
        <div className="h-[clamp(0.7rem,0.85vw,1.2rem)] w-full bg-[color:var(--step-top)]" style={{ clipPath: 'polygon(9% 0, 91% 0, 100% 100%, 0 100%)' }} />
        <div className={cn('flex w-full flex-col items-center border-t border-[color:var(--step-edge)] bg-[color:var(--step-front)] px-1',
          big
            ? (first ? 'pb-[clamp(2.4rem,3.6vw,5.5rem)] pt-[clamp(0.6rem,0.8vw,1.2rem)]' : rank === 2 ? 'pb-[clamp(1.2rem,1.9vw,2.9rem)] pt-[clamp(0.5rem,0.7vw,1rem)]' : 'pb-[clamp(0.6rem,0.9vw,1.4rem)] pt-[clamp(0.5rem,0.7vw,1rem)]')
            : (first ? 'pb-[clamp(0.9rem,1.3vw,1.9rem)] pt-[clamp(0.45rem,0.6vw,0.9rem)]' : 'pb-[clamp(0.4rem,0.55vw,0.8rem)] pt-[clamp(0.35rem,0.5vw,0.75rem)]'))}>
          <span
            className="grid h-[clamp(1.6rem,1.8vw,2.6rem)] w-[clamp(1.6rem,1.8vw,2.6rem)] place-items-center rounded-[28%]"
            style={place ? { background: `var(--${place})`, color: `var(--${place}-on)` } : { background: 'var(--step-top)', color: 'var(--mute)' }}
          >
            <Trophy className="h-[55%] w-[55%]" />
          </span>
          <p className={cn('num mt-1 font-bold leading-none', first ? 'text-[clamp(1.6rem,2vw,2.9rem)]' : 'text-[clamp(1.3rem,1.55vw,2.25rem)]')}>{fmtInt(p.payments)}</p>
          <p className={cn('text-[color:var(--mute)]', T.tiny)}>payments</p>
          <p className={cn('num mt-[clamp(0.2rem,0.3vw,0.45rem)] whitespace-nowrap font-bold text-[color:var(--money)]', first ? T.body : T.small)} title="Collected this month">{fmtMoney(p.month_aed)}</p>
          <div className="my-[clamp(0.25rem,0.35vw,0.5rem)] h-px w-4/5 bg-[color:var(--line)]" />
          <p className={cn('num whitespace-nowrap text-[color:var(--ink2)]', T.tiny)}>
            <span className={p.today_payments > 0 ? 'font-semibold text-[color:var(--good)]' : undefined}>{fmtInt(p.today_payments || 0)} today</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function PersonRow({ p, rank, money, top = false }) {
  const zero = 'text-[color:var(--mute)]';
  return (
    <li className={cn(COLS, 'num border-b border-[color:var(--line)] px-[clamp(0.6rem,0.7vw,1rem)] py-[clamp(0.3rem,0.4vw,0.6rem)] last:border-b-0', top && 'rounded-xl bg-[color:var(--panel2)]', T.body)}>
      <span className={cn('font-medium text-[color:var(--mute)]', T.tiny)}>#{String(rank).padStart(2, '0')}</span>
      <span className="flex min-w-0 items-center gap-[clamp(0.4rem,0.5vw,0.75rem)]">
        <Photo name={p.name} url={p.photo ?? null} className="h-[clamp(1.7rem,1.9vw,2.7rem)] w-[clamp(1.7rem,1.9vw,2.7rem)] rounded-full" ring={top ? `var(--${PLACES[rank - 1]})` : undefined} />
        <span className="min-w-0">
          <span className="block truncate font-medium leading-tight">{p.name}</span>
          <span className={cn('block truncate leading-tight text-[color:var(--mute)]', T.tiny)}>{p.team || '—'}</span>
        </span>
      </span>
      <span className="text-right font-semibold">{fmtInt(p.payments)}</span>
      <span className={cn('text-right', p.today_payments > 0 ? 'font-semibold text-[color:var(--good)]' : zero)}>{fmtInt(p.today_payments || 0)}</span>
      <span className={cn('text-right', p.month_aed ? 'font-semibold text-[color:var(--money)]' : zero)}>{fmtInt(money(p.month_aed))}</span>
      <span className={cn('text-right', p.today_aed ? 'font-semibold text-[color:var(--good)]' : zero)}>{fmtInt(money(p.today_aed))}</span>
    </li>
  );
}

/** On a TV nobody scrolls: a table longer than its box drifts down, rests, and goes back up. */
function useAutoScroll(ref, rows) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let raf = 0;
    let pauseUntil = performance.now() + 4000;
    let goTop = false;
    let pos = el.scrollTop;
    const frame = (t) => {
      raf = requestAnimationFrame(frame);
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 4 || t < pauseUntil) return;
      if (goTop) { goTop = false; el.scrollTo({ top: 0, behavior: 'smooth' }); pos = 0; pauseUntil = t + 5000; return; }
      pos = Math.min(max, pos + 0.45);
      el.scrollTop = pos;
      if (pos >= max) { goTop = true; pauseUntil = t + 4000; }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [ref, rows]);
}

/** The HRMS photo; initials on a warm tile when there is none or it won't load. */
function Photo({ name, url, className, ring }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const style = ring ? { boxShadow: `0 0 0 2px ${ring}` } : undefined;
  if (url && !failed) return <img src={url} alt={name} className={cn('shrink-0 object-cover', className)} style={style} onError={() => setFailed(true)} referrerPolicy="no-referrer" />;
  return <span className={cn('grid shrink-0 place-items-center bg-[color:var(--step-top)] font-semibold text-[color:var(--ink2)]', className)} style={style}>{initials(name)}</span>;
}

/** Every CS of the location, ranked — the members' list, drifting down and back up by itself (the user, 2026-10-22). */
function AllCs({ people, money }) {
  const body = useRef(null);
  useAutoScroll(body, people.length);
  const head = cn('text-right font-medium text-[color:var(--ink2)]', T.tiny);
  const t = people.reduce((a, p) => ({ m: a.m + p.payments, d: a.d + (p.today_payments || 0), r: a.r + p.month_aed, x: a.x + p.today_aed }), { m: 0, d: 0, r: 0, x: 0 });
  return (
    <section className="flex min-h-0 flex-[3] flex-col overflow-hidden rounded-[clamp(1rem,1.2vw,1.6rem)] border border-[color:var(--line)] bg-[color:var(--panel)]">
      <div className="flex items-center gap-2.5 px-[clamp(0.8rem,1vw,1.4rem)] py-[clamp(0.6rem,0.8vw,1.1rem)]">
        <span className="h-[0.7em] w-[0.7em] shrink-0 rounded-full bg-[color:var(--gold)]" />
        <h2 className={cn('truncate font-semibold', T.title)}>Standings</h2>
        <span className={cn('num ml-auto rounded-full bg-[color:var(--head)] px-3 py-0.5 font-semibold', T.body)}>{people.length}</span>
      </div>
      <div className={cn(COLS, 'mx-[clamp(0.4rem,0.5vw,0.8rem)] rounded-full bg-[color:var(--head)] px-[clamp(0.6rem,0.7vw,1rem)] py-[clamp(0.35rem,0.45vw,0.65rem)]')}>
        <span className={cn(head, 'text-left')}>#</span>
        <span className={cn(head, 'text-left')}>CS</span>
        <span className={head} title="Course payments this month">Month</span>
        <span className={head} title="Course payments today">Today</span>
        <span className={head} title="Collected this month">Collected</span>
        <span className={head} title="Collected today">Today</span>
      </div>
      <div ref={body} className="stv-scroll min-h-0 flex-1 overflow-y-auto px-[clamp(0.4rem,0.5vw,0.8rem)]">
        {people.length === 0
          ? <p className={cn('px-2 py-4 text-center text-[color:var(--mute)]', T.small)}>No CSs yet.</p>
          : <ol>{people.map((p, i) => <PersonRow key={p.id} p={p} rank={i + 1} money={money} top={i < 3} />)}</ol>}
      </div>
      <div className={cn(COLS, 'num border-t border-[color:var(--line)] px-[clamp(1rem,1.2vw,1.8rem)] py-[clamp(0.4rem,0.55vw,0.8rem)] font-semibold whitespace-nowrap', T.body)}>
        <span className={cn('col-span-2 truncate font-medium text-[color:var(--mute)]', T.small)}>Total · {people.length} people</span>
        <span className="text-right">{fmtInt(t.m)}</span>
        <span className="text-right">{fmtInt(t.d)}</span>
        <span className="text-right text-[color:var(--money)]">{fmtInt(money(t.r))}</span>
        <span className="text-right text-[color:var(--good)]">{fmtInt(money(t.x))}</span>
      </div>
    </section>
  );
}

// ── Side panels ────────────────────────────────────────────────────────────────

function Panel({ title, dot, count, hint, className, children }) {
  return (
    <section className={cn('flex min-h-0 flex-col overflow-hidden rounded-[clamp(1rem,1.2vw,1.6rem)] border border-[color:var(--line)] bg-[color:var(--panel)]', className)}>
      <div className="flex items-center gap-2.5 px-[clamp(0.8rem,1vw,1.4rem)] py-[clamp(0.6rem,0.8vw,1.1rem)]" title={hint}>
        <span className="h-[0.7em] w-[0.7em] shrink-0 rounded-full" style={{ background: dot }} />
        <h2 className={cn('truncate font-semibold', T.title)}>{title}</h2>
        {count !== undefined && <span className={cn('num ml-auto rounded-full bg-[color:var(--head)] px-3 py-0.5 font-semibold', T.body)}>{count}</span>}
      </div>
      <div className="stv-scroll min-h-0 flex-1 overflow-y-auto px-[clamp(0.4rem,0.5vw,0.8rem)] pb-2">{children}</div>
    </section>
  );
}

function TeamsPanel({ teams, fmtMoney }) {
  return (
    <Panel title="Teams" dot="var(--accent)" count={teams.length} className="flex-[3]">
      {teams.length === 0 ? (
        <p className={cn('px-2 py-6 text-center text-[color:var(--mute)]', T.small)}>No teams yet.</p>
      ) : (
        <ul>
          {teams.map((t, i) => (
            <li key={t.id || t.team} className="flex items-center gap-[clamp(0.5rem,0.6vw,0.9rem)] border-b border-[color:var(--line)] px-[clamp(0.4rem,0.5vw,0.7rem)] py-[clamp(0.35rem,0.45vw,0.65rem)] last:border-b-0">
              <span className={cn('num w-[2ch] shrink-0 font-bold', T.title)} style={{ color: i < 3 ? `var(--${PLACES[i]})` : 'var(--mute)' }}>{i + 1}</span>
              <span className="h-[2.2em] w-1 shrink-0 rounded-full" style={{ background: teamTone(t.team) }} />
              <div className="min-w-0 flex-1">
                <p className={cn('truncate font-semibold leading-tight', T.body)}>{t.team}</p>
                <p className={cn('text-[color:var(--mute)]', T.tiny)}>{t.cs_count} CS · {fmtInt(t.payments)} payments</p>
              </div>
              <span className={cn('num shrink-0 font-bold text-[color:var(--money)]', T.body)}>{fmtMoney(t.month_aed)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── Sound: browsers need one click first ───────────────────────────────────────

function SoundPrompt() {
  const pref = useSoundPref();
  const unlocked = useSoundUnlocked();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    soundUnlocked();
    const t = window.setTimeout(() => setReady(true), 400);
    return () => window.clearTimeout(t);
  }, []);
  if (!ready || unlocked || pref === 'off') return null;
  const enable = () => { unlockSound(); setSoundPref('on'); };
  if (pref === 'on') {
    return (
      <button type="button" onClick={enable} className="fixed bottom-4 left-1/2 z-[900] inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-[color:var(--warn)] bg-[color:var(--panel)] px-4 py-2 text-sm font-medium text-[color:var(--warn)]">
        <Volume2 className="h-4 w-4" /> Click to enable sound
      </button>
    );
  }
  return (
    <div className="fixed inset-0 z-[950] grid place-items-center bg-black/75 p-4" onClick={enable}>
      <div className="w-full max-w-md rounded-3xl border border-[color:var(--line)] bg-[color:var(--panel)] p-8 text-center" onClick={(e) => e.stopPropagation()}>
        <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-[color:var(--accent)] text-white"><Volume2 className="h-7 w-7" /></span>
        <h2 className="text-2xl font-bold">Click to enable sound</h2>
        <p className="mt-2 text-[color:var(--ink2)]">Every payment is announced with a sparkle and a voice. Browsers stay silent until somebody clicks once — this screen remembers.</p>
        <div className="mt-6 flex flex-col gap-2">
          <button type="button" onClick={enable} className="rounded-full bg-[color:var(--accent)] px-4 py-3 text-lg font-semibold text-white hover:opacity-90">Enable sound</button>
          <button type="button" onClick={() => setSoundPref('off')} className="rounded-full px-4 py-2 text-sm text-[color:var(--mute)] hover:text-[color:var(--ink)]">Keep this screen silent</button>
        </div>
      </div>
    </div>
  );
}
