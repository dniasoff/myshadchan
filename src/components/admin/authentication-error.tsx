import { History, TriangleAlert } from "lucide-react";
import { Translate } from "ra-core";
import { Button } from "@/components/ui/button";

/**
 * Fallback page displayed when an access check throws
 * (reached via `useRequireAccess` / `<CanAccess>`'s default error element).
 */
export const AuthenticationError = () => {
  return (
    <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center gap-2 text-center">
      <TriangleAlert className="h-16 w-16 text-muted-foreground" />
      <h1 className="text-2xl font-semibold">
        <Translate i18nKey="ra.page.authentication_error" />
      </h1>
      <p className="max-w-xl text-muted-foreground">
        <Translate i18nKey="ra.message.authentication_error" />
      </p>
      <Button className="mt-3 cursor-pointer" onClick={goBack}>
        <History />
        <Translate i18nKey="ra.action.back" />
      </Button>
    </div>
  );
};

function goBack() {
  window.history.go(-1);
}
