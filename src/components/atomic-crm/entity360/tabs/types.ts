import type { Identifier } from "ra-core";

import type { EntityTargetType } from "../../types";

/**
 * The one prop shape every universal tab takes — `ActivityTab`, `NotesTab`,
 * `FilesTab`, `TasksTab` (Epic 3 API contract §8). Exactly these two fields,
 * no per-entity variants: a tab reaches the record it belongs to entirely
 * through `targetType`/`targetId`, never through a typed `record` prop.
 */
export type UniversalTabProps = {
  targetType: EntityTargetType;
  targetId: Identifier;
};
