import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// /templates is public — spec: anonymous users can browse templates and
// inspect previews before authenticating; "Use Template" itself still
// requires auth, handled inside its own server action rather than here.
//
// /admin is "public" here too, deliberately: src/app/admin/page.tsx
// returns notFound() for anyone who isn't an admin (signed out or signed
// in) specifically so the route's existence isn't distinguishable from a
// URL that doesn't exist at all — redirecting anonymous visitors to
// /login here instead would leak exactly that. Let the page's own check
// be the sole gate for this one route.
const PUBLIC_PATHS = [
  "/",
  "/login",
  "/signup",
  "/auth",
  "/templates",
  "/admin",
  // Must be reachable while signed OUT — that's the entire point of a
  // password reset flow. Missing from this list meant every visit
  // bounced straight back to /login before the page ever rendered,
  // which looked like the "Forgot password?" link did nothing at all.
  "/forgot-password",
  "/reset-password",
];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

// Refreshes the Supabase session cookie on every request and redirects
// unauthenticated visitors away from private routes. Must run before any
// server component that reads the session, or cookies can silently expire
// mid-session (the middleware is the only place setAll() reliably persists).
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
