"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  linkUrl: string | null;
  metadata: unknown;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

const POLL_INTERVAL_MS = 60_000; // 60s when tab is visible

/**
 * Polls /api/notifications every 60s when the tab is visible. Pauses when
 * the tab goes background (visibilitychange) to save on requests. Returns
 * the current list + unreadCount + helpers to mark as read.
 */
export function useNotifications() {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNow = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=20");
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  const startPolling = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setInterval(fetchNow, POLL_INTERVAL_MS);
  }, [fetchNow]);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    fetchNow();
    startPolling();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchNow();
        startPolling();
      } else {
        stopPolling();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stopPolling();
    };
  }, [fetchNow, startPolling, stopPolling]);

  const markRead = useCallback(
    async (id: string) => {
      // Optimistic update
      setItems((prev) =>
        prev.map((n) => (n.id === id && !n.read ? { ...n, read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
      try {
        await fetch(`/api/notifications/${id}`, { method: "PATCH" });
      } catch {
        // silent — background polling will correct any mismatch
      }
    },
    []
  );

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read-all" }),
      });
    } catch {
      // silent
    }
  }, []);

  return { items, unreadCount, loading, markRead, markAllRead, refresh: fetchNow };
}
