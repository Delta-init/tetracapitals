import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crown, Maximize, RotateCw, Trophy, Users } from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────────
   The CS TV board (the user, 2026-10-22) — the office screens' leaderboard,
   like the Root portal's Sales TV: no sign-in (a secret in the link, copied by
   a Super Admin from the Leaderboard page), this month's course payments by
   CS with their HRMS photos, the teams, and a pop-up for each new approved
   payment. Turns 0 / 90 / 180 / 270° for a screen hung on its side
   (?rotate=, or the button / the R key — remembered on that screen).
   /tv/cs/dubai?t=<token> once on a screen, then just /tv/cs/dubai (or /bangalore) [?rotate=90].
   backend functions/csTv.ts (GET /api/public/cs-tv).
──────────────────────────────────────────────────────────────────────────── */

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const REFRESH_MS = 20_000;
const ROT_KEY = 'cs_tv_rotate';
const INR_PER_AED = 1 / (3.67 * 0.01);
const MEDAL = ['from-amber-300 to-amber-500', 'from-slate-200 to-slate-400', 'from-orange-300 to-orange-500'];

const params = () => new URLSearchParams(window.location.search);
const money = (aed, loc) => (loc === 'bangalore'
  ? `₹${Math.round((Number(aed) || 0) * INR_PER_AED).toLocaleString('en-IN')}`
  : `AED ${Math.round(Number(aed) || 0).toLocaleString('en-US')}`);
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.12 + 0.6);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + i * 0.12); o.stop(ctx.currentTime + i * 0.12 + 0.7);
    });
  } catch { /* no sound on this screen */ }
}

function Photo({ name, url, className }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) return <img src={url} alt="" onError={() => setBroken(true)} className={`object-cover ${className}`} />;
  return <div className={`grid place-items-center bg-gradient-to-br from-sky-500 to-indigo-600 font-bold text-white ${className}`}>{initials(name)}</div>;
}

