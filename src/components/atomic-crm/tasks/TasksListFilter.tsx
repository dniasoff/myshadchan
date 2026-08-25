import {
  ListContextProvider,
  ResourceContextProvider,
  useList,
  useTranslate,
} from "ra-core";

import { Button } from "@/components/ui/button";

import { TasksIterator } from "./TasksIterator";

type TaskListProps = {
  tasks: any[];
  title: string;
  isMobile: boolean;
};

export const TaskListFilter = ({ tasks, title, isMobile }: TaskListProps) => {
  const translate = useTranslate();
  const listContext = useList({
    data: tasks,
    resource: "tasks",
    perPage: isMobile ? 10 : 5,
  });

  const { total } = listContext;

  if (!tasks?.length || !total) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">
        {title}
      </p>
      <ResourceContextProvider value="tasks">
        <ListContextProvider value={listContext}>
          <TasksIterator />
        </ListContextProvider>
      </ResourceContextProvider>
      {total > listContext.perPage && (
        <div className="flex justify-center">
          {/* A real button, not an <a href="#"> with its click prevented:
              that announced a link going nowhere to a screen reader, pushed
              a hash onto history on keyboard activation, and was an
              unpadded ~20px target between two task groups. */}
          <Button
            type="button"
            variant="ghost"
            className="underline hover:no-underline"
            onClick={() => listContext.setPerPage(listContext.perPage + 10)}
          >
            {translate("crm.common.load_more")}
          </Button>
        </div>
      )}
    </div>
  );
};
