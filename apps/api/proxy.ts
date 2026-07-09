import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Web portal pages require a signed-in user (unauthenticated → redirect to
// sign-in). API routes are left to self-enforce: they read the user via
// getUserId() and return 401 JSON rather than redirecting, so the mobile app
// gets a clean error instead of an HTML redirect. Admin routes (ADMIN_SECRET)
// don't call getUserId(), so they keep working without a Clerk session.
const isPortalPage = createRouteMatcher(["/", "/sessions(.*)", "/ask(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isPortalPage(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Run on everything except Next internals and static assets...
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|map|jpe?g|gif|png|svg|ico|webp|woff2?|ttf)).*)",
    // ...and always on API routes.
    "/(api|trpc)(.*)",
  ],
};
