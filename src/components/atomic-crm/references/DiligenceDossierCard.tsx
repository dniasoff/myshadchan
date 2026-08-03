import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "ra-core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import { useAiEntitlement } from "./useAiEntitlement";
import { callAiWorker } from "../providers/commons/aiWorkerClient";
import type { Identifier } from "ra-core";

export interface DossierResponse {
  spokenToCount: number;
  outstandingCount: number;
  endorsementCount: number;
  reservationCount: number;
  covered: string[];
  gaps: string[];
  hasContradiction: boolean;
  narrative: string;
}

const UpgradePrompt = () => {
  const translate = useTranslate();
  const { isEntitled, isLoading } = useAiEntitlement();

  if (isLoading) return null;
  if (isEntitled) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-semibold">
          {translate("crm.diligence.dossier.title", {
            _: "Cross-reference summary",
          })}
        </CardTitle>
        <Badge variant="secondary">
          {translate("crm.diligence.dossier.paid", { _: "Paid" })}
        </Badge>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {translate("crm.diligence.dossier.upsell", {
          _: "See what everyone agreed on, where they differed, and what nobody was asked.",
        })}
      </CardContent>
    </Card>
  );
};

function DossierCardContent({ data }: { data: DossierResponse }) {
  const translate = useTranslate();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-semibold">
          {translate("crm.diligence.dossier.title", {
            _: "Cross-reference summary",
          })}
        </CardTitle>
        {data.hasContradiction ? (
          <Badge
            variant="outline"
            className="text-attention border-attention/50"
          >
            {translate("crm.diligence.dossier.contradiction", {
              _: "References differ",
            })}
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">
              {translate("crm.diligence.dossier.consensus", { _: "Consensus" })}
            </p>
            <p className="text-sm text-muted-foreground">
              {data.spokenToCount === 0
                ? translate("crm.diligence.dossier.nothingRecorded", {
                    _: "Nothing recorded yet.",
                  })
                : translate("crm.diligence.dossier.consensusDetail", {
                    warm: data.endorsementCount,
                    reserved: data.reservationCount,
                    _: "%{warm} spoke warmly, %{reserved} raised a reservation.",
                  })}
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">
              {translate("crm.diligence.dossier.covered", { _: "Covered" })}
            </p>
            <p className="text-sm text-muted-foreground">
              {data.covered.length === 0
                ? translate("crm.diligence.dossier.nothingCovered", {
                    _: "Nothing recorded yet.",
                  })
                : data.covered.join(", ")}
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">
              {translate("crm.diligence.dossier.gaps", { _: "Still missing" })}
            </p>
            <p className="text-sm text-muted-foreground">
              {data.gaps.length === 0
                ? translate("crm.diligence.dossier.noGaps", {
                    _: "Every topic has been touched on.",
                  })
                : data.gaps.join(", ")}
            </p>
          </div>
        </div>

        {data.narrative ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">
              {translate("crm.diligence.dossier.narrative", { _: "Summary" })}
            </p>
            <p className="text-sm text-muted-foreground">{data.narrative}</p>
          </div>
        ) : null}

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {translate("crm.diligence.dossier.guardrail", {
            _: "This summary organises what you have learned. It never judges compatibility or suggests a match.",
          })}
        </p>
      </CardContent>
    </Card>
  );
}

export function DiligenceDossierCard({
  shidduchimId,
}: {
  shidduchimId: Identifier;
}) {
  const translate = useTranslate();
  const { isEntitled, isLoading: entitlementLoading } = useAiEntitlement();

  const { data, isLoading, error } = useQuery({
    queryKey: ["dossier", shidduchimId],
    queryFn: async () => {
      const res = await callAiWorker(
        `${import.meta.env.VITE_AI_WORKER_URL}/dossier`,
        { shidduchim_id: Number(shidduchimId) },
      );
      return res as DossierResponse;
    },
    enabled: isEntitled,
  });

  if (entitlementLoading) return null;
  if (!isEntitled) return <UpgradePrompt />;
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-1/3" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      </Card>
    );
  }
  if (error) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">
            {translate("crm.diligence.dossier.title", {
              _: "Cross-reference summary",
            })}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-attention">
          {translate("crm.diligence.dossier.error", {
            _: "Could not load the summary. Please try again.",
          })}
        </CardContent>
      </Card>
    );
  }

  return <DossierCardContent data={data!} />;
}
