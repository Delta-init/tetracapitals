import { useSyncExternalStore } from "react";

/*
 * A closed sale, celebrated on the Sales TV (the user, 2026-10-20) — ported
 * from the Sales CRM web's lib/saleAnnouncement.ts (2026-10-15), the free way:
 * a sparkle made here with WebAudio and the browser's own voice
 * (speechSynthesis), so there are no audio files and nothing is paid for.
 * Between the two, the owner's own clip (public/sounds/sale-voice.m4a, 2026-10-28).
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
  if (typeof window === "undefined") return;
  preloadClip();
  if (!("speechSynthesis" in window)) return;
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

/**
 * Says it in the browser's own voice. Free: nothing leaves the device. Resolves "played" once it starts, "none" when
 * this browser has no voice to speak with (most TV browsers), "blocked" when it refused or never started.
 */
export function say(text) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve("none");
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
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    utterance.onstart = () => finish("played");
    utterance.onerror = () => finish(voices.length || bestVoice() ? "blocked" : "none");
    window.setTimeout(() => finish(voices.length || bestVoice() ? "blocked" : "none"), 4000);
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      finish("blocked");
    }
  });
}

export function stopVoice() {
  stops++;
  try { playing?.pause(); } catch { /* nothing playing */ }
  playing = null;
  try { source?.stop(); } catch { /* nothing playing */ }
  source = null;
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* no voice here */
  }
}

export function voiceBusy() {
  if (source) return true;
  if (playing && !playing.paused && !playing.ended) return true;
  if (speakingOwn) return true;
  try {
    return Boolean(window.speechSynthesis?.speaking);
  } catch {
    return false;
  }
}

// ── Our own voice (the user, 2026-10-26) ──────────────────────────────────────

/* Where a sale's line in the owner's own voice comes from (the page sets it, CsTv.jsx): first their own recordings, as
   a list to play one after another (GET /api/public/cs-tv/voice-plan — kept in R2, 2026-10-26), else one made line
   (GET /api/public/cs-tv/voice — ElevenLabs). Neither: the browser's voice, as before. */
let ownVoiceUrl = null;
let speakingOwn = false;
let ownPlanUrl = null;
let playing = null;
/** Counts stopVoice calls: a recording stopped mid-way doesn't go on to the next one. */
let stops = 0;
export function setOwnVoice(urlFor, planFor = null) {
  ownVoiceUrl = typeof urlFor === "function" ? urlFor : null;
  ownPlanUrl = typeof planFor === "function" ? planFor : null;
}

/*
 * Played through the same audio engine as the sparkle (2026-10-29: on the office TV only the sparkle was heard). A
 * plain <audio> started when a payment comes in needs a click of its own on most TV browsers and is refused without a
 * word; the engine, once the screen's sound is on, plays whatever it is given. So each file is fetched and decoded here
 * and played as a buffer — wherever the sparkle is heard, so are the clip and the line. The <audio> stays as the
 * fallback where the file can't be fetched from here (no CORS on it) or decoded.
 */
let source = null;
const decoded = new Map();

/** The file, fetched and decoded (kept for next time when `keep`); null when it can't be, or not within `ms`. */
function bufferFor(url, { keep = false, ms = 12_000 } = {}) {
  const ac = audio();
  if (!ac || typeof fetch === "undefined") return Promise.resolve(null);
  if (keep && decoded.has(url)) return decoded.get(url);
  const p = Promise.race([
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((bytes) => new Promise((ok, no) => ac.decodeAudioData(bytes, ok, no))),
    sleep(ms).then(() => null),
  ]).catch(() => null);
  if (keep) {
    decoded.set(url, p);
    void p.then((b) => { if (!b) decoded.delete(url); });
  }
  return p;
}

/** A decoded file through the engine. Resolves when it ended or was stopped; `onStart` when it begins. */
function playBuffer(ac, buf, onStart) {
  return new Promise((resolve) => {
    try {
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.connect(ac.destination);
      src.onended = () => { if (source === src) source = null; resolve(true); };
      source = src;
      src.start();
      onStart?.();
    } catch {
      resolve(false);
    }
  });
}

/** Through the engine, to its end. Null when the engine can't play it here (then the <audio> is tried). */
async function playThroughEngine(url, keep = false) {
  const ac = audio();
  if (!ac || ac.state !== "running") return null;
  const buf = await bufferFor(url, { keep });
  if (!buf) return null;
  return playBuffer(ac, buf);
}

