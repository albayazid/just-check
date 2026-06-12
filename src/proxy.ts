// Middleware for authentication and authorization
// Renamed from middleware.ts to proxy.ts as Vercel recently changed the name of the file in Next.js 16.
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

// Define public routes that don't require authentication
const isPublicRoute = createRouteMatcher([
  '/landing(.*)',
  '/students(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/upgrade(.*)',
  '/how-billing-works(.*)',
  '/share(.*)',          // Public share page
  '/api/share(.*)',      // Public share API (GET + attachment resolve)
  '/api/webhooks(.*)',
  '/api/health(.*)',
])

// Define routes that require authentication but NOT profile completion
const isOnboardingRoute = createRouteMatcher([
  '/onboarding(.*)',
  '/api/onboarding(.*)',
])

export default clerkMiddleware(async (auth, req) => {

  // Special handling for root "/" route
  if (req.nextUrl.pathname === '/') {
    const { userId, sessionClaims } = await auth.protect().catch(() => ({ userId: null, sessionClaims: null }));

    if (!userId) {
      return NextResponse.redirect(new URL('/landing', req.url))
    }

    const publicMetadata = sessionClaims?.publicMetadata as { profileComplete?: boolean } | undefined
    const profileComplete = publicMetadata?.profileComplete === true

    if (!profileComplete) {
      const onboardingUrl = new URL('/onboarding', req.url)
      onboardingUrl.searchParams.set('returnUrl', req.url)
      return NextResponse.redirect(onboardingUrl)
    }

    return
  }

  // Allow public routes (no authentication required)
  if (isPublicRoute(req)) {
    return
  }

  // Protect route and get authentication data
  const { sessionClaims } = await auth.protect()

  // Allow onboarding routes without profile completion check
  if (isOnboardingRoute(req)) {
    const publicMetadata = sessionClaims?.publicMetadata as { profileComplete?: boolean } | undefined
    const profileComplete = publicMetadata?.profileComplete === true

    if (profileComplete) {
      return NextResponse.redirect(new URL('/', req.url))
    }

    return
  }

  // Check profile completion status from JWT metadata (ZERO database calls!)
  const publicMetadata = sessionClaims?.publicMetadata as {
    profileComplete?: boolean
  } | undefined
  const profileComplete = publicMetadata?.profileComplete === true

  // KISS: Simple boolean check
  if (profileComplete) {
    return
  }

  // Profile is incomplete - redirect to onboarding
  const onboardingUrl = new URL('/onboarding', req.url)
  // Add return URL so user can come back after completion
  onboardingUrl.searchParams.set('returnUrl', req.url)
  // Add reason for debugging
  onboardingUrl.searchParams.set('reason', 'incomplete_profile')

  return NextResponse.redirect(onboardingUrl)
})

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