export default function CsTv() {
  const p = params();
  // /tv/cs/dubai or /tv/cs/bangalore (the user, 2026-10-22); ?location= still works. The secret comes once with the
  // link (?t=) and the screen keeps it, so afterwards the short address alone opens the board on that screen.
  const fromPath = window.location.pathname.toLowerCase().split('/').filter(Boolean)[2];
  const location = (fromPath || p.get('location')) === 'bangalore' ? 'bangalore' : 'dubai';
  const token = (() => {
    const given = p.get('t');
    try {
      if (given) localStorage.setItem('cs_tv_t', given);
      return given || localStorage.getItem('cs_tv_t') || '';
    } catch { return given || ''; }
  })();
  const [rotate, setRotate] = useState(() => {
    const fromUrl = Number(p.get('rotate'));
    if ([0, 90, 180, 270].includes(fromUrl) && p.has('rotate')) return fromUrl;
    try { const v = Number(localStorage.getItem(ROT_KEY)); return [0, 90, 180, 270].includes(v) ? v : 0; } catch { return 0; }
  });
  // Once kept, the secret leaves the address bar: the screen shows just /tv/cs/<location>.
  useEffect(() => {
    if (!p.get('t')) return;
    const q = new URLSearchParams(window.location.search); q.delete('t'); q.delete('location');
    window.history.replaceState(null, '', `/tv/cs/${location}${q.toString() ? `?${q}` : ''}`);
  }, []);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [pop, setPop] = useState(null);
  const [controls, setControls] = useState(true);
  const seen = useRef(null);
  const queue = useRef([]);

  const turn = useCallback(() => setRotate(r => {
    const next = (r + 90) % 360;
    try { localStorage.setItem(ROT_KEY, String(next)); } catch { /* not kept */ }
    return next;
  }), []);

  // The board, every 20 seconds; a new approved payment queues a pop-up.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`${API}/api/public/cs-tv?t=${encodeURIComponent(token)}&location=${location}`, { cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || body?.message || `The board answered ${res.status}`);
        if (!alive) return;
        setError('');
        setData(body);
        const ids = (body.recent || []).map(r => r.id);
        if (seen.current) {
          const fresh = (body.recent || []).filter(r => !seen.current.has(r.id)).reverse();
          queue.current.push(...fresh);
        }
        seen.current = new Set([...(seen.current || []), ...ids]);
      } catch (e) {
        if (alive) setError(e.message || 'The board could not be loaded');
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, [token, location]);

  // One pop-up at a time, 8 seconds each.
  useEffect(() => {
    const id = setInterval(() => {
      setPop(cur => {
        if (cur) return cur;
        const next = queue.current.shift();
        if (next) { chime(); setTimeout(() => setPop(null), 8000); }
        return next || null;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // The buttons show while the mouse moves, then hide; R turns the screen.
  useEffect(() => {
    let t = setTimeout(() => setControls(false), 4000);
    const show = () => { setControls(true); clearTimeout(t); t = setTimeout(() => setControls(false), 4000); };
    const key = (e) => { if (e.key === 'r' || e.key === 'R') turn(); };
    window.addEventListener('mousemove', show); window.addEventListener('keydown', key);
    return () => { clearTimeout(t); window.removeEventListener('mousemove', show); window.removeEventListener('keydown', key); };
  }, [turn]);

  const side = rotate % 180 !== 0;
  const frame = { position: 'fixed', top: '50%', left: '50%', width: side ? '100vh' : '100vw', height: side ? '100vw' : '100vh', transform: `translate(-50%, -50%) rotate(${rotate}deg)` };
  const cs = data?.cs ?? [];
  const top = cs.slice(0, 3);
  const rest = cs.slice(3);
  const monthLabel = useMemo(() => (data?.month ? new Date(`${data.month}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : ''), [data?.month]);
  const podium = [top[1], top[0], top[2]];

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#070b1a]">
      <div style={frame} className="flex flex-col overflow-hidden bg-gradient-to-br from-[#0b1230] via-[#0a0f24] to-[#120a2a] p-[2.2vmin] text-white">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-[1.5vmin]">
            <img src="/brand/delta-logo-white.png" alt="Delta" className="h-[4.5vmin] w-auto" />
            <div>
              <p className="text-[1.6vmin] font-semibold uppercase tracking-[0.3em] text-sky-300">CS Leaderboard · {location === 'bangalore' ? 'Bangalore' : 'Dubai'}</p>
              <p className="text-[3.4vmin] font-extrabold leading-tight">Course payments · {monthLabel}</p>
            </div>
          </div>
          {data && (
            <div className="flex gap-[1.5vmin] text-right">
              <div className="rounded-[1.4vmin] bg-white/5 px-[2vmin] py-[1vmin]"><p className="text-[1.4vmin] uppercase tracking-wider text-slate-400">This month</p><p className="text-[3.2vmin] font-extrabold text-emerald-300">{money(data.totals.month_aed, location)}</p></div>
              <div className="rounded-[1.4vmin] bg-white/5 px-[2vmin] py-[1vmin]"><p className="text-[1.4vmin] uppercase tracking-wider text-slate-400">Today</p><p className="text-[3.2vmin] font-extrabold text-amber-300">{money(data.totals.today_aed, location)}</p></div>
            </div>
          )}
        </div>

        {error && !data ? (
          <div className="grid flex-1 place-items-center text-center text-[2.4vmin] text-rose-300">{error}</div>
        ) : !data ? (
          <div className="grid flex-1 place-items-center text-[2.4vmin] text-slate-400">Loading the board…</div>
        ) : (
          <div className={`mt-[2vmin] grid min-h-0 flex-1 gap-[2vmin] ${side ? 'grid-rows-[auto_1fr]' : 'grid-cols-[1.15fr_1fr]'}`}>
            {/* Podium */}
            <div className="flex min-h-0 flex-col">
              <div className="flex flex-1 items-end justify-center gap-[2vmin] pb-[1vmin]">
                {podium.map((r, i) => {
                  if (!r) return <div key={i} className="w-[22%]" />;
                  const place = r.rank - 1;
                  const h = place === 0 ? '24vmin' : place === 1 ? '17vmin' : '13vmin';
                  return (
                    <div key={r.id} className="flex w-[26%] flex-col items-center">
                      {place === 0 && <Crown className="mb-[0.6vmin] h-[4vmin] w-[4vmin] text-amber-300 drop-shadow" />}
                      <Photo name={r.name} url={r.photo} className={`rounded-full ring-[0.5vmin] ring-white/20 ${place === 0 ? 'h-[14vmin] w-[14vmin]' : 'h-[10.5vmin] w-[10.5vmin]'}`} />
                      <p className="mt-[1vmin] max-w-full truncate text-center text-[2.4vmin] font-bold">{r.name}</p>
                      <p className="max-w-full truncate text-center text-[1.5vmin] text-slate-400">{r.team}</p>
                      <p className="text-[2.6vmin] font-extrabold text-emerald-300">{money(r.month_aed, location)}</p>
                      <div style={{ height: h }} className={`mt-[1vmin] grid w-full place-items-start justify-center rounded-t-[1.2vmin] bg-gradient-to-b ${MEDAL[place]} pt-[1vmin] text-[4.5vmin] font-black text-black/70 shadow-2xl`}>{place + 1}</div>
                    </div>
                  );
                })}
              </div>
              {/* Teams */}
              <div className="mt-[1.5vmin] rounded-[1.6vmin] bg-white/5 p-[1.6vmin]">
                <p className="mb-[1vmin] flex items-center gap-[0.8vmin] text-[1.6vmin] font-semibold uppercase tracking-wider text-slate-300"><Users className="h-[2vmin] w-[2vmin]" />Teams</p>
                <div className="grid grid-cols-2 gap-[1vmin]">
                  {(data.teams || []).slice(0, 6).map((t, i) => (
                    <div key={t.id || t.team} className="flex items-center justify-between rounded-[1vmin] bg-white/5 px-[1.4vmin] py-[0.9vmin]">
                      <span className="truncate text-[1.9vmin] font-semibold">{i === 0 && <Trophy className="mr-[0.6vmin] inline h-[2vmin] w-[2vmin] text-amber-300" />}{t.team}</span>
                      <span className="text-[1.9vmin] font-bold text-emerald-300">{money(t.month_aed, location)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* The rest */}
            <div className="flex min-h-0 flex-col rounded-[1.6vmin] bg-white/5 p-[1.4vmin]">
              <div className="grid grid-cols-[6vmin_1fr_auto_auto] gap-[1.4vmin] px-[1vmin] pb-[0.8vmin] text-[1.4vmin] uppercase tracking-wider text-slate-400">
                <span>#</span><span>CS</span><span className="text-right">Today</span><span className="w-[16vmin] text-right">This month</span>
              </div>
              <div className="min-h-0 flex-1 space-y-[0.7vmin] overflow-hidden">
                {[...top, ...rest].map(r => (
                  <div key={r.id} className={`grid grid-cols-[6vmin_1fr_auto_auto] items-center gap-[1.4vmin] rounded-[1vmin] px-[1vmin] py-[0.7vmin] ${r.rank <= 3 ? 'bg-white/10' : 'bg-white/[0.03]'}`}>
                    <span className="text-[2.2vmin] font-black text-slate-300">{r.rank}</span>
                    <span className="flex min-w-0 items-center gap-[1vmin]">
                      <Photo name={r.name} url={r.photo} className="h-[4.2vmin] w-[4.2vmin] shrink-0 rounded-full" />
                      <span className="min-w-0"><span className="block truncate text-[2vmin] font-semibold">{r.name}</span><span className="block truncate text-[1.3vmin] text-slate-400">{r.team} · {r.payments} payment{r.payments === 1 ? '' : 's'}</span></span>
                    </span>
                    <span className={`text-right text-[1.8vmin] font-semibold ${r.today_aed > 0 ? 'text-amber-300' : 'text-slate-500'}`}>{r.today_aed > 0 ? money(r.today_aed, location) : '—'}</span>
                    <span className="w-[16vmin] text-right text-[2.1vmin] font-extrabold text-emerald-300">{money(r.month_aed, location)}</span>
                  </div>
                ))}
                {!cs.length && <p className="py-[4vmin] text-center text-[2vmin] text-slate-400">No CSs on this board yet.</p>}
              </div>
            </div>
          </div>
        )}

        {error && data && <p className="mt-[0.8vmin] text-center text-[1.3vmin] text-rose-300">Couldn't refresh — showing the last board. ({error})</p>}

        {/* A new approved payment */}
        {pop && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/50">
            <div className="animate-in zoom-in-90 rounded-[3vmin] bg-gradient-to-br from-emerald-400 to-teal-600 px-[6vmin] py-[4vmin] text-center shadow-2xl">
              <p className="text-[2.2vmin] font-semibold uppercase tracking-[0.3em] text-emerald-950/80">🎉 Payment collected</p>
              <p className="mt-[1vmin] text-[7vmin] font-black leading-none">{money(pop.aed, location)}</p>
              <p className="mt-[1.5vmin] text-[3.6vmin] font-extrabold">{pop.cs}</p>
              <p className="text-[2vmin] text-emerald-950/80">{[pop.team, pop.product].filter(Boolean).join(' · ')}</p>
            </div>
          </div>
        )}
      </div>

      {/* Controls — outside the turned frame, so they stay where a hand can reach */}
      <div className={`fixed right-3 top-3 z-50 flex gap-2 transition-opacity ${controls ? 'opacity-100' : 'opacity-0'}`}>
        <button type="button" onClick={turn} className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-2 text-sm font-medium text-white backdrop-blur hover:bg-white/25" title="Turn the screen (R)">
          <RotateCw className="h-4 w-4" />{rotate}°
        </button>
        <button type="button" onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})} className="rounded-full bg-white/15 p-2 text-white backdrop-blur hover:bg-white/25" title="Full screen">
          <Maximize className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
