import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import {
  useDataProvider,
  useGetList,
  useNotify,
  useRefresh,
  useTranslate,
} from "ra-core";
import { MessageSquare, StickyNote } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type {
  CallStatus,
  ReferenceLinkSummary,
  Resume,
  ShidduchSummary,
} from "../types";
import type { CrmDataProvider } from "../providers/types";
import { resumeSubjectFilter } from "./resumeSubject";
import {
  matchResumeReferenceLinks,
  parseResumeSections,
  type ParsedAdditionalSection,
  type ParsedAdditionalSectionItem,
  type ParsedResumeReference,
} from "./resumeReadableSections";

type DetailItem = { label: string; value: string };
type DetailGroup = { heading: string; items: DetailItem[] };
type ReadableGroupEntry = {
  key: string;
  group: DetailGroup;
  stacked?: boolean;
};

const FIXED_GROUP_KEYS = [
  "personal_details",
  "family",
  "learning_and_community",
] as const;

const FIXED_GROUP_HEADINGS: Record<(typeof FIXED_GROUP_KEYS)[number], string> =
  {
    personal_details: "Personal details",
    family: "Family",
    learning_and_community: "Learning and community",
  };

const normalizeReadableText = (value: string): string =>
  value
    .replace(/\p{Cf}/gu, "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase();

const normalizeReadableItemKey = (item: ParsedAdditionalSectionItem): string =>
  JSON.stringify([
    normalizeReadableText(item.label),
    normalizeReadableText(item.value),
  ]);

function filterDuplicateFamilyExtras(
  additionalSections: ParsedAdditionalSection[],
  detailGroups: DetailGroup[],
): ParsedAdditionalSection[] {
  const familyGroup = detailGroups.find(
    (group) => group.heading === FIXED_GROUP_HEADINGS.family,
  );
  const fixedFamilyItems = new Set(
    familyGroup?.items.map(normalizeReadableItemKey) ?? [],
  );
  const fixedFamilyValues = new Set(
    familyGroup?.items.map((item) => normalizeReadableText(item.value)) ?? [],
  );

  return additionalSections.flatMap((section) => {
    if (normalizeReadableText(section.title) !== "family") {
      return [section];
    }
    const items = section.items.filter(
      (item) =>
        !fixedFamilyItems.has(normalizeReadableItemKey(item)) &&
        !fixedFamilyValues.has(normalizeReadableText(item.value)),
    );
    return items.length > 0 ? [{ ...section, items }] : [];
  });
}

function buildReadableGroups(
  detailGroups: DetailGroup[],
  learningHistory: ParsedAdditionalSectionItem[],
  additionalSections: ParsedAdditionalSection[],
): ReadableGroupEntry[] {
  const fixedEntries = FIXED_GROUP_KEYS.flatMap((key) => {
    const group = detailGroups.find(
      (candidate) => candidate.heading === FIXED_GROUP_HEADINGS[key],
    );
    return group ? [{ key, group }] : [];
  });
  const learningEntry =
    learningHistory.length > 0
      ? {
          key: "learning_history",
          group: { heading: "Learning history", items: learningHistory },
          stacked: true,
        }
      : null;
  const hasAnchors = additionalSections.some(
    (section) => section.order !== undefined || section.after !== undefined,
  );

  if (!hasAnchors) {
    return [
      ...detailGroups.map((group) => ({
        key: `fixed-${group.heading}`,
        group,
      })),
      ...(learningEntry ? [learningEntry] : []),
      ...additionalSections.map((section, index) => ({
        key: `additional-${section.key}-${section.title}-${index}`,
        group: { heading: section.title, items: section.items },
        stacked: true,
      })),
    ];
  }

  const orderedExtras = additionalSections
    .map((section, index) => ({ section, index }))
    .sort((left, right) => {
      const leftOrder = left.section.order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.section.order ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.index - right.index;
    });
  const anchoredExtras = new Map<string, typeof orderedExtras>();
  const unanchoredExtras: typeof orderedExtras = [];
  for (const entry of orderedExtras) {
    if (entry.section.after === undefined) {
      unanchoredExtras.push(entry);
      continue;
    }
    const bucket = anchoredExtras.get(entry.section.after) ?? [];
    bucket.push(entry);
    anchoredExtras.set(entry.section.after, bucket);
  }

  const entries: ReadableGroupEntry[] = [];
  for (const fixedKey of FIXED_GROUP_KEYS) {
    const fixedEntry = fixedEntries.find((entry) => entry.key === fixedKey);
    if (fixedEntry) entries.push(fixedEntry);
    for (const { section, index } of anchoredExtras.get(fixedKey) ?? []) {
      entries.push({
        key: `additional-${section.key}-${section.title}-${section.order ?? index}`,
        group: { heading: section.title, items: section.items },
        stacked: true,
      });
    }
  }
  if (learningEntry) entries.push(learningEntry);
  for (const { section, index } of anchoredExtras.get("learning_history") ??
    []) {
    entries.push({
      key: `additional-${section.key}-${section.title}-${section.order ?? index}`,
      group: { heading: section.title, items: section.items },
      stacked: true,
    });
  }
  for (const { section, index } of unanchoredExtras) {
    entries.push({
      key: `additional-${section.key}-${section.title}-${section.order ?? index}`,
      group: { heading: section.title, items: section.items },
      stacked: true,
    });
  }

  return entries;
}

const STATUS_OPTIONS: ReadonlyArray<{
  id: CallStatus;
  label: string;
}> = [
  { id: "answered", label: "Answered" },
  { id: "call_back", label: "I will call back" },
  { id: "they_will_call_back", label: "They will call back" },
  { id: "no_answer", label: "Did not answer" },
];

const asText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const normalizeEnumValue = (value: string): string => {
  if (value === "yes") return "Yes";
  if (value === "no") return "No";
  if (value === "unknown") return "";
  return value;
};

const localized = (english?: string | null, hebrew?: string | null): string =>
  asText(english) || asText(hebrew);

const personName = (record: ShidduchSummary): string =>
  localized(record.name_en, record.name_he) ||
  localized(
    [record.single_first_name_en, record.single_last_name_en]
      .filter(Boolean)
      .join(" "),
    [record.single_first_name_he, record.single_last_name_he]
      .filter(Boolean)
      .join(" "),
  );

function readableDetailGroups(record: ShidduchSummary): DetailGroup[] {
  const groups: DetailGroup[] = [
    {
      heading: "Personal details",
      items: [
        { label: "Name", value: personName(record) },
        { label: "Age", value: record.age == null ? "" : String(record.age) },
        { label: "Height", value: asText(record.height) },
        {
          label: "Location",
          value: localized(record.location_en, record.location_he),
        },
        { label: "Marital status", value: asText(record.marital_status) },
        {
          label: "Kohen status",
          value: normalizeEnumValue(asText(record.kohen_status)),
        },
      ],
    },
    {
      heading: "Family",
      items: [
        {
          label: "Father",
          value: localized(record.father_en, record.father_he),
        },
        {
          label: "Mother",
          value: localized(record.mother_en, record.mother_he),
        },
      ],
    },
    {
      heading: "Learning and community",
      items: [
        {
          label: "Seminary / yeshiva",
          value: localized(record.seminary_en, record.seminary_he),
        },
        { label: "Shul", value: localized(record.shul_en, record.shul_he) },
      ],
    },
  ];

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.value),
    }))
    .filter((group) => group.items.length > 0);
}

