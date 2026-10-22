import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "framer-motion";
import { Trophy, Volume2, VolumeX, X } from "lucide-react";
import {
  announce,
  saleMoney,
  setSoundPref,
  useSoundPref,
  voiceBusy,
  warmUpVoices,
} from "./saleAnnouncement";

/*
 * Every close, celebrated on the Sales TV (the user, 2026-10-20) — ported from
 * the Sales CRM web's components/shared/SaleCelebration.tsx, in the board's warm,
 * flat theme (2026-10-20). In the middle of the screen with confetti:
 * who closed it, in which CRM, the course(s) and the amount — never the
 * student. A sparkle plays and the browser's voice says the
 * same (lib/saleAnnouncement.ts). One at a time: closes that land together
 * wait their turn. Click, press Esc, or wait, and it goes.
 *
 * The board hands closes over with celebrate(); this listens. Rendered inside
 * the board (not a portal), so the board's colours apply.
 */

/** On screen at least this long, and until the voice has finished. */
const SHOW_MS = 8000;
/** Never longer than this, even mid-sentence. */
const MAX_MS = 15_000;
/** Closes arriving together beyond this many are not queued. */
const WAITING_MAX = 8;
const SALE_EVENT = "portal:cs-tv-payment";

/** Shows (and says) a close on this screen. */
export function celebrate(sale) {
  window.dispatchEvent(new CustomEvent(SALE_EVENT, { detail: sale }));
}

