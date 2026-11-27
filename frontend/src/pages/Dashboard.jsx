import React, { useRef, useState } from 'react';
import { Inbox, MessagesSquare } from 'lucide-react';
import { ConversationList } from '../components/ConversationList.jsx';
import { Feedback } from '../components/Feedback.jsx';
import { Thread } from '../components/Thread.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { useDrafts } from '../hooks/useDrafts.js';
import { useWorkspaceSocket } from '../hooks/useWorkspaceSocket.js';
import { DashboardLayout } from '../layouts/DashboardLayout.jsx';

function WorkspaceInbox({ api, user, workspace, role, cursors, drafts, selection, showInbox, select }) {
  const { expire } = useSession();
  const [inboxRevision, setInboxRevision] = useState(0);
  const [threadRevision, setThreadRevision] = useState(0);

  function onChange(contacts) {
    setInboxRevision((value) => value + 1);
    if (!contacts || contacts.has(selection)) setThreadRevision((value) => value + 1);
  }

  const connection = useWorkspaceSocket(workspace, cursors, {
    changed: onChange, expire, verifySession: (signal) => api('/api/me', { signal }).catch(() => {}),
  });

  return <div className="inbox-grid">
    <ConversationList {...{ api, workspace, connection, select }} user={user.sub} selected={selection}
      revision={inboxRevision} showThread={Boolean(selection)} />
    {selection ? <Thread key={selection} {...{ api, workspace, role, connection, drafts, onChange }}
      user={user.sub} contact={selection} revision={threadRevision} back={showInbox} />
      : <div className="thread-empty">
        <Feedback icon={MessagesSquare} title="Select a conversation" detail="Choose a contact from the inbox to read messages and reply." />
      </div>}
  </div>;
}

export function Dashboard() {
  const { user, api, logout } = useSession();
  const [requested, setRequested] = useState('');
  const [selection, select] = useState(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const cursors = useRef(new Map()).current;
  const drafts = useDrafts();

  const membership = user.workspaces.find(({ id }) => id === requested) ?? user.workspaces[0];
  const workspace = membership?.id ?? '';
  const role = membership?.role;
  const showInbox = () => select(null);
  function onWorkspace(id) {
    if (id === workspace || !user.workspaces.some((item) => item.id === id)) return;
    showInbox();
    setRequested(id);
  }

  async function onLogout() {
    setLoggingOut(true);
    setLogoutError('');
    try {
      await logout();
    } catch {
      setLogoutError('Could not sign out. Try again.');
    } finally {
      setLoggingOut(false);
    }
  }

  return <DashboardLayout {...{ user, workspace, role, onWorkspace, showInbox, onLogout, loggingOut, logoutError }}>
    {workspace ? <WorkspaceInbox key={workspace} {...{ api, user, workspace, role, cursors, drafts, selection, showInbox, select }} />
      : <main className="grid grow place-items-center bg-canvas">
        <Feedback icon={Inbox} title="No workspaces available" detail="Your account does not have access to a workspace." />
      </main>}
  </DashboardLayout>;
}
