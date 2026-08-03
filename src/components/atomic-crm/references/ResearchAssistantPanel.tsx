import { useTranslate } from "ra-core";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { Reference } from "../types";
import { getQuestionsForRelationship } from "./relationshipQuestions";
import { useAiEntitlement } from "./useAiEntitlement";

/**
 * The research assistant panel (§5d, FR59-63).
 *
 * Three things it does: tailored questions for this relationship type (FR59),
 * a guided call script whose capture writes into the real call log rather than
 * a side channel (FR60), and a cross-reference summary of consensus,
 * contradictions and gaps (FR61).
 *
 * THE GUARDRAIL (FR63) is not decoration. This assistant organizes what the
 * family has already learned. It never judges compatibility, never scores or
 * ranks a match, and never looks the reference up anywhere outside this account
 * (PRV-6). The disclaimer below is shown, not merely enforced server-side,
 * because the promise only works if the user can see it being made.
 *
 * Entitlement: this panel is the ONLY reference surface behind the paid tier.
 * The timeline, notes, reminders, call log, match-on-entry and merge are all
 * free and must never consult useAiEntitlement.
 *
 * Deferred (Epic-10/AD-8): generated prose. Everything rendered here is computed
 * locally from the account's own data; when the AI Gateway lands, generation
 * goes through it and never direct to a provider.
 */

const Guardrail = () => {
  const translate = useTranslate();
  return (
    <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
      {translate("crm.references.assistant.guardrail", {
        _: "This assistant organizes what you have learned. It never judges compatibility and never suggests a match.",
      })}
    </p>
  );
};

const UpgradePrompt = () => {
  const translate = useTranslate();
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold">
            {translate("crm.references.assistant.title", {
              _: "Research assistant",
            })}
          </h3>
          <Badge variant="secondary">
            {translate("crm.references.assistant.paid", { _: "Paid" })}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {translate("crm.references.assistant.upsell", {
            _: "Tailored questions for each reference, a guided call script, and a summary of what everyone agreed on and what is still missing.",
          })}
        </p>
        <Guardrail />
      </CardContent>
    </Card>
  );
};

export const ResearchAssistantPanel = ({
  reference,
}: {
  reference: Reference;
}) => {
  const translate = useTranslate();
  const { isEntitled, isLoading } = useAiEntitlement();

  if (isLoading) return null;
  if (!isEntitled) return <UpgradePrompt />;

  const { set, questions } = getQuestionsForRelationship(
    reference.relationship,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold">
          {translate("crm.references.assistant.title", {
            _: "Research assistant",
          })}
        </h3>
        <Badge variant="secondary">
          {translate("crm.references.assistant.paid", { _: "Paid" })}
        </Badge>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-2 pt-6">
          <p className="text-sm font-medium">
            {translate("crm.references.assistant.questionsTitle", {
              relationship: set?.label ?? reference.relationship ?? "",
              _: "Questions worth asking %{relationship}",
            })}
          </p>
          <ol className="list-inside list-decimal text-sm">
            {questions.map((question) => (
              <li key={question} className="py-0.5">
                {question}
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">
            {translate("crm.references.assistant.captureHint", {
              _: 'Use "Log a call" on any linked single to capture the answers as you go.',
            })}
          </p>
        </CardContent>
      </Card>

      <Guardrail />
    </div>
  );
};
