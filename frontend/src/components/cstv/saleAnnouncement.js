import { useSyncExternalStore } from "react";

/*
 * A closed sale, celebrated on the Sales TV (the user, 2026-10-20) — ported
 * from the Sales CRM web's lib/saleAnnouncement.ts (2026-10-15), the free way:
 * a sparkle made here with WebAudio and the browser's own voice
 * (speechSynthesis), so there are no audio files and nothing is paid for.
 *
 * Differences from the CRM's: it says which CRM the close is from and the
 * amount in the close's own currency, and never a student's name — this is a
 * screen on an office wall. And browsers keep a page silent until somebody
 * clicks it, which a TV nobody touches never does, so the page asks for that
 * click once (unlockSound) and remembers that sound is wanted.
 *
 * The sound and voice can be muted per device; the pop-up always shows. With
 * the board open in several tabs of one browser only one of them speaks.
 */


// ── What it says ──────────────────────────────────────────────────────────────

const CURRENCY_WORDS = {
  USD: "dollars", INR: "rupees", AED: "dirhams", EUR: "euros", GBP: "pounds", SAR: "riyals",
};

/** The amount as the screen shows it, and as the voice says it. Null when there is none. */
export function saleMoney(sale) {
  if (!(sale.amount > 0)) return null;
  // Grouped in thousands, which every English voice reads as a number.
  const plain = sale.amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return { shown: `${sale.currency} ${plain}`, spoken: `${plain} ${CURRENCY_WORDS[sale.currency] ?? sale.currency}` };
}

/** "A", "A and B", "A, B and C". */
function listed(items) {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "Sale closed by Abhin, in Draw! Forex Mastery, for 5,500 dirhams. Congratulations!" */
export function spokenLine(sale) {
  const money = saleMoney(sale);
  const courses = listed(sale.courses);
  const where = sale.crmName ? `, in ${sale.crmName}` : "";
  let line = sale.closer ? `Payment collected by ${sale.closer}${where}! ` : `Payment collected${where}! `;
  line += courses ? `${courses}` : "A course payment";
  if (money) line += `, for ${money.spoken}`;
  return `${line}. Congratulations!`;
}

// ── Sound wanted or muted, per device ─────────────────────────────────────────

const SOUND_KEY = "portal_cs_tv_sound"; // "on" | "off" | nothing (not asked yet)
const SOUND_CHANGED = "portal:cs-tv-sound";
/** For a browser that keeps nothing (a private window). */
let prefHere = null;


export function soundPref() {
  try {
    const v = localStorage.getItem(SOUND_KEY);
    return v === "on" || v === "off" ? v : null;
  } catch {
    return prefHere;
  }
}

export function setSoundPref(pref) {
  prefHere = pref;
  try {
    localStorage.setItem(SOUND_KEY, pref);
  } catch {
    /* kept for this tab only */
  }
  if (pref === "off") stopVoice();
  window.dispatchEvent(new Event(SOUND_CHANGED));
}

export const saleSoundOn = () => soundPref() !== "off";

function onSoundChange(cb) {
  const fromOtherTab = (e) => {
    if (e.key === SOUND_KEY || e.key === null) cb();
  };
  window.addEventListener(SOUND_CHANGED, cb);
  window.addEventListener("storage", fromOtherTab);
  return () => {
    window.removeEventListener(SOUND_CHANGED, cb);
    window.removeEventListener("storage", fromOtherTab);
  };
}

/** The device's choice, kept current. */
export function useSoundPref() {
  return useSyncExternalStore(onSoundChange, soundPref, () => null);
}

// ── The sparkle ───────────────────────────────────────────────────────────────

let ctx = null;
const UNLOCKED = "portal:cs-tv-unlocked";

function audio() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      ctx.addEventListener?.("statechange", () => window.dispatchEvent(new Event(UNLOCKED)));
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

/** Whether this page may make a sound now (the browser has had its click). */
export function soundUnlocked() {
  return audio()?.state === "running";
}

/** Whether the page may make a sound, kept current. */
export function useSoundUnlocked() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(UNLOCKED, cb);
      return () => window.removeEventListener(UNLOCKED, cb);
    },
    () => ctx?.state === "running",
    () => false,
  );
}

