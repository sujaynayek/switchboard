import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket, WebSocketServer } from 'ws';
import { acceptsOrigin } from '../middleware/session.js';
import { latestSequence, readEvents } from '../services/event-stream.js';
import { getSession, readCookie, sessionCookie, workspaceRole } from '../services/sessions.js';

function reject(socket, status) {
  if (!socket.destroyed) socket.end('HTTP/1.1 ' + status + '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
}

async function streamEvents(socket, workspace, after, sessionId) {
  const controller = new AbortController();
  socket.once('close', () => controller.abort());
  socket.on('error', () => socket.terminate());

  let pong = true;
  socket.on('pong', () => { pong = true; });
  const heartbeat = setInterval(() => {
    if (!pong) return socket.terminate();
    pong = false;
    socket.ping();
  }, 15_000);

  let nextSessionCheck = Date.now() + 5000;
  let cursor = after;
  try {
    while (socket.readyState === WebSocket.OPEN) {
      if (Date.now() >= nextSessionCheck) {
        const session = await getSession(sessionId);
        if (!session || !workspaceRole(session, workspace)) {
          socket.close(1008, 'Session ended');
          return;
        }
        nextSessionCheck = Date.now() + 5000;
      }
      const frames = await readEvents(workspace, cursor);
      for (const frame of frames) {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (socket.bufferedAmount > 512 * 1024) {
          socket.terminate();
          return;
        }
        socket.send(JSON.stringify(frame));
        cursor = frame.seq;
      }
      if (frames.length < 100) await sleep(150, undefined, { signal: controller.signal });
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error('WebSocket stream:', error.message);
      socket.close(1011, 'Stream unavailable');
    }
  } finally {
    clearInterval(heartbeat);
  }
}

export function attachWebSockets(server) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  let shuttingDown = false;
  async function upgrade(req, socket, head) {
    const handleError = () => socket.destroy();
    socket.once('error', handleError);
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method !== 'GET' || url.pathname !== '/ws') return reject(socket, '404 Not Found');
      if (!acceptsOrigin(req.headers.origin)) return reject(socket, '403 Forbidden');
      const sessionId = readCookie(req.headers.cookie, sessionCookie);
      const session = await getSession(sessionId);
      if (!session) return reject(socket, '401 Unauthorized');
      const workspaces = url.searchParams.getAll('workspace');
      if (workspaces.length !== 1 || !workspaceRole(session, workspaces[0])) return reject(socket, '403 Forbidden');
      const [workspace] = workspaces;
      const cursors = url.searchParams.getAll('after');
      let after;
      if (!cursors.length) {
        after = await latestSequence(workspace);
      } else {
        const [value] = cursors;
        after = Number(value);
        if (cursors.length !== 1 || !/^\d+$/.test(value) || !Number.isSafeInteger(after)) {
          return reject(socket, '400 Bad Request');
        }
      }
      if (shuttingDown) return reject(socket, '503 Service Unavailable');
      sockets.handleUpgrade(req, socket, head, (connection) => {
        socket.removeListener('error', handleError);
        void streamEvents(connection, workspace, after, sessionId);
      });
    } catch (error) {
      console.error('WebSocket upgrade:', error.message);
      reject(socket, '503 Service Unavailable');
    }
  }

  server.on('upgrade', upgrade);
  return () => {
    shuttingDown = true;
    for (const socket of sockets.clients) socket.terminate();
    sockets.close();
  };
}
