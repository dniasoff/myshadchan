import * as React from "react";
import { useCallback, useEffect } from "react";
import type { ToasterProps } from "sonner";
import { Toaster, toast } from "sonner";
import { useTheme } from "@/components/admin/use-theme";
import {
  CloseNotificationContext,
  useNotificationContext,
  useTakeUndoableMutation,
  useTranslate,
} from "ra-core";

/**
 * Displays notifications triggered with the useNotify hook.
 *
 * Supports different notification types (info, success, warning, error) and undoable mutations.
 * Automatically adapts to the current theme (light/dark).
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/notification Notification documentation}
 * @see {@link https://marmelab.com/ra-core/usenotify/ useNotify hook}
 *
 * @example
 * // Trigger a notification
 * import { useNotify } from 'ra-core';
 *
 * const NotifyButton = () => {
 *   const notify = useNotify();
 *   const handleClick = () => {
 *     notify('Comment approved', { type: 'success' });
 *   };
 *   return <button onClick={handleClick}>Notify</button>;
 * };
 */
export const Notification = (props: ToasterProps) => {
  const translate = useTranslate();
  const { notifications, takeNotification } = useNotificationContext();
  const takeMutation = useTakeUndoableMutation();
  const { theme } = useTheme();

  useEffect(() => {
    if (notifications.length) {
      const notification = takeNotification();
      if (notification) {
        const { message, type = "info", notificationOptions } = notification;
        const { messageArgs, undoable, autoHideDuration } =
          notificationOptions || {};

        const beforeunload = (e: BeforeUnloadEvent) => {
          e.preventDefault();
          const confirmationMessage = "";
          e.returnValue = confirmationMessage;
          return confirmationMessage;
        };

        if (undoable) {
          window.addEventListener("beforeunload", beforeunload);
        }

        const mutation = takeMutation();
        let mutationFinalized = false;

        const finalizeMutation = (isUndo: boolean) => {
          if (mutationFinalized) return;
          mutationFinalized = true;
          mutation?.({ isUndo });
          window.removeEventListener("beforeunload", beforeunload);
        };

        const handleExited = () => {
          if (undoable) {
            finalizeMutation(false);
          }
        };

        const handleUndo = (toastId: string | number) => {
          finalizeMutation(true);
          toast.dismiss(toastId);
        };

        const finalMessage = message
          ? typeof message === "string"
            ? translate(message, messageArgs)
            : React.isValidElement(message)
              ? message
              : undefined
          : undefined;

        const duration =
          autoHideDuration === null ? Infinity : autoHideDuration;

        if (undoable) {
          toast.custom(
            (toastId) => (
              <div
                role="status"
                aria-live="polite"
                className="flex items-center gap-3 rounded-md border bg-background px-4 py-3 text-foreground shadow-lg"
              >
                <span className="flex-1">{finalMessage}</span>
                <button
                  type="button"
                  className="min-h-11 min-w-11 rounded-md px-3 font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleUndo(toastId);
                  }}
                >
                  {translate("ra.action.undo")}
                </button>
                <button
                  type="button"
                  aria-label="Close toast"
                  className="min-h-11 min-w-11 rounded-md px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={(event) => {
                    event.stopPropagation();
                    finalizeMutation(false);
                    toast.dismiss(toastId);
                  }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            ),
            {
              duration,
              closeButton: true,
              onDismiss: handleExited,
              onAutoClose: handleExited,
            },
          );
        } else {
          toast[type](finalMessage, { duration });
        }
      }
    }
  }, [notifications, takeMutation, takeNotification, translate]);

  const handleRequestClose = useCallback(() => {
    // Dismiss all toasts
    toast.dismiss();
  }, []);

  return (
    <CloseNotificationContext.Provider value={handleRequestClose}>
      <Toaster
        richColors
        theme={theme}
        closeButton
        position="bottom-center"
        {...props}
      />
    </CloseNotificationContext.Provider>
  );
};