/**
 * Called from a click: starts the sound and primes the voice, so a close that
 * comes later can be heard. Browsers allow both only inside a user gesture.
 */
export function unlockSound() {
  const ac = audio();
  if (ac) {
    // A silent blip, which is what actually lets the context run on some browsers.
    try {
      const buf = ac.createBuffer(1, 1, 22050);
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.connect(ac.destination);
      src.start(0);
    } catch {
      /* fine */
    }
  }
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis?.speak(u);
  } catch {
    /* no voice here */
  }
  window.dispatchEvent(new Event(UNLOCKED));
}

// Any click or key on the page also starts the sound, once.
if (typeof window !== "undefined") {
  const wake = () => {
    unlockSound();
    window.removeEventListener("pointerdown", wake, true);
    window.removeEventListener("keydown", wake, true);
  };
  window.addEventListener("pointerdown", wake, true);
  window.addEventListener("keydown", wake, true);
}

/** A glassy "ting": a sine with two quiet overtones, struck and left to ring. */
function ting(ac, out, freq, at, level, ring) {
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(level, at + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, at + ring);
  env.connect(out);
  for (const [mult, part] of [[1, 1], [2.76, 0.22], [5.4, 0.07]]) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = freq * mult;
    gain.gain.value = part;
    osc.connect(gain).connect(env);
    osc.start(at);
    osc.stop(at + ring + 0.05);
  }
}

/**
 * The glitter sound: a quick harp-like run up a pentatonic scale, then a
 * scatter of high twinkles, with a short echo for shimmer. Returns how long to
 * wait before the voice, in ms (0 when this browser has no sound).
 */
export function playSparkle() {
  const ac = audio();
  if (!ac) return 0;
  const t0 = ac.currentTime + 0.03;
  const master = ac.createDynamicsCompressor();
  master.connect(ac.destination);
  const out = ac.createGain();
  out.gain.value = 0.9;
  out.connect(master);
  const echo = ac.createDelay(0.5);
  echo.delayTime.value = 0.11;
  const feedback = ac.createGain();
  feedback.gain.value = 0.32;
  const wet = ac.createGain();
  wet.gain.value = 0.3;
  out.connect(echo);
  echo.connect(feedback).connect(echo);
  echo.connect(wet).connect(master);

  const run = [1046.5, 1174.66, 1318.51, 1567.98, 1760, 2093, 2349.32, 2637.02, 3135.96, 3520, 4186.01];
  run.forEach((f, i) => ting(ac, out, f, t0 + i * 0.042, 0.2, 0.5));
  const top = [2093, 2637.02, 3135.96, 3520, 4186.01, 5274.04];
  for (let i = 0; i < 10; i++) {
    const f = top[Math.floor(Math.random() * top.length)];
    ting(ac, out, f, t0 + 0.42 + i * 0.075 + Math.random() * 0.03, 0.09 + Math.random() * 0.05, 0.35);
  }
  window.setTimeout(() => {
    for (const node of [out, echo, feedback, wet, master]) node.disconnect();
  }, 3000);
  return 1100;
}

// ── The voice ─────────────────────────────────────────────────────────────────

let voices = [];

function loadVoices() {
  try {
    voices = window.speechSynthesis.getVoices();
  } catch {
    voices = [];
  }
}

/** Ask for the voices early: Chrome lists them a moment after the page loads. */
export function warmUpVoices() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  loadVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", loadVoices);
}

/** The joke and robot voices a Mac lists beside the real ones: never chosen. */
const NOVELTY =
  /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Eddy|Flo|Fred|Good News|Grandma|Grandpa|Hysterical|Jester|Junior|Kathy|Organ|Pipe Organ|Princess|Ralph|Reed|Rocko|Sandy|Shelley|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/i;

/** Voices by name, best first: Chrome's, then a Mac's own, then Windows' own. */
const NAMED = [
  "Google UK English Female", "Google US English", "Google UK English Male",
  "Samantha", "Ava", "Allison", "Susan", "Zoe", "Daniel", "Karen", "Moira", "Tessa", "Serena",
  "Microsoft Zira", "Microsoft David", "Microsoft Mark", "Microsoft Heera", "Microsoft Ravi",
];

