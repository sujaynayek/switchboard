export class ApiError extends Error {
  constructor(status) {
    super('Request failed (' + status + ')');
    this.status = status;
  }
}

export async function request(path, { signal, method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new ApiError(response.status);
  return response.headers.get('content-type')?.includes('application/json') ? response.json() : undefined;
}

export function conversationPath(workspace, contact, action, page) {
  const path = '/api/conversations' + (contact ? '/' + encodeURIComponent(contact) : '');
  const query = new URLSearchParams({ workspace, ...page });
  return path + (action ? '/' + action : '') + '?' + query;
}

export async function readPages(load, field, depth) {
  const rows = [];
  let offset = 0;
  for (let index = 0; index < depth && offset !== null; index += 1) {
    const page = await load(offset);
    rows.push(page[field]);
    offset = page.next_offset;
  }
  return { pages: rows, next: offset !== null };
}

export function uniqueBy(rows, key) {
  return [...new Map(rows.map((row) => [row[key], row])).values()];
}
