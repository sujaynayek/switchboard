import React, { useLayoutEffect, useRef } from 'react';
import { MessagesSquare } from 'lucide-react';
import { Feedback } from './Feedback.jsx';
import { ContactAvatar, DeliveryStatus } from './Indicators.jsx';
import { messageDay, messageTime } from '../utils/format.js';

export function MessageHistory({ contact, messages, loading, hasOlder, loadOlder, busy }) {
  const scroller = useRef(null);
  const prepend = useRef(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (prepend.current && messages.length !== prepend.current.count) {
      element.scrollTop = prepend.current.top + element.scrollHeight - prepend.current.height;
      prepend.current = null;
    } else if (!prepend.current && stick.current) {
      element.scrollTop = element.scrollHeight;
    }
    if (!busy) prepend.current = null;
  }, [messages, busy]);

  function older() {
    const { scrollTop, scrollHeight } = scroller.current;
    prepend.current = { top: scrollTop, height: scrollHeight, count: messages.length };
    loadOlder();
  }

  return <div ref={scroller} role="log" aria-label="Message history" tabIndex={0}
    onScroll={(event) => {
      const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
      stick.current = scrollHeight - scrollTop - clientHeight < 90;
    }}
    className="min-h-0 grow overflow-y-auto bg-canvas">
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-7 md:py-7">
      {loading && <Feedback loading title="Loading messages" />}
      {!loading && !messages.length && <Feedback icon={MessagesSquare} title="No messages yet" detail="Replies and incoming messages will appear here." />}
      {hasOlder && <div className="mb-4 text-center">
        <button type="button" disabled={busy} className="button button-secondary" onClick={older}>Load older messages</button>
      </div>}
      {messages.map((message, index) => {
        const day = messageDay(message.occurred_at);
        const dayStarts = index === 0 || messageDay(messages[index - 1].occurred_at) !== day;
        const outgoing = message.direction === 'outbound';
        return <React.Fragment key={message.id}>
          {dayStarts && <div className="day-divider"><span />{day}<span /></div>}
          <article className={'mb-4 flex w-full items-end gap-2 ' + (outgoing ? 'justify-end' : '')}
            aria-label={outgoing ? 'Outgoing message' : 'Incoming message'}>
            {!outgoing && <ContactAvatar contact={contact} className="mb-5 size-7! rounded-lg!" />}
            <div className={'flex min-w-0 max-w-[86%] flex-col sm:max-w-[72%] ' + (outgoing ? 'items-end' : 'items-start')}>
              <p className={'message-bubble ' + (outgoing ? 'message-out' : 'message-in')}>{message.text}</p>
              <div className="mt-1.5 flex items-center gap-2 text-xs text-muted">
                <time dateTime={message.occurred_at}>{messageTime(message.occurred_at)}</time>
                {outgoing && <DeliveryStatus status={message.status} />}
              </div>
            </div>
          </article>
        </React.Fragment>;
      })}
    </div>
  </div>;
}
