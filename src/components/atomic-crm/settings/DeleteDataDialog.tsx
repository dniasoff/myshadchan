import { Trash2 } from "lucide-react";
import {
  useGetIdentity,
  useTranslate,
  useNotify,
  useDataProvider,
} from "ra-core";
import { useState } from "react";

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

export const DeleteDataDialog = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider();
  const { identity } = useGetIdentity();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<
    "request" | "confirm" | "processing" | "done"
  >("request");
  const [includeExport, setIncludeExport] = useState(true);

  const handleDelete = async () => {
    if (!identity) {
      notify("Error: No identity found", { type: "error" });
      return;
    }

    try {
      setStep("processing");
      setLoading(true);

      // Call the delete_account_data RPC function
      // First get the current context ID (account_id)
      const { data: contextData } = await dataProvider.custom({
        url: "/rpc/current_context_id",
        options: {
          method: "POST",
        },
      });
      const accountId = contextData ?? null;

      if (!accountId) {
        notify("Error: Unable to determine account context", { type: "error" });
        setStep("request");
        setLoading(false);
        return;
      }

      const { data } = await dataProvider.custom({
        url: "/rpc/delete_account_data",
        options: {
          method: "POST",
          body: JSON.stringify({
            p_account_id: accountId,
            p_requested_by_auth_uid: identity.id,
            p_include_export: includeExport,
          }),
        },
      });

      // Handle the result
      if (data) {
        notify("Account deletion completed successfully", { type: "success" });
        setStep("done");
      } else {
        notify("Account deletion failed: No data returned", { type: "error" });
        setStep("request");
      }
    } catch (error: any) {
      notify(`Account deletion failed: ${error.message || String(error)}`, {
        type: "error",
      });
      setStep("request");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
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
      {/* Two traps this dialog fell into, both now fixed — do not reintroduce:
          (1) `DialogContent` always renders its own `DialogPortal` +
          `DialogOverlay` + a `fixed z-50` panel (`ui/dialog.tsx`), so it can
          only ever appear ONCE per `Dialog`. Each step's body used to nest a
          second one, stacking a full-screen overlay over this dialog's own
          footer so Cancel/Confirm could not be tapped on a phone. Bodies are
          plain `<div>`s.
          (2) The action buttons passed `asChild` with a plain string child,
          which makes Radix `Slot` throw during render ("Expected a single
          React element child") — opening this dialog crashed into the app
          ErrorBoundary, making account deletion unreachable. `asChild` is for
          wrapping a single element (a `<Link>`), never text. */}
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        {step === "request" && (
          <>
            <DialogHeader>
              <DialogTitle>
                {translate("crm.profile.privacy.delete_dialog_title", {
                  _: "Deleting your family's data",
                })}
              </DialogTitle>
              <DialogDescription>
                {translate("crm.profile.privacy.delete_dialog_description", {
                  _: "To protect against accidental data loss, deletion requires confirmation and includes a cooling-off window.",
                })}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <p>
                {translate("crm.profile.privacy.delete_cooling_off", {
                  _: "After confirmation, there will be a 24-hour cooling-off period during which you can cancel the deletion.",
                })}
              </p>
              <div className="space-y-2">
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={includeExport}
                    onChange={(e) => setIncludeExport(e.target.checked)}
                    className="h-4 w-4 text-primary"
                  />
                  <span>
                    {translate("crm.profile.privacy.include_export", {
                      _: "Include data export before deletion (recommended)",
                    })}
                  </span>
                </label>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">{translate("ra.action.cancel")}</Button>
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                onClick={() => setStep("confirm")}
                disabled={loading}
              >
                {loading
                  ? translate("ra.action.deleting")
                  : translate("crm.profile.privacy.confirm_deletion", {
                      _: "Confirm deletion",
                    })}
              </Button>
            </DialogFooter>
          </>
        )}
        {step === "confirm" && (
          <>
            <DialogHeader>
              <DialogTitle>
                {translate("crm.profile.privacy.confirm_dialog_title", {
                  _: "Please confirm deletion",
                })}
              </DialogTitle>
              <DialogDescription>
                {translate("crm.profile.privacy.confirm_dialog_description", {
                  _: "This action cannot be undone. All your family's data will be permanently deleted.",
                })}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <p className="text-destructive">
                {translate("crm.profile.privacy.delete_warning", {
                  _: "Are you sure you want to delete your family's entire account and all associated data?",
                })}
              </p>
              {includeExport && (
                <p className="mb-4">
                  {translate("crm.profile.privacy.export_will_be_created", {
                    _: "A data export will be created before deletion begins.",
                  })}
                </p>
              )}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost" onClick={() => setStep("request")}>
                  {translate("ra.action.cancel")}
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={loading}
              >
                {loading
                  ? translate("ra.action.deleting")
                  : translate("crm.profile.privacy.delete_my_data", {
                      _: "Delete my data",
                    })}
              </Button>
            </DialogFooter>
          </>
        )}
        {step === "processing" && (
          <>
            <DialogHeader>
              <DialogTitle>
                {translate("crm.profile.privacy.processing_title", {
                  _: "Processing deletion request",
                })}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <p>
                {translate("crm.profile.privacy.deletion_in_progress", {
                  _: "Your deletion request is being processed. This may take several minutes.",
                })}
              </p>
              {includeExport && (
                <p>
                  {translate("crm.profile.privacy.creating_export", {
                    _: "Creating data export...",
                  })}
                </p>
              )}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost" disabled={loading}>
                  {translate("ra.action.cancel")}
                </Button>
              </DialogClose>
            </DialogFooter>
          </>
        )}
        {step === "done" && (
          <>
            <DialogHeader>
              <DialogTitle>
                {translate("crm.profile.privacy.deletion_complete_title", {
                  _: "Deletion completed",
                })}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <p>
                {translate("crm.profile.privacy.deletion_success_message", {
                  _: "Your family's data has been successfully deleted from our systems.",
                })}
              </p>
              {includeExport && (
                <p>
                  {translate("crm.profile.privacy.export_available_note", {
                    _: "An export of your data was created before deletion.",
                  })}
                </p>
              )}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost" onClick={() => setStep("request")}>
                  {translate("ra.action.close")}
                </Button>
              </DialogClose>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
