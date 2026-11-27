import { useRef, useState } from 'react';

const empty = { text: '', ref: null, sending: false, error: '' };

export function useDrafts() {
  const drafts = useRef(new Map());
  const [, render] = useState(0);

  function get(key) {
    return drafts.current.get(key) ?? empty;
  }

  function set(key, value) {
    if (value) drafts.current.set(key, value);
    else drafts.current.delete(key);
    render((version) => version + 1);
  }

  function edit(key, text) {
    const draft = get(key);
    if (!draft.ref) set(key, { ...empty, text });
  }

  function confirm(key, ref) {
    if (get(key).ref === ref) set(key, null);
  }

  async function send(key, deliver, refresh) {
    const draft = get(key);
    const text = draft.text.trim();
    if (draft.sending || !text) return;
    const ref = draft.ref ?? crypto.randomUUID();
    set(key, { text, ref, sending: true, error: '' });
    try {
      await deliver({ text, client_ref: ref });
      confirm(key, ref);
      refresh();
    } catch (error) {
      if (get(key).ref !== ref) return;
      const uncertain = !error.status || error.status === 408 || error.status >= 500;
      set(key, {
        text, ref: uncertain ? ref : null, sending: false,
        error: uncertain ? 'Send could not be confirmed. Retry to use the same reply reference.'
          : 'This reply was rejected. Check your access or edit the message and try again.',
      });
    }
  }

  return { get, edit, confirm, send };
}
