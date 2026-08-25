import type { ReactNode } from "react";
import { useListContext, Translate } from "ra-core";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BulkDeleteButton } from "@/components/admin/bulk-delete-button";
import { SelectAllButton } from "@/components/admin/select-all-button";
import { X } from "lucide-react";
import { BulkExportButton } from "./bulk-export-button";

/**
 * Default children for BulkActionsToolbar. Renders SelectAllButton, BulkExportButton, and BulkDeleteButton.
 *
 * @internal
 */
export function BulkActionsToolbarChildren() {
  return (
    <>
      <SelectAllButton />
      <BulkExportButton />
      <BulkDeleteButton />
    </>
  );
}

/**
 * A sticky toolbar that appears when rows are selected in a DataTable.
 *
 * Shows the number of selected rows and provides bulk action buttons. Automatically hidden
 * when no rows are selected. Positioned at the bottom center of the screen.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/bulkactionstoolbar/ BulkActionsToolbar documentation}
 *
 * @example
 * import { BulkActionsToolbar, BulkDeleteButton } from '@/components/admin';
 *
 * const CustomBulkToolbar = () => (
 *     <BulkActionsToolbar>
 *         <BulkDeleteButton />
 *     </BulkActionsToolbar>
 * );
 *
 * const PostList = () => (
 *   <List>
 *     <DataTable bulkActionsToolbar={<CustomBulkToolbar />}>
 *       ...
 *     </DataTable>
 *   </List>
 * );
 */
export const BulkActionsToolbar = ({
  children = <BulkActionsToolbarChildren />,
}: {
  children?: ReactNode;
}) => {
  const { selectedIds, onUnselectItems } = useListContext();
  if (!selectedIds?.length) {
    return null;
  }
  const handleUnselectAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onUnselectItems();
  };
  return (
    <Card
      className={cn(
        "flex flex-col gap-2 md:gap-6 md:flex-row items-stretch sm:items-center p-2 px-4",
        "w-[90%] sm:w-fit mx-auto fixed left-0 right-0 bg-card",
        // `bottom-2` alone parks this toolbar inside the 64px band that
        // MobileNavigation occupies (`--mobile-nav-h`, z-50), so on a phone it
        // renders entirely behind the nav and none of select-all / export /
        // delete can be tapped. Clear the nav the same way the toast already
        // does (atomic-crm/layout/MobileLayout.tsx), and keep z below the nav
        // so the nav still wins if the two ever meet.
        "bottom-[calc(var(--mobile-nav-clearance)+0.5rem)] md:bottom-2 z-30",
      )}
    >
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          className="has-[>svg]:px-0"
          onClick={handleUnselectAll}
        >
          <X />
        </Button>
        <span className="text-sm text-muted-foreground">
          <Translate
            i18nKey="ra.action.bulk_actions"
            options={{ smart_count: selectedIds.length }}
          >
            {selectedIds.length} rows selected
          </Translate>
        </span>
      </div>
      {children}
    </Card>
  );
};
