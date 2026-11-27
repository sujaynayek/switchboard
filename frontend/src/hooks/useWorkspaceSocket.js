import { useEffect, useEffectEvent, useState } from 'react';

export function useWorkspaceSocket(workspace, cursors, { changed, verifySession, expire }) {
  const [connection, setConnection] = useState('connecting');
  const update = useEffectEvent(changed);
  const verify = useEffectEvent(verifySession);
  const sessionEnded = useEffectEvent(expire);

  useEffect(() => {
    let active = true;
    let socket;
    let reconnect;
    let handshake;
    let batch;
    let attempt = 0;
    const contacts = new Set();
    const abort = new AbortController();

    function flush() {
      window.clearTimeout(batch);
      batch = undefined;
      if (!active || !contacts.size) return;
      update(new Set(contacts));
      contacts.clear();
    }

    function schedule() {
      window.clearTimeout(reconnect);
      if (!active || !navigator.onLine) return;
      const delay = Math.min(12_000, 500 * 2 ** Math.min(attempt++, 5));
      reconnect = window.setTimeout(connect, delay);
    }

    function connect() {
      if (!active || !navigator.onLine || (socket && socket.readyState < WebSocket.CLOSING)) return;
      setConnection(attempt ? 'reconnecting' : 'connecting');
      const url = new URL('/ws', window.location.href);
      url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('workspace', workspace);
      url.searchParams.set('after', String(cursors.get(workspace) ?? 0));
      const connection = new WebSocket(url);
      socket = connection;
      handshake = window.setTimeout(() => connection.close(), 8000);

      connection.onopen = () => {
        if (!active || socket !== connection) return;
        window.clearTimeout(handshake);
        attempt = 0;
        setConnection('live');
        update(); // Refresh the HTTP snapshot after a reconnect even if no frames were missed.
      };
      connection.onmessage = ({ data }) => {
        if (!active || socket !== connection) return;
        try {
          const frame = JSON.parse(data);
          if (!Number.isSafeInteger(frame.seq) || frame.seq <= (cursors.get(workspace) ?? 0)) return;
          cursors.set(workspace, frame.seq);
          if (typeof frame.contact === 'string') contacts.add(frame.contact);
          batch ??= window.setTimeout(flush, 120);
        } catch {
          // A non-JSON frame cannot update the replay cursor.
        }
      };
      connection.onclose = ({ code }) => {
        if (!active || socket !== connection) return;
        window.clearTimeout(handshake);
        flush();
        socket = undefined;
        if (code === 1008) {
          sessionEnded();
          return;
        }
        setConnection(navigator.onLine ? 'reconnecting' : 'offline');
        if (navigator.onLine) void verify(abort.signal);
        schedule();
      };
    }

    function offline() {
      window.clearTimeout(reconnect);
      setConnection('offline');
      socket?.close();
    }

    function online() {
      window.clearTimeout(reconnect);
      attempt = 0;
      connect();
    }

    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    if (navigator.onLine) connect();
    else offline();

    return () => {
      active = false;
      abort.abort();
      window.clearTimeout(reconnect);
      window.clearTimeout(handshake);
      window.clearTimeout(batch);
      socket?.close();
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, [workspace, cursors]);

  return connection;
}
