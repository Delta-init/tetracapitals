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
function tone() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audio.createOscillator(), gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audio.currentTime);
    osc.frequency.setValueAtTime(1175, audio.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.4);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.42);
  } catch { /* no sound (the page was never clicked yet, or no audio) */ }
}

/** A desktop notification and a tone, once per `key`. A click brings the portal forward and runs onClick. */
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
  tone();
}
