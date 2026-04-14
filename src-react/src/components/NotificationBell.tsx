import { useState, useEffect, useRef } from 'react';
import { useAuth, useNotifications } from '../lib/hooks';
import { Bell, Check, CheckCheck } from 'lucide-react';

export function NotificationBell() {
  const { user } = useAuth();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!user) return null;

  const typeIcon: Record<string, string> = {
    assigned:  '📌',
    validated: '✅',
    rejected:  '❌',
    submitted: '📬',
  };

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  return (
    <div ref={ref} className="relative">
      <button
        className="btn-icon relative"
        onClick={() => setOpen(!open)}
        title="Notifications"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-[0.6rem] font-bold flex items-center justify-center"
            style={{ background: 'var(--danger)', color: '#fff' }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-80 rounded-xl overflow-hidden z-50"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>
          <div className="flex items-center justify-between px-4 py-2.5"
            style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
              Notifications {unreadCount > 0 && `(${unreadCount})`}
            </span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent)' }}>
                <CheckCheck size={12} /> Tout lire
              </button>
            )}
          </div>

          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <div className="py-6 text-center text-xs" style={{ color: 'var(--text-dim)' }}>
                Aucune notification
              </div>
            ) : (
              notifications.map(n => (
                <div key={n.id}
                  className="flex items-start gap-2.5 px-4 py-2.5 cursor-pointer transition-colors"
                  style={{
                    background: n.read ? 'transparent' : 'var(--accent-bg)',
                    borderBottom: '1px solid var(--bg-hover)',
                  }}
                  onClick={() => !n.read && markRead(n.id)}
                >
                  <span className="flex-shrink-0 text-sm mt-0.5">{typeIcon[n.type] || '🔔'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs leading-snug">{n.message}</div>
                    <div className="text-[0.68rem] mt-0.5" style={{ color: 'var(--text-dim)' }}>
                      {fmtDate(n.created_at)}
                    </div>
                  </div>
                  {!n.read && (
                    <button onClick={(e) => { e.stopPropagation(); markRead(n.id); }}
                      className="flex-shrink-0 btn-icon w-5 h-5" title="Marquer comme lu">
                      <Check size={10} style={{ color: 'var(--accent)' }} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
