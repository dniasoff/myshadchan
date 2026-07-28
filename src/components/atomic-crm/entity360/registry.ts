import type { RaRecord } from "ra-core";

import type { EntityDescriptor } from "./entityDescriptor";

/**
 * The one registry every entity's 360 (and, per `EntityDescriptor`'s own
 * doc comment, list metadata) resolves through. Backing store is a private
 * `Map` keyed by resource `name` — never exported (contract §4 rule 1).
 *
 * `getEntityDescriptor` is for code that must degrade (`RecordLink`, Story
 * 3.9); `requireEntityDescriptor` is for code where absence is a bug
 * (`EntityShow`, the path builders in `entityPaths.ts`). Never dereference
 * the guarded form (`.claude/rules/coding-style.md#Error-handling`).
 */
const descriptors = new Map<string, EntityDescriptor>();

/**
 * Registers a descriptor under `descriptor.name`. Throws on a duplicate
 * `name` unless `opts.replace` is `true`, in which case the previous
 * descriptor is replaced wholesale — this is the entire "extend" API
 * (contract §4 rule 2): there is no `updateEntityDescriptor` and no partial
 * merge, so the replacing module supplies the whole descriptor.
 */
export function registerEntityDescriptor<T extends RaRecord = RaRecord>(
  descriptor: EntityDescriptor<T>,
  opts?: { replace?: boolean },
): void {
  const replace = opts?.replace ?? false;
  if (!replace && descriptors.has(descriptor.name)) {
    throw new Error(
      `Entity descriptor for resource "${descriptor.name}" is already registered; pass { replace: true } to replace it.`,
    );
  }
  descriptors.set(descriptor.name, descriptor as unknown as EntityDescriptor);
}

/** Never throws. Returns `undefined` for an unregistered resource. */
export function getEntityDescriptor(
  name: string,
): EntityDescriptor | undefined {
  return descriptors.get(name);
}

/** Fail-fast accessor. Throws when `name` has no registered descriptor. */
export function requireEntityDescriptor(name: string): EntityDescriptor {
  const descriptor = getEntityDescriptor(name);
  if (!descriptor) {
    throw new Error(`No entity descriptor registered for resource "${name}"`);
  }
  return descriptor;
}
