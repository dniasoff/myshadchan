import { useState } from "react";
import { useRecordContext } from "ra-core";
import { useDataProvider } from "ra-core";
import type { Identifier } from "ra-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  CheckCircle,
  XCircle,
  Share2,
  Loader2,
} from "lucide-react";
import type { Single, ChildGrant } from "../types";

interface GrantListItemProps {
  grant: ChildGrant;
  onRefresh: () => void;
}

function GrantListItem({ grant, onRefresh }: GrantListItemProps) {
  const dataProvider = useDataProvider();
  const [loading, setLoading] = useState(false);

  const handleAction = async (
    action: "revoke" | "sever" | "regrant",
    grantId: Identifier,
  ) => {
    setLoading(true);
    try {
      if (action === "revoke") {
        await dataProvider.revokeChildGrant!(grantId);
      } else if (action === "sever") {
        await dataProvider.severChildGrant!(grantId);
      } else if (action === "regrant") {
        await dataProvider.regrantChildGrant!(grantId);
      }
      onRefresh();
    } catch (error) {
      console.error(`${action}ChildGrant error`, error);
      alert(error instanceof Error ? error.message : "Action failed");
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = () => {
    switch (grant.status) {
      case "pending":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800">
            <span className="size-1.5 rounded-full bg-yellow-500" />
            Pending
          </span>
        );
      case "accepted":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
            <CheckCircle className="size-3" />
            Active
          </span>
        );
      case "revoked":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
            <XCircle className="size-3" />
            Revoked
          </span>
        );
      case "expired":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-800">
            <AlertCircle className="size-3" />
            Expired
          </span>
        );
      case "severed":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
            <XCircle className="size-3" />
            Severed
          </span>
        );
    }
  };

  return (
    <div className="flex items-center justify-between p-4 border rounded-lg bg-card">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Share2 className="size-5 text-muted-foreground" />
          <div>
            <p className="font-medium">Grant to another household</p>
            <p className="text-sm text-muted-foreground">
              {grant.proposer_account_id === grant.grantee_account_id
                ? "Awaiting acceptance"
                : `With household #${grant.grantee_account_id}`}
            </p>
          </div>
        </div>
        {grant.status === "accepted" && grant.severed_at && (
          <span className="text-xs text-muted-foreground">
            Severed {new Date(grant.severed_at).toLocaleDateString()}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {getStatusBadge()}
        <div className="flex items-center gap-2">
          {grant.status === "pending" && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAction("revoke", grant.id)}
                disabled={loading}
                title="Revoke this pending grant"
              >
                Revoke
              </Button>
            </>
          )}
          {grant.status === "accepted" && (
            <>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  if (
                    confirm(
                      "Sever this grant? The other household will immediately lose access to this child's record.",
                    )
                  ) {
                    handleAction("sever", grant.id);
                  }
                }}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Sever"
                )}
              </Button>
            </>
          )}
          {["severed", "revoked", "expired"].includes(grant.status) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleAction("regrant", grant.id)}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Re-grant"
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

interface ProposeGrantDialogProps {
  single: Single;
  onSuccess: () => void;
}

function ProposeGrantDialog({ single, onSuccess }: ProposeGrantDialogProps) {
  const dataProvider = useDataProvider();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const token = await dataProvider.createChildGrant!(single.id, email);
      setOpen(false);
      setEmail("");
      alert(
        `Grant created! Share this link with the other parent:\n\n${window.location.origin}/accept-grant/${token}`,
      );
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create grant");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>
            <Share2 className="size-4 mr-2" />
            Share with another household
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Share this child's record</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Enter the email address of the parent you want to share this
              child's record with. They will receive an invitation to accept
              access.
            </p>
            <div className="space-y-2">
              <Label htmlFor="grantee-email">Email address</Label>
              <Input
                id="grantee-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="parent@example.com"
                required
                disabled={loading}
              />
            </div>
            {error && (
              <div className="text-sm text-destructive flex items-center gap-2">
                <AlertCircle className="size-4" />
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading || !email}>
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-2" />
                    Creating grant...
                  </>
                ) : (
                  "Create grant"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SingleGrantManagement(): React.ReactElement | null {
  const record = useRecordContext<Single>();
  const dataProvider = useDataProvider();
  const [grants, setGrants] = useState<ChildGrant[]>([]);
  const [loading, setLoading] = useState(true);

  if (!record) return null;

  const loadGrants = async () => {
    setLoading(true);
    try {
      const { data } = await dataProvider.getList<ChildGrant>("child_grants", {
        filter: { target_single_id: record.id },
        sort: { field: "created_at", order: "DESC" },
        pagination: { page: 1, perPage: 50 },
      });
      setGrants(data);
    } catch (error) {
      console.error("Failed to load grants", error);
    } finally {
      setLoading(false);
    }
  };

  // Load grants on mount
  if (loading && grants.length === 0) {
    loadGrants();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Shared access</h3>
        <ProposeGrantDialog single={record} onSuccess={loadGrants} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : grants.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Share2 className="size-12 mx-auto mb-3 opacity-50" />
          <p>This child's record is not shared with any other household.</p>
          <p className="text-sm mt-1">
            Use "Share with another household" to grant access.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {grants.map((grant) => (
            <GrantListItem
              key={grant.id}
              grant={grant}
              onRefresh={loadGrants}
            />
          ))}
        </div>
      )}
    </div>
  );
}
