import { useQuery } from "@tanstack/react-query";
import { useRecordContext } from "ra-core";
import { useTranslate } from "ra-core";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import type { Identifier } from "ra-core";
import type { ShidduchDiligenceProgress, ShidduchSummary } from "../types";
import { useDataProvider } from "ra-core";
import type { CrmDataProvider } from "@/components/atomic-crm/providers/types";

function getDiligenceProgress(
  dataProvider: CrmDataProvider,
  shidduchimId: Identifier,
): Promise<ShidduchDiligenceProgress> {
  return dataProvider.rpc?.("shidduch_diligence_progress", {
    p_shidduchim_id: shidduchimId,
  }) as Promise<ShidduchDiligenceProgress>;
}

export function SingleDiligenceProgressTab(): React.ReactElement | null {
  const record = useRecordContext<ShidduchSummary>();
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();

  const recordId = record?.id;

  const { data, isLoading, error } = useQuery({
    queryKey: ["diligence-progress", recordId],
    queryFn: () => getDiligenceProgress(dataProvider, recordId!),
    enabled: recordId != null,
  });

  if (!record) return null;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-4" data-testid="skeleton">
          <Skeleton className="h-4 w-1/3" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-start gap-2 text-sm text-attention py-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {translate("crm.diligence.dossier.error", {
              _: "Could not load the summary. Please try again.",
            })}
          </span>
        </CardContent>
      </Card>
    );
  }

  const progress = data as ShidduchDiligenceProgress;

  if (progress.total === 0) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-muted-foreground">
          {translate("crm.references.shidduch.empty", {
            _: "Nobody has been asked about this single yet.",
          })}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-sm tabular-nums">
          {translate("crm.references.header.progress", {
            contacted: progress.contacted,
            total: progress.total,
            _: "%{contacted} of %{total} conversations done",
          })}
        </p>
      </CardContent>
    </Card>
  );
}
