import React from 'react';
import { ChevronDown, Inbox, LogOut, PanelLeft, Radio, WifiOff } from 'lucide-react';
import { Brand } from '../components/Brand.jsx';
import { nameFromId } from '../utils/format.js';

function WorkspaceSelect({ user, workspace, onWorkspace, id }) {
  return <div>
    <label htmlFor={id} className="field-label">Workspace</label>
    <div className="relative mt-2">
      <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 grid size-7 -translate-y-1/2 place-items-center rounded-md bg-accent-soft text-xs font-bold text-accent">
        {(workspace ? nameFromId(workspace) : '–').slice(0, 1)}
      </span>
      <select id={id} value={workspace} onChange={(event) => {
        onWorkspace(event.target.value);
        event.currentTarget.closest('details')?.removeAttribute('open');
      }}
        className="w-full appearance-none rounded-lg border border-line bg-white py-2.5 pr-8 pl-11 text-sm font-semibold">
        {!user.workspaces.length && <option value="">No workspaces</option>}
        {user.workspaces.map(({ id, role }) => <option key={id} value={id}>{nameFromId(id)} · {nameFromId(role)}</option>)}
      </select>
      <ChevronDown size={15} aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted" />
    </div>
  </div>;
}

export function DashboardLayout({ user, workspace, role, onWorkspace, showInbox, onLogout, loggingOut, logoutError, children }) {
  return <div className="dashboard">
    <aside className="sidebar" aria-label="Workspace navigation">
      <div className="px-5 pt-7 pb-6"><Brand /></div>
      <div className="px-4"><WorkspaceSelect {...{ user, workspace, onWorkspace }} id="desktop-workspace" /></div>
      <nav className="mt-7 px-4" aria-label="Main">
        <button type="button" onClick={showInbox} aria-current="page" className="nav-current"><Inbox size={19} />Inbox</button>
      </nav>
      <div className="mt-auto border-t border-line px-4 py-4">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-[#e9e5ff] text-sm font-bold text-[#5037a2]">{nameFromId(user.sub).slice(0, 1)}</span>
          <div className="min-w-0 grow"><p className="truncate text-sm font-semibold" title={user.sub}>{nameFromId(user.sub)}</p><p className="text-xs text-muted">{role ? nameFromId(role) : 'Signed in'}</p></div>
          <button type="button" title="Sign out" aria-label="Sign out" disabled={loggingOut} onClick={onLogout} className="icon-button"><LogOut size={17} /></button>
        </div>
        {logoutError && <p role="alert" className="mt-2 text-xs text-red-700">{logoutError}</p>}
      </div>
    </aside>
    <div className="dashboard-content">
      <div className="mobile-bar">
        <details className="relative">
          <summary className="icon-button list-none" aria-label="Workspace menu"><PanelLeft size={21} /></summary>
          <div className="absolute top-12 left-0 z-20 w-64 rounded-xl border border-line bg-white p-4 shadow-xl">
            <WorkspaceSelect {...{ user, workspace, onWorkspace }} id="mobile-workspace" />
            <p className="mt-4 text-sm font-semibold" title={user.sub}>{nameFromId(user.sub)} {role && '· ' + nameFromId(role)}</p>
            <button type="button" onClick={(event) => { event.currentTarget.closest('details').open = false; showInbox(); }} className="button button-secondary mt-3 w-full"><Inbox size={16} /> Inbox</button>
            <button type="button" disabled={loggingOut} onClick={onLogout} className="button button-secondary mt-2 w-full"><LogOut size={16} /> Sign out</button>
            {logoutError && <p role="alert" className="mt-2 text-xs text-red-700">{logoutError}</p>}
          </div>
        </details>
        <Brand />
      </div>
      {children}
    </div>
  </div>;
}

export function ConnectionBadge({ state }) {
  const live = state === 'live';
  const Icon = state === 'offline' ? WifiOff : Radio;
  const label = { live: 'Live', offline: 'Offline', reconnecting: 'Reconnecting', connecting: 'Connecting' }[state];
  return <span role="status" className={'connection-badge ' + (live ? 'connection-live' : '')}>
    <Icon size={14} aria-hidden="true" />{label}
  </span>;
}
