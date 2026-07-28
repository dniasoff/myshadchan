import React from "react";
import { buttonVariants } from "@/components/ui/button";
import { Plus } from "lucide-react";
import {
  useCreatePath,
  useGetResourceLabel,
  useResourceContext,
  useResourceTranslation,
} from "ra-core";
import { Link } from "react-router";

import { buildNewPath } from "@/components/atomic-crm/entity360/entityPaths";
import { getEntityDescriptor } from "@/components/atomic-crm/entity360/registry";

export type CreateButtonProps = {
  label?: string;
  resource?: string;
};

/**
 * A button that navigates to the create page for a resource.
 *
 * Automatically uses the current resource unless overridden.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/createbutton/ CreateButton documentation}
 *
 * @example
 * import { CreateButton, List, ExportButton } from '@/components/admin';
 *
 * const PostList = () => (
 *   <List
 *     actions={<>
 *       <CreateButton />
 *       <ExportButton />
 *     </>}
 *   >
 *     ...
 *   </List>
 * );
 */
export const CreateButton = (props: CreateButtonProps) => {
  const { label: labelProp } = props;
  const resource = useResourceContext(props);
  const createPath = useCreatePath();
  const getResourceLabel = useGetResourceLabel();
  // AD-24 (contract §5 rule 3): a resource with a registered entity
  // descriptor creates at `/{resource}/new`, never `useCreatePath`'s
  // hardcoded `/{resource}/create` (`ra-core/dist/routing/useCreatePath.js:46-47`).
  // A resource with no descriptor (e.g. `tasks`) falls back unchanged.
  const link =
    resource && getEntityDescriptor(resource)
      ? buildNewPath(resource)
      : createPath({
          resource,
          type: "create",
        });
  const label = useResourceTranslation({
    resourceI18nKey: resource
      ? `resources.${resource}.action.create`
      : undefined,
    baseI18nKey: "ra.action.create",
    options: {
      name: resource ? getResourceLabel(resource, 1) : undefined,
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
      <Plus />
      {label}
    </Link>
  );
};

// useful to prevent click bubbling in a datagrid with rowClick
const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();
