import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdminClient } from '@/lib/supabase-client.server';
import { AICustomizationSettings, DEFAULT_AI_CUSTOMIZATION_SETTINGS } from '@/types/settings';
import { userSettingsPostRatelimit, userSettingsGetRatelimit } from '@/lib/ratelimit';
import { z } from 'zod';

const aiCustomizationSettingsSchema = z.object({
  aiCustomizationSettings: z.object({
    aiNickname: z.string().optional(),
    userNickname: z.string().optional(),
    userProfession: z.string().optional(),
    preferredTopics: z.string().optional(),
    avoidTopics: z.string().optional(),
    moreAboutYou: z.string().optional(),
    aiTone: z.enum(['default', 'friendly', 'warmer', 'professional', 'gen-z']).optional(),
    responseLength: z.enum(['default', 'concise', 'detail']).optional(),
    customInstructions: z.string().optional(),
    memoryEnabled: z.boolean().optional(),
  }),
});

function mergeAICustomizationSettings(
  existing?: Partial<AICustomizationSettings>,
  incoming?: Partial<AICustomizationSettings>
): AICustomizationSettings {
  return {
    ...DEFAULT_AI_CUSTOMIZATION_SETTINGS,
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
      .select('ai_customization_settings')
      .eq('clerk_user_id', clerkUserId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    if (!existingSettings) {
      const { error: insertError } = await supabase
        .from('user_settings')
        .insert({ clerk_user_id: clerkUserId, ai_customization_settings: DEFAULT_AI_CUSTOMIZATION_SETTINGS })
        .select('ai_customization_settings')
        .single();

      if (insertError) throw insertError;

      return NextResponse.json({ aiCustomizationSettings: DEFAULT_AI_CUSTOMIZATION_SETTINGS });
    }

    const merged = mergeAICustomizationSettings(existingSettings.ai_customization_settings);

    return NextResponse.json({ aiCustomizationSettings: merged });
  } catch (error) {
    console.error('Error fetching AI customization settings:', error);
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

    const parsed = aiCustomizationSettingsSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid settings data', details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) },
        { status: 400 }
      );
    }
    const { aiCustomizationSettings: incoming } = parsed.data;

    const supabase = getSupabaseAdminClient();

    const { data: existingSettings } = await supabase
      .from('user_settings')
      .select('ai_customization_settings')
      .eq('clerk_user_id', clerkUserId)
      .single();

    const merged = mergeAICustomizationSettings(
      existingSettings?.ai_customization_settings,
      incoming as Partial<AICustomizationSettings>
    );

    const { data, error } = await supabase
      .from('user_settings')
      .upsert(
        { clerk_user_id: clerkUserId, ai_customization_settings: merged },
        { onConflict: 'clerk_user_id' }
      )
      .select('ai_customization_settings')
      .single();

    if (error) throw error;

    return NextResponse.json({ aiCustomizationSettings: data.ai_customization_settings });
  } catch (error) {
    console.error('Error updating AI customization settings:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
