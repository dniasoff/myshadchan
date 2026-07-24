import { useState } from "react";
import { Loader2, Users, Sparkles, Check } from "lucide-react";
import {
  useCreate,
  useGetList,
  useNotify,
  useTranslate,
  useUpdate,
} from "ra-core";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Account } from "../types";
import { LedgerMark } from "./BrandLockup";
import { PRIMARY_CTA_CLASSNAME } from "./primaryCtaClassName";

type Step = "account" | "child" | "done";

const STEPS: Step[] = ["account", "child", "done"];

/**
 * First-run onboarding: name the family record, add the first child, land
 * on the dashboard. Rendered inline (no dedicated route) by
 * `login/OnboardingChoice.tsx`'s "Start with my own family" path — see
 * `root/OnboardingGate.tsx` for when that screen shows.
 *
 * Both steps are real writes, not mocked: `accounts` (name) and `children`
 * (first child) are both RLS-scoped, authenticated-writable tables already —
 * see supabase/schemas/05_policies.sql / 06_grants.sql.
 */
export const FirstRunSetup = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("account");
  const [childName, setChildName] = useState<string>("");

  const { data: accounts, isPending: isAccountLoading } = useGetList<Account>(
    "accounts",
    {
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
    },
  );
  const account = accounts?.[0];

  const [updateAccount, { isPending: isSavingAccount }] = useUpdate();
  const [createChild, { isPending: isSavingChild }] = useCreate();

  const accountForm = useForm<{ name: string }>({
    values: account ? { name: account.name } : undefined,
  });
  const childForm = useForm<{
    first_name_en: string;
    gender?: string;
  }>({ defaultValues: { first_name_en: "", gender: "" } });

  const stepIndex = STEPS.indexOf(step);

  const handleAccountSubmit = accountForm.handleSubmit((values) => {
    if (!account) return;
    updateAccount(
      "accounts",
      { id: account.id, data: { name: values.name }, previousData: account },
      {
        onSuccess: () => setStep("child"),
        onError: () => {
          notify("crm.auth.onboarding.account_save_error", {
            type: "error",
            messageArgs: { _: "Couldn't save that name. Try again." },
          });
        },
      },
    );
  });

  const handleChildSubmit = childForm.handleSubmit((values) => {
    createChild(
      "children",
      {
        data: {
          first_name_en: values.first_name_en,
          gender: values.gender || null,
          status: "active",
        },
      },
      {
        onSuccess: () => {
          setChildName(values.first_name_en);
          setStep("done");
        },
        onError: () => {
          notify("crm.auth.onboarding.child_save_error", {
            type: "error",
            messageArgs: { _: "Couldn't add that child. Try again." },
          });
        },
      },
    );
  });

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-background p-6"
      style={{ backgroundImage: "var(--wash)" }}
    >
      <div className="ql-enter mx-auto w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center gap-2">
          <div
            className="grid h-9 w-9 place-items-center rounded-lg text-primary-foreground"
            style={{ background: "var(--primary)" }}
          >
            <LedgerMark className="h-5 w-5" />
          </div>
          <span className="font-display text-lg font-bold tracking-tight">
            My<span style={{ color: "var(--primary)" }}>Shadchan</span>
          </span>
        </div>

        {/* Step dots */}
        <div
          className="flex items-center justify-center gap-2"
          aria-hidden="true"
        >
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={cn(
                "h-1.5 rounded-full transition-[width,background-color] duration-[240ms] ease-[--ease-out]",
                i === stepIndex ? "w-6" : "w-1.5",
              )}
              style={{
                background:
                  i <= stepIndex
                    ? "var(--primary)"
                    : "color-mix(in oklch, var(--muted-foreground) 30%, transparent)",
              }}
            />
          ))}
        </div>

        {step === "account" ? (
          <div className="space-y-5">
            <div className="space-y-2 text-center">
              <h1 className="font-display text-2xl font-bold tracking-tight">
                {translate("crm.auth.onboarding.account_title", {
                  _: "Name your family's record",
                })}
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {translate("crm.auth.onboarding.account_body", {
                  _: "This is what you'll see across MyShadchan — you can change it any time in Settings.",
                })}
              </p>
            </div>

            {isAccountLoading ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <form onSubmit={handleAccountSubmit} className="space-y-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="account-name">
                    {translate("crm.auth.onboarding.account_label", {
                      _: "Family record name",
                    })}
                  </Label>
                  <Input
                    id="account-name"
                    placeholder="The Klein Family"
                    {...accountForm.register("name", { required: true })}
                  />
                </div>
                <Button
                  type="submit"
                  className={cn("w-full cursor-pointer", PRIMARY_CTA_CLASSNAME)}
                  disabled={isSavingAccount || !account}
                >
                  {isSavingAccount ? (
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {translate("crm.auth.onboarding.continue", {
                    _: "Continue",
                  })}
                </Button>
              </form>
            )}
          </div>
        ) : null}

        {step === "child" ? (
          <div className="space-y-5">
            <div className="space-y-2 text-center">
              <div
                className="mx-auto grid h-14 w-14 place-items-center rounded-full shadow-[0_0_32px_-8px_var(--glow-accent)]"
                style={{
                  background:
                    "color-mix(in oklch, var(--st-look) 16%, transparent)",
                }}
              >
                <Users
                  className="size-6"
                  style={{ color: "var(--st-look)" }}
                  aria-hidden="true"
                />
              </div>
              <h1 className="font-display text-2xl font-bold tracking-tight">
                {translate("crm.auth.onboarding.child_title", {
                  _: "Add your first child",
                })}
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {translate("crm.auth.onboarding.child_body", {
                  _: "Every suggestion, shadchan and reference call is tracked per child. You can add more any time.",
                })}
              </p>
            </div>

            <form onSubmit={handleChildSubmit} className="space-y-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="child-first-name-en">
                  {translate("crm.auth.onboarding.child_first_name", {
                    _: "First name",
                  })}
                </Label>
                <Input
                  id="child-first-name-en"
                  autoFocus
                  {...childForm.register("first_name_en", { required: true })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="child-gender">
                  {translate("crm.auth.onboarding.child_gender", {
                    _: "Gender — optional",
                  })}
                </Label>
                <Select
                  onValueChange={(value) => childForm.setValue("gender", value)}
                >
                  <SelectTrigger id="child-gender" className="w-full">
                    <SelectValue
                      placeholder={translate(
                        "crm.auth.onboarding.child_gender_placeholder",
                        { _: "Select..." },
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="female">
                      {translate("crm.children.gender_female", {
                        _: "Female",
                      })}
                    </SelectItem>
                    <SelectItem value="male">
                      {translate("crm.children.gender_male", { _: "Male" })}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                type="submit"
                className={cn("w-full cursor-pointer", PRIMARY_CTA_CLASSNAME)}
                disabled={isSavingChild}
              >
                {isSavingChild ? (
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                ) : null}
                {translate("crm.auth.onboarding.add_child", {
                  _: "Add child",
                })}
              </Button>
            </form>
          </div>
        ) : null}

        {step === "done" ? (
          <div className="space-y-6 text-center">
            <div
              className="mx-auto grid h-14 w-14 place-items-center rounded-full shadow-[0_0_32px_-8px_var(--glow-accent)]"
              style={{
                background:
                  "linear-gradient(135deg, var(--accent-grad-from), var(--accent-grad-to))",
              }}
            >
              <Check
                className="size-6 text-primary-foreground"
                aria-hidden="true"
              />
            </div>
            <div className="space-y-2">
              <h1 className="font-display text-2xl font-bold tracking-tight">
                {translate("crm.auth.onboarding.done_title", {
                  _: "You're all set",
                })}
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {childName
                  ? translate("crm.auth.onboarding.done_body_named", {
                      _: `${childName}'s record is ready. Start by logging a suggestion.`,
                      childName,
                    })
                  : translate("crm.auth.onboarding.done_body", {
                      _: "Your record is ready. Start by logging a suggestion.",
                    })}
              </p>
            </div>
            <Button
              type="button"
              className={cn(
                "w-full cursor-pointer gap-2",
                PRIMARY_CTA_CLASSNAME,
              )}
              onClick={() => navigate("/")}
            >
              <Sparkles className="size-4" aria-hidden="true" />
              {translate("crm.auth.onboarding.go_to_dashboard", {
                _: "Go to my dashboard",
              })}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
};
