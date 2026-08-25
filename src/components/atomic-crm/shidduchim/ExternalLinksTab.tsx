import { useState } from "react";
import type { ChangeEvent, FormEvent, ReactElement, ReactNode } from "react";
import {
  useCreate,
  useDelete,
  useGetList,
  useNotify,
  useRecordContext,
  useRefresh,
  useTranslate,
} from "ra-core";
import type { Identifier } from "ra-core";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

import type { ShidduchExternalLink, ShidduchSummary } from "../types";
import { formatTimelineDate } from "../entity360/tabs/interactionLabels";

/**
 * Story 5.6 — the shidduch-specific External links tab (AC 2, AC 4, AC 5).
 * A bookmark to an external profile (a shidduch site, a social profile) with
 * no file behind it — deliberately NOT made polymorphic across every entity
 * (YAGNI, `.claude/rules/coding-style.md`): no other Epic 5 story asks for it
 * outside `shidduchim`, so it lives here in `shidduchim/`, unlike the
 * polymorphic Files tab, which stays in `entity360/tabs/`.
 *
 * `render` is arity-zero (contract §2 rule 4) — reaches the shidduch via
 * `useRecordContext()`, exactly like `MedicalTab`/`ResumeTab`/`PhotoTab`.
 */

/** AC 4 — a URL that does not parse is rejected before insert. `new URL()`
 * throws on anything that is not an absolute, parseable URL. */
function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function ExternalLinksSkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-3/5" />
    </div>
  );
}

function ExternalLinksEmpty(): ReactElement {
  const translate = useTranslate();
  return (
    <p className="text-sm text-muted-foreground">
      {translate("crm.entity360.external-links.empty", {
        _: "No external links yet.",
      })}
    </p>
  );
}

function ExternalLinksError(): ReactElement {
  const translate = useTranslate();
  return (
    <p role="alert" className="text-sm text-destructive">
      {translate("crm.entity360.external-links.error", {
        _: "Could not load the external links.",
      })}
    </p>
  );
}

/**
 * AC 4's add form: a URL (required, validated before insert) plus an
 * optional short label. `shidduchim_id` and `account_id` are the only two
 * columns the trigger layer does not set on the client's behalf —
 * `account_id` is server-stamped by `set_shidduchim_external_links_account_id`.
 */
function AddExternalLinkForm({
  shidduchimId,
  onAdded,
}: {
  shidduchimId: Identifier;
  onAdded: () => void;
}): ReactElement {
  const [create, { isPending }] = useCreate();
  const notify = useNotify();
  const translate = useTranslate();
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);

  const handleUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
    setUrl(event.target.value);
    if (urlError) setUrlError(null);
  };

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedUrl = url.trim();
    if (trimmedUrl === "") return;

    // AC 4 — rejected before insert with a visible message, never silently
    // dropped.
    if (!isValidUrl(trimmedUrl)) {
      setUrlError(
        translate("crm.entity360.external-links.invalidUrl", {
          _: "Enter a valid URL (including https://).",
        }),
      );
      return;
    }

    try {
      await create(
        "shidduchim_external_links",
        {
          data: {
            shidduchim_id: shidduchimId,
            url: trimmedUrl,
            label: label.trim() === "" ? null : label.trim(),
          },
        },
        { returnPromise: true },
      );
      setUrl("");
      setLabel("");
      onAdded();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.entity360.external-links.addError", {
              _: "Failed to add the link",
            }),
        { type: "error" },
      );
    }
  };

  return (
    <form className="flex flex-col gap-2" onSubmit={handleAdd} noValidate>
      {/* A real <Label>, not the placeholder-plus-aria-label this used to be:
          the placeholder disappears at the first keystroke, and the field it
          was naming is the one whose value has to be an absolute URL. */}
      <Label htmlFor="external-link-url">
        {translate("crm.entity360.external-links.urlLabel", {
          _: "Link URL",
        })}
      </Label>
      <Input
        id="external-link-url"
        // `type="url"` + `inputMode="url"` is what puts "/" and ".com" on a
        // phone keyboard for a field that rejects anything `new URL()` cannot
        // parse. The form is `noValidate`, so the native constraint never
        // pre-empts this component's own visible message (AC 4).
        type="url"
        inputMode="url"
        autoComplete="url"
        autoCapitalize="none"
        spellCheck={false}
        value={url}
        onChange={handleUrlChange}
        placeholder={translate("crm.entity360.external-links.urlPlaceholder", {
          _: "https://example.com/profile",
        })}
        aria-invalid={urlError != null}
      />
      {urlError ? (
        <p role="alert" className="text-xs text-destructive">
          {urlError}
        </p>
      ) : null}
      <Label htmlFor="external-link-label">
        {translate("crm.entity360.external-links.labelLabel", {
          _: "Label (optional)",
        })}
      </Label>
      <Input
        id="external-link-label"
        type="text"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        placeholder={translate(
          "crm.entity360.external-links.labelPlaceholder",
          { _: "Label (optional)" },
        )}
      />
      <div className="flex justify-end">
        <Button
          type="submit"
          variant="secondary"
          disabled={isPending || url.trim() === ""}
        >
          {translate("crm.entity360.external-links.add", { _: "Add link" })}
        </Button>
      </div>
    </form>
  );
}

