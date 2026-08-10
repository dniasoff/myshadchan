import { useState } from "react";
import { useDataProvider, useNotify, useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";

export const PurgeRequestVerifyPage = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider();
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false);
  const [requestId, setRequestId] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!requestId.trim()) {
      notify("Please enter a request ID", { type: "error" });
      return;
    }

    try {
      setLoading(true);
      // In a real implementation, we would get the token from the URL query params
      // For this manual runbook phase, we'll ask for both ID and token
      const token = window.prompt(
        "Please enter the verification token sent to your email:",
      );
      if (!token) {
        notify("Verification token is required", { type: "error" });
        setLoading(false);
        return;
      }

      // Call the verify purge request RPC function
      const { data } = await dataProvider.custom({
        url: "/rpc/verify_purge_request",
        options: {
          method: "POST",
          body: JSON.stringify({
            p_request_id: parseInt(requestId.trim(), 10),
            p_token: token,
          }),
        },
      });

      if (data) {
        notify("Purge request verified successfully", { type: "success" });
        setVerified(true);
        setRequestId("");
      } else {
        notify("Failed to verify purge request", { type: "error" });
      }
    } catch (error: any) {
      notify(`Failed to verify purge request: ${error.message}`, {
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="max-w-md mx-auto py-8 px-4 sm:p-6">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-foreground">
            {translate("crm.profile.privacy.verify_request_title", {
              _: "Verify Purge Request",
            })}
          </h1>
          <p className="text-muted-foreground mt-2">
            {translate("crm.profile.privacy.verify_request_description", {
              _: "To verify your purge request, please enter the request ID shown on the confirmation page and the verification token sent to your email.",
            })}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">
              {translate("crm.profile.privacy.request_id", {
                _: "Request ID",
              })}
            </label>
            <input
              type="text"
              value={requestId}
              onChange={(e) => setRequestId(e.target.value)}
              placeholder={translate(
                "crm.profile.privacy.request_id_placeholder",
                {
                  _: "Enter your request ID",
                },
              )}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={loading}
            />
          </div>

          <div className="flex justify-end space-x-3">
            <Button
              variant="ghost"
              onClick={() => {
                setRequestId("");
              }}
              disabled={loading}
            >
              {translate("ra.action.reset")}
            </Button>
            <Button variant="outline" type="submit" disabled={loading}>
              {loading
                ? translate("ra.action.submitting")
                : translate("crm.profile.privacy.verify_request", {
                    _: "Verify Request",
                  })}
            </Button>
          </div>
        </form>
      </div>

      {/* Verified dialog */}
      {verified && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <div className="text-center">
              <h2 className="text-xl font-bold text-foreground mb-4">
                {translate("crm.profile.privacy.request_verified_title", {
                  _: "Request Verified",
                })}
              </h2>
              <p className="text-muted-foreground mb-6">
                {translate("crm.profile.privacy.request_verified_description", {
                  _: "Your purge request has been verified. An administrator will now review and process your request according to our privacy policy.",
                })}
              </p>
              <Button variant="outline" onClick={() => setVerified(false)}>
                {translate("ra.action.close")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
