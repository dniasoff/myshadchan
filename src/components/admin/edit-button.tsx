import React from "react";
import { buttonVariants } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import type { RaRecord } from "ra-core";
import {
  useCreatePath,
  useGetRecordRepresentation,
  useGetResourceLabel,
  useRecordContext,
  useResourceContext,
  useResourceTranslation,
} from "ra-core";
import { Link } from "react-router";

import { buildEditPath } from "@/components/atomic-crm/entity360/entityPaths";
import { hasAd24RecordShape } from "@/components/atomic-crm/entity360/routeConvention";

export type EditButtonProps = {
  record?: RaRecord;
  resource?: string;
  label?: string;
};

/**
 * A button that navigates to the edit page for a record.
 *
 * Works within RecordContext to automatically get the record ID.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/editbutton/ EditButton documentation}
 *
 * @example
 * import { DataTable, EditButton } from '@/components/admin';
 *
 * const PostList = () => (
 *   <DataTable>
 *     <DataTable.Col source="title" />
 *     <DataTable.Col source="author" />
 *     <DataTable.Col source="published_at" />
 *     <DataTable.Col>
 *       <EditButton />
 *     </DataTable.Col>
 *   </DataTable>
 * );
 */
export const EditButton = (props: EditButtonProps) => {
  const { label: labelProp } = props;
  const resource = useResourceContext(props);
  const record = useRecordContext(props);
  const createPath = useCreatePath();
  const getResourceLabel = useGetResourceLabel();
  const getRecordRepresentation = useGetRecordRepresentation(resource);
  const recordRepresentationValue = getRecordRepresentation(record);
  const recordRepresentation =
    typeof recordRepresentationValue === "string"
      ? recordRepresentationValue
      : recordRepresentationValue?.toString();
  // AD-24 (contract §5 rule 3, AC 3): once a descriptor's own
  // `buildRecordPath` already returns the AD-24 shape (`/{resource}/{id}`,
  // Epic 5's one-line flip), the live edit route moves to
  // `/{resource}/{id}/edit` and this button must follow it. Until that flip,
  // `buildEditPath` would collide with the pre-migration `:id/show/*` route
  // (`/singles/1/show/edit`), so `useCreatePath`'s `/{resource}/{id}`
  // fallback — today's real edit route — is kept.
  const link =
    resource && record?.id != null && hasAd24RecordShape(resource, record.id)
      ? buildEditPath(resource, record.id)
      : createPath({
          resource,
          type: "edit",
          id: record?.id,
        });
  const label = useResourceTranslation({
    resourceI18nKey: resource ? `resources.${resource}.action.edit` : undefined,
    baseI18nKey: "ra.action.edit",
    options: {
      name: resource ? getResourceLabel(resource, 1) : undefined,
      recordRepresentation,
    },
    userText: labelProp,
  });
  return (
    <Link
      className={buttonVariants({ variant: "outline" })}
      to={link}
      onClick={stopPropagation}
      aria-label={typeof label === "string" ? label : undefined}
    >
      <Pencil />
      {label}
    </Link>
  );
};

// useful to prevent click bubbling in a datagrid with rowClick
const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();
