import { useCallback, useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';

/* ────────────────────────────────────────────────────────────────────────────
   Notifications on this phone or computer (Web Push), as in the Sales CRM:
   public/push-sw.js shows them, backend/src/lib/notify.ts sends them.

   Once allowed, every visit saves this device for whoever is signed in — so a
   device the server forgot (expired, or the keys changed) comes back by itself,
   and a shared computer follows the person using it.
──────────────────────────────────────────────────────────────────────────── */

const call = async (name, body = {}) => (await base44.functions.invoke(name, body)).data;
const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** The server's public key as the browser wants it. */
function keyBytes(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function save(reg, publicKey) {
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const j = sub.toJSON();
  await call('savePushSubscription', { endpoint: j.endpoint, keys: j.keys });
}

export function usePushNotifications(currentUser) {
  const ios = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true);
  const [state, setState] = useState({ supported: supported(), enabled: false, permission: supported() ? Notification.permission : 'unsupported', on: false, busy: false });
  const reg = useRef(null);
  const publicKey = useRef('');

  useEffect(() => {
    if (!currentUser?.id || !supported()) return undefined;
    let alive = true;
    (async () => {
      try {
        const cfg = await call('getPushConfig');
        publicKey.current = cfg.publicKey || '';
        reg.current = await navigator.serviceWorker.register('/push-sw.js');
        let on = false;
        if (cfg.enabled && Notification.permission === 'granted') {
          await save(reg.current, publicKey.current);
          on = true;
        }
        if (alive) setState((s) => ({ ...s, enabled: !!cfg.enabled, permission: Notification.permission, on }));
      } catch {
        /* notifications are extra — the portal works without them */
      }
    })();
    return () => { alive = false; };
  }, [currentUser?.id]);

  const turnOn = useCallback(async () => {
    setState((s) => ({ ...s, busy: true }));
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        if (!reg.current) reg.current = await navigator.serviceWorker.register('/push-sw.js');
        await save(reg.current, publicKey.current);
      }
      setState((s) => ({ ...s, permission, on: permission === 'granted', busy: false }));
    } catch (e) {
      setState((s) => ({ ...s, busy: false }));
      throw e;
    }
  }, []);

  const turnOff = useCallback(async () => {
    setState((s) => ({ ...s, busy: true }));
    try {
      const sub = await reg.current?.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await call('deletePushSubscription', { endpoint });
      }
    } finally {
      setState((s) => ({ ...s, on: false, busy: false }));
    }
  }, []);

  const test = useCallback(() => call('sendTestPush'), []);
  return { ...state, ios, standalone, turnOn, turnOff, test };
}

/** Before signing out: this device stops getting the person's notifications. */
export async function forgetThisDevice() {
  try {
    if (!supported()) return;
    const reg = await navigator.serviceWorker.getRegistration('/push-sw.js');
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await call('deletePushSubscription', { endpoint: sub.endpoint });
    await sub.unsubscribe();
  } catch {
    /* signing out goes on regardless */
  }
}