type ReferenceRow = {
  reference: ParsedResumeReference;
  link: ReferenceLinkSummary | null;
};

const REFERENCE_DISPLAY_LIMIT = 50;

function linkAsParsedReference(
  link: ReferenceLinkSummary,
): ParsedResumeReference {
  return {
    name:
      asText(link.reference_name_en) ||
      asText(link.reference_name_he) ||
      "Reference",
    relationship: asText(link.effective_relationship),
    phone: asText(link.reference_phone),
  };
}

function buildReferenceRows(
  references: ParsedResumeReference[],
  links: ReferenceLinkSummary[],
): ReferenceRow[] {
  const matchedLinks = matchResumeReferenceLinks(references, links);
  const used = new Set(matchedLinks.flatMap((link) => (link ? [link.id] : [])));
  const rows = references.map((reference, index) => ({
    reference,
    link: matchedLinks[index],
  }));

  return [
    ...rows,
    ...links
      .filter((link) => !used.has(link.id))
      .map((link) => ({ reference: linkAsParsedReference(link), link })),
  ].slice(0, REFERENCE_DISPLAY_LIMIT);
}

export function ResumeReadableSections({
  record,
  canViewReferences,
}: {
  record: ShidduchSummary;
  canViewReferences: boolean;
}): ReactElement | null {
  const translate = useTranslate();
  const { data: resumes, isPending: isResumePending } = useGetList<Resume>(
    "resumes",
    {
      filter: resumeSubjectFilter({ shidduchimId: record.id }),
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
    },
  );
  const resume = resumes?.[0];
  const sections = useMemo(
    () => parseResumeSections(resume?.sections, canViewReferences === true),
    [resume?.sections, canViewReferences],
  );
  const detailGroups = useMemo(() => readableDetailGroups(record), [record]);
  const displayAdditionalSections = useMemo(
    () =>
      filterDuplicateFamilyExtras(sections.additionalSections, detailGroups),
    [sections.additionalSections, detailGroups],
  );
  const readableGroups = useMemo(
    () =>
      buildReadableGroups(
        detailGroups,
        sections.learningHistory,
        displayAdditionalSections,
      ),
    [detailGroups, sections.learningHistory, displayAdditionalSections],
  );

  const { data: links, isPending: areLinksPending } =
    useGetList<ReferenceLinkSummary>(
      "reference_links",
      {
        filter: { shidduchim_id: record.id },
        pagination: { page: 1, perPage: REFERENCE_DISPLAY_LIMIT },
        sort: { field: "created_at", order: "ASC" },
      },
      {
        enabled:
          canViewReferences && resume != null && sections.references.length > 0,
      },
    );

  if (isResumePending || !resume) return null;

  const hasReadableContent =
    readableGroups.length > 0 ||
    (canViewReferences && sections.references.length > 0);
  const referenceRows = canViewReferences
    ? buildReferenceRows(sections.references, links ?? [])
    : [];

  return (
    <Card className="gap-0 overflow-hidden rounded-2xl">
      <CardHeader className="gap-1 border-b px-4 py-4 sm:px-6">
        <h2 className="text-xl font-semibold">
          {translate("crm.entity360.resume.readable.title", {
            _: "Easy-to-read resume",
          })}
        </h2>
        <p className="text-sm text-muted-foreground">
          {translate("crm.entity360.resume.readable.description", {
            _: "Only sections with information are shown.",
          })}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-0 px-4 py-0 sm:px-6">
        {!hasReadableContent ? (
          <div className="my-5 flex items-start gap-3 rounded-xl border border-dashed p-4 text-sm">
            <StickyNote
              className="mt-0.5 size-5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <div>
              <p className="font-medium">
                {translate("crm.entity360.resume.readable.emptyTitle", {
                  _: "No sections were found in this resume.",
                })}
              </p>
              <p className="mt-1 text-muted-foreground">
                {translate("crm.entity360.resume.readable.emptyDescription", {
                  _: "You can still read or download the original file above.",
                })}
              </p>
            </div>
          </div>
        ) : (
          <>
            {readableGroups.map((entry) => (
              <ReadableGroup
                key={entry.key}
                group={entry.group}
                stacked={entry.stacked}
              />
            ))}
            {canViewReferences && sections.references.length > 0 ? (
              <ReferenceGroup
                rows={referenceRows}
                isPending={areLinksPending}
                hasLinks={(links ?? []).length > 0}
              />
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ReadableGroup({
  group,
  stacked = false,
}: {
  group: DetailGroup;
  stacked?: boolean;
}): ReactElement {
  return (
    <section className="border-t py-5 first:border-t-0">
      <h3 dir="auto" className="mb-3 text-base font-semibold">
        <bdi dir="auto">{group.heading}</bdi>
      </h3>
      <div
        className={
          stacked
            ? "flex min-w-0 flex-col gap-2"
            : "grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-3"
        }
      >
        {group.items.map((item) => (
          <ReadableItem key={JSON.stringify(item)} item={item} />
        ))}
      </div>
    </section>
  );
}

function ReadableItem({ item }: { item: DetailItem }): ReactElement {
  return (
    <div className="min-w-0 rounded-xl bg-muted/40 p-3">
      <strong
        dir="auto"
        className="block break-words text-xs font-semibold text-muted-foreground"
      >
        <bdi dir="auto">{item.label}</bdi>
      </strong>
      <p dir="auto" className="mt-1 whitespace-pre-wrap break-words text-sm">
        <bdi dir="auto">{item.value}</bdi>
      </p>
    </div>
  );
}

function ReferenceGroup({
  rows,
  isPending,
  hasLinks,
}: {
  rows: ReferenceRow[];
  isPending: boolean;
  hasLinks: boolean;
}): ReactElement {
  const translate = useTranslate();

  return (
    <section className="border-t py-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">
          {translate("crm.entity360.resume.readable.references", {
            _: "References",
          })}
        </h3>
        <span className="text-xs text-muted-foreground">
          {rows.length} {rows.length === 1 ? "reference" : "references"}
        </span>
      </div>
      {isPending ? (
        <div
          aria-label={translate(
            "crm.entity360.resume.readable.loadingReferences",
            {
              _: "Loading references",
            },
          )}
          role="status"
          className="mb-3 h-20 animate-pulse rounded-lg bg-muted/40"
        />
      ) : !hasLinks ? (
        <p className="mb-3 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
          {translate("crm.entity360.resume.readable.referencesPreparing", {
            _: "References are being prepared.",
          })}
        </p>
      ) : null}
      {!isPending ? (
        <div className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <ReferenceResumeCard
              key={`${row.reference.name}-${row.link?.id ?? "unlinked"}-${index}`}
              reference={row.reference}
              link={row.link}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ReferenceResumeCard({
  reference,
  link,
}: {
  reference: ParsedResumeReference;
  link: ReferenceLinkSummary | null;
}): ReactElement {
  const translate = useTranslate();

  if (!link) {
    return (
      <article className="rounded-xl border p-3 sm:p-4">
        <div className="min-w-0">
          <p dir="auto" className="break-words text-sm font-semibold">
            {reference.name}
          </p>
          <p
            dir="auto"
            className="mt-1 break-words text-sm text-muted-foreground"
          >
            {[
              reference.relationship,
              reference.phone || "No phone number saved",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            {translate("crm.entity360.resume.readable.referenceUnlinked", {
              _: "This reference is not linked yet; call details will appear when it is matched.",
            })}
          </p>
        </div>
      </article>
    );
  }

  return <LinkedReferenceResumeCard reference={reference} link={link} />;
}

function LinkedReferenceResumeCard({
  reference,
  link,
}: {
  reference: ParsedResumeReference;
  link: ReferenceLinkSummary;
}): ReactElement {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const [status, setStatus] = useState<CallStatus>(
    (link.call_status as CallStatus) ?? "not_started",
  );
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const noteTriggerRef = useRef<HTMLButtonElement>(null);
  const didOpenNote = useRef(false);

  useEffect(() => {
    if (isNoteOpen) {
      didOpenNote.current = true;
    } else if (didOpenNote.current) {
      didOpenNote.current = false;
      requestAnimationFrame(() => noteTriggerRef.current?.focus());
    }
  }, [isNoteOpen]);

  useEffect(() => {
    setStatus((link.call_status as CallStatus) ?? "not_started");
  }, [link.call_status]);

  const displayRelationship =
    link.effective_relationship || reference.relationship;
  const displayPhone = link.reference_phone || reference.phone;
  const displayName =
    asText(link.reference_name_en) ||
    asText(link.reference_name_he) ||
    reference.name;
  const noteExists = Boolean(link.what_they_said?.trim());
  const noteAriaLabel = `${translate("crm.entity360.resume.readable.noteOpen", {
    name: displayName,
    _: "Open note for %{name}",
  })}${
    noteExists
      ? `; ${translate("crm.entity360.resume.readable.noteSavedAria", {
          _: "note saved",
        })}`
      : ""
  }`;

  const saveStatus = async (nextStatus: CallStatus) => {
    if (isSavingStatus) return;
    const previousStatus = status;
    setStatus(nextStatus);
    setIsSavingStatus(true);
    try {
      await dataProvider.logReferenceCall({
        reference_link_id: link.id,
        call_status: nextStatus,
        source: "manual",
      });
      refresh();
    } catch {
      setStatus(previousStatus);
      notify(
        translate("crm.entity360.resume.readable.saveError", {
          _: "We could not save this. Nothing was changed. Try again.",
        }),
        { type: "error" },
      );
    } finally {
      setIsSavingStatus(false);
    }
  };

  return (
    <article className="rounded-xl border p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p dir="auto" className="break-words text-sm font-semibold">
            {displayName}
          </p>
          <p
            dir="auto"
            className="mt-1 break-words text-sm text-muted-foreground"
          >
            {[displayRelationship, displayPhone || "No phone number saved"]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Button
          ref={noteTriggerRef}
          type="button"
          variant="outline"
          size="icon"
          aria-label={noteAriaLabel}
          aria-expanded={isNoteOpen}
          aria-haspopup="dialog"
          className="relative shrink-0"
          onClick={() => setIsNoteOpen(true)}
        >
          <MessageSquare aria-hidden="true" />
          {noteExists ? (
            <span
              className="absolute right-1 top-1 size-2 rounded-full bg-primary"
              aria-hidden="true"
            />
          ) : null}
        </Button>
      </div>
      <p className="mt-4 text-xs font-medium text-muted-foreground">
        {translate("crm.entity360.resume.readable.callQuestion", {
          _: "How did the call go?",
        })}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {status === "not_started"
          ? translate("crm.entity360.resume.readable.noStatus", {
              _: "No choice selected yet.",
            })
          : translate("crm.entity360.resume.readable.clearStatus", {
              _: "Tap the selected choice again to clear it.",
            })}
      </p>
      <div
        className="mt-2 grid grid-cols-3 gap-2"
        role="group"
        aria-label={`Call status for ${displayName}`}
      >
        {STATUS_OPTIONS.map((option) => {
          const isSelected = status === option.id;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={isSelected}
              disabled={isSavingStatus}
              className={cn(
                "h-12 min-w-0 rounded-full border px-2 py-1 text-xs font-medium leading-tight sm:h-11",
                "break-words transition-[box-shadow,background-color]",
                "disabled:cursor-wait disabled:opacity-60",
                isSelected
                  ? "border-primary bg-primary/10 text-primary shadow-[0_0_0_2px_hsl(var(--background)),0_0_0_4px_hsl(var(--primary))]"
                  : "bg-background hover:bg-muted",
                option.id === "no_answer" ? "col-start-1" : "",
              )}
              onClick={() =>
                void saveStatus(isSelected ? "not_started" : option.id)
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <ReferenceNoteEditor
        link={link}
        referenceName={displayName}
        open={isNoteOpen}
        onOpenChange={setIsNoteOpen}
      />
    </article>
  );
}

function ReferenceNoteEditor({
  link,
  referenceName,
  open,
  onOpenChange,
}: {
  link: ReferenceLinkSummary;
  referenceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const translate = useTranslate();
  const [note, setNote] = useState(link.what_they_said ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const noteDirty = useRef(false);

  useEffect(() => {
    if (open && !noteDirty.current) setNote(link.what_they_said ?? "");
  }, [link.what_they_said, open]);

  const saveNote = async () => {
    const nextNote = note.trim();
    const previousNote = (link.what_they_said ?? "").trim();
    if (!nextNote && previousNote) return;
    if (nextNote === previousNote) {
      noteDirty.current = false;
      onOpenChange(false);
      return;
    }

    setIsSaving(true);
    try {
      await dataProvider.logReferenceCall({
        reference_link_id: link.id,
        what_they_said: nextNote,
        source: "manual",
      });
      refresh();
      noteDirty.current = false;
      onOpenChange(false);
      notify(
        translate("crm.entity360.resume.readable.noteSaved", {
          _: "Saved to the call log.",
        }),
        { type: "success" },
      );
    } catch {
      notify(
        translate("crm.entity360.resume.readable.saveError", {
          _: "We could not save this. Nothing was changed. Try again.",
        }),
        { type: "error" },
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen && !noteDirty.current) {
          setNote(link.what_they_said ?? "");
        }
        onOpenChange(nextOpen);
      }}
    >
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))] md:bottom-auto md:left-1/2 md:right-auto md:top-1/2 md:w-[min(92vw,32rem)] md:translate-x-[-50%] md:translate-y-[-50%] md:rounded-xl md:border"
      >
        <SheetHeader className="pe-12">
          <SheetTitle>
            {translate("crm.entity360.resume.readable.noteTitle", {
              name: referenceName,
              _: "Note for %{name}",
            })}
          </SheetTitle>
          <SheetDescription>
            {translate("crm.entity360.resume.readable.noteDescription", {
              _: "Write only what the reference said.",
            })}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-4 md:px-6">
          <Textarea
            aria-label={`What ${referenceName} said`}
            dir="auto"
            value={note}
            onChange={(event) => {
              noteDirty.current = true;
              setNote(event.target.value);
            }}
            rows={5}
            className="text-base"
          />
          <Button
            type="button"
            size="lg"
            disabled={
              isSaving || (!note.trim() && Boolean(link.what_they_said?.trim()))
            }
            onClick={() => void saveNote()}
            className="min-h-11 w-full"
          >
            {translate("crm.entity360.resume.readable.saveNote", {
              _: "Save note",
            })}
          </Button>
          {!note.trim() && link.what_they_said?.trim() ? (
            <p className="text-xs text-muted-foreground">
              {translate("crm.entity360.resume.readable.noteEmpty", {
                _: "Write a note to save it.",
              })}
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
