import React from 'react';
import { LoaderCircle, Send } from 'lucide-react';
import { InlineError } from './Feedback.jsx';

export function ReplyComposer({ draft, edit, send, offline }) {
  const locked = draft.sending || Boolean(draft.ref);
  const disabled = offline || draft.sending || !draft.text.trim();
  function submit(event) {
    event.preventDefault();
    if (!disabled) send();
  }

  return <form onSubmit={submit} className="border-t border-line bg-white px-4 py-4 sm:px-6">
    <div className="mx-auto max-w-5xl">
      {draft.error && <div className="mb-3"><InlineError>{draft.error}</InlineError></div>}
      <label htmlFor="reply-text" className="mb-2 block text-sm font-semibold">Reply</label>
      <div className="composer">
        <textarea id="reply-text" placeholder="Write a reply…" rows={2} value={draft.text} readOnly={locked}
          onChange={(event) => edit(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') submit(event);
          }} />
        <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
          <span className="px-1 text-xs text-muted">{offline ? 'Connect to send a reply' : 'Ctrl / ⌘ + Enter to send'}</span>
          <button type="submit" className="button button-primary" disabled={disabled}>
            {draft.sending ? <LoaderCircle size={16} className="motion-safe:animate-spin" /> : <Send size={15} />}
            {draft.sending ? 'Sending…' : draft.ref ? 'Retry send' : 'Send reply'}
          </button>
        </div>
      </div>
    </div>
  </form>;
}
