import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Bell, BellRing, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { usePushNotifications } from '@/components/utils/usePushNotifications';
import { alertsSupported, alertsPermission, alertsOn, setAlertsOn, setPushActive, markSeen, showAlert } from '@/components/utils/browserAlerts';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';

const WA_POLL_MS = 15000;

export default function NotificationBell({ currentUser, onWhatsAppUnread }) {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const device = usePushNotifications(currentUser);
  const [perm, setPerm] = useState(alertsPermission());
  const [alerts, setAlerts] = useState(alertsOn());
  const primed = useRef(false);

  // With push on, the service worker shows the notices; this tab does not pop them up again.
  useEffect(() => { setPushActive(device.on); }, [device.on]);

  const handleClick = async (notif) => {
    await base44.entities.Notification.update(notif.id, { read: true });
    setNotifications(prev => prev.filter(n => n.id !== notif.id));
    setOpen(false);
    if (notif.type?.startsWith('ticket_') && notif.reference_id) {
      navigate(`/Tickets?open=${notif.reference_id}`);
    } else if (notif.link) {
      navigate(notif.link);
    }
  };

  const fetchNotifications = async () => {
    if (!currentUser?.id) return;
    try {
      const all = (await base44.entities.Notification.filter({ user_id: currentUser.id, read: false }, '-created_date', 20)) || [];
      setNotifications(all);
      // A browser notification for each new one — the ones already there when the portal opened are just marked shown.
      for (const n of [...all].reverse()) {
        if (!primed.current) markSeen(`bell:${n.id}`);
        else showAlert({ key: `bell:${n.id}`, title: n.title, body: n.message, tag: n.type, url: n.link || '/', onClick: () => handleClick(n) });
      }
      primed.current = true;
    } catch (_) {}
  };

  useEffect(() => {
    primed.current = false;
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [currentUser?.id]);

  // A CS's own WhatsApp: new messages pop up, and the menu shows that some are unread.
  useEffect(() => {
    if (currentUser?.app_role !== 'cs') return undefined;
    let since = null, alive = true;
    const tick = async () => {
      try {
        const d = (await base44.functions.invoke('getWhatsAppUnread', { since })).data;
        if (!alive) return;
        onWhatsAppUnread?.(d.unread || 0);
        for (const m of [...(d.messages || [])].reverse()) {
          const url = `/WhatsApp?chat=${encodeURIComponent(m.chat)}`;
          showAlert({ key: `wa:${m.id}`, title: `WhatsApp · ${m.name}`, body: m.body, tag: `wa-${m.chat}`, url, onClick: () => navigate(url) });
        }
        since = d.now;
      } catch (_) { /* WhatsApp is optional */ }
    };
    tick();
    const t = setInterval(tick, WA_POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [currentUser?.id, currentUser?.app_role]);

  // From public/push-sw.js: a push arrived (refresh now), or one was tapped (open what it is about).
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const onMessage = (e) => {
      if (e.data?.type === 'PUSH') fetchNotifications();
      if (e.data?.type === 'NAVIGATE' && e.data.url) navigate(e.data.url);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [currentUser?.id]);

  const run = async (fn, done) => {
    try { await fn(); if (done) toast.success(done); } catch (e) { toast.error(e?.message || 'Could not change notifications'); }
  };
  const pushReady = device.supported && device.enabled;
  // On: browser notifications while the portal is open, and push for when it is closed where the server has it.
  const turnOn = () => run(async () => {
    setAlertsOn(true);
    if (pushReady) await device.turnOn();
    else await Notification.requestPermission();
    setPerm(alertsPermission());
    setAlerts(alertsOn());
  });
  const turnOff = () => run(async () => {
    if (device.on) await device.turnOff();
    setAlertsOn(false);
    setAlerts(false);
  }, 'Notifications off for this device');

  const markAllRead = async () => {
    await Promise.all(notifications.map(n => base44.entities.Notification.update(n.id, { read: true })));
    setNotifications([]);
    setOpen(false);
  };

  const count = notifications.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5 text-gray-600" />
          {count > 0 && (
            <span className="absolute -top-1 -right-1 h-5 w-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center font-bold">
              {count > 9 ? '9+' : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 shadow-xl" align="end">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="font-semibold text-gray-800 text-sm">Notifications</h3>
          {count > 0 && (
            <button onClick={markAllRead} className="text-xs text-blue-600 hover:underline">Mark all read</button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
          {notifications.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-6">No unread notifications</p>
          ) : notifications.slice(0, 10).map(notif => (
            <button
              key={notif.id}
              onClick={() => handleClick(notif)}
              className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors"
            >
              <p className="text-sm font-medium text-gray-800 truncate">{notif.title}</p>
              <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{notif.message}</p>
              {notif.created_date && (
                <p className="text-xs text-gray-400 mt-1">
                  {formatDistanceToNow(new Date(notif.created_date), { addSuffix: true })}
                </p>
              )}
            </button>
          ))}
        </div>
        {/* Notifications on this phone or computer */}
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-600">
          {!alertsSupported() ? (
            device.ios && !device.standalone
              ? <p>On iPhone: tap Share → <strong>Add to Home Screen</strong>, open the portal from there, and turn notifications on.</p>
              : <p>This browser cannot show notifications.</p>
          ) : perm === 'denied' ? (
            <p>Notifications are blocked for this site — allow them in the browser's site settings.</p>
          ) : perm !== 'granted' || !alerts ? (
            <div className="space-y-2">
              <p>New students, today's follow-ups and WhatsApp messages as notifications on this device{pushReady ? ', even when the portal is closed' : ''}.</p>
              <Button size="sm" className="w-full" disabled={device.busy} onClick={turnOn}>
                {device.busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <BellRing className="mr-1 h-4 w-4" />}Turn on notifications
              </Button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-emerald-700">
                  <BellRing className="h-3.5 w-3.5" />{device.on ? 'On — also when the portal is closed' : 'On while the portal is open'}
                </span>
                <span className="flex gap-3">
                  {device.on && <button className="text-blue-600 hover:underline" onClick={() => run(device.test, 'Test sent — it should pop up in a moment')}>Test</button>}
                  <button className="text-gray-500 hover:underline" disabled={device.busy} onClick={turnOff}>Turn off</button>
                </span>
              </div>
              {!device.on && pushReady && (
                <button className="text-blue-600 hover:underline" disabled={device.busy} onClick={turnOn}>Also when the portal is closed</button>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
