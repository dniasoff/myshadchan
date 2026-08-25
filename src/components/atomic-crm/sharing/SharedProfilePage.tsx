import { useEffect, useState } from "react";

import {
  loadSharedProfile,
  resolveShareFileUrl,
  type SharedProfileData,
  type SharedProfileFile,
} from "./shareClient";
import { readShareToken, type ShareUrl } from "./shareToken";
import { translateSharedProfile } from "./sharedProfileTranslate";

type LoadState =
  | { phase: "loading" }
  | { phase: "active"; data: SharedProfileData }
  | { phase: "inactive" };

export interface SharedProfilePageProps {
  /** Injectable for tests; defaults to the real `window.location`. */
  url?: ShareUrl;
  /** Injectable loader; defaults to the Worker fetch client. */
  loadProfile?: (token: string) => Promise<SharedProfileData | null>;
}

/** A calm reading surface with a soft ambient glow — the same visual
 * language the retired token-portal page (deleted, Epic 1 Story 1.4) and
 * `PublicSearchPage.tsx` (Story 9.4) both used, so this pre-CRM surface
 * reads as one family rather than three one-offs. */
const ShareShell = ({ children }: { children: React.ReactNode }) => (
  <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{
        background:
          "radial-gradient(120% 80% at 50% -10%, color-mix(in oklch, var(--primary) 14%, transparent), transparent 60%), radial-gradient(90% 60% at 100% 0%, color-mix(in oklch, var(--violet, var(--primary)) 12%, transparent), transparent 55%)",
      }}
    />
    <main className="relative mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 py-14 sm:py-20">
      {children}
    </main>
  </div>
);

const InactiveNotice = () => (
  <ShareShell>
    <div className="m-auto max-w-md text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        MyShadchan
      </p>
      <h1 className="mt-4 font-display text-2xl font-bold tracking-tight">
        {translateSharedProfile(
          "crm.sharing.shared_profile.inactive_title",
          "This link is no longer active",
        )}
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {translateSharedProfile(
          "crm.sharing.shared_profile.inactive_body",
          "If you were expecting to see something here, please ask the person who shared this link to send you a new one.",
        )}
      </p>
    </div>
  </ShareShell>
);

const LoadingNotice = () => (
  <ShareShell>
    <div className="m-auto" aria-busy="true" aria-live="polite">
      <span className="sr-only">
        {translateSharedProfile(
          "crm.sharing.shared_profile.loading",
          "Loading",
        )}
      </span>
      <div
        className="h-10 w-10 rounded-full border-2 border-transparent"
        style={{
          borderTopColor: "var(--primary)",
          borderRightColor:
            "color-mix(in oklch, var(--primary) 40%, transparent)",
          animation: "spin 0.9s linear infinite",
        }}
      />
    </div>
  </ShareShell>
);

const isPhoto = (file: SharedProfileFile): boolean => file.fileKey === "photo";

const FileRow = ({ file }: { file: SharedProfileFile }) => (
  <a
    href={resolveShareFileUrl(file.downloadUrl)}
    // AC-3: every downloadUrl is a same-origin-to-the-Worker path, never a
    // raw or signed Storage URL — this anchor's own href is exactly the
    // opaque manifest entry, unmodified.
    download={file.filename ?? undefined}
    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/50 px-4 py-3 text-sm hover:bg-card"
  >
    <span className="truncate">
      {file.filename ??
        translateSharedProfile(
          "crm.sharing.shared_profile.resume_file",
          "Resume",
        )}
    </span>
    <span className="shrink-0 text-xs font-medium text-muted-foreground">
      {translateSharedProfile(
        "crm.sharing.shared_profile.download",
        "Download",
      )}
    </span>
  </a>
);

const ProfileContent = ({ data }: { data: SharedProfileData }) => {
  const firstName =
    data.single.first_name_en?.trim() ||
    data.single.first_name_he?.trim() ||
    null;
  const heading = firstName
    ? translateSharedProfile(
        "crm.sharing.shared_profile.heading_named",
        "%{name}'s profile",
        { name: firstName },
      )
    : translateSharedProfile(
        "crm.sharing.shared_profile.heading",
        "Shared profile",
      );

  const photo = data.files.find(isPhoto);
  const resumeFiles = data.files.filter((file) => !isPhoto(file));

  return (
    <ShareShell>
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          MyShadchan
        </p>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">
          {heading}
        </h1>
      </header>

      {photo ? (
        <img
          src={resolveShareFileUrl(photo.downloadUrl)}
          alt={heading}
          className="mb-6 aspect-square w-full max-w-xs rounded-2xl object-cover"
        />
      ) : null}

      {resumeFiles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {translateSharedProfile(
              "crm.sharing.shared_profile.no_files",
              "No resume has been shared here yet.",
            )}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {resumeFiles.map((file) => (
            <FileRow key={file.fileKey} file={file} />
          ))}
        </div>
      )}

      <footer className="mt-auto pt-12">
        <p className="text-xs text-muted-foreground">
          {translateSharedProfile(
            "crm.sharing.shared_profile.footer",
            "This is a private link shared with you. Only what was chosen to share appears here.",
          )}
        </p>
      </footer>
    </ShareShell>
  );
};

/**
 * The unauthenticated, read-only recipient page for a share link (Story
 * 9.5, `/share#<token>`). Rendered OUTSIDE the CRM's authed routes
 * (`App.tsx`), mirroring the retired token-portal page's (deleted, Epic 1
 * Story 1.4) unauthenticated-shell pattern exactly: it reads the token from
 * the URL fragment and asks the `share/` Worker what to show; every access
 * decision (revoked/expired/unknown — all the identical inactive state,
 * AC-7) is made server-side. No login, no `dataProvider`.
 */
export const SharedProfilePage = ({
  url = window.location,
  loadProfile = loadSharedProfile,
}: SharedProfilePageProps) => {
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  useEffect(() => {
    const token = readShareToken(url);
    if (!token) {
      setState({ phase: "inactive" });
      return;
    }
    let isStale = false;
    loadProfile(token)
      .then((data) => {
        if (isStale) return;
        setState(data ? { phase: "active", data } : { phase: "inactive" });
      })
      .catch(() => {
        // Fail soft: a transport or config error reads as an inactive link,
        // never a crash, and no error detail is surfaced to an anonymous
        // recipient.
        if (!isStale) {
          setState({ phase: "inactive" });
        }
      });
    return () => {
      isStale = true;
    };
  }, [loadProfile, url]);

  if (state.phase === "loading") {
    return <LoadingNotice />;
  }
  if (state.phase === "inactive") {
    return <InactiveNotice />;
  }
  return <ProfileContent data={state.data} />;
};