export function SaleCelebration() {
  const [current, setCurrent] = useState(null);
  const shown = useRef(null);
  const waiting = useRef([]);
  const busy = useRef(false);
  const seen = useRef(new Map());

  const showNext = useCallback(() => {
    const next = waiting.current.shift() ?? null;
    busy.current = next !== null;
    shown.current = next;
    setCurrent(next);
  }, []);

  const close = useCallback(() => {
    if (!shown.current) return;
    shown.current = null;
    setCurrent(null);
    window.setTimeout(showNext, 450);
  }, [showNext]);

  const receive = useCallback(
    (sale) => {
      const now = Date.now();
      seen.current.forEach((at, id) => {
        if (now - at > 30 * 60_000) seen.current.delete(id);
      });
      if (seen.current.has(sale.id)) return;
      seen.current.set(sale.id, now);
      if (waiting.current.length >= WAITING_MAX) return;
      waiting.current.push(sale);
      if (!busy.current) showNext();
    },
    [showNext],
  );

  useEffect(() => {
    warmUpVoices();
    const on = (e) => receive(e.detail);
    window.addEventListener(SALE_EVENT, on);
    return () => window.removeEventListener(SALE_EVENT, on);
  }, [receive]);

  // The sparkle and the voice, stopped when it leaves the screen.
  useEffect(() => (current ? announce(current) : undefined), [current]);

  // Away on its own: after SHOW_MS, once the voice is done, and by MAX_MS at the latest.
  useEffect(() => {
    if (!current) return;
    const shownAt = Date.now();
    let timer = 0;
    const check = () => {
      const age = Date.now() - shownAt;
      if (age < MAX_MS && (age < SHOW_MS || voiceBusy())) timer = window.setTimeout(check, 400);
      else close();
    };
    timer = window.setTimeout(check, SHOW_MS);
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [current, close]);

  return <AnimatePresence>{current && <Celebration key={current.id} sale={current} onClose={close} />}</AnimatePresence>;
}

// ── The pop-up ────────────────────────────────────────────────────────────────

/** In the board's warm theme, solid colours: a gold trophy, the closer, the CRM, the course(s), the amount. No gradients. */
function Celebration({ sale, onClose }) {
  const still = useReducedMotion();
  const present = useIsPresent();
  const soundOn = useSoundPref() !== "off";
  const money = saleMoney(sale);
  const closer = sale.closer || "The team";
  const tone = sale.tone || "#ff6b1a";

  return (
    <motion.div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
      style={{ pointerEvents: present ? "auto" : "none" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
      role="status"
      aria-live="polite"
      data-testid="sale-celebration"
    >
      <div className="absolute inset-0 bg-black/80" />

      <motion.div
        className="relative w-full max-w-[min(44rem,94vw)] overflow-hidden rounded-[1.75rem] border border-[color:var(--step-edge)] bg-[color:var(--panel)] px-[clamp(1.25rem,2.2vw,2.75rem)] pb-8 pt-7 text-center text-[color:var(--ink)]"
        initial={still ? { opacity: 0 } : { opacity: 0, y: 40 }}
        animate={still ? { opacity: 1 } : { opacity: 1, y: 0 }}
        exit={still ? { opacity: 0 } : { opacity: 0, y: 20, transition: { duration: 0.2 } }}
        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-full p-1.5 text-[color:var(--mute)] hover:bg-[color:var(--head)] hover:text-[color:var(--ink)]"
        >
          <X className="h-5 w-5" />
        </button>

        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl" style={{ background: "var(--gold)", color: "var(--gold-on)" }}>
          <Trophy className="h-8 w-8" />
        </span>

        <p className="mt-4 text-sm font-semibold uppercase tracking-[0.3em] text-[color:var(--accent)]">Payment collected</p>
        {sale.crmName && (
          <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] px-3 py-0.5 text-sm font-medium text-[color:var(--ink2)]">
            <span className="h-2 w-2 rounded-full" style={{ background: tone }} /> {sale.crmName}
          </p>
        )}
        <p className="mt-3 line-clamp-2 break-words text-[clamp(2.2rem,3.6vw,4rem)] font-bold leading-[1.05]">{closer}</p>

        {sale.courses.length > 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {sale.courses.map((c) => (
              <span key={c} className="rounded-full bg-[color:var(--head)] px-4 py-1.5 text-[clamp(0.95rem,1.15vw,1.35rem)] font-medium text-[color:var(--ink2)]">
                {c}
              </span>
            ))}
          </div>
        )}

        {money && (
          <motion.div
            className="mx-auto mt-6 max-w-sm border-t border-[color:var(--line)] pt-5"
            initial={still ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={still ? { opacity: 1 } : { opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <p className="num text-[clamp(2.8rem,4.6vw,5rem)] font-extrabold leading-none text-[color:var(--money)]">{money.shown}</p>
            <p className="mt-1 text-sm text-[color:var(--mute)]">Amount</p>
          </motion.div>
        )}

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-[color:var(--mute)]">
          <button
            type="button"
            onClick={() => setSoundPref(soundOn ? "off" : "on")}
            className="flex items-center gap-1.5 rounded-full border border-[color:var(--line)] px-3 py-1 hover:text-[color:var(--ink)]"
          >
            {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            {soundOn ? "Mute this screen" : "Muted: turn sound on"}
          </button>
          {sale.test && <span className="rounded-full bg-[color:var(--head)] px-2.5 py-1">Test</span>}
        </div>

        <motion.div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1 origin-left"
          style={{ background: "var(--accent)" }}
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: SHOW_MS / 1000, ease: "linear" }}
        />
      </motion.div>

      {!still && <Glitter />}
    </motion.div>
  );
}

// ── The glitter ───────────────────────────────────────────────────────────────

const GLITTER = ["#FFC861", "#ECD27C", "#FF6B1A", "#FFFFFF", "#E0A96D", "#F5A524"];


/** A burst out of the middle, glitter raining down, and stars twinkling around the card, on one canvas over the screen. */
function Glitter() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const fit = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    window.addEventListener("resize", fit);

    const rnd = (a, b) => a + Math.random() * (b - a);
    const colour = () => GLITTER[Math.floor(Math.random() * GLITTER.length)];
    const bits = [];
    const add = (b) =>
      bits.push({ size: rnd(5, 10), color: colour(), angle: rnd(0, Math.PI * 2), spin: rnd(-0.2, 0.2), age: 0, ttl: rnd(2400, 4400), ...b });

    for (let i = 0; i < 120; i++) {
      const a = rnd(0, Math.PI * 2);
      const v = rnd(3, 13);
      add({ kind: i % 3 === 0 ? 1 : 0, x: w / 2, y: h / 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3 });
    }

    const start = performance.now();
    let last = start;
    let raf = 0;
    const frame = (now) => {
      const step = Math.min(50, now - last) / 16.7;
      last = now;
      const t = now - start;
      if (t < 3200) {
        for (let i = 0; i < 2; i++) add({ kind: Math.random() < 0.35 ? 1 : 0, x: rnd(0, w), y: -10, vx: rnd(-1, 1), vy: rnd(1.5, 3.5) });
      }
      if (t < 6500 && Math.random() < 0.5) {
        add({
          kind: 2, x: w / 2 + rnd(-280, 280), y: h / 2 + rnd(-240, 240), vx: 0, vy: 0,
          size: rnd(5, 13), ttl: rnd(500, 1100), color: Math.random() < 0.6 ? "#FFF7CC" : colour(),
        });
      }

      g.clearRect(0, 0, w, h);
      for (let i = bits.length - 1; i >= 0; i--) {
        const b = bits[i];
        b.age += step * 16.7;
        if (b.age > b.ttl || b.y > h + 30) {
          bits.splice(i, 1);
          continue;
        }
        const fade = Math.min(1, (b.ttl - b.age) / 500);
        if (b.kind === 2) {
          twinkle(g, b.x, b.y, b.size * Math.sin((b.age / b.ttl) * Math.PI), b.color, fade);
          continue;
        }
        b.vy = Math.min(b.vy + 0.12 * step, 6);
        b.vx *= Math.pow(0.985, step);
        b.x += (b.vx + Math.sin((b.age + b.size * 100) / 300) * 0.6) * step;
        b.y += b.vy * step;
        b.angle += b.spin * step;
        g.fillStyle = b.color;
        if (b.kind === 1) {
          // Catches the light now and then.
          g.globalAlpha = fade * (0.5 + 0.5 * Math.abs(Math.sin(b.age / 90)));
          g.beginPath();
          g.arc(b.x, b.y, b.size / 3.2, 0, Math.PI * 2);
          g.fill();
        } else {
          g.globalAlpha = fade;
          g.save();
          g.translate(b.x, b.y);
          g.rotate(b.angle);
          g.scale(1, Math.cos(b.age / 120 + b.size));
          g.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2);
          g.restore();
        }
      }
      g.globalAlpha = 1;
      if (t < 9000 || bits.length) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}

/** A four-pointed star, flat. */
function twinkle(g, x, y, r, color, alpha) {
  if (r <= 0) return;
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.quadraticCurveTo(x, y, x, y + r);
  g.quadraticCurveTo(x, y, x - r, y);
  g.quadraticCurveTo(x, y, x, y - r);
  g.fill();
  g.restore();
}
