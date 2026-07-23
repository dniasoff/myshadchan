/**
 * Shared input recipe for the auth cluster (design-language.md §5, auth
 * redesign spec §5 "Inputs"): a 44px+ target, solid/opaque surface (the
 * card around it is glass — the field itself stays legible per §6.4), and a
 * clear indigo focus ring/glow. Reused by every auth input so login, signup,
 * forgot-password and set-password fields read as one system.
 */
export const AUTH_FIELD_CLASSNAME =
  "h-11 rounded-lg bg-input/40 " +
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0";
