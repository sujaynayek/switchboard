const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fullDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

export function nameFromId(id) {
  return id.replace(/^(ws|u)_/, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function activityTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return date.toDateString() === new Date().toDateString() ? time.format(date) : shortDate.format(date);
}

export function messageTime(value) {
  return time.format(new Date(value));
}

export function messageDay(value) {
  const date = new Date(value);
  return date.toDateString() === new Date().toDateString() ? 'Today' : fullDate.format(date);
}