const PREFERRED = [
  (v) => /^en[-_]IN/i.test(v.lang) && /natural/i.test(v.name),
  (v) => /natural/i.test(v.name),
  (v) => /premium|enhanced/i.test(v.name),
  ...NAMED.map((name) => (v) => v.name.startsWith(name)),
  (v) => /^en[-_]IN/i.test(v.lang),
  (v) => v.default,
  () => true,
];

function bestVoice() {
  if (!voices.length) loadVoices();
  const english = voices.filter((v) => /^en([-_]|$)/i.test(v.lang) && !NOVELTY.test(v.name));
  for (const test of PREFERRED) {
    const found = english.find(test);
    if (found) return found;
  }
  return null;
}

/** Says it in the browser's own voice. Free: nothing leaves the device. */
export function say(text) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = bestVoice();
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = "en-US";
  }
  utterance.rate = 0.98;
  utterance.pitch = 1.05;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
}

export function stopVoice() {
  try { playing?.pause(); } catch { /* nothing playing */ }
  playing = null;
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* no voice here */
  }
}

export function voiceBusy() {
  if (playing && !playing.paused && !playing.ended) return true;
  try {
    return Boolean(window.speechSynthesis?.speaking);
  } catch {
    return false;
  }
}

// ── Our own voice (the user, 2026-10-26) ──────────────────────────────────────

/* Where a sale's line in the owner's own voice is made (the page sets it: CsTv.jsx → GET /api/public/cs-tv/voice).
   Not set, or not answering: the browser's voice, as before. */
let ownVoiceUrl = null;
let playing = null;
export function setOwnVoice(urlFor) {
  ownVoiceUrl = typeof urlFor === "function" ? urlFor : null;
}

/** Plays the sale's line in the own voice. Resolves true when it played, false to fall back to the browser's. */
function playOwnVoice(sale) {
  if (!ownVoiceUrl || typeof Audio === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    try {
      const a = new Audio(ownVoiceUrl(sale));
      a.preload = "auto";
      a.addEventListener("error", () => finish(false), { once: true });
      a.addEventListener("playing", () => finish(true), { once: true });
      // Made on demand the first time: wait up to 12 s for it, then the browser's voice.
      window.setTimeout(() => { if (!done) { a.pause(); finish(false); } }, 12_000);
      playing = a;
      a.play().catch(() => finish(false));
    } catch {
      finish(false);
    }
  });
}

// ── One tab says it ───────────────────────────────────────────────────────────

const SAID = "portal_cs_tv_said:";
const TAB = Math.random().toString(36).slice(2);
const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

/** With the board open in several tabs of one browser only one speaks, agreed through localStorage. */
async function claimToSay(id) {
  await sleep(document.visibilityState === "visible" ? Math.random() * 40 : 300 + Math.random() * 200);
  try {
    const key = SAID + id;
    if (localStorage.getItem(key)) return false;
    const mine = `${TAB}:${Date.now()}`;
    localStorage.setItem(key, mine);
    await sleep(60);
    const won = localStorage.getItem(key) === mine;
    forgetOldClaims();
    return won;
  } catch {
    return true;
  }
}

function forgetOldClaims() {
  const cutoff = Date.now() - 10 * 60_000;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key?.startsWith(SAID)) continue;
    const at = Number(localStorage.getItem(key)?.split(":")[1]);
    if (!(at > cutoff)) localStorage.removeItem(key);
  }
}

/** The sparkle, then the voice, for a sale on screen. Nothing when muted; a test always plays. Returns a stop. */
export function announce(sale) {
  let stopped = false;
  let voiceTimer;
  const allowed = () => !stopped && (sale.test || saleSoundOn());
  void (async () => {
    if (!allowed()) return;
    if (!sale.test && !(await claimToSay(sale.id))) return;
    if (!allowed()) return;
    voiceTimer = window.setTimeout(async () => {
      if (!allowed()) return;
      // The owner's own voice when this server has it; else the browser's (2026-10-26).
      if (await playOwnVoice(sale)) return;
      if (allowed()) say(spokenLine(sale));
    }, playSparkle());
  })();
  return () => {
    stopped = true;
    window.clearTimeout(voiceTimer);
    stopVoice();
  };
}