/** One recording, played to its end. Resolves true when it played through, false when it couldn't. */
async function playOne(url, keep = false) {
  const at = stops;
  const viaEngine = await playThroughEngine(url, keep);
  if (viaEngine !== null || stops !== at) return Boolean(viaEngine);
  return playOneElement(url);
}

/** The same, as a plain <audio> (a browser where the engine couldn't have it). */
function playOneElement(url) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    try {
      const a = new Audio(url);
      a.preload = "auto";
      a.addEventListener("ended", () => finish(true), { once: true });
      a.addEventListener("error", () => finish(false), { once: true });
      // Stopped (the pop-up went): done at once, not at the 30 s guard.
      a.addEventListener("pause", () => finish(a.ended), { once: true });
      window.setTimeout(() => { if (!done) { a.pause(); finish(false); } }, 30_000);
      playing = a;
      a.play().catch(() => finish(false));
    } catch {
      finish(false);
    }
  });
}

/** The owner's own recordings for the sale, one after another with a breath between. True when the first played. */
async function playRecorded(sale) {
  if (!ownPlanUrl || typeof Audio === "undefined") return false;
  const at = stops;
  let urls = [];
  try {
    const res = await fetch(ownPlanUrl(sale), { cache: "no-store" });
    if (res.ok) urls = (await res.json())?.urls ?? [];
  } catch {
    return false;
  }
  if (stops !== at) return true;
  if (!urls.length) return false;
  for (const [i, url] of urls.entries()) {
    if (i) await sleep(220);
    if (stops !== at) return true;
    const ok = await playOne(url);
    if (stops !== at) return true;
    if (!ok && i === 0) return false;
  }
  return true;
}

/** Plays the sale's line in the own voice. Resolves true when it played, false to fall back to the browser's. */
async function playOwnVoice(sale) {
  const at = stops;
  if (await playRecorded(sale)) return true;
  if (stops !== at) return true;
  return playMade(sale);
}

async function playMade(sale) {
  if (!ownVoiceUrl) return false;
  // Through the engine first (made on demand the first time: up to 12 s); resolves once it starts, as before.
  const ac = audio();
  if (ac && ac.state === "running") {
    const at = stops;
    const buf = await bufferFor(ownVoiceUrl(sale));
    if (stops !== at) return true;
    if (buf) return new Promise((resolve) => { void playBuffer(ac, buf, () => resolve(true)).then((ok) => { if (!ok) resolve(false); }); });
  }
  return playMadeElement(sale);
}

function playMadeElement(sale) {
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

// ── The owner's clip (the user, 2026-10-28) ──────────────────────────────────

/** Played after the sparkle, before the line, on every pop-up. */
const SALE_CLIP = "/sounds/sale-voice.m4a";

/** Fetched while the board loads, so the first payment doesn't wait for it. */
function preloadClip() {
  void bufferFor(SALE_CLIP, { keep: true });
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

// ── What was heard (the Test pop-up's sound check, 2026-10-29) ───────────────

const reports = new Map();
const REPORTED = "portal:cs-tv-report";
function report(id, part, result) {
  const was = reports.get(id) ?? { music: "pending", clip: "pending", voice: "pending" };
  reports.set(id, { ...was, [part]: result });
  window.dispatchEvent(new Event(REPORTED));
}

/** What a payment's pop-up got to play on this screen ({ music, clip, voice }: pending/played/blocked/none), kept current. */
export function useSoundReport(id) {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(REPORTED, cb);
      return () => window.removeEventListener(REPORTED, cb);
    },
    () => (id ? reports.get(id) ?? null : null),
    () => null,
  );
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
    const wait = playSparkle();
    report(sale.id, "music", wait > 0 && soundUnlocked() ? "played" : "blocked");
    voiceTimer = window.setTimeout(async () => {
      if (!allowed()) return;
      speakingOwn = true;
      try {
        // The owner's clip after the music (2026-10-28), then the line.
        report(sale.id, "clip", (await playOne(SALE_CLIP, true)) ? "played" : "blocked");
        if (!allowed()) return;
        // The owner's own voice when this server has it; else the browser's (2026-10-26).
        if (await playOwnVoice(sale)) { report(sale.id, "voice", "played"); return; }
      } finally {
        speakingOwn = false;
      }
      if (allowed()) report(sale.id, "voice", await say(spokenLine(sale)));
    }, wait);
  })();
  return () => {
    stopped = true;
    window.clearTimeout(voiceTimer);
    stopVoice();
  };
}
