import { useState, useEffect } from "react";
import { useTranslate } from "ra-core";
import { useDataProvider } from "ra-core";
import type { CrmDataProvider } from "../providers/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Shield, Eye } from "lucide-react";
import { getSetting, setSetting } from "./eventCollector";

const ANALYTICS_ENABLED_KEY = "analytics_collection_enabled";

export const AnalyticsPrivacyControl = () => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSetting<boolean>(ANALYTICS_ENABLED_KEY).then((value) => {
      setEnabled(value ?? true);
      setLoading(false);
    });
  }, []);

  const handleToggle = async (newValue: boolean) => {
    setEnabled(newValue);
    await setSetting(ANALYTICS_ENABLED_KEY, newValue);
    if (dataProvider.setAnalyticsEnabled) {
      await dataProvider.setAnalyticsEnabled(newValue);
    }
  };

  if (loading) return null;

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <Shield className="size-5 text-muted-foreground mt-0.5" />
        <div className="flex-1">
          <h3 className="font-medium">
            {translate("crm.analytics.privacy.title")}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {translate("crm.analytics.privacy.description")}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">
            {translate("crm.analytics.privacy.collection")}
          </p>
          <p className="text-sm text-muted-foreground">
            {translate("crm.analytics.privacy.collection_hint")}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          aria-label={translate("crm.analytics.privacy.collection")}
        />
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {enabled
            ? translate("crm.analytics.privacy.enabled")
            : translate("crm.analytics.privacy.disabled")}
        </span>
        <Button variant="ghost" size="sm" asChild>
          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1"
          >
            <Eye className="size-3.5" />
            {translate("crm.analytics.privacy.policy_link")}
          </a>
        </Button>
      </div>
    </div>
  );
};
