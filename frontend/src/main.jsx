import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [session, setSession] = useState(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/me', { signal: controller.signal }).then(async (response) => {
      if (response.status === 401) return setSession(null);
      if (!response.ok) throw new Error('Could not load your session.');
      setSession(await response.json());
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause.message);
    });
    return () => controller.abort();
  }, []);

  async function logout() {
    setError('');
    try {
      const response = await fetch('/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Could not sign out.');
      setSession(null);
    } catch (cause) {
      setError(cause.message);
    }
  }

  return (
    <main>
      <h1>Switchboard</h1>
      {error && <p role="alert">{error}</p>}
      {session === undefined && !error && <p>Loading session…</p>}
      {session === null && <a href="/auth/login">Sign in</a>}
      {session && <>
        <p>Signed in as {session.sub}</p>
        <ul>
          {session.workspaces.map(({ id, role }) => <li key={id}>{id} ({role})</li>)}
        </ul>
        <button type="button" onClick={logout}>Sign out</button>
      </>}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
