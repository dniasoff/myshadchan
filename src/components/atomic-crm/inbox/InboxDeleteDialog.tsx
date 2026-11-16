import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const InboxDeleteDialog = ({
  open,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) => (
  <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
    <DialogContent className="top-auto bottom-0 max-w-md translate-y-0 rounded-b-none border-border bg-popover shadow-lg sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:rounded-lg">
      <DialogHeader>
        <DialogTitle className="font-display text-2xl font-semibold tracking-tight">
          Delete this item?
        </DialogTitle>
        <DialogDescription>
          It and its files will be removed. A resume already attached to a
          suggestion is not removed.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter className="flex-col gap-2 sm:flex-row sm:gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={busy}
          className="min-h-11 w-full sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={onConfirm}
          disabled={busy}
          className="min-h-11 w-full sm:w-auto"
        >
          {busy ? "Deleting…" : "Delete"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
