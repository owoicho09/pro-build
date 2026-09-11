import { NextResponse } from "next/server";
import { advancePendingBuilds } from "@/lib/services/build-orchestrator";

// Durable fallback for build progress: polls every in-flight build's v0
// message status and finalizes anything that has completed since the last
// run. This is what keeps a build moving even if nobody has the workspace
// tab open (spec: "the browser should not need to remain open"). Wired to
// Vercel Cron in vercel.json; the workspace UI also calls the same
// advanceBuild() logic directly per-build while a tab is open, for a
// snappier local-dev experience that doesn't depend on cron being deployed.
export async function GET(request: Request) {
  // Vercel Cron automatically sends `Authorization: Bearer <CRON_SECRET>`
  // when it invokes this route — see
  // https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await advancePendingBuilds();
  return NextResponse.json(result);
}
