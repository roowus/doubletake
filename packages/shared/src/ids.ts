import { ulid } from 'ulid';

/** ULIDs everywhere: sortable, URL-safe, no coordination. */
export function newId(): string {
  return ulid();
}

export function nowIso(): string {
  return new Date().toISOString();
}
