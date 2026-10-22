import { useCallback, useEffect, useState } from 'react';
import CsTvBoard from '@/components/cstv/CsTvBoard';

/* ────────────────────────────────────────────────────────────────────────────
   The CS TV board for the office screens (the user, 2026-10-22) — the Root
   portal's Sales TV, ported (components/cstv). Open, no sign-in and no secret
   (the user, 2026-10-22): /cs/dubai or /cs/bangalore.
   Turns 0 / 90 / 180 / 270° for a screen on its side (?rotate=, the header's
   button or the R key — remembered on that screen).
   backend functions/csTv.ts (GET /api/public/cs-tv).
──────────────────────────────────────────────────────────────────────────── */

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const ROT_KEY = 'cs_tv_rotate';

export default function CsTv() {
  const p = new URLSearchParams(window.location.search);
  // /cs/dubai or /cs/bangalore (the user, 2026-10-22); /tv/cs/<location> and ?location= still work.
  const fromPath = window.location.pathname.toLowerCase().split('/').filter(Boolean).find(x => x === 'dubai' || x === 'bangalore');
  const location = (fromPath || p.get('location')) === 'bangalore' ? 'bangalore' : 'dubai';
  const [rotate, setRotate] = useState(() => {
    const fromUrl = Number(p.get('rotate'));
    if (p.has('rotate') && [0, 90, 180, 270].includes(fromUrl)) return fromUrl;
    try { const v = Number(localStorage.getItem(ROT_KEY)); return [0, 90, 180, 270].includes(v) ? v : 0; } catch { return 0; }
  });

  useEffect(() => { document.title = `CS TV — ${location === 'bangalore' ? 'Bangalore' : 'Dubai'}`; }, [location]);

  const turn = useCallback(() => setRotate(r => {
    const next = (r + 90) % 360;
    try { localStorage.setItem(ROT_KEY, String(next)); } catch { /* not kept */ }
    return next;
  }), []);
  useEffect(() => {
    const key = (e) => { if (e.key === 'r' || e.key === 'R') turn(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [turn]);

  const fetcher = useCallback(async () => {
    const res = await fetch(`${API}/api/public/cs-tv?location=${location}`, { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || body?.message || `The board answered ${res.status}`);
    return body;
  }, [location]);

  const side = rotate % 180 !== 0;
  const frame = { position: 'fixed', top: '50%', left: '50%', width: side ? '100vh' : '100vw', height: side ? '100vw' : '100vh', transform: `translate(-50%, -50%) rotate(${rotate}deg)` };
  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: '#0f0a07' }}>
      <div style={frame}>
        <CsTvBoard fetcher={fetcher} location={location} rotate={rotate} onRotate={turn} />
      </div>
    </div>
  );
}
