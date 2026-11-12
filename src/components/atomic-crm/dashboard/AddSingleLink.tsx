import { Link } from "react-router";

import { buildNewPath } from "../entity360/entityPaths";
import { useCanAddSingle } from "./useCanAddSingle";

/**
 * The dashboard entry point for the existing single create flow. The
 * database permits creation only for a non-single member in the active
 * context; this client gate keeps a single-role viewer from being offered a
 * route the server will refuse, while leaving household and shadchanus
 * contexts on their own account-scoped create path.
 */
export const AddSingleLink = () => {
  const canAddSingle = useCanAddSingle();

  if (!canAddSingle) return null;

  return (
    <Link
      to={buildNewPath("singles")}
      className="inline-flex min-h-11 items-center rounded-xl border border-border
        bg-background px-4 font-semibold text-foreground
        transition-[background-color,transform] duration-[160ms]
        hover:bg-muted active:scale-[0.97]
        focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
        focus-visible:ring-offset-background outline-none"
    >
      Add a single
    </Link>
  );
};
