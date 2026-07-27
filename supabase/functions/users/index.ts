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

async function createMember(
  user_id: string,
  data: {
    email: string;
    password: string;
    first_name: string;
    last_name: string;
    disabled: boolean;
    administrator: boolean;
  },
) {
  const { data: members, error: membersError } = await supabaseAdmin
    .from("members")
    .insert({ ...data, user_id })
    .select("*");

  if (!members?.length || membersError) {
    console.error("Error creating user:", membersError);
    throw membersError ?? new Error("Failed to create member");
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

/**
 * Binds an invited user to the inviter's account.
 *
 * current_context_id() fails closed, so a user with no account_members row can
 * log in and then find a completely empty, unwritable app. Creating the auth
 * user is therefore only half of an invite — this is the other half.
 *
 * Deliberately narrow, pending the real invite-token flow (AD-11, Epic-1):
 *  - the account comes from the INVITER's membership, never from the request;
 *  - the role is always 'helper', the least-privileged role. parent_admin and
 *    the reserved shadchan role are never grantable through this path, so a
 *    request body cannot escalate anyone;
 *  - it is idempotent, so re-inviting an existing member changes nothing.
 */
async function provisionAccountMembership(
  inviterUserId: string,
  newUserId: string,
) {
  const { data: inviterMembership } = await supabaseAdmin
    .from("account_members")
    .select("id, account_id")
    .eq("user_id", inviterUserId)
    .eq("status", "active")
    .order("id")
    .limit(1)
    .maybeSingle();

  if (!inviterMembership) {
    // The inviter has no membership either, so there is no account to bind to.
    // Better to leave the invitee unprovisioned than to guess an account.
    console.error(
      `Cannot provision membership: inviter ${inviterUserId} has no active account_members row`,
    );
    return;
  }

  const { data: existing } = await supabaseAdmin
    .from("account_members")
    .select("id")
    .eq("user_id", newUserId)
    .limit(1);

  if (existing?.length) return;

  const { error } = await supabaseAdmin.from("account_members").insert({
    account_id: inviterMembership.account_id,
    user_id: newUserId,
    role: "helper",
    status: "active",
    invited_by: inviterMembership.id,
  });

  if (error) {
    console.error("Error provisioning account membership:", error);
    throw error;
  }
}

async function inviteUser(req: Request, currentUserMember: any) {
  const { email, password, first_name, last_name, disabled, administrator } =
    await req.json();

  if (!currentUserMember.administrator) {
    return createErrorResponse(401, "Not Authorized");
  }

  const { data, error: userError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    user_metadata: { first_name, last_name },
  });

  let user = data?.user;

  if (!user && userError?.code === "email_exists") {
    // This may happen if users cleared their database but not the users
    // We have to create the member directly
    const { data, error } = await supabaseAdmin.rpc("get_user_id_by_email", {
      email,
    });

    if (!data || error) {
      console.error(
        `Error inviting user: error=${error ?? "could not fetch users for email"}`,
      );
      return createErrorResponse(500, "Internal Server Error");
    }

    user = data[0];
    try {
      const { data: existingMember, error: membersError } = await supabaseAdmin
        .from("members")
        .select("*")
        .eq("user_id", user.id);
      if (membersError) {
        return createErrorResponse(membersError.status, membersError.message, {
          code: membersError.code,
        });
      }
      if (existingMember.length > 0) {
        return createErrorResponse(
          400,
          "A member for this email already exists",
        );
      }

      const member = await createMember(user.id, {
        email,
        password,
        first_name,
        last_name,
        disabled,
        administrator,
      });

      await provisionAccountMembership(currentUserMember.user_id, user.id);

      return new Response(
        JSON.stringify({
          data: member,
        }),
        {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    } catch (error) {
      return createErrorResponse(
        (error as any).status ?? 500,
        (error as Error).message,
        {
          code: (error as any).code,
        },
      );
    }
  } else {
    if (userError) {
      console.error(`Error inviting user: user_error=${userError}`);
      return createErrorResponse(userError.status, userError.message, {
        code: userError.code,
      });
    }
    if (!data?.user) {
      console.error("Error inviting user: undefined user");
      return createErrorResponse(500, "Internal Server Error");
    }
    const { error: emailError } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(email);

    if (emailError) {
      console.error(`Error inviting user, email_error=${emailError}`);
      return createErrorResponse(500, "Failed to send invitation mail");
    }
  }

  try {
    await provisionAccountMembership(currentUserMember.user_id, user.id);
    await updateMemberDisabled(user.id, disabled);
    const member = await updateMemberAdministrator(user.id, administrator);

    return new Response(
      JSON.stringify({
        data: member,
      }),
      {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  } catch (e) {
    console.error("Error patching member:", e);
    return createErrorResponse(500, "Internal Server Error");
  }
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

        if (req.method === "POST") {
          return inviteUser(req, currentUserMember);
        }

        if (req.method === "PATCH") {
          return patchUser(req, currentUserMember);
        }

        return createErrorResponse(405, "Method Not Allowed");
      }),
    ),
  ),
);
