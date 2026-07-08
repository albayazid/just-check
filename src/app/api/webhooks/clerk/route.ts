import { verifyWebhook } from '@clerk/nextjs/webhooks'
import { NextRequest } from 'next/server'
import { clerkClient } from '@/lib/clerk/clerk-client'
import { getSupabaseAdminClient } from '@/lib/supabase-client.server'

// TODO: This file was a important piece missing in this codebase for a longtime, though it didn't catch our eye, cause it never cause build error, and we are not in production yet.
// Now we have copy pasted it here from our old codebase for critical fix. But this needs a super clear review later.

// Webhook endpoint to handle Clerk user events (user.created, user.updated, user.deleted)
// This ensures Clerk metadata stays synchronized with your application state
//
// IMPORTANT: This webhook sets publicMetadata that will appear in session tokens
// Configure the _session template in Clerk Dashboard to include: 
// { "publicMetadata": { "profileComplete": "{{user.public_metadata.profileComplete}}" } }
export async function POST(req: NextRequest) {
  
  try {
    // âœ… CORRECT: Use Clerk's built-in verifyWebhook helper for security
    // This validates the webhook signature to prevent malicious requests
    const evt = await verifyWebhook(req)


    const eventType = evt.type

    // âœ… PROPER TYPE CHECKING: Handle different event types appropriately
    if (eventType === 'user.created' || eventType === 'user.updated') {
      const userData = evt.data as any // Clerk User type
      const { 
        id: clerkUserId, 
        email_addresses, 
        first_name, 
        last_name, 
        image_url 
      } = userData

      if (!clerkUserId || !email_addresses?.[0]?.email_address) {
        console.error('Missing required user data:', { clerkUserId, email_addresses })
        return new Response('Missing required user data', { status: 400 })
      }


      const supabase = getSupabaseAdminClient()

      // Handle new user registration
      // Creates database record and sets initial completion status
      if (eventType === 'user.created') {
        const email = email_addresses[0].email_address

        // Create user profile in your database
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            clerk_user_id: clerkUserId,
            email: email,
            full_name: `${first_name || ''} ${last_name || ''}`.trim() || null,
            nickname: null,                    // Required: set to null initially
            date_of_birth: null,               // Required: set to null initially
            avatar_url: image_url || null,     // Optional: from OAuth provider
          })

        if (profileError) {
          console.error('ðŸš¨ ERROR: Profile creation failed:', profileError)
          console.error('ðŸš¨ ERROR DETAILS:', {
            code: profileError.code,
            message: profileError.message,
            details: profileError.details,
            hint: profileError.hint
          })
          return new Response('Error creating profile', { status: 500 })
        }


        // ðŸ”‘ IMPORTANT: Set Clerk publicMetadata for session claims
        // This data will appear in JWT tokens and be available in middleware
        // Configure _session template in Clerk Dashboard to include:
        // { "publicMetadata": { "profileComplete": "{{user.public_metadata.profileComplete}}" } }
        // Use centralized clerk client
        await clerkClient.users.updateUserMetadata(clerkUserId, {
          publicMetadata: {
            profileComplete: false  // Will be set to true when onboarding is complete
          }
        })

      }

      // Handle user updates (profile completion changes or profile edits)
      // This runs when user completes onboarding or updates their profile
      if (eventType === 'user.updated') {
        
        // Use centralized clerk client

        // First: Sync avatar_url from Clerk to Supabase
        // This captures profile picture changes made through Clerk's built-in upload UI
        if (image_url !== undefined) {
          
          // Check if profile exists
          const { data: existingProfile } = await supabase
            .from('profiles')
            .select('id')
            .eq('clerk_user_id', clerkUserId)
            .single()
          
          if (existingProfile) {
            const { error: avatarUpdateError } = await supabase
              .from('profiles')
              .update({ avatar_url: image_url })
              .eq('clerk_user_id', clerkUserId)

            if (avatarUpdateError) {
              console.error('ðŸš¨ ERROR: Failed to sync avatar_url:', avatarUpdateError)
            }
          }
        }

        // Then: Update Clerk metadata for profile completion status
        // This ensures session tokens have accurate completion status
        const { data: profile, error: fetchError } = await supabase
          .from('profiles')
          .select('full_name, nickname, date_of_birth')
          .eq('clerk_user_id', clerkUserId)
          .single()

        if (fetchError && fetchError.code !== 'PGRST116') {
          console.error('ðŸš¨ ERROR: Error fetching profile:', fetchError)
          return new Response('Error fetching profile', { status: 500 })
        }

        // Calculate if profile is complete based on required fields
        // Profile is complete when ALL required fields are filled
        const isComplete = !!(
          profile?.full_name &&     // Required: User's full name
          profile?.nickname &&      // Required: Short display name
          profile?.date_of_birth    // Required: For age verification
        )

        // Update Clerk publicMetadata to match database state
        await clerkClient.users.updateUserMetadata(clerkUserId, {
          publicMetadata: {
            profileComplete: isComplete
          }
        })

      }
    }

    // Handle user account deletion
    if (eventType === 'user.deleted') {
      const userData = evt.data as any
      const { id: clerkUserId } = userData

      if (!clerkUserId) {
        console.error('Missing user ID for deletion')
        return new Response('Missing user ID', { status: 400 })
      }

      const supabase = getSupabaseAdminClient()
      
      // Soft delete the profile (don't permanently remove data)
      const { error: deleteError } = await supabase
        .from('profiles')
        .update({ 
          deleted_at: new Date().toISOString()  // Soft delete: mark as deleted but keep record
        })
        .eq('clerk_user_id', clerkUserId)

      if (deleteError) {
        console.error('Error soft deleting profile:', deleteError)
        return new Response('Error deleting profile', { status: 500 })
      }

    }

    return new Response('Webhook processed successfully', { status: 200 })
  } catch (error) {
    console.error('ðŸš¨ ERROR: Webhook verification failed:', error)
    return new Response('Invalid webhook', { status: 400 })
  }
}
