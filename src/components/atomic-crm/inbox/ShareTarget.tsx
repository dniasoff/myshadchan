import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { Identifier, SupportCreateSuggestionOptions } from "ra-core";
import {
  Form,
  useDataProvider,
  useGetList,
  useNotify,
  useTranslate,
} from "ra-core";
import { useNavigate, useSearchParams } from "react-router";

import { AutocompleteInput } from "@/components/admin/autocomplete-input";
import { SaveButton } from "@/components/admin/form";
import { ReferenceInput } from "@/components/admin/reference-input";
import { FormToolbar } from "@/components/admin/simple-form";
import { cn } from "@/lib/utils";

import { uploadToBucket } from "../providers/supabase/dataProvider";
import type { CrmDataProvider } from "../providers/types";
import type {
  CreateShidduchInput,
  InboxItem,
  InboxSource,
  RAFile,
  Single,
} from "../types";
import { INBOX_PRIMARY_CTA_CLASS, INBOX_SOURCE_META } from "./inboxMeta";
import { LinkToShidduchSearch } from "./LinkToShidduchSearch";
import { useResolveInboxItem } from "./useResolveInboxItem";

/**
 * Story 10.1 (Task 1): must match `src/sw.ts`'s own copy of these three
 * literals exactly — that file's own header explains why they cannot be
 * imported from one shared module (it is a separate build, the service
 * worker bundle, not the app bundle this file ships in). Keep both in sync
 * if either changes.
 *
 * The leading "/" is load-bearing, not stylistic: `Cache.match()` parses a
 * bare string key as a URL, and a key without one (e.g. "<uuid>:manifest")
 * gets its UUID read as a URL SCHEME by the real Cache API, which rejects it
 * — `src/sw.ts`'s own header comment has the full reproduction.
 */
const SHARE_TARGET_CACHE = "share-target-inbox";
const shareTargetManifestKey = (shareKey: string) =>
  `/share-target-inbox/${shareKey}/manifest`;
const shareTargetFileKey = (shareKey: string, index: number) =>
  `/share-target-inbox/${shareKey}/${index}`;

/** The three source choices AC 2 renders — a plain three-way toggle, not a
 * new resource. `InboxSource` also has `"email"`/`"upload"`/`"shadchan"`,
 * none reachable from a share sheet. */
type ShareSourceTab = Extract<InboxSource, "whatsapp" | "sms" | "photo">;
const SOURCE_TABS: ShareSourceTab[] = ["whatsapp", "sms", "photo"];

/** The exact `{title, type, path, src}` shape `postmark/
 * extractAndUploadAttachments.ts` writes for an emailed attachment (AD-6:
 * one attachment shape across channels, one renderer). Declared locally
 * rather than imported from `../types` — `InboxItem.attachments` is
 * `unknown[] | null` there today; a specific shape is still assignable to
 * it either way, so this file does not need to wait on that type changing. */
type SharedAttachment = {
  title: string;
  type: string;
  path: string;
  src: string;
};

type SharedFileManifestEntry = { name: string; type: string };

/** Task 1's counterpart read: the `fetch` handler in `src/sw.ts` stores each
 * shared file (plus a small JSON manifest recording name/type, since a
 * cached `Response` carries bytes and a content-type but no filename) and
 * redirects here with `?shareKey=…`. Reading it back rebuilds real `File`s;
 * the cache entries are deleted immediately after so a page refresh never
 * re-imports the same files. */
