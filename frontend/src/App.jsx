import React from 'react';
import { Feedback } from './components/Feedback.jsx';
import { useSession } from './context/SessionContext.jsx';
import { Dashboard } from './pages/Dashboard.jsx';
import { Login } from './pages/Login.jsx';

export function App() {
  const { user, error, retry, expired } = useSession();
  if (user === undefined) {
    return <main className="grid min-h-dvh place-items-center bg-canvas">
      <Feedback title={error ? 'Connection unavailable' : 'Opening Switchboard'} detail={error}
        loading={!error} action={error ? retry : undefined} />
    </main>;
  }
  return user ? <Dashboard key={user.sub} /> : <Login expired={expired} />;
}
