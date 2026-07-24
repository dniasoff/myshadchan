import type { Identifier } from "ra-core";
import { useDataProvider, useNotify } from "ra-core";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import { buildPortalUrl } from "../portal/portalToken";
import type { CrmDataProvider } from "../providers/types";
import type { ChildPortalToken } from "../types";

interface ChildPortalShareProps {
  childId: Identifier;
  childName?: string | null;
}

/**
 * Parent-side control for the read-only child portal (E7). Mints, shows, copies,
 * rotates and revokes the unguessable per-child link. It writes through the
 * authenticated data provider (RLS scopes every token to this account); the
 * secret itself is generated server-side — the client only ever reads it back.
 */
export const ChildPortalShare = ({
  childId,
  childName,
}: ChildPortalShareProps) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const [token, setToken] = useState<ChildPortalToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let isStale = false;
    setLoading(true);
    dataProvider
      .getActiveChildPortalToken(childId)
      .then((active) => {
        if (!isStale) setToken(active);
      })
      .catch(() => {
        if (!isStale) setToken(null);
      })
      .finally(() => {
        if (!isStale) setLoading(false);
      });
    return () => {
      isStale = true;
    };
  }, [dataProvider, childId]);

  const who = childName?.trim() || "this child";
  const portalUrl = token
    ? buildPortalUrl(window.location.origin, token.token)
    : null;

  const mint = useCallback(async () => {
    setBusy(true);
    try {
      const created = await dataProvider.mintChildPortalToken(childId);
      setToken(created);
      notify("Portal link created", { type: "info" });
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Failed to create the link",
        { type: "error" },
      );
    } finally {
      setBusy(false);
    }
  }, [dataProvider, childId, notify]);

  const revoke = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    try {
      await dataProvider.revokeChildPortalToken(token.id);
      setToken(null);
      notify("Portal link revoked", { type: "info" });
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Failed to revoke the link",
        { type: "error" },
      );
    } finally {
      setBusy(false);
    }
  }, [dataProvider, token, notify]);

  const rotate = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    try {
      await dataProvider.revokeChildPortalToken(token.id);
      const created = await dataProvider.mintChildPortalToken(childId);
      setToken(created);
      notify("New portal link created; the old one no longer works", {
        type: "info",
      });
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Failed to rotate the link",
        { type: "error" },
      );
    } finally {
      setBusy(false);
    }
  }, [dataProvider, token, childId, notify]);

  const copy = useCallback(async () => {
    if (!portalUrl) return;
    try {
      await navigator.clipboard.writeText(portalUrl);
      notify("Link copied", { type: "info" });
    } catch {
      notify("Copy failed — select and copy the link manually", {
        type: "warning",
      });
    }
  }, [portalUrl, notify]);

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h3 className="font-display text-lg font-semibold">Share with {who}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        A calm, read-only view of what&rsquo;s being looked into — only shared
        suggestions still in progress. No diligence, notes or private items.
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
      ) : portalUrl ? (
        <div className="mt-4 flex flex-col gap-3">
          <input
            readOnly
            value={portalUrl}
            aria-label="Portal link"
            onFocus={(event) => event.currentTarget.select()}
            className="w-full truncate rounded-xl border border-input bg-background px-3 py-2 font-mono text-xs text-muted-foreground"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={copy} disabled={busy}>
              Copy link
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={rotate}
              disabled={busy}
            >
              New link
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={revoke}
              disabled={busy}
            >
              Revoke
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Anyone with this link can view the shared list. &ldquo;New
            link&rdquo; replaces it and stops the old one from working.
          </p>
        </div>
      ) : (
        <div className="mt-4">
          <Button type="button" onClick={mint} disabled={busy}>
            Create a link
          </Button>
        </div>
      )}
    </section>
  );
};
