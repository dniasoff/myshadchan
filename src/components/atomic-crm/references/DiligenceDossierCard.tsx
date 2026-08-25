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
  /**
   * True when at least one reference read warm and at least one read
   * hesitant, anywhere across the whole corpus — a coarse sentiment split,
   * not a claim that two references contradict each other on the same
   * topic. Named `hasMixedSentiment` rather than "contradiction" for that
   * reason (review fix, Finding 13).
   */
  hasMixedSentiment: boolean;
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
        {data.hasMixedSentiment ? (
          <Badge
            variant="outline"
            className="text-attention border-attention/50"
          >
            {/*
             * Review fix (Finding 13): this used to read
             * "crm.diligence.dossier.contradiction" / "References differ",
             * which claims two references disagree on the same point. The
             * underlying flag is a whole-corpus warm-vs-hesitant split, not a
             * same-topic conflict, so the label is renamed to match — see
             * DossierResponse.hasMixedSentiment's doc comment above. The
             * catalogue key itself was renamed alongside this (English +
             * French) as part of the wave's cross-reconciliation pass.
             */}
            {translate("crm.diligence.dossier.mixedSentiment", {
              _: "Mixed sentiment",
            })}
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Three prose facts, not three numbers: at 360px a bare
            `grid-cols-3` gives each column ~90px and every sentence
            renders one or two words per line. Stack first, columns from
            sm up — the same shape `ReferenceMergeCollision.tsx` uses. */}
        <div className="grid gap-4 sm:grid-cols-3">
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
                    _: "All topics have been asked about.",
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
