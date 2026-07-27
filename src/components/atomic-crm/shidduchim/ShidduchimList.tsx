import type { Identifier } from "ra-core";
import { useGetIdentity, useGetList, useListContext } from "ra-core";
import { useEffect, useState } from "react";
import { Link, matchPath, useLocation } from "react-router";

import { CreateButton } from "@/components/admin/create-button";
import { List } from "@/components/admin/list";
import { cn } from "@/lib/utils";

import { TopToolbar } from "../layout/TopToolbar";
import type { Single } from "../types";
import { ShidduchCreate } from "./ShidduchCreate";
import { ShidduchimListContent } from "./ShidduchimListContent";
import { ShidduchShow } from "./ShidduchShow";

const singleLabel = (single: Single) => single.first_name_en ?? `#${single.id}`;

const ShidduchimList = () => {
  const { identity } = useGetIdentity();
  const { data: singles, isPending: singlesPending } = useGetList<Single>(
    "singles",
    {
      pagination: { page: 1, perPage: 100 },
      sort: { field: "first_name_en", order: "ASC" },
    },
  );
  const [singleId, setSingleId] = useState<Identifier | undefined>();

  useEffect(() => {
    if (singleId == null && singles && singles.length > 0) {
      setSingleId(singles[0].id);
    }
  }, [singles, singleId]);

  if (!identity || singlesPending) return null;
  if (!singles || singles.length === 0) return <ShidduchimNoSingles />;

  const selectedSingleId = singleId ?? singles[0].id;

  return (
    <List
      title={false}
      perPage={200}
      filter={{ single_id: selectedSingleId }}
      sort={{ field: "index", order: "ASC" }}
      pagination={null}
      actions={<ShidduchimActions />}
    >
      <ShidduchimLayout
        singleList={singles}
        singleId={selectedSingleId}
        onSelectSingle={setSingleId}
      />
    </List>
  );
};

const ShidduchimActions = () => (
  <TopToolbar>
    <span data-tour="add-suggestion">
      <CreateButton label="Add a suggestion" />
    </span>
  </TopToolbar>
);

const ShidduchimLayout = ({
  singleList,
  singleId,
  onSelectSingle,
}: {
  singleList: Single[];
  singleId: Identifier;
  onSelectSingle: (id: Identifier) => void;
}) => {
  const location = useLocation();
  const matchCreate = matchPath("/shidduchim/create", location.pathname);
  const matchShow = matchPath("/shidduchim/:id/show", location.pathname);
  const { isPending } = useListContext();

  if (isPending) return null;

  return (
    <div className="w-full">
      <ShidduchimHeader
        singleList={singleList}
        singleId={singleId}
        onSelect={onSelectSingle}
      />
      <ShidduchimListContent />
      <ShidduchCreate open={!!matchCreate} singleId={singleId} />
      <ShidduchShow open={!!matchShow} id={matchShow?.params.id} />
    </div>
  );
};

const ShidduchimHeader = ({
  singleList,
  singleId,
  onSelect,
}: {
  singleList: Single[];
  singleId: Identifier;
  onSelect: (id: Identifier) => void;
}) => {
  const selected = singleList.find((single) => single.id === singleId);
  const nameEn = selected
    ? [selected.first_name_en, selected.last_name_en].filter(Boolean).join(" ")
    : "";

  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        {singleList.length > 1 ? (
          <div className="mb-3 inline-flex gap-0.5 rounded-full border bg-secondary p-0.5">
            {singleList.map((single) => (
              <button
                key={single.id}
                type="button"
                onClick={() => onSelect(single.id)}
                className={cn(
                  "rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors",
                  single.id === singleId
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {singleLabel(single)}
              </button>
            ))}
          </div>
        ) : null}
        <h1 className="text-2xl font-bold tracking-tight">
          Pipeline{nameEn ? ` — ${nameEn}` : ""}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A calm memory of every redt, from every shadchan.
        </p>
      </div>
    </div>
  );
};

const ShidduchimNoSingles = () => (
  <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
    <h2 className="text-xl font-semibold">No singles yet</h2>
    <p className="max-w-md text-sm text-muted-foreground">
      A shidduchim pipeline belongs to a single (the person you are redting
      for). Add a single first, then start tracking suggestions.
    </p>
    <Link
      to="/singles/create"
      className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-105"
    >
      Add a single
    </Link>
  </div>
);

export default ShidduchimList;
