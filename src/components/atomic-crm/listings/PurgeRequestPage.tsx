import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useDataProvider, useNotify, useTranslate } from "ra-core";
import type { CrmDataProvider } from "../providers/types";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

const purgeRequestSchema = z.object({
  single_name: z.string().min(1, "Your name is required"),
  contact: z.string().min(1, "An email or phone number is required"),
  details: z.string().optional(),
});

type PurgeRequestFormData = z.infer<typeof purgeRequestSchema>;

const SearchShell = ({ children }: { children: React.ReactNode }) => (
  <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{
        background:
          "radial-gradient(120% 80% at 50% -10%, color-mix(in oklch, var(--primary) 14%, transparent), transparent 60%), radial-gradient(90% 60% at 100% 0%, color-mix(in oklch, var(--violet, var(--primary)) 12%, transparent), transparent 55%)",
      }}
    />
    <main className="relative mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-5 py-14 sm:py-20">
      {children}
    </main>
  </div>
);

export const PurgeRequestPage = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [phase, setPhase] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PurgeRequestFormData>({
    resolver: zodResolver(purgeRequestSchema),
    defaultValues: {
      single_name: "",
      contact: "",
      details: "",
    },
  });

  const onSubmit = async (data: PurgeRequestFormData) => {
    setPhase("submitting");
    try {
      await dataProvider.create("purge_requests", { data });
      setPhase("success");
      reset();
    } catch (error) {
      setPhase("error");
      notify(
        error instanceof Error
          ? error.message
          : translate("ra.notification.http_error"),
        { type: "error" },
      );
    }
  };

  return (
    <SearchShell>
      <Card className="w-full">
        <CardHeader className="text-center pb-4">
          <CardTitle>
            {/* `CardTitle` is a plain <div> and takes no `asChild`
             * (ui/card.tsx), so without this nested <h1> the page — a public,
             * unauthenticated surface — has no top-level heading at all. */}
            <h1 className="font-display text-2xl font-bold tracking-tight">
              Request Removal of Your Information
            </h1>
          </CardTitle>
          <CardDescription className="text-base">
            You found your name in our system and you want it removed. This page
            lets you submit a request — no account, no login, no family name
            needed.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {phase === "success" ? (
            <div className="flex flex-col items-center gap-4 text-center py-8">
              <CheckCircle2
                className="size-12 text-green-600"
                aria-hidden="true"
              />
              <h2 className="font-display text-xl font-semibold">
                Request Submitted
              </h2>
              <p className="text-muted-foreground max-w-md">
                Your request has been received. A verification link has been
                sent to the contact you provided. Once you click it, an
                administrator will review your request and follow the process
                described below.
              </p>
              <Button variant="outline" onClick={() => setPhase("idle")}>
                Submit Another Request
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-3 text-sm text-muted-foreground border-l-4 border-primary pl-4">
                <h2 className="font-medium text-foreground">
                  What happens after you submit
                </h2>
                <ul className="list-disc list-inside space-y-2 text-left">
                  <li>
                    <strong>Identity is verified first.</strong> A purge request
                    can also be used to attack someone, so we check before
                    deleting anything.
                  </li>
                  <li>
                    <strong>
                      The accounts holding your record are notified.
                    </strong>{" "}
                    They will know a request was made.
                  </li>
                  <li>
                    <strong>Your own record is removed.</strong> But a family's
                    notes about their own child are not deleted — those belong
                    to them.
                  </li>
                  <li>
                    <strong>
                      Reference conversations that mention you may remain.
                    </strong>
                    A reference is also about the person who gave it. Our
                    published policy (Story 14.1) decides which parts stay.
                  </li>
                </ul>
              </div>

              <Separator />

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                <div className="space-y-2">
                  <Label
                    htmlFor="single_name"
                    className="block text-sm font-medium"
                  >
                    Your full name
                  </Label>
                  <Input
                    id="single_name"
                    {...register("single_name")}
                    placeholder="e.g., Chaya Cohen"
                    aria-invalid={!!errors.single_name}
                    aria-describedby={
                      errors.single_name ? "single_name_error" : undefined
                    }
                    disabled={phase === "submitting"}
                    autoComplete="name"
                  />
                  {errors.single_name && (
                    <p
                      id="single_name_error"
                      className="text-sm text-destructive"
                      role="alert"
                    >
                      {errors.single_name.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="contact"
                    className="block text-sm font-medium"
                  >
                    Email or phone to reach you
                  </Label>
                  <Input
                    id="contact"
                    {...register("contact")}
                    placeholder="e.g., chaya@example.com or 555-123-4567"
                    aria-invalid={!!errors.contact}
                    aria-describedby={
                      errors.contact ? "contact_error" : undefined
                    }
                    disabled={phase === "submitting"}
                    autoComplete="email"
                  />
                  {errors.contact && (
                    <p
                      id="contact_error"
                      className="text-sm text-destructive"
                      role="alert"
                    >
                      {errors.contact.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="details"
                    className="block text-sm font-medium text-foreground"
                  >
                    Anything else that helps us find your record
                  </Label>
                  <Textarea
                    id="details"
                    {...register("details")}
                    placeholder="School, community, approximate age, shadchan name, years you were suggested — anything that helps us identify which record is yours. You don't need to know the family name."
                    className="min-h-[100px]"
                    disabled={phase === "submitting"}
                    aria-describedby="details-hint"
                  />
                  <p
                    id="details-hint"
                    className="text-xs text-muted-foreground"
                  >
                    This is optional but helps us locate the right record
                    faster.
                  </p>
                </div>

                {phase === "error" && (
                  <div
                    role="alert"
                    className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-destructive text-sm"
                  >
                    <AlertCircle
                      className="size-4 flex-shrink-0"
                      aria-hidden="true"
                    />
                    <span>
                      Could not submit your request. Please try again, or
                      contact support if the problem persists.
                    </span>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={phase === "submitting"}
                  size="lg"
                >
                  {phase === "submitting" ? (
                    <>
                      <Loader2
                        className="me-2 size-4 animate-spin"
                        aria-hidden="true"
                      />
                      Submitting…
                    </>
                  ) : (
                    "Submit Request"
                  )}
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </SearchShell>
  );
};
