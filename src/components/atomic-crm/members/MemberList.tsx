import { useRecordContext, useTranslate } from "ra-core";
import { useDataProvider, useNotify } from "ra-core";
import { useState } from "react";
import { DataTable } from "@/components/admin/data-table";
import { ExportButton } from "@/components/admin/export-button";
import { List } from "@/components/admin/list";
import { SearchInput } from "@/components/admin/search-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Trash2 } from "lucide-react";

import { TopToolbar } from "../layout/TopToolbar";
import type { CrmDataProvider } from "../providers/types";
import type { Member } from "../types";

const MemberListActions = () => (
  <TopToolbar>
    <ExportButton />
  </TopToolbar>
);

const filters = [<SearchInput source="q" alwaysOn />];

const OptionsField = (_props: { label?: string | boolean }) => {
  const record = useRecordContext<Member>();
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  if (!record) return null;

  const handleRemove = async () => {
    setIsRemoving(true);
    try {
      // Remove both the member and their single record if they have one
      await dataProvider.removePersonaAdmin(record.id, "member");
      await dataProvider.removePersonaAdmin(record.id, "single");
      notify("crm.members.remove.success", {
        messageArgs: { _: "Person removed from household" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      notify("crm.members.remove.error", {
        type: "error",
        messageArgs: { _: message || "Could not remove person. Try again." },
      });
    } finally {
      setIsRemoving(false);
      setRemoveDialogOpen(false);
    }
  };

  return (
    // `gap-2` and `items-center`, not `gap-1`: the only destructive action on
    // this screen sat 4px from the status badges, so on a phone the two are
    // one crowded strip and the remove button is easy to hit by accident.
    // Its own 44px floor comes from ui/button.tsx's `icon` size.
    <div className="flex flex-row items-center gap-2">
      {record.administrator && (
        <Badge variant="outline" className="border-primary">
          {translate("resources.members.fields.administrator")}
        </Badge>
      )}
      {record.disabled && (
        <Badge variant="outline" className="border-attention">
          {translate("resources.members.fields.disabled")}
        </Badge>
      )}
      {/* Remove from household action - only for parent_admin users viewing other members */}
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        onClick={() => setRemoveDialogOpen(true)}
        disabled={isRemoving}
        aria-label={translate("crm.members.remove.label", {
          _: "Remove from household",
        })}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <Dialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        {/* dvh, not vh — mobile browser chrome makes vh wrong — and an
            internal scroll, since the base DialogContent is centre-
            translated with no height cap: past the viewport height the
            footer is simply clipped away with no way to reach it. */}
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {translate("crm.members.remove.confirmTitle", {
                _: "Remove from household",
              })}
            </DialogTitle>
            <DialogDescription>
              {translate("crm.members.remove.confirmDescription", {
                name: `${record.first_name} ${record.last_name}`,
                _: "This will remove {name} from this household. They will stay in your family's records and you can undo this at any time.",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setRemoveDialogOpen(false)}
              disabled={isRemoving}
            >
              {translate("crm.members.remove.cancel", { _: "Cancel" })}
            </Button>
            <Button
              variant="destructive"
              onClick={handleRemove}
              disabled={isRemoving}
            >
              {isRemoving
                ? translate("crm.members.remove.removing", { _: "Removing..." })
                : translate("crm.members.remove.confirm", { _: "Remove" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export function MemberList() {
  return (
    <List
      filters={filters}
      actions={<MemberListActions />}
      sort={{ field: "first_name", order: "ASC" }}
    >
      <DataTable>
        <DataTable.Col source="first_name" />
        <DataTable.Col source="last_name" />
        <DataTable.Col source="email" />
        <DataTable.Col label={false}>
          <OptionsField />
        </DataTable.Col>
      </DataTable>
    </List>
  );
}
