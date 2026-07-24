import { useEffect, useRef } from "react";
import { useDataProvider, useNotify } from "ra-core";
import { useNavigate, useSearchParams } from "react-router";

import type { CrmDataProvider } from "../providers/types";

/**
 * PWA share-target landing (Epic 2, mockup `isShare`). Android/WhatsApp share a
 * redt straight into the app: the manifest's `share_target` (method GET) routes
 * the shared title/text/url here; we file it as an unresolved inbox item and
 * drop the user in the Inbox to confirm it while they still remember. File
 * sharing (POST + service worker) is a follow-up; text sharing needs no worker.
 */
export const ShareTarget = () => {
  const [searchParams] = useSearchParams();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const navigate = useNavigate();
  const notify = useNotify();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const title = searchParams.get("title") ?? "";
    const text = searchParams.get("text") ?? "";
    const url = searchParams.get("url") ?? "";
    const raw = [title, text, url].filter(Boolean).join("\n").trim();

    const file = async () => {
      if (!raw) {
        navigate("/inbox_items", { replace: true });
        return;
      }
      try {
        await dataProvider.create("inbox_items", {
          data: { source: "whatsapp", raw_text: raw, status: "unresolved" },
        });
        notify("Shared to your inbox", { type: "info" });
      } catch (error) {
        notify(
          error instanceof Error ? error.message : "Couldn't file that share",
          { type: "error" },
        );
      } finally {
        navigate("/inbox_items", { replace: true });
      }
    };
    void file();
  }, [searchParams, dataProvider, navigate, notify]);

  return (
    <div className="grid min-h-[40vh] place-items-center text-sm text-muted-foreground">
      Filing what you shared…
    </div>
  );
};

ShareTarget.path = "/share";
