import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdminClient } from '@/lib/supabase-client.server';
import { PrivacySettings, DEFAULT_PRIVACY_SETTINGS } from '@/types/settings';
import { userSettingsPostRatelimit, userSettingsGetRatelimit } from '@/lib/ratelimit';
import { z } from 'zod';

const privacySettingsSchema = z.object({
  privacySettings: z.object({
    shareAnonymousData: z.boolean(),
    shareDiagnostics: z.boolean(),
  }).partial(),
});

function mergePrivacySettings(
  existing?: Partial<PrivacySettings>,
  incoming?: Partial<PrivacySettings>
): PrivacySettings {
  return {
    ...DEFAULT_PRIVACY_SETTINGS,
    ...existing,
    ...incoming,
  };
}

export async function GET() {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { success } = await userSettingsGetRatelimit.limit(clerkUserId);
    if (!success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Too many requests.' },
        { status: 429 }
      );
    }

    const supabase = getSupabaseAdminClient();

    const { data: existingSettings, error: fetchError } = await supabase
      .from('user_settings')
      .select('privacy_settings')
      .eq('clerk_user_id', clerkUserId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    if (!existingSettings) {
      const { error: insertError } = await supabase
        .from('user_settings')
        .insert({ clerk_user_id: clerkUserId, privacy_settings: DEFAULT_PRIVACY_SETTINGS })
        .select('privacy_settings')
        .single();

      if (insertError) throw insertError;

      return NextResponse.json({ privacySettings: DEFAULT_PRIVACY_SETTINGS });
    }

    const merged = mergePrivacySettings(existingSettings.privacy_settings);

    return NextResponse.json({ privacySettings: merged });
  } catch (error) {
    console.error('Error fetching privacy settings:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { success } = await userSettingsPostRatelimit.limit(clerkUserId);
    if (!success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Too many requests.' },
        { status: 429 }
      );
    }

    const parsed = privacySettingsSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid settings data', details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) },
        { status: 400 }
      );
    }
    const { privacySettings: incoming } = parsed.data;

    const supabase = getSupabaseAdminClient();

    const { data: existingSettings } = await supabase
      .from('user_settings')
      .select('privacy_settings')
      .eq('clerk_user_id', clerkUserId)
      .single();

    const merged = mergePrivacySettings(
      existingSettings?.privacy_settings,
      incoming as Partial<PrivacySettings>
    );

    const { data, error } = await supabase
      .from('user_settings')
      .upsert(
        { clerk_user_id: clerkUserId, privacy_settings: merged },
        { onConflict: 'clerk_user_id' }
      )
      .select('privacy_settings')
      .single();

    if (error) throw error;

    return NextResponse.json({ privacySettings: data.privacy_settings });
  } catch (error) {
    console.error('Error updating privacy settings:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
