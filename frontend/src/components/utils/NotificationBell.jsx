import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Bell } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';

export default function NotificationBell({ currentUser }) {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const fetchNotifications = async () => {
    if (!currentUser?.id) return;
    try {
      const all = await base44.entities.Notification.filter({ user_id: currentUser.id, read: false }, '-created_date', 20);
      setNotifications(all || []);
    } catch (_) {}
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [currentUser?.id]);

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
      </PopoverContent>
    </Popover>
  );
}