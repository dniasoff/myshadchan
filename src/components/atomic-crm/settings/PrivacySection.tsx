import { Baby, BookUser, Handshake, Heart } from "lucide-react";
import { useDataProvider, useGetList, useTranslate } from "ra-core";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { DashboardStat } from "../dashboard/DashboardStat";
import type { CrmDataProvider } from "../providers/types";
import type { Child, Reference, Shadchan, Shidduch } from "../types";
import { DeleteDataDialog } from "./DeleteDataDialog";
import { collectFamilyData, downloadAsJson } from "./exportFamilyData";
import { PrivacyLine } from "./PrivacyLine";
import { SectionLabel } from "./SectionLabel";

/**
 * The privacy statement section (ticket lane 7 — "the privacy wedge made
 * tangible"): the trust line, a quiet tally of what's held for this family,
 * and the two controls parents actually want — export and delete.
 */
export const PrivacySection = () => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [isExporting, setIsExporting] = useState(false);

  const { total: childrenTotal } = useGetList<Child>("children", {
    pagination: { page: 1, perPage: 1 },
  });
  const { total: shidduchimTotal } = useGetList<Shidduch>("shidduchim", {
    pagination: { page: 1, perPage: 1 },
  });
  const { total: shadchanimTotal } = useGetList<Shadchan>("shadchanim", {
    pagination: { page: 1, perPage: 1 },
  });
  const { total: referencesTotal } = useGetList<Reference>("references", {
    pagination: { page: 1, perPage: 1 },
  });

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const bundle = await collectFamilyData(dataProvider);
      downloadAsJson(bundle, `myshadchan-family-data-${Date.now()}.json`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div>
      <SectionLabel>
        {translate("crm.profile.privacy.title", { _: "Privacy" })}
      </SectionLabel>
      <div className="space-y-4 rounded-lg border p-4">
        <PrivacyLine />

        <div>
          <p className="mb-2 px-1 text-sm text-muted-foreground">
            {translate("crm.profile.privacy.records_held", {
              _: "Records held for your family",
            })}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <DashboardStat
              label={translate("crm.profile.family.children", {
                _: "Children",
              })}
              value={childrenTotal ?? 0}
              icon={Baby}
            />
            <DashboardStat
              label={translate("resources.shidduchim.name", {
                _: "Shidduchim",
                smart_count: 2,
              })}
              value={shidduchimTotal ?? 0}
              icon={Heart}
            />
            <DashboardStat
              label={translate("resources.shadchanim.name", {
                _: "Shadchanim",
                smart_count: 2,
              })}
              value={shadchanimTotal ?? 0}
              icon={Handshake}
            />
            <DashboardStat
              label={translate("resources.references.name", {
                _: "References",
                smart_count: 2,
              })}
              value={referencesTotal ?? 0}
              icon={BookUser}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-1 sm:flex-row">
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting
              ? translate("crm.profile.privacy.exporting", {
                  _: "Preparing…",
                })
              : translate("crm.profile.privacy.export_data", {
                  _: "Export my data",
                })}
          </Button>
          <DeleteDataDialog />
        </div>
      </div>
    </div>
  );
};
