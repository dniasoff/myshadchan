import { SaveButton } from "@/components/admin/form";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  EditBase,
  Form,
  useEditContext,
  useNotify,
  useRedirect,
  useResourceContext,
  useTranslate,
  type EditBaseProps,
  type FormProps,
  type RedirectionSideEffect,
} from "ra-core";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { getEntityDescriptor } from "../entity360/registry";
import { redirectToRecord } from "../entity360/routeConvention";

export interface EditSheetProps extends EditBaseProps {
  /**
   * The children elements that will be rendered inside the sheet as form inputs
   */
  children: ReactNode;

  /**
   * Controls whether the sheet is open
   */
  open: boolean;

  /**
   * Callback fired when the sheet open state changes
   */
  onOpenChange: (open: boolean) => void;

  /**
   * The title displayed in the sheet header
   */
  title?: ReactNode;

  /**
   * Default values for the form
   */
  defaultValues?: FormProps["defaultValues"];

  /**
   * Optional actions to render in the sheet header, next to the title
   */
  headerActions?: ReactNode;
}

/**
 * A Sheet component that contains an edit form with externally controlled open state.
 *
 * Renders a Sheet containing an EditBase form. The sheet has a fixed footer with Save and Delete buttons.
 * The open state is controlled externally via the open and onOpenChange props. The sheet will automatically
 * close itself on successful submission (if redirect is false) or when the Delete/Close actions are triggered.
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false);
 *
 * return (
 *   <>
 *     <Button onClick={() => setOpen(true)}>Edit Task</Button>
 *     <EditSheet
 *       resource="tasks"
 *       id={taskId}
 *       title="Edit Task"
 *       open={open}
 *       onOpenChange={setOpen}
 *     >
 *       <TextInput source="text" />
 *       <TextInput source="type" />
 *       <DateTimeInput source="due_date" />
 *     </EditSheet>
 *   </>
 * );
 * ```
 */
export const EditSheet = ({
  children,
  open,
  onOpenChange,
  title,
  redirect: redirectProp,
  mutationOptions,
  mutationMode = "undoable",
  defaultValues,
  headerActions,
  ...editBaseProps
}: EditSheetProps) => {
  const resource = useResourceContext(editBaseProps);
  const translate = useTranslate();
  const notify = useNotify();
  const redirect = useRedirect();
  // AD-24 (Story 3.12 AC 4): an unspecified `redirect` must not silently
  // resolve through `useRedirect`'s hardcoded `/{resource}/{id}/show`
  // (`useRedirect.js:55`) for a migrated entity — that is exactly the dead
  // URL this story retires everywhere else. A resource with a registered
  // entity descriptor defaults to `redirectToRecord`, which follows
  // `buildRecordPath` (and so tracks Epic 5's flip automatically); a
  // resource with none (e.g. `tasks`) keeps today's `"show"` verb, since it
  // has no AD-24 shape to diverge from.
  const redirectTo: RedirectionSideEffect =
    redirectProp ??
    (resource && getEntityDescriptor(resource) ? redirectToRecord : "show");

  // Handle success - close sheet in addition to default behavior
  const handleSuccess = (...args: any[]) => {
    if (mutationOptions?.onSuccess) {
      return mutationOptions.onSuccess(
        ...(args as Parameters<typeof mutationOptions.onSuccess>),
      );
    }
    const [data] = args;
    notify(`resources.${resource}.notifications.updated`, {
      type: "info",
      messageArgs: {
        smart_count: 1,
        _: translate(`ra.notification.updated`, {
          smart_count: 1,
        }),
      },
      undoable: mutationMode === "undoable",
    });
    redirect(redirectTo, resource, data.id, data);
    onOpenChange(false);
  };

  const enhancedMutationOptions = {
    ...mutationOptions,
    onSuccess: handleSuccess,
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-dvh flex flex-col"
        aria-describedby={undefined}
      >
        <EditBase
          {...editBaseProps}
          redirect={redirectTo}
          mutationOptions={enhancedMutationOptions}
          mutationMode={mutationMode}
        >
          <Form defaultValues={defaultValues} className="flex-1 flex flex-col">
            <SheetHeader className="border-b">
              <div
                className={cn(
                  "flex items-center gap-2",
                  headerActions && "pr-12",
                )}
              >
                <SheetTitle className="min-w-0 flex-1 truncate">
                  <EditSheetTitle title={title} />
                </SheetTitle>
                {headerActions && (
                  <div className="shrink-0">{headerActions}</div>
                )}
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto flex flex-col gap-3 p-4">
              {children}
            </div>

            {/* The sheet is anchored to `bottom-0`, so without the inset the
             * primary action sits partly under an iPhone's home-indicator
             * gesture area — `SheetFooter`'s own padding is a flat `p-4`.
             * The app's mobile nav already folds the same
             * `env(safe-area-inset-bottom)` in (`--mobile-nav-clearance` in
             * `src/index.css`, `layout/MobileNavigation.tsx`). */}
            <SheetFooter className="border-t flex flex-row w-full gap-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <SaveButton className="flex-1 h-12" />
            </SheetFooter>
          </Form>
        </EditBase>
      </SheetContent>
    </Sheet>
  );
};

const EditSheetTitle = ({ title }: { title?: ReactNode | string | false }) => {
  const { defaultTitle } = useEditContext();

  if (title === false) {
    return null;
  }

  const resolvedTitle = title === undefined ? defaultTitle : title;
  if (resolvedTitle == null) {
    return null;
  }

  return typeof resolvedTitle === "string" ? (
    <span className="text-xl font-semibold">{resolvedTitle}</span>
  ) : (
    resolvedTitle
  );
};
