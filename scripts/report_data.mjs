// Pure data merging; the caller supplies verified business facts and evidence.
export const DAY_MS = 86400000;

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty text`);
  return value;
}

export function dateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid date: ${value}`);
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value || +value.slice(0, 4) < 1900) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date;
}

export function dateColor(date, anchor) {
  const offset = Math.round((dateValue(date) - dateValue(anchor)) / DAY_MS);
  return ((offset % 2) + 2) % 2 === 0 ? '#BFE5F2' : '#FCE4E4';
}

function validate(doc, allowRemoval = true) {
  if (doc?.schema_version !== 1) throw new Error('schema_version must be 1');
  requireText(doc.timezone, 'timezone');
  new Intl.DateTimeFormat('en', {timeZone: doc.timezone});
  if (!Array.isArray(doc.category_order) || !doc.category_order.length) throw new Error('category_order is required');
  doc.category_order.forEach(c => requireText(c, 'category'));
  if (new Set(doc.category_order).size !== doc.category_order.length) throw new Error('Duplicate category');
  if (!Array.isArray(doc.days)) throw new Error('days must be an array');
  if (doc.color_anchor !== undefined) dateValue(doc.color_anchor);
  const dates = new Set();
  for (const day of doc.days) {
    dateValue(day.date);
    if (dates.has(day.date)) throw new Error(`Duplicate date: ${day.date}`);
    dates.add(day.date);
    if (!Array.isArray(day.items)) throw new Error(`items must be an array: ${day.date}`);
    if (day.coverage !== undefined && typeof day.coverage !== 'string') throw new Error('coverage must be text');
    const ids = new Set();
    for (const item of day.items) {
      for (const field of ['id', 'category', 'project', 'progress']) requireText(item[field], field);
      if (typeof item.follow_up !== 'string') throw new Error('follow_up must be text (empty is allowed)');
      if (ids.has(item.id)) throw new Error(`Duplicate item id: ${day.date}/${item.id}`);
      ids.add(item.id);
      if (!Array.isArray(item.evidence) || !item.evidence.length) throw new Error(`Missing evidence: ${item.id}`);
      item.evidence.forEach(e => requireText(e, 'evidence reference'));
    }
    if (day.remove_ids !== undefined) {
      if (!allowRemoval || !Array.isArray(day.remove_ids)) throw new Error('Unexpected remove_ids');
      const removed = new Set();
      for (const id of day.remove_ids) {
        requireText(id, 'remove id');
        if (removed.has(id) || ids.has(id)) throw new Error(`Conflicting remove id: ${id}`);
        removed.add(id);
      }
    }
  }
}

export function mergeReports(input, previous = null) {
  validate(input);
  if (previous) {
    validate(previous, false);
    if (previous.timezone !== input.timezone) throw new Error('Timezone changed; reconcile calendar dates before merging');
    if (input.color_anchor && input.color_anchor !== previous.color_anchor) throw new Error('Cannot silently change the existing color anchor');
  }
  const hasUpdate = input.days.some(d => d.items.length || d.remove_ids?.length);
  if (!hasUpdate) throw new Error('No daily items or explicit corrections; do not generate an empty report');
  const days = new Map((previous?.days ?? []).map(d => [d.date, structuredClone(d)]));
  for (const incoming of input.days) {
    if (!incoming.items.length && !incoming.remove_ids?.length) continue;
    const old = days.get(incoming.date);
    const items = new Map((old?.items ?? []).map(item => [item.id, item]));
    for (const id of incoming.remove_ids ?? []) {
      if (!items.delete(id)) throw new Error(`Cannot remove unknown item: ${incoming.date}/${id}`);
    }
    for (const item of incoming.items) items.set(item.id, structuredClone(item));
    if (items.size) days.set(incoming.date, {
      date: incoming.date,
      coverage: incoming.coverage ?? old?.coverage ?? '',
      items: [...items.values()],
    });
    else days.delete(incoming.date);
  }
  const sortedDays = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!sortedDays.length) throw new Error('No report rows remain');
  return {
    schema_version: 1,
    timezone: input.timezone,
    category_order: [...input.category_order],
    color_anchor: previous?.color_anchor ?? input.color_anchor ?? sortedDays[0].date,
    days: sortedDays,
  };
}

export function groupItems(items, categoryOrder) {
  const categories = [...new Set([...categoryOrder, ...items.map(i => i.category)])];
  return categories.flatMap(c => items.filter(i => i.category === c));
}
