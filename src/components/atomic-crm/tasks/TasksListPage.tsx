import { useTranslate } from "ra-core";

import { useIsMobile } from "@/hooks/use-mobile";

import { MobileContent } from "../layout/MobileContent";
import MobileHeader from "../layout/MobileHeader";
import { TasksListContent } from "./TasksListContent";

/**
 * `/tasks` — one responsive list shared by both surfaces (story 1.5). Mobile
 * keeps the app's `<MobileHeader>` / `<MobileContent>` chrome; desktop gets a
 * page heading matching the other custom-route pages (e.g. Settings).
 * Read/complete only — reminders own task creation (`/reminders`).
 */
export const TasksListPage = () => {
  const translate = useTranslate();
  const isMobile = useIsMobile();
  const title = translate("resources.tasks.name", { smart_count: 2 });

  if (isMobile) {
    return (
      <>
        <MobileHeader>
          <h1 className="text-xl font-semibold">{title}</h1>
        </MobileHeader>
        <MobileContent>
          <TasksListContent />
        </MobileContent>
      </>
    );
  }

  return (
    <div className="mx-auto mt-10 max-w-3xl px-4">
      <h1 className="font-display text-[2rem] font-bold tracking-tight">
        {title}
      </h1>
      <div className="mt-8">
        <TasksListContent />
      </div>
    </div>
  );
};
