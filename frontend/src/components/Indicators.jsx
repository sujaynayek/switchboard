import React from 'react';
import { Check, CheckCheck, CircleAlert, Clock3, UserRound } from 'lucide-react';
import { nameFromId } from '../utils/format.js';

export function ContactAvatar({ contact, className = '' }) {
  const tone = contact.split('').reduce((total, character) => total + character.charCodeAt(0), 0) % 4;
  return <span aria-hidden="true" className={'contact-avatar avatar-' + tone + ' ' + className}><UserRound size={17} /></span>;
}

export function StateBadge({ state }) {
  return <span className={'state-badge ' + (state === 'closed' ? 'state-closed' : 'state-open')}>
    <span aria-hidden="true" />{state === 'closed' ? 'Closed' : 'Open'}
  </span>;
}

export function Assignment({ assignee, user }) {
  if (!assignee) return 'Unassigned';
  return assignee === user ? 'Assigned to you' : 'Assigned to ' + nameFromId(assignee);
}

const delivery = {
  queued: [Clock3, 'Queued', 'text-muted'],
  sent: [Check, 'Sent', 'text-violet-700'],
  delivered: [CheckCheck, 'Delivered', 'text-violet-700'],
  failed: [CircleAlert, 'Failed', 'text-red-700'],
};

export function DeliveryStatus({ status }) {
  const [Icon, label, color] = delivery[status] ?? delivery.queued;
  return <span className={'inline-flex items-center gap-1 font-medium ' + color}><Icon size={14} aria-hidden="true" />{label}</span>;
}
