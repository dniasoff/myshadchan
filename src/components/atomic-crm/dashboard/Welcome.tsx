import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Welcome = () => (
  <Card>
    <CardHeader className="px-4">
      <CardTitle>Welcome to MyShadchan</CardTitle>
    </CardHeader>
    <CardContent className="px-4">
      <p className="text-sm mb-4">
        MyShadchan is your private, organised memory for the shidduch process —
        every shadchan, suggestion, resume, reference call, and date, all in one
        calm place.
      </p>
      <p className="text-sm mb-4">
        Capture a resume from wherever it arrives, and MyShadchan checks it
        against every past suggestion and your child's dating history — so
        nothing, and no thoughtful decision, ever gets lost.
      </p>
      <p className="text-sm">
        Your data is yours alone: never pooled, never shared without your
        consent, and always exportable.
      </p>
    </CardContent>
  </Card>
);
