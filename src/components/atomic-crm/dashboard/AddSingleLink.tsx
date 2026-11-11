import { Link } from "react-router";

import { buildNewPath } from "../entity360/entityPaths";
import { useViewerRole } from "../entity360/useViewerRole";

/**
 * The dashboard entry point for the existing single create flow. The
 * database permits creation only for a non-single member in the active
 * context; this client gate keeps a single-role viewer from being offered a
 * route the server will refuse, while leaving household and shadchanus
 * contexts on their own account-scoped create path.
 */
export const AddSingleLink = () => {
  const { role, isPending } = useViewerRole();

  if (isPending || role == null || role === "single") return null;

  return (
    <Link
      to={buildNewPath("singles")}
      className="inline-flex min-h-11 items-center rounded-xl px-4
        font-semibold text-primary-foreground
        bg-[linear-gradient(135deg,var(--accent-grad-from),var(--accent-grad-to))]
        shadow-sm shadow-[0_8px_24px_-6px_var(--glow-accent)]
        transition-[transform,box-shadow] duration-[160ms] ease-[var(--ease-spring)]
        hover:shadow-[0_10px_30px_-6px_var(--glow-accent-strong)]
        active:scale-[0.97]
        focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
        focus-visible:ring-offset-background outline-none"
    >
      Add a single
    </Link>
  );
};
