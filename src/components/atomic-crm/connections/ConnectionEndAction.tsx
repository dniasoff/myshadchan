import { useState } from "react";
import { useDataProvider, useNotify, useRefresh, useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";
import { CancelButton } from "@/components/admin/cancel-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { CrmDataProvider } from "../providers/types";
import type { Connection } from "../types";

/**
 * Story 8.5 (AC-5, Task 5): a confirm-and-call action over Story 8.2's
 * `endConnection()`, available from the Connection 360 itself (Story 8.2's
 * Settings panel already has a direct, unconfirmed button — this one adds
 * the confirm step the story's Task 5 asks for). Refreshes the 360 on
 * success so the identity header immediately shows `ended` and "Send a
 * redt" disables itself (ConnectionSendRedtAction reads the same record).
 * Renders nothing once the connection has already ended — there is nothing
 * left to confirm.
 */
export const ConnectionEndAction = ({
  connection,
}: {
  connection: Connection;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefresh();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [open, setOpen] = useState(false);
  const [isEnding, setIsEnding] = useState(false);

  if (connection.status === "ended") return null;

  const handleConfirm = async () => {
    setIsEnding(true);
    try {
      await dataProvider.endConnection(connection.id);
      setOpen(false);
      refresh();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.connections.end.error", {
              _: "Couldn't end that connection. Try again.",
            }),
        { type: "error" },
      );
    } finally {
      setIsEnding(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => setOpen(true)}
      >
        {translate("crm.connections.end.button", { _: "End connection" })}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-popover border-border shadow-lg sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-semibold tracking-tight">
              {translate("crm.connections.end.confirmTitle", {
                _: "End this connection?",
              })}
            </DialogTitle>
            <DialogDescription>
              {translate("crm.connections.end.confirmDescription", {
                _: "This is immediate and cannot be undone. Its history stays visible, but a redt can no longer be sent through it.",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <CancelButton onClick={() => setOpen(false)} />
            <Button
              type="button"
              variant="destructive"
              disabled={isEnding}
              onClick={handleConfirm}
            >
              {translate("crm.connections.end.confirmButton", {
                _: "End connection",
              })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
