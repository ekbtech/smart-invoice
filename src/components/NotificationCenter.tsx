import { useEffect, useState } from "react";
import { Bell, Check, X } from "lucide-react";
import { apiRequest } from "../lib/api";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

export default function NotificationCenter({ onClose }: { onClose: () => void }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  async function loadNotifications() {
    setLoading(true);
    setError("");
    try {
      setNotifications(await apiRequest<Notification[]>("/notifications?limit=30&offset=0"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load notifications.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadNotifications(); }, []);

  async function markRead(notification: Notification) {
    setBusyId(notification.id);
    setError("");
    try {
      await apiRequest(`/notifications/${notification.id}/read`, { method: "POST", body: "{}" });
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this notification.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="notification-center" aria-label="Notifications">
      <header><span><Bell size={15} /> Notifications</span><button className="icon-button" aria-label="Close notifications" onClick={onClose}><X size={15} /></button></header>
      {loading && <p className="notification-empty">Loading notifications…</p>}
      {error && <p className="security-error notification-error" role="alert">{error}</p>}
      {!loading && !error && notifications.length === 0 && <p className="notification-empty">You’re all caught up. New business alerts will appear here.</p>}
      <ul>
        {notifications.map((notification) => <li className={notification.readAt ? "notification-read" : "notification-unread"} key={notification.id}>
          <div><strong>{notification.title}</strong><p>{notification.body}</p><small>{new Date(notification.createdAt).toLocaleString()}</small></div>
          {!notification.readAt && <button className="icon-button" aria-label={`Mark ${notification.title} as read`} title="Mark as read" disabled={busyId === notification.id} onClick={() => void markRead(notification)}><Check size={14} /></button>}
        </li>)}
      </ul>
      <button className="notification-refresh" disabled={loading} onClick={() => void loadNotifications()}>Refresh</button>
    </section>
  );
}
