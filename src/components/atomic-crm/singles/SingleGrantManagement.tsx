import { useCallback, useEffect, useState } from "react";
import { useNotify, useRecordContext } from "ra-core";
import { useDataProvider } from "ra-core";
import type { Identifier } from "ra-core";
import { Confirm } from "@/components/admin/confirm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  Check,
  Copy,
  Share2,
  Loader2,
  Scissors,
} from "lucide-react";
import { pickActiveContext } from "../providers/commons/roleAuthority";
import type { CrmDataProvider } from "../providers/types";
import { useMyContexts } from "../root/useMyContexts";
import type { Single, ChildGrant, ChildGrantAccessLevel } from "../types";
import {
  ACCESS_LEVEL_DESCRIPTIONS,
  ACCESS_LEVEL_ICONS,
  ACCESS_LEVEL_LABELS,
  ACCESS_LEVEL_ORDER,
} from "./childGrantAccessLevel";
import { GrantAccessChip, GrantStatusChip } from "./GrantChips";

interface GrantListItemProps {
  grant: ChildGrant;
  onRefresh: () => void;
}

function GrantListItem({ grant, onRefresh }: GrantListItemProps) {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const { data: contexts } = useMyContexts();
  const activeAccountId = pickActiveContext(contexts)?.account_id;
  const isProposer = grant.proposer_account_id === activeAccountId;
  const [loading, setLoading] = useState(false);
  const [accessLevelSaving, setAccessLevelSaving] = useState(false);
  const [isSeverConfirmOpen, setIsSeverConfirmOpen] = useState(false);

  const handleAction = async (
    action: "revoke" | "sever" | "regrant",
    grantId: Identifier,
  ) => {
    setLoading(true);
    try {
      if (action === "revoke") {
        await dataProvider.revokeChildGrant(grantId);
      } else if (action === "sever") {
        await dataProvider.severChildGrant(grantId);
      } else if (action === "regrant") {
        await dataProvider.regrantChildGrant(grantId);
      }
      onRefresh();
    } catch (error) {
      console.error(`${action}ChildGrant error`, error);
      // `notify`, never `alert()`: a native alert is unstyled, outside the
      // app's focus management, and on a phone it interrupts the whole
      // browser. The raw provider message is the inline FALLBACK, never the
      // notify key — a key that is really an error string would make any
      // future catalogue entry unreachable (InvitesSection.tsx's own note).
      notify("crm.singles.grants.actionError", {
        type: "error",
        messageArgs: {
          _:
            (error instanceof Error ? error.message : "") ||
            "Couldn't update that grant. Try again.",
        },
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAccessLevelChange = async (value: string) => {
    const accessLevel = value as ChildGrantAccessLevel;
    if (accessLevel === grant.access_level) return;
    setAccessLevelSaving(true);
    try {
      await dataProvider.updateChildGrantAccess(grant.id, accessLevel);
      onRefresh();
    } catch (error) {
      console.error("updateChildGrantAccess error", error);
      notify("crm.singles.grants.accessLevelError", {
        type: "error",
        messageArgs: {
          _:
            (error instanceof Error ? error.message : "") ||
            "Couldn't change the access level. Try again.",
        },
      });
    } finally {
      setAccessLevelSaving(false);
    }
  };

  const AccessLevelIcon = ACCESS_LEVEL_ICONS[grant.access_level];

  // Editable only by the proposer, and only once the grant is live — an
  // offer still pending acceptance carries the tier the grantee is about to
  // consent to (update_child_grant_access is scoped to accepted grants).
  const canEditAccessLevel = isProposer && grant.status === "accepted";

  // Never the raw `grantee_account_id`: "With household #4127" names nobody
  // a parent can recognise, on the row where they decide whether to cut
  // access to their single's record. The acceptance date is the one fact
  // this row actually carries about the other side. Showing the household's
  // NAME needs a denormalized snapshot on the read path, the way
  // `connections.household_account_name` already works.
  const acceptanceLine =
    grant.grantee_account_id == null
      ? "Awaiting acceptance"
      : grant.accepted_at
        ? `Accepted ${new Date(grant.accepted_at).toLocaleDateString()}`
        : "Accepted by the other household";

  return (
    // Stacked on a phone, side-by-side from `sm:`. As one non-wrapping
    // `justify-between` row the combined intrinsic width of the two text
    // lines plus three controls far exceeded 360px, and the right-hand
    // controls — Revoke / Sever / Re-grant — were pushed out of view.
    // `min-w-0` on the text column is the other half: without it a flex
    // item's `min-width:auto` resolves to min-content and refuses to shrink.
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <Share2
          className="size-5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="truncate font-medium">Grant to another household</p>
          <p className="truncate text-sm text-muted-foreground">
            {acceptanceLine}
          </p>
          {grant.severed_at ? (
            <p className="truncate text-xs text-muted-foreground">
              Severed {new Date(grant.severed_at).toLocaleDateString()}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <GrantStatusChip status={grant.status} />
        {canEditAccessLevel ? (
          <Select
            value={grant.access_level}
            onValueChange={handleAccessLevelChange}
            disabled={accessLevelSaving}
          >
            {/* No `size="sm"` and no `h-7`: the trigger is a real control a
                finger has to hit. `data-[size=default]` is what carries this
                repo's `min-h-11 md:min-h-9` touch floor (ui/select.tsx) —
                `sm` opts out of it, and an explicit `h-7` beat it anyway. */}
            <SelectTrigger
              aria-label="Change access level"
              className="gap-1.5 border-0 bg-secondary px-2.5 text-xs font-semibold text-muted-foreground shadow-none ring-1 ring-border hover:bg-secondary/80"
            >
              <AccessLevelIcon className="size-3" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACCESS_LEVEL_ORDER.map((level) => (
                <SelectItem key={level} value={level}>
                  {ACCESS_LEVEL_LABELS[level]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <GrantAccessChip
            Icon={AccessLevelIcon}
            label={ACCESS_LEVEL_LABELS[grant.access_level]}
          />
        )}
        {grant.status === "pending" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleAction("revoke", grant.id)}
            disabled={loading}
            title="Revoke this pending grant"
          >
            Revoke
          </Button>
        )}
        {grant.status === "accepted" && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setIsSeverConfirmOpen(true)}
            disabled={loading}
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : "Sever"}
          </Button>
        )}
        {["severed", "revoked", "expired"].includes(grant.status) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleAction("regrant", grant.id)}
            disabled={loading}
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : "Re-grant"}
          </Button>
        )}
      </div>
      {/* The app's own confirm shape, not a native `confirm()`: that one is
          unstyled, not focus-trapped, and on a phone it is a browser-chrome
          sheet the destructive action then fires from with no visible link
          back to the row it belongs to. */}
      <Confirm
        isOpen={isSeverConfirmOpen}
        loading={loading}
        title="Sever this grant?"
        content="The other household will immediately lose access to this single's record."
        confirm="Sever"
        confirmColor="warning"
        ConfirmIcon={Scissors}
        onClose={() => setIsSeverConfirmOpen(false)}
        onConfirm={() => {
          setIsSeverConfirmOpen(false);
          void handleAction("sever", grant.id);
        }}
      />
    </div>
  );
}

interface ProposeGrantDialogProps {
  single: Single;
  onSuccess: () => void;
}

function ProposeGrantDialog({ single, onSuccess }: ProposeGrantDialogProps) {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [accessLevel, setAccessLevel] = useState<ChildGrantAccessLevel>("read");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  // Reset on close so the next open starts clean rather than re-showing the
  // previous grant's link (SingleLoginInvite.tsx's own handleOpenChange).
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setEmail("");
      setAccessLevel("read");
      setError(null);
      setCreatedLink(null);
      setIsCopied(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const token = await dataProvider.createChildGrant(
        single.id,
        email,
        accessLevel,
      );
      // Two things were wrong with the `alert()` this replaces. Its text is
      // not selectable or copyable in iOS Safari or Android Chrome, so on a
      // phone the whole share flow dead-ended with a link the parent could
      // read and not take. And the link itself was path-shaped — this app
      // runs on ra-core's default HashRouter, so `/accept-grant/<token>`
      // reaches the web server, never the router; only the `/#/…` form is
      // reachable (SingleLoginInvite.tsx and InvitesSection.tsx both build
      // their accept links that way).
      setCreatedLink(`${window.location.origin}/#/accept-grant/${token}`);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create grant");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!createdLink) return;
    navigator.clipboard.writeText(createdLink).then(() => setIsCopied(true));
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Share2 className="size-4 mr-2" />
          Share with another household
        </Button>
      </DialogTrigger>
      {/* `sm:max-w-md`, never a bare `max-w-md`: tailwind-merge keeps the
          LAST unprefixed `max-w-*`, so an unprefixed cap silently replaces
          the base component's `max-w-[calc(100%-2rem)]` — the rule that
          reserves the 16px gutter each side at phone width. `dvh`, not
          `vh`, so mobile browser chrome is accounted for; without the cap
          and the scroll this panel is centre-translated off both edges of
          the visual viewport once the software keyboard opens. */}
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share this single's record</DialogTitle>
        </DialogHeader>
        {createdLink ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Send this link to the other parent. They will be asked to accept
              before they can see anything.
            </p>
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2">
              {/* `text-base` below `md`: ui/input.tsx's own base is
                  `text-sm` (14px), and iOS Safari auto-zooms the page
                  whenever a focused input is under 16px — a readonly field
                  included, since it still takes focus when it is tapped to
                  select the link. Same reason as SingleLoginInvite.tsx's. */}
              <Input
                readOnly
                value={createdLink}
                aria-label="Invitation link"
                className="min-w-0 flex-1 text-base md:text-sm"
              />
              <Button type="button" variant="outline" onClick={handleCopy}>
                {isCopied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
                {isCopied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="flex justify-end pt-2">
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Enter the email address of the parent you want to share this
              record with. They will receive an invitation to accept access.
            </p>
            <div className="space-y-2">
              <Label htmlFor="grantee-email">Email address</Label>
              <Input
                id="grantee-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="parent@example.com"
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label>Access level</Label>
              <RadioGroup
                value={accessLevel}
                onValueChange={(value) =>
                  setAccessLevel(value as ChildGrantAccessLevel)
                }
                disabled={loading}
                className="gap-2"
              >
                {ACCESS_LEVEL_ORDER.map((level) => (
                  <div key={level} className="flex items-start gap-2">
                    {/* aria-label as well as the <Label htmlFor> below.
                     * Radix renders this as `<button role="radio">`, and
                     * `htmlFor` names form controls only — never a button —
                     * so without it the accessible name resolves EMPTY. The
                     * label's own first line, so the two cannot drift. */}
                    <RadioGroupItem
                      value={level}
                      id={`grant-access-level-${level}`}
                      aria-label={ACCESS_LEVEL_LABELS[level]}
                      className="mt-0.5"
                    />
                    <Label
                      htmlFor={`grant-access-level-${level}`}
                      className="flex flex-col items-start gap-0.5 font-normal"
                    >
                      <span>{ACCESS_LEVEL_LABELS[level]}</span>
                      <span className="text-xs text-muted-foreground">
                        {ACCESS_LEVEL_DESCRIPTIONS[level]}
                      </span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
            {error && (
              <div className="text-sm text-destructive flex items-center gap-2">
                <AlertCircle className="size-4" />
                {error}
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
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
        )}
      </DialogContent>
    </Dialog>
  );
}

export function SingleGrantManagement(): React.ReactElement | null {
  const record = useRecordContext<Single>();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [grants, setGrants] = useState<ChildGrant[]>([]);
  const [loading, setLoading] = useState(true);

  const recordId = record?.id;

  const loadGrants = useCallback(async () => {
    if (recordId == null) return;
    setLoading(true);
    try {
      const { data } = await dataProvider.getList<ChildGrant>("child_grants", {
        filter: { target_single_id: recordId },
        sort: { field: "created_at", order: "DESC" },
        pagination: { page: 1, perPage: 50 },
      });
      setGrants(data);
    } catch (error) {
      console.error("Failed to load grants", error);
    } finally {
      setLoading(false);
    }
  }, [dataProvider, recordId]);

  // Load grants on mount and whenever the record changes.
  //
  // This was previously a bare `if (loading && grants.length === 0)
  // loadGrants()` in the render body. loadGrants() calls setLoading(true)
  // synchronously, so it updated state during render, the guard stayed true
  // on the re-render, and it looped until React threw "Too many re-renders".
  // That took the whole singles 360 down — every one of the 19 tests in
  // entityDescriptor.test.tsx failed on it, not just the grant ones, because
  // the throw escaped to the router's error boundary and replaced the page.
  useEffect(() => {
    void loadGrants();
  }, [loadGrants]);

  if (!record) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
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
          <p>This single's record is not shared with any other household.</p>
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