/**
 * AC 5 — `target="_blank" rel="noopener noreferrer"` is non-negotiable: it
 * is what makes "share nothing back" true (no `window.opener` handoff, no
 * referrer leaked to the linked site).
 */
function ExternalLinkRow({
  link,
  onChanged,
}: {
  link: ShidduchExternalLink;
  onChanged: () => void;
}): ReactElement {
  const [deleteOne, { isPending }] = useDelete();
  const notify = useNotify();
  const translate = useTranslate();
  // A delete with no undo behind it: the row asks in place rather than
  // opening a sheet, so the question stays next to the link it is about.
  const [isConfirming, setIsConfirming] = useState(false);

  const handleRemove = async () => {
    setIsConfirming(false);
    try {
      await deleteOne(
        "shidduchim_external_links",
        { id: link.id, previousData: link },
        { returnPromise: true },
      );
      onChanged();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.entity360.external-links.removeError", {
              _: "Failed to remove the link",
            }),
        { type: "error" },
      );
    }
  };

  const displayLabel =
    link.label && link.label.trim() !== "" ? link.label : link.url;

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3 last:border-b-0">
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 truncate text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {displayLabel}
      </a>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground">
          {formatTimelineDate(link.created_at)}
        </span>
        {isConfirming ? (
          <>
            <span className="text-xs text-muted-foreground">
              {translate("crm.entity360.external-links.confirmRemove", {
                _: "Remove this link?",
              })}
            </span>
            {/* `min-h-11 md:min-h-8`: `size="sm"` is a flat `h-8` (32px), below
                the touch floor, and this one deletes something. */}
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="min-h-11 md:min-h-8"
              disabled={isPending}
              onClick={handleRemove}
            >
              {translate("crm.entity360.external-links.confirmRemoveAction", {
                _: "Yes, remove",
              })}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11 md:min-h-8"
              onClick={() => setIsConfirming(false)}
            >
              {translate("crm.entity360.external-links.cancelRemove", {
                _: "Cancel",
              })}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 md:min-h-8"
            disabled={isPending}
            onClick={() => setIsConfirming(true)}
          >
            {translate("crm.entity360.external-links.remove", {
              _: "Remove",
            })}
          </Button>
        )}
      </div>
    </li>
  );
}

function ExternalLinksContent({
  shidduchimId,
}: {
  shidduchimId: Identifier;
}): ReactElement {
  const refresh = useRefresh();
  const { data, error, isPending } = useGetList<ShidduchExternalLink>(
    "shidduchim_external_links",
    {
      filter: { shidduchim_id: shidduchimId },
      sort: { field: "created_at", order: "DESC" },
      pagination: { page: 1, perPage: 50 },
    },
  );

  return (
    <div className="flex flex-col gap-4">
      <AddExternalLinkForm shidduchimId={shidduchimId} onAdded={refresh} />
      {isPending ? (
        <ExternalLinksSkeleton />
      ) : error ? (
        <ExternalLinksError />
      ) : !data || data.length === 0 ? (
        <ExternalLinksEmpty />
      ) : (
        <ul className="flex flex-col gap-3">
          {data.map((link) => (
            <ExternalLinkRow
              key={String(link.id)}
              link={link}
              onChanged={refresh}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The shidduch descriptor's `external-links` tab entry point (AC 2, AC 4,
 * AC 5). `render` is arity-zero (contract §2 rule 4) — reaches the shidduch
 * via `useRecordContext()`, exactly like `ResumeTab`/`PhotoTab`/`MedicalTab`.
 */
export function ExternalLinksTab(): ReactNode {
  const record = useRecordContext<ShidduchSummary>();
  if (!record) return null;

  return <ExternalLinksContent shidduchimId={record.id} />;
}
