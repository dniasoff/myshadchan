import { useMutation } from "@tanstack/react-query";
import { useDataProvider, useNotify, useRedirect, useTranslate } from "ra-core";
import type { SubmitHandler } from "react-hook-form";
import { SimpleForm } from "@/components/admin/simple-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import type { CrmDataProvider } from "../providers/types";
import type { MemberFormData } from "../types";
import { MemberInputs } from "./MemberInputs";

export function MemberCreate() {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const translate = useTranslate();
  const redirect = useRedirect();

  const { mutate } = useMutation({
    mutationKey: ["signup"],
    mutationFn: async (data: MemberFormData) => {
      return dataProvider.memberCreate(data);
    },
    onSuccess: () => {
      notify("resources.members.create.success", {
        messageArgs: {
          _: "User created. They will soon receive an email to set their password.",
        },
      });
      redirect("/members");
    },
    onError: (error) => {
      notify(
        error.message ||
          translate("resources.members.create.error", {
            _: "An error occurred while creating the user.",
          }),
        {
          type: "error",
        },
      );
    },
  });
  const onSubmit: SubmitHandler<MemberFormData> = async (data) => {
    mutate(data);
  };

  return (
    <div className="max-w-lg w-full mx-auto mt-8">
      <Card>
        <CardHeader>
          <CardTitle>
            {translate("resources.members.create.title", {
              _: "Create a new user",
            })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SimpleForm onSubmit={onSubmit as SubmitHandler<any>}>
            <MemberInputs />
          </SimpleForm>
        </CardContent>
      </Card>
    </div>
  );
}
