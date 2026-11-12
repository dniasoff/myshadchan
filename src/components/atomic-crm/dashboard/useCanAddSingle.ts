import { useViewerRole } from "../entity360/useViewerRole";

/**
 * The active-context roles that may create a single. Keep this decision in
 * one place so dashboard and roster entry points mirror the database rule.
 */
export function useCanAddSingle() {
  const { role, isPending } = useViewerRole();
  return !isPending && role != null && role !== "single";
}
