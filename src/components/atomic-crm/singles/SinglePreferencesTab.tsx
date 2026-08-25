import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import {
  useDataProvider,
  useGetList,
  useNotify,
  useRecordContext,
  useRefresh,
  useTranslate,
} from "ra-core";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import type { CrmDataProvider } from "../providers/types";
import type { Single } from "../types";

type SinglePreference = {
  id: string | number;
  account_id: string | number;
  single_id: string | number;
  body: string;
  visible_to_manager: boolean;
  created_at: string;
  updated_at: string;
};

function PreferencesSkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-6 w-5/6" />
    </div>
  );
}

function PreferencesEmpty(): ReactElement {
  const translate = useTranslate();
  return (
    <p className="text-sm text-muted-foreground">
      {/* Person-neutral: a single may be male, and this tab is reached from
          a son's own profile as often as a daughter's. `gender` is on the
          record, but branching copy on it buys nothing here — there is no
          sentence that needs the pronoun. */}
      {translate("crm.singles.preferences.empty", {
        _: "No preferences added yet.",
      })}
    </p>
  );
}

function PreferencesError(): ReactElement {
  const translate = useTranslate();
  return (
    <p role="alert" className="text-sm text-destructive">
      {translate("crm.singles.preferences.error", {
        _: "Could not load preferences.",
      })}
    </p>
  );
}

function PreferenceRow({
  preference,
}: {
  preference: SinglePreference;
}): ReactElement {
  const translate = useTranslate();
  return (
    <li>
      <p className="whitespace-pre-line text-sm">{preference.body}</p>
      <div className="mt-1 flex items-center gap-2">
        <Badge variant="outline" className="gap-1.5 text-xs">
          {preference.visible_to_manager
            ? translate("crm.singles.preferences.visibleToManager", {
                _: "Visible to manager",
              })
            : translate("crm.singles.preferences.hiddenFromManager", {
                _: "Hidden from manager",
              })}
        </Badge>
        <span className="text-xs tabular-nums text-muted-foreground">
          {new Date(preference.created_at).toLocaleDateString()}
        </span>
      </div>
    </li>
  );
}

function AddPreferenceForm({
  singleId,
  onAdded,
}: {
  singleId: string | number | undefined;
  onAdded: () => void;
}): ReactElement {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const translate = useTranslate();
  const [body, setBody] = useState("");
  const [visibleToManager, setVisibleToManager] = useState(true);
  const [isPending, setIsPending] = useState(false);

  const handleAdd = async () => {
    const text = body.trim();
    if (text === "" || !singleId) return;

    setIsPending(true);
    try {
      await dataProvider.create("single_preferences", {
        data: {
          single_id: singleId,
          body: text,
          visible_to_manager: visibleToManager,
        },
      });
      setBody("");
      setVisibleToManager(true);
      onAdded();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.singles.preferences.addError", {
              _: "Failed to add the preference",
            }),
        { type: "error" },
      );
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={body}
        rows={3}
        onChange={(event) => setBody(event.target.value)}
        placeholder={translate("crm.singles.preferences.placeholder", {
          _: "Add a preference…",
        })}
      />
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm">
          {/* Same string as the <span> beside it; Radix makes this a
           * `<button role="switch">`, which no adjacent label can name. */}
          <Switch
            aria-label={translate(
              "crm.singles.preferences.visibleToManagerLabel",
              {
                _: "Visible to whoever manages this process",
              },
            )}
            checked={visibleToManager}
            onCheckedChange={setVisibleToManager}
          />
          <span>
            {translate("crm.singles.preferences.visibleToManagerLabel", {
              _: "Visible to whoever manages this process",
            })}
          </span>
        </label>
        <Button
          type="button"
          variant="secondary"
          disabled={isPending || body.trim() === "" || !singleId}
          onClick={handleAdd}
        >
          {translate("crm.singles.preferences.add", { _: "Add preference" })}
        </Button>
      </div>
    </div>
  );
}

export function SinglePreferencesTab(): ReactNode {
  const record = useRecordContext<Single>();
  const refresh = useRefresh();

  const { data, error, isPending } = useGetList<SinglePreference>(
    "single_preferences",
    {
      filter: { single_id: record?.id },
      sort: { field: "created_at", order: "ASC" },
      pagination: { page: 1, perPage: 50 },
    },
    { enabled: !!record },
  );

  if (!record) return null;

  return (
    <div className="flex flex-col gap-4">
      <AddPreferenceForm singleId={record.id} onAdded={refresh} />
      {isPending ? (
        <PreferencesSkeleton />
      ) : error ? (
        <PreferencesError />
      ) : !data || data.length === 0 ? (
        <PreferencesEmpty />
      ) : (
        <ul className="flex flex-col gap-4 border-s border-border ps-4">
          {data.map((preference) => (
            <PreferenceRow
              key={String(preference.id)}
              preference={preference}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
