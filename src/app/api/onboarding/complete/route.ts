import { auth, currentUser } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase-client.server'
import { clerkClient } from '@/lib/clerk/clerk-client'
import { validateAge } from '@/lib/age-validation'
import { splitFullName } from '@/lib/clerk/utils'
import { onboardingRatelimit } from '@/lib/ratelimit';

export async function POST(req: Request) {
  try {
    // Authenticate user and get current user details
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    }

    // Rate limit check
    const { success } = await onboardingRatelimit.limit(userId);
    if (!success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Too many requests.' },
        { status: 429 }
      );
    }

    // Get current user to access email
    const currentUserData = await currentUser()

    if (!currentUserData) {
      return NextResponse.json(
        { error: 'Could not fetch user details', code: 'USER_FETCH_ERROR' },
        { status: 500 }
      )
    }

    // Get primary email from Clerk user data
    const userEmail = currentUserData.emailAddresses?.[0]?.emailAddress ||
      currentUserData.primaryEmailAddress?.emailAddress

    if (!userEmail) {
      return NextResponse.json(
        { error: 'No email address found for user', code: 'NO_EMAIL' },
        { status: 400 }
      )
    }

    // Parse request body
    const body = await req.json()
    const { fullName, nickname, dateOfBirth } = body

    // Validate input
    const errors: string[] = []
    if (!fullName || fullName.trim().length < 2 || fullName.trim().length > 100) {
      errors.push('Full name must be between 2 and 100 characters')
    }
    // Validate full name has at least 2 words (for splitting into first/last)
    const fullNameTrimmed = fullName.trim();
    const nameParts = fullNameTrimmed.split(/\s+/);
    if (nameParts.length < 2) {
      errors.push('Full name must contain at least 2 words (first name and last name)')
    }
    if (!nickname || nickname.trim().length < 2 || nickname.trim().length > 50) {
      errors.push('Nickname must be between 2 and 50 characters')
    }
    // Sanitize nickname to prevent XSS
    const sanitizedNickname = nickname.trim().replace(/<[^>]*>/g, '');
    if (sanitizedNickname.length !== nickname.trim().length) {
      errors.push('Nickname contains invalid characters');
    }
    if (!dateOfBirth) {
      errors.push('Date of birth is required')
    } else {
      const ageValidation = validateAge(dateOfBirth, 13, 150)
      if (!ageValidation.isValid) {
        errors.push(ageValidation.error || 'Invalid date of birth')
      }
    }

    if (errors.length > 0) {
      return NextResponse.json(
        { error: 'Validation failed', details: errors, code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    // Initialize Supabase client
    const supabase = getSupabaseAdminClient()

    try {
      // First, check if profile exists
      const { data: existingProfile, error: checkError } = await supabase
        .from('profiles')
        .select('id, clerk_user_id, email')
        .eq('clerk_user_id', userId)
        .single()

      let updateError
      let updatedProfile

      if (existingProfile) {
        // Update existing profile
        const result = await supabase
          .from('profiles')
          .update({
            full_name: fullName.trim(),
            nickname: sanitizedNickname,
            date_of_birth: dateOfBirth,
            avatar_url: currentUserData.imageUrl || null,
            updated_at: new Date().toISOString(),
          })
          .eq('clerk_user_id', userId)
          .select()

        updateError = result.error
        updatedProfile = result.data
      } else {
        // Create new profile with real email
        const result = await supabase
          .from('profiles')
          .insert({
            clerk_user_id: userId,
            email: userEmail, // Using real email from Clerk
            full_name: fullName.trim(),
            nickname: sanitizedNickname,
            date_of_birth: dateOfBirth,
            avatar_url: currentUserData.imageUrl || null,
          })
          .select()

        updateError = result.error
        updatedProfile = result.data
      }

      if (updateError) {
        throw updateError
      }

      // Update Clerk metadata to mark profile as complete
      await clerkClient.users.updateUserMetadata(userId, {
        publicMetadata: {
          profileComplete: true
        }
      })

      // Sync full name to Clerk's firstName and lastName fields
      const fullNameTrimmed = fullName.trim()
      const splitName = splitFullName(fullNameTrimmed)
      if (splitName) {
        await clerkClient.users.updateUser(userId, {
          firstName: splitName.firstName,
          lastName: splitName.lastName
        })
      }

      return NextResponse.json({
        success: true,
        message: 'Profile completed successfully',
        data: {
          fullName: fullName.trim(),
          nickname: sanitizedNickname,
          dateOfBirth,
          avatarUrl: currentUserData.imageUrl || null,
        }
      })

    } catch (dbError) {
      return NextResponse.json(
        {
          error: 'Failed to update profile',
          code: 'DATABASE_ERROR'
        },
        { status: 500 }
      )
    }

  } catch (error) {
    // Return user-friendly error messages
    if (error instanceof Error) {
      return NextResponse.json(
        {
          error: 'Failed to complete profile',
          details: error.message,
          code: 'SERVER_ERROR'
        },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        error: 'An unexpected error occurred',
        code: 'UNKNOWN_ERROR'
      },
      { status: 500 }
    )
  }
}

// Add GET endpoint to check profile status
export async function GET() {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    }

    // For now, we'll just return the status from Clerk metadata
    // In a more complex system, you might also check Supabase
    return NextResponse.json({
      success: true,
      data: {
        userId,
        // This would typically come from sessionClaims, but for a GET request
        // we can't easily access that, so this is a simple response
        message: 'Profile status check - metadata will be updated on next middleware check'
      }
    })

  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to check profile status',
        code: 'SERVER_ERROR'
      },
      { status: 500 }
    )
  }
}