async function readSharedFiles(shareKey: string): Promise<File[]> {
  if (typeof caches === "undefined") return [];
  const cache = await caches.open(SHARE_TARGET_CACHE);
  const manifestResponse = await cache.match(shareTargetManifestKey(shareKey));
  if (!manifestResponse) return [];
  const manifest = (await manifestResponse.json()) as SharedFileManifestEntry[];
  const files = await Promise.all(
    manifest.map(async (entry, index) => {
      const fileResponse = await cache.match(
        shareTargetFileKey(shareKey, index),
      );
      const blob = fileResponse
        ? await fileResponse.blob()
        : new Blob([], { type: entry.type });
      return new File([blob], entry.name, { type: entry.type });
    }),
  );
  await Promise.all([
    cache.delete(shareTargetManifestKey(shareKey)),
    ...manifest.map((_, index) =>
      cache.delete(shareTargetFileKey(shareKey, index)),
    ),
  ]);
  return files;
}

/** Task 4: uploads through the SAME primitive `members.avatar` already
 * uses (`uploadToBucket`, exported this story) rather than a second upload
 * path — one upload primitive across every entry point. */
async function uploadSharedFiles(files: File[]): Promise<SharedAttachment[]> {
  const uploaded: SharedAttachment[] = [];
  for (const file of files) {
    const objectUrl = URL.createObjectURL(file);
    try {
      const raFile: RAFile = {
        src: objectUrl,
        title: file.name,
        rawFile: file,
        type: file.type,
      };
      const result = await uploadToBucket(raFile);
      uploaded.push({
        title: result.title,
        type: result.type ?? file.type,
        path: result.path ?? "",
        src: result.src,
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
  return uploaded;
}

/**
 * PWA share-target landing (Epic 2, mockup `isShare`; Story 10.1 replaces
 * the auto-file-and-redirect body this used to have). Android/WhatsApp/SMS
 * share a redt straight into the app; `public/manifest.json`'s
 * `share_target` (now Level 2, POST) routes text AND files through
 * `src/sw.ts`'s `fetch` handler to this screen, which lets the user set the
 * source, resolve who sent it and who it's for, optionally link it to an
 * existing suggestion instead of creating a new one, or skip straight to
 * the Inbox — never losing the capture (AC 6).
 */
export const ShareTarget = () => {
  const [searchParams] = useSearchParams();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { resolveAsNewShidduch, resolveAsLinkToExisting } =
    useResolveInboxItem();
  const navigate = useNavigate();
  const notify = useNotify();
  const translate = useTranslate();
  const handled = useRef(false);

  const title = searchParams.get("title") ?? "";
  const text = searchParams.get("text") ?? "";
  const url = searchParams.get("url") ?? "";
  const shareKey = searchParams.get("shareKey");
  const rawText = [title, text, url].filter(Boolean).join("\n").trim();

  // `null` = still resolving from the Cache API (only when a `shareKey` was
  // handed off); an empty array covers both "no shareKey" and "no files".
  const [files, setFiles] = useState<File[] | null>(null);
  const [sourceTab, setSourceTab] = useState<ShareSourceTab | null>(null);
  const [singleId, setSingleId] = useState<Identifier | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  // AC 1: read the shared file(s) back exactly once per landing.
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    if (!shareKey) {
      setFiles([]);
      return;
    }
    void readSharedFiles(shareKey).then(setFiles);
  }, [shareKey]);

  // AC 2: default to "Photo" when a file was shared, "WhatsApp" otherwise —
  // set once, the moment `files` first resolves; never overridden after,
  // so the user's own tab choice (AC 2: "changeable before saving") sticks.
  useEffect(() => {
    if (files === null || sourceTab !== null) return;
    setSourceTab(files.length > 0 ? "photo" : "whatsapp");
  }, [files, sourceTab]);

  // No worker/query-string share landed here at all (a direct, un-shared
  // visit to /#/share) — nothing to file, matching the previous
  // auto-redirect's fast path.
  useEffect(() => {
    if (files !== null && files.length === 0 && rawText === "") {
      navigate("/inbox_items", { replace: true });
    }
  }, [files, rawText, navigate]);

  // Image thumbnails (Task 4: "a preview of the raw text or image(s)").
  // Revoked on every recompute so a re-share never leaks the previous set.
  useEffect(() => {
    const urls = (files ?? [])
      .filter((file) => file.type.startsWith("image/"))
      .map((file) => URL.createObjectURL(file));
    setPreviewUrls(urls);
    return () => {
      urls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
    };
  }, [files]);

  // AC 4: a household with exactly one single needs no picker — nothing to
  // disambiguate. `ShidduchInputs.tsx`'s own `single_id` ReferenceInput
  // excludes archived singles the same way (2.5 AC-8).
  const { data: singles } = useGetList<Single>("singles", {
    filter: { "status@neq": "archived" },
    pagination: { page: 1, perPage: 50 },
    sort: { field: "first_name_en", order: "ASC" },
  });

  useEffect(() => {
    if (singleId == null && singles && singles.length === 1) {
      setSingleId(singles[0].id);
    }
  }, [singles, singleId]);

  // AC 3's inline "+ Add a shadchan" (FR78): the same
  // `dataProvider.create("shadchanim", …)` call `ShidduchInputs.tsx`'s new
  // `onCreateShadchan` prop (this story) plumbs through everywhere it's
  // reused.
  const handleCreateShadchan: SupportCreateSuggestionOptions["onCreate"] =
    async (filter) => {
      const { data } = await dataProvider.create("shadchanim", {
        data: { name: filter ?? "" },
      });
      return data;
    };

  /** Task 4: "creates the inbox_items row first" — shared by "Save" and by
   * every "Link" press in `LinkToShidduchSearch`, so the raw capture (and
   * any shared photo) is preserved identically no matter which resolve path
   * runs next, including a bare "Skip". */
  const createInboxItem = async (): Promise<InboxItem> => {
    const attachments =
      files && files.length > 0 ? await uploadSharedFiles(files) : [];
    const { data } = await dataProvider.create<InboxItem>("inbox_items", {
      data: {
        source: sourceTab ?? "whatsapp",
        raw_text: rawText || null,
        attachments: attachments.length > 0 ? attachments : null,
        status: "unresolved",
      },
    });
    return data;
  };

  const resolveSingleId = (): Identifier | null => {
    if (singleId != null) return singleId;
    if (singles && singles.length === 1) return singles[0].id;
    return null;
  };

  const handleSave = async (values: Record<string, unknown>) => {
    const resolvedSingleId = resolveSingleId();
    if (resolvedSingleId == null) {
      notify(
        translate("crm.inbox.share.pickSingleError", {
          _: "Choose which single this is for",
        }),
        { type: "error" },
      );
      return;
    }
    setIsSaving(true);
    try {
      const item = await createInboxItem();
      const input: CreateShidduchInput = {
        single_id: resolvedSingleId,
        shadchan_id: (values.shadchan_id as Identifier | undefined) ?? null,
        origin: "channel",
        initial_state: "new",
        visibility: "shared",
        redt_date: item.created_at.split("T")[0],
      };
      await resolveAsNewShidduch(item, input);
      notify(
        translate("crm.inbox.share.saved", { _: "Filed as a suggestion" }),
        {
          type: "info",
        },
      );
      navigate("/inbox_items", { replace: true });
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.inbox.share.saveError", {
              _: "Couldn't file that share",
            }),
        { type: "error" },
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleLinkToExisting = async (shidduchimId: Identifier) => {
    try {
      const item = await createInboxItem();
      await resolveAsLinkToExisting(item, shidduchimId);
      notify(
        translate("crm.inbox.share.linked", {
          _: "Linked to the existing suggestion",
        }),
        { type: "info" },
      );
      navigate("/inbox_items", { replace: true });
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.inbox.share.saveError", {
              _: "Couldn't file that share",
            }),
        { type: "error" },
      );
    }
  };

  // AC 6: always available, and behaves exactly as before this story — a
  // bare unresolved row, nothing ever lost.
  const handleSkip = async () => {
    setIsSaving(true);
    try {
      await createInboxItem();
      notify(
        translate("crm.inbox.share.skipped", { _: "Shared to your inbox" }),
        {
          type: "info",
        },
      );
      navigate("/inbox_items", { replace: true });
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.inbox.share.saveError", {
              _: "Couldn't file that share",
            }),
        { type: "error" },
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (files === null || sourceTab === null) {
    return (
      <div className="grid min-h-[40vh] place-items-center text-sm text-muted-foreground">
        {translate("crm.inbox.share.loading", { _: "Filing what you shared…" })}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        {translate("crm.inbox.share.title", { _: "File this share" })}
      </h1>

      {/* AC 2: source tabs — a plain three-way toggle, no new resource. */}
      <div
        role="tablist"
        aria-label={translate("crm.inbox.share.sourceLabel", {
          _: "Where this came from",
        })}
        className="flex gap-2"
      >
        {SOURCE_TABS.map((tab) => {
          const meta = INBOX_SOURCE_META[tab];
          const Icon = meta.icon;
          const isActive = sourceTab === tab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setSourceTab(tab)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {translate(`crm.inbox.source_${tab}`, { _: meta.label })}
              {isActive ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Task 4: "a preview of the raw text or image(s)". */}
      <div className="rounded-2xl border border-border bg-secondary/60 p-4">
        {rawText ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {rawText}
          </p>
        ) : previewUrls.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {translate("crm.inbox.share.noPreview", {
              _: "No text — see the attached file.",
            })}
          </p>
        ) : null}
        {previewUrls.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {previewUrls.map((previewUrl) => (
              <img
                key={previewUrl}
                src={previewUrl}
                alt=""
                className="h-24 w-24 rounded-lg object-cover"
              />
            ))}
          </div>
        ) : null}
      </div>

      <Form onSubmit={handleSave} mode="onBlur">
        <div className="flex flex-col gap-4">
          {/* AC 3: shadchan typeahead + inline "+ Add a shadchan". */}
          <ReferenceInput source="shadchan_id" reference="shadchanim">
            <AutocompleteInput
              label={translate("crm.inbox.share.shadchanLabel", {
                _: "Shadchan",
              })}
              helperText={translate("crm.inbox.share.shadchanHelper", {
                _: "Optional — who suggested this match",
              })}
              onCreate={handleCreateShadchan}
            />
          </ReferenceInput>

          {/* AC 4: a pill picker, shown only when there is more than one
              single to disambiguate. */}
          {singles && singles.length > 1 ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {translate("crm.inbox.share.singleLabel", {
                  _: "Which single is this for?",
                })}
              </span>
              <div className="flex flex-wrap gap-2">
                {singles.map((single) => {
                  const label =
                    [single.first_name_en, single.last_name_en]
                      .filter(Boolean)
                      .join(" ") || `#${single.id}`;
                  const isActive = singleId === single.id;
                  return (
                    <button
                      key={String(single.id)}
                      type="button"
                      onClick={() => setSingleId(single.id)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                        isActive
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* AC 5: link to an existing suggestion instead of creating one. */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {translate("crm.inbox.share.linkLabel", {
                _: "Or link to an existing suggestion",
              })}
            </span>
            <LinkToShidduchSearch onLink={handleLinkToExisting} />
          </div>

          <FormToolbar>
            <div className="flex flex-row justify-between gap-2">
              <button
                type="button"
                onClick={() => void handleSkip()}
                disabled={isSaving}
                className="inline-flex h-11 items-center rounded-xl px-4 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                {translate("crm.inbox.share.skip", {
                  _: "Skip — drop it in my Inbox",
                })}
              </button>
              <SaveButton
                label={translate("crm.inbox.share.save", {
                  _: "Save & review",
                })}
                className={INBOX_PRIMARY_CTA_CLASS}
                disabled={isSaving}
              />
            </div>
          </FormToolbar>
        </div>
      </Form>
    </div>
  );
};

ShareTarget.path = "/share";
