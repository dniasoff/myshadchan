import { Trash2 } from "lucide-react";
import { useGetIdentity, useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * "Delete data" affordance (ticket lane 7 — the privacy wedge made
 * tangible). Account deletion is deliberately not self-service anywhere in
 * MyShadchan (AGENTS.md — "use account disabling instead"), so this does
 * not pretend to delete anything on click. It explains that plainly and
 * opens a pre-filled email to request it, which is the honest version of
 * this control until a real deletion workflow exists.
 */
export const DeleteDataDialog = () => {
  const translate = useTranslate();
  const { identity } = useGetIdentity();

  const subject = translate("crm.profile.privacy.delete_request_subject", {
    _: "Request to delete my family's data",
  });
  // myshadchan.space is the live domain; myshadchan.app was never registered,
  // so every deletion request sent from here bounced.
  const mailto = `mailto:support@myshadchan.space?subject=${encodeURIComponent(
    subject,
  )}${identity?.email ? `&body=${encodeURIComponent(`Account: ${identity.email}`)}` : ""}`;

  return (
    <Dialog>
      <DialogTrigger asChild>
        {/* Ghost trigger, destructive confirm: the weight belongs on the
            step that commits, not on the one that opens an explanation. */}
        <Button
          variant="ghost"
          className="w-full text-destructive hover:text-destructive sm:w-auto"
        >
          <Trash2 />
          {translate("crm.profile.privacy.delete_data", {
            _: "Delete my data",
          })}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {translate("crm.profile.privacy.delete_dialog_title", {
              _: "Deleting your family's data",
            })}
          </DialogTitle>
          <DialogDescription>
            {translate("crm.profile.privacy.delete_dialog_description", {
              _: "To protect against accidental data loss, deletion isn't self-service yet. Send a request and we'll remove your family's records by hand, promptly.",
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{translate("ra.action.cancel")}</Button>
          </DialogClose>
          <Button asChild variant="destructive">
            <a href={mailto}>
              {translate("crm.profile.privacy.delete_request_send", {
                _: "Request deletion by email",
              })}
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
