import { type User } from "jsr:@supabase/supabase-js@2";
import { supabaseAdmin } from "./supabaseAdmin.ts";

/**
 * Get the member associated to the provided user.
 */
export const getUserMember = async (user: User) => {
  return (
    await supabaseAdmin
      .from("members")
      .select("*")
      .eq("user_id", user.id)
      .single()
  )?.data;
};
