"use server";

import { createClient } from "@/lib/supabase/server";

export async function markNotificationsRead(ids: string[]) {
  if (ids.length === 0) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // RLS ("notifications_all_own") already scopes this to the caller's own
  // rows — the .eq("user_id", ...) here is belt-and-suspenders, not the
  // actual security boundary.
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids)
    .eq("user_id", user.id)
    .is("read_at", null);
}
