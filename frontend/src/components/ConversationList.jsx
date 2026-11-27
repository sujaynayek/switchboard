import React, { useCallback, useMemo, useState } from 'react';
import { Inbox, Search, X } from 'lucide-react';
import { Feedback, InlineError } from './Feedback.jsx';
import { Assignment, ContactAvatar, StateBadge } from './Indicators.jsx';
import { ConnectionBadge } from '../layouts/DashboardLayout.jsx';
import { useResource } from '../hooks/useResource.js';
import { conversationPath, readPages, uniqueBy } from '../services/api.js';
import { activityTime, nameFromId } from '../utils/format.js';

const filters = [['all', 'All'], ['open', 'Open'], ['closed', 'Closed']];

export function ConversationList({ api, workspace, user, connection, selected, select, revision, showThread }) {
  const [depth, setDepth] = useState(1);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const load = useCallback((signal) => readPages(
    (offset) => api(conversationPath(workspace, null, null, { limit: 30, offset }), { signal }),
    'conversations', depth,
  ), [api, workspace, depth]);
  const { data, busy, error, refresh } = useResource(load, revision);
  const rows = useMemo(() => uniqueBy(data?.pages.flat() ?? [], 'contact'), [data]);
  const query = search.trim().toLowerCase();
  const shown = rows.filter((row) => (filter === 'all' || row.state === filter) &&
    (!query || row.contact.toLowerCase().includes(query)));

  return <section aria-label="Inbox" className={'inbox-panel ' + (showThread ? 'mobile-hidden' : '')}>
    <header className="border-b border-line px-5 pt-6 pb-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-[1.8rem] leading-none font-semibold tracking-[-.065em]">Inbox</h1>
        <ConnectionBadge state={connection} />
      </div>
      <p className="mt-2 text-sm text-muted">{nameFromId(workspace)} conversations</p>
      <div className="search-field mt-5">
        <Search size={17} aria-hidden="true" />
        <input aria-label="Filter by contact" placeholder="Filter by contact" value={search} onChange={(event) => setSearch(event.target.value)} />
        {search && <button type="button" className="icon-button size-7!" aria-label="Clear contact filter" onClick={() => setSearch('')}><X size={15} /></button>}
      </div>
      <div className="mt-4 flex gap-1" aria-label="Filter conversations by status">
        {filters.map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value}
          className={'filter-button ' + (filter === value ? 'filter-active' : '')} onClick={() => setFilter(value)}>{label}</button>)}
      </div>
    </header>
    <div className="min-h-0 grow overflow-y-auto px-3 py-3">
      {error && <div className="mb-2"><InlineError action={refresh}>Could not load conversations.</InlineError></div>}
      {!data && busy && <Feedback loading title="Loading conversations" />}
      {data && !shown.length && <Feedback icon={Inbox} title={rows.length ? 'No matching conversations' : 'No conversations yet'}
        detail={rows.length ? (data.next ? 'Load more conversations to extend this view.' : 'Try another filter.') : 'New customer messages will appear here.'} />}
      <ul className="space-y-1">
        {shown.map((row) => <li key={row.contact}>
          <button type="button" className={'conversation-row ' + (selected === row.contact ? 'conversation-active' : '')}
            aria-current={selected === row.contact ? 'true' : undefined} onClick={() => select(row.contact)}>
            <ContactAvatar contact={row.contact} />
            <div className="min-w-0 grow text-left">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold tracking-[-.02em]">{row.contact}</span>
                <time dateTime={row.last_activity_at ?? undefined} className="shrink-0 text-xs text-muted">{activityTime(row.last_activity_at)}</time>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-muted"><Assignment assignee={row.assignee} user={user} /></span>
                <StateBadge state={row.state} />
              </div>
            </div>
          </button>
        </li>)}
      </ul>
      {data?.next && <div className="px-2 py-3 text-center">
        <button type="button" className="button button-secondary" disabled={busy} onClick={() => setDepth((current) => current + 1)}>Load more</button>
      </div>}
    </div>
    <footer className="border-t border-line px-5 py-3 text-xs text-muted">{rows.length} {rows.length === 1 ? 'conversation' : 'conversations'}{data?.next ? ' loaded' : ''}</footer>
  </section>;
}
