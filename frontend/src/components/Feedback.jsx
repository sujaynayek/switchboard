import React from 'react';
import { CircleAlert, LoaderCircle, MessageSquare } from 'lucide-react';

export function Feedback({ icon: Icon = MessageSquare, title, detail, loading, action }) {
  return <div className="mx-auto flex max-w-xs flex-col items-center px-5 py-10 text-center" role={loading ? 'status' : undefined}>
    <span className="mb-5 grid size-12 place-items-center rounded-2xl border border-accent/15 bg-accent-soft text-accent">
      {loading ? <LoaderCircle size={21} className="motion-safe:animate-spin" /> : <Icon size={21} />}
    </span>
    <p className="font-semibold text-ink">{title}</p>
    {detail && <p className="mt-2 text-sm leading-relaxed text-muted">{detail}</p>}
    {action && <button type="button" className="button button-secondary mt-4" onClick={action}>Try again</button>}
  </div>;
}

export function InlineError({ children, action }) {
  return <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
    <CircleAlert size={16} className="mt-0.5 shrink-0" />
    <span className="grow">{children}</span>
    {action && <button type="button" onClick={action} className="shrink-0 font-semibold underline">Retry</button>}
  </div>;
}
