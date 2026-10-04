/* ────────────────────────────────────────────────────────────────────────────
   Browser notifications while the portal is open — a desktop pop-up and a
   short tone, as the media ERP and the Sales CRM do: a new bell notice (a new
   student, the day's follow-ups) or a new WhatsApp message. Needs nothing on
   the server.

   With push on for this device (usePushNotifications) the service worker
   shows them instead — also when the portal is closed — so they never double.
   Each thing pops up once, also across tabs and reloads.
──────────────────────────────────────────────────────────────────────────── */

const PREF = 'notify:desktop';      // the person's own switch, besides the browser's permission
const SEEN = 'notify:seen';
const SEEN_TTL = 2 * 24 * 60 * 60 * 1000;

export const alertsSupported = () => typeof window !== 'undefined' && 'Notification' in window;
export const alertsPermission = () => (alertsSupported() ? Notification.permission : 'unsupported');
const pref = () => { try { return localStorage.getItem(PREF); } catch { return null; } };
export const alertsOn = () => alertsSupported() && Notification.permission === 'granted' && pref() !== 'off';
export const setAlertsOn = (on) => { try { localStorage.setItem(PREF, on ? 'on' : 'off'); } catch { /* not kept */ } };

let pushActive = false;
/** Push is on for this device: the service worker shows the notices, not this tab. */
export const setPushActive = (on) => { pushActive = !!on; };

/** Has this already popped up (here or in another tab)? Marks it as shown either way. */
export function markSeen(key) {
  try {
    const now = Date.now();
    const all = JSON.parse(localStorage.getItem(SEEN) || '{}');
    for (const k of Object.keys(all)) if (now - all[k] > SEEN_TTL) delete all[k];
    const had = key in all;
    all[key] = now;
    localStorage.setItem(SEEN, JSON.stringify(all));
    return had;
  } catch {
    return false;
  }
}

let audio = null;
const context = () => (audio = audio || new (window.AudioContext || window.webkitAudioContext)());

/* The bell's ring (the user, 2026-10-04): a short chime for every new notice and WhatsApp message while the portal
   is open — whatever the pop-up and push settings — once per thing across tabs, and one ring for a burst. Off per
   device from the bell's menu. Browsers keep a page quiet until it has been clicked, so the sound wakes on the first
   click or key press. */
const SOUND = 'notify:sound';
const RUNG = 'notify:rung';
const BURST_MS = 4000;
let lastRing = 0;

export const soundOn = () => { try { return localStorage.getItem(SOUND) !== 'off'; } catch { return true; } };
export const setSoundOn = (on) => { try { localStorage.setItem(SOUND, on ? 'on' : 'off'); } catch { /* not kept */ } };

if (typeof window !== 'undefined') {
  const wake = () => { try { const a = context(); if (a.state === 'suspended') a.resume().catch(() => {}); } catch { /* no audio */ } };
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, wake, { once: true, capture: true, passive: true });
}

/** Has this rung already (here or in another tab)? Marks it as rung either way. */
export function markRung(key) {
  try {
    const now = Date.now();
    const all = JSON.parse(localStorage.getItem(RUNG) || '{}');
    for (const k of Object.keys(all)) if (now - all[k] > SEEN_TTL) delete all[k];
    const had = key in all;
    all[key] = now;
    localStorage.setItem(RUNG, JSON.stringify(all));
    return had;
  } catch {
    return false;
  }
}

/** A small bell, struck twice: each strike a tone and two overtones, fading out. */
function chime() {
  try {
    const a = context();
    if (a.state === 'suspended') a.resume().catch(() => {});
    const t0 = a.currentTime;
    for (const [at, freq] of [[0, 1318.5], [0.2, 1046.5]]) {
      for (const [mult, vol] of [[1, 0.18], [2.76, 0.05], [5.4, 0.02]]) {
        const osc = a.createOscillator(), gain = a.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * mult, t0 + at);
        gain.gain.setValueAtTime(0.0001, t0 + at);
        gain.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 1.1);
        osc.connect(gain).connect(a.destination);
        osc.start(t0 + at);
        osc.stop(t0 + at + 1.15);
      }
    }
  } catch { /* no sound (the page was never clicked yet, or no audio) */ }
}

/** Ring for `key` — once (here or in another tab), and once for a burst; true when it rang. */
export function ringBell(key) {
  if (!soundOn() || (key && markRung(key))) return false;
  const now = Date.now();
  if (now - lastRing < BURST_MS) return false;
  lastRing = now;
  chime();
  return true;
}

/** A desktop notification, once per `key` (the bell rings on its own — ringBell). A click brings the portal forward and runs onClick. */
export function showAlert({ key, title, body = '', tag, url = '/', onClick }) {
  if (markSeen(key) || pushActive || !alertsOn()) return;
  const options = { body, icon: '/icon-192.png', badge: '/icon-192.png', tag: tag || key };
  try {
    const n = new Notification(title, options);
    n.onclick = () => { window.focus(); n.close(); onClick?.(); };
  } catch {
    // Phones (Android Chrome) only show them through the service worker; a tap there opens `url`.
    navigator.serviceWorker?.getRegistration('/push-sw.js')
      .then((reg) => reg?.showNotification(title, { ...options, data: { url } }))
      .catch(() => {});
  }
}
