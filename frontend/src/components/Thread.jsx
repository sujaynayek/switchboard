import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, CircleCheck, RotateCcw, UserRoundPlus } from 'lucide-react';
import { Feedback, InlineError } from './Feedback.jsx';
import { Assignment, ContactAvatar, StateBadge } from './Indicators.jsx';
import { MessageHistory } from './MessageHistory.jsx';
import { ReplyComposer } from './ReplyComposer.jsx';
import { useResource } from '../hooks/useResource.js';
import { conversationPath, readPages, uniqueBy } from '../services/api.js';

export function Thread({ api, workspace, contact, user, role, connection, drafts, revision, onChange, back }) {
  const [depth, setDepth] = useState(1);
  const [action, setAction] = useState('');
  const [actionError, setActionError] = useState('');
  const key = JSON.stringify([workspace, contact]);
  const load = useCallback(async (signal) => {
    const [thread, history] = await Promise.all([
      api(conversationPath(workspace, contact), { signal }),
      readPages((offset) => api(conversationPath(workspace, contact, 'messages', { limit: 40, offset }), { signal }), 'messages', depth),
    ]);
    return { thread, history };
  }, [api, workspace, contact, depth]);
  const { data, error, busy, refresh } = useResource(load, revision);
  const messages = useMemo(() => uniqueBy(data ? [...data.history.pages].reverse().flat() : [], 'id'), [data]);
  const thread = data?.thread;
  const draft = drafts.get(key);

  useEffect(() => {
    if (draft.ref && messages.some((message) => message.client_ref === draft.ref)) drafts.confirm(key, draft.ref);
  }, [draft.ref, messages, drafts, key]);

  async function change(operation) {
    setAction(operation);
    setActionError('');
    try {
      await api(conversationPath(workspace, contact, operation), { method: 'POST' });
    } catch (failure) {
      setActionError(failure.status === 409 ? 'Another agent already claimed this conversation.'
        : failure.status === 403 ? 'You don’t have permission to change this conversation.'
          : 'The change could not be confirmed. Try again.');
    } finally {
      setAction('');
      onChange();
    }
  }

  const heldByOther = thread?.assignee && thread.assignee !== user;
  const mayChangeState = role === 'admin' || !heldByOther;
  const closed = thread?.state === 'closed';
  const unavailable = Boolean(action) || connection === 'offline';
  const send = () => drafts.send(key,
    (body) => api(conversationPath(workspace, contact, 'reply'), { method: 'POST', body }), onChange);

  return <section aria-label="Conversation" className="thread-panel">
    <header className="thread-header">
      <div className="flex min-w-0 items-center gap-2.5">
        <button type="button" aria-label="Back to inbox" className="icon-button shrink-0 lg:hidden" onClick={back}><ChevronLeft size={21} /></button>
        <ContactAvatar contact={contact} className="size-10! rounded-xl!" />
        <div className="min-w-0">
          <h2 className="truncate text-lg leading-6 font-semibold tracking-[-.035em]">{contact}</h2>
          {thread && <p className="mt-0.5 truncate text-sm text-muted"><Assignment assignee={thread.assignee} user={user} /></p>}
        </div>
        {thread && <StateBadge state={thread.state} />}
      </div>
      {thread && <div className="flex shrink-0 flex-wrap gap-2">
        {!thread.assignee && <button type="button" className="button button-secondary" disabled={unavailable} onClick={() => change('claim')}>
          <UserRoundPlus size={16} />{action === 'claim' ? 'Claiming…' : 'Claim'}
        </button>}
        {mayChangeState && <button type="button" className="button button-secondary" disabled={unavailable} onClick={() => change(closed ? 'reopen' : 'close')}>
          {closed ? <RotateCcw size={16} /> : <CircleCheck size={16} />}
          {closed ? 'Reopen' : 'Close conversation'}
        </button>}
      </div>}
    </header>
    {actionError && <div className="border-b border-line bg-white px-4 py-2"><InlineError>{actionError}</InlineError></div>}
    {error && <div className="border-b border-line bg-white px-4 py-2">
      <InlineError action={refresh}>{error.status === 404 ? 'This conversation is no longer available.' : 'Could not refresh this conversation.'}</InlineError>
    </div>}
    {!thread && error ? <div className="grid min-h-0 grow place-items-center bg-canvas">
      <Feedback title="Conversation unavailable" detail="Select a conversation from the inbox or try again." />
    </div> : <MessageHistory contact={contact} messages={messages} loading={!thread} busy={busy}
      hasOlder={data?.history.next} loadOlder={() => setDepth((current) => current + 1)} />}
    {thread && <ReplyComposer draft={draft} edit={(text) => drafts.edit(key, text)} send={send} offline={connection === 'offline'} />}
  </section>;
}
