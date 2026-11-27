import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { request } from '../services/api.js';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [user, setUser] = useState(undefined);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);

  const expire = useCallback(() => {
    setExpired(true);
    setUser(null);
  }, []);

  const checkSession = useCallback(async (signal) => {
    try {
      const identity = await request('/api/me', { signal });
      if (!signal?.aborted) setUser(identity);
    } catch (failure) {
      if (signal?.aborted) return;
      if (failure.status === 401) setUser((current) => current === undefined ? null : current);
      else setError('Could not reach Switchboard. Check your connection and try again.');
    }
  }, []);

  const retry = useCallback(() => {
    setError('');
    void checkSession();
  }, [checkSession]);

  useEffect(() => {
    const controller = new AbortController();
    void checkSession(controller.signal);
    return () => controller.abort();
  }, [checkSession]);

  const api = useCallback(async (...args) => {
    try {
      return await request(...args);
    } catch (failure) {
      if (failure.status === 401 && !args[1]?.signal?.aborted) expire();
      throw failure;
    }
  }, [expire]);

  async function logout() {
    await request('/auth/logout', { method: 'POST' });
    setExpired(false);
    setUser(null);
  }

  return (
    <SessionContext.Provider value={{ user, api, error, retry, logout, expired, expire }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
