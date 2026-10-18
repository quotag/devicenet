import { ulid } from 'ulid';

export type IdPrefix = 'dev' | 'evt' | 'run' | 'cmd' | 'hub' | 'tenant' | 'site' | 'room' | 'rule' | 'scn';

/** `<prefix>_<ULID>`; passes the matching `@devicenet/shared` id schema. */
export function newId(prefix: IdPrefix, seedTime?: number): string {
  return `${prefix}_${ulid(seedTime)}`;
}
