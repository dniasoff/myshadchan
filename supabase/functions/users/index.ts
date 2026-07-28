import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { getUserMember } from "../_shared/getUserMember.ts";

async function updateMemberDisabled(user_id: string, disabled: boolean) {
  return await supabaseAdmin
    .from("members")
    .update({ disabled: disabled ?? false })
    .eq("user_id", user_id);
}

async function updateMemberAdministrator(
  user_id: string,
  administrator: boolean,
) {
  const { data: members, error: membersError } = await supabaseAdmin
    .from("members")
    .update({ administrator })
    .eq("user_id", user_id)
    .select("*");

  if (!members?.length || membersError) {
    console.error("Error updating user:", membersError);
    throw membersError ?? new Error("Failed to update member");
  }
  return members.at(0);
}

async function updateMemberAvatar(user_id: string, avatar: string) {
  const { data: members, error: membersError } = await supabaseAdmin
    .from("members")
    .update({ avatar })
    .eq("user_id", user_id)
    .select("*");

  if (!members?.length || membersError) {
    console.error("Error updating user:", membersError);
    throw membersError ?? new Error("Failed to update member");
  }
  return members.at(0);
}

async function patchUser(req: Request, currentUserMember: any) {
  const {
    member_id,
    email,
    first_name,
    last_name,
    avatar,
    administrator,
    disabled,
  } = await req.json();
  const { data: member } = await supabaseAdmin
    .from("members")
    .select("*")
    .eq("id", member_id)
    .single();

  if (!member) {
    return createErrorResponse(404, "Not Found");
  }

  // Users can only update their own profile unless they are an administrator
  if (!currentUserMember.administrator && currentUserMember.id !== member.id) {
    return createErrorResponse(401, "Not Authorized");
  }

  // A profile self-edit sends only name/avatar. Never overwrite the email
  // (re-setting it breaks OAuth/Google users on the hosted GoTrue) or the ban
  // state unless the caller actually changed them.
  const userUpdate: {
    email?: string;
    ban_duration?: string;
    user_metadata: { first_name?: string; last_name?: string };
  } = { user_metadata: { first_name, last_name } };
  if (email && email !== member.email) {
    userUpdate.email = email;
  }
  if (disabled !== undefined) {
    userUpdate.ban_duration = disabled ? "87600h" : "none";
  }

  const { data, error: userError } =
    await supabaseAdmin.auth.admin.updateUserById(member.user_id, userUpdate);

  if (!data?.user || userError) {
    console.error("Error patching user:", userError);
    return createErrorResponse(500, "Internal Server Error");
  }

  if (avatar) {
    await updateMemberAvatar(data.user.id, avatar);
  }

  // Only administrators can update the administrator and disabled status
  if (!currentUserMember.administrator) {
    const { data: new_member } = await supabaseAdmin
      .from("members")
      .select("*")
      .eq("id", member_id)
      .single();
    return new Response(
      JSON.stringify({
        data: new_member,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      },
    );
  }

  try {
    // Only touch the privileged fields an admin actually changed. On a self-edit
    // administrator/disabled arrive undefined and must not be reset (updating a
    // NOT NULL column to null is what previously 500'd the profile save).
    if (disabled !== undefined) {
      await updateMemberDisabled(data.user.id, disabled);
    }
    let updatedMember;
    if (administrator !== undefined) {
      updatedMember = await updateMemberAdministrator(
        data.user.id,
        administrator,
      );
    } else {
      const { data: current } = await supabaseAdmin
        .from("members")
        .select("*")
        .eq("user_id", data.user.id)
        .single();
      updatedMember = current;
    }
    return new Response(
      JSON.stringify({
        data: updatedMember,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      },
    );
  } catch (e) {
    console.error("Error patching member:", e);
    return createErrorResponse(500, "Internal Server Error");
  }
}

Deno.serve(async (req: Request) =>
  OptionsMiddleware(req, async (req) =>
    AuthMiddleware(req, async (req) =>
      UserMiddleware(req, async (req, user) => {
        const currentUserMember = await getUserMember(user);
        if (!currentUserMember) {
          return createErrorResponse(401, "Unauthorized");
        }

        if (req.method === "PATCH") {
          return patchUser(req, currentUserMember);
        }

        return createErrorResponse(405, "Method Not Allowed");
      }),
    ),
  ),
);
