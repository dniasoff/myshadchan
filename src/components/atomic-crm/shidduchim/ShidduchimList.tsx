import type { Identifier } from "ra-core";
import { useGetIdentity, useGetList, useListContext } from "ra-core";
import { useEffect, useState } from "react";
import { Link, matchPath, useLocation } from "react-router";

import { CreateButton } from "@/components/admin/create-button";
import { List } from "@/components/admin/list";
import { cn } from "@/lib/utils";

import { TopToolbar } from "../layout/TopToolbar";
import type { Child } from "../types";
import { ShidduchCreate } from "./ShidduchCreate";
import { ShidduchimListContent } from "./ShidduchimListContent";
import { ShidduchShow } from "./ShidduchShow";

const childLabel = (child: Child) =>
  child.first_name_en ?? child.first_name_he ?? `#${child.id}`;

const ShidduchimList = () => {
  const { identity } = useGetIdentity();
  const { data: children, isPending: childrenPending } = useGetList<Child>(
    "children",
    {
      pagination: { page: 1, perPage: 100 },
      sort: { field: "first_name_en", order: "ASC" },
    },
  );
  const [childId, setChildId] = useState<Identifier | undefined>();

  useEffect(() => {
    if (childId == null && children && children.length > 0) {
      setChildId(children[0].id);
    }
  }, [children, childId]);

  if (!identity || childrenPending) return null;
  if (!children || children.length === 0) return <ShidduchimNoChildren />;

  const selectedChildId = childId ?? children[0].id;

  return (
    <List
      title={false}
      perPage={200}
      filter={{ child_id: selectedChildId }}
      sort={{ field: "index", order: "ASC" }}
      pagination={null}
      actions={<ShidduchimActions />}
    >
      <ShidduchimLayout
        childList={children}
        childId={selectedChildId}
        onSelectChild={setChildId}
      />
    </List>
  );
};

const ShidduchimActions = () => (
  <TopToolbar>
    <CreateButton label="Add a suggestion" />
  </TopToolbar>
);

const ShidduchimLayout = ({
  childList,
  childId,
  onSelectChild,
}: {
  childList: Child[];
  childId: Identifier;
  onSelectChild: (id: Identifier) => void;
}) => {
  const location = useLocation();
  const matchCreate = matchPath("/shidduchim/create", location.pathname);
  const matchShow = matchPath("/shidduchim/:id/show", location.pathname);
  const { isPending } = useListContext();

  if (isPending) return null;

  return (
    <div className="w-full">
      <ShidduchimHeader
        childList={childList}
        childId={childId}
        onSelect={onSelectChild}
      />
      <ShidduchimListContent />
      <ShidduchCreate open={!!matchCreate} childId={childId} />
      <ShidduchShow open={!!matchShow} id={matchShow?.params.id} />
    </div>
  );
};

const ShidduchimHeader = ({
  childList,
  childId,
  onSelect,
}: {
  childList: Child[];
  childId: Identifier;
  onSelect: (id: Identifier) => void;
}) => {
  const selected = childList.find((child) => child.id === childId);
  const nameEn = selected
    ? [selected.first_name_en, selected.last_name_en].filter(Boolean).join(" ")
    : "";
  const nameHe = selected?.first_name_he;

  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        {childList.length > 1 ? (
          <div className="mb-3 inline-flex gap-0.5 rounded-full border bg-secondary p-0.5">
            {childList.map((child) => (
              <button
                key={child.id}
                type="button"
                onClick={() => onSelect(child.id)}
                className={cn(
                  "rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors",
                  child.id === childId
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {childLabel(child)}
              </button>
            ))}
          </div>
        ) : null}
        <h1 className="text-2xl font-bold tracking-tight">
          Pipeline{nameEn ? ` — ${nameEn}` : ""}
          {nameHe ? (
            <span
              className="font-hebrew ms-2 text-xl font-medium text-muted-foreground"
              dir="rtl"
            >
              {nameHe}
            </span>
          ) : null}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A calm memory of every redt, from every shadchan.
        </p>
      </div>
    </div>
  );
};

const ShidduchimNoChildren = () => (
  <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
    <h2 className="text-xl font-semibold">No children yet</h2>
    <p className="max-w-md text-sm text-muted-foreground">
      A shidduchim pipeline belongs to a child (the single you are redting for).
      Add a child first, then start tracking suggestions.
    </p>
    <Link
      to="/children/create"
      className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-105"
    >
      Add a child
    </Link>
  </div>
);

export default ShidduchimList;
