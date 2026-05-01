-- ============================================================================
-- TOOL USAGE LOG SETUP
-- Lumy Alpha - Tool Usage Tracking & Cost Auditing
-- Version: 007
-- Created: 2026-03-16
-- Updated: 2026-03-16 - Changed estimated_cost_cents to NUMERIC(16,10) for sub-cent precision
-- ============================================================================

-- ============================================================================
-- TOOL USAGE LOG TABLE
-- Tracks all external tool usage and associated costs for auditing and analytics
-- ============================================================================

-- Create tool_usage_log table
CREATE TABLE IF NOT EXISTS public.tool_usage_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clerk_user_id TEXT NOT NULL,
    message_id TEXT,
    tool_name TEXT NOT NULL,
    args JSONB NOT NULL DEFAULT '{}',
    result JSONB,
    estimated_cost_cents NUMERIC(16,10) NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_tool_usage_log_clerk_user_id
    ON public.tool_usage_log(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_tool_usage_log_tool_name
    ON public.tool_usage_log(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_usage_log_message_id
    ON public.tool_usage_log(message_id);
CREATE INDEX IF NOT EXISTS idx_tool_usage_log_created_at
    ON public.tool_usage_log(created_at);
CREATE INDEX IF NOT EXISTS idx_tool_usage_log_cost
    ON public.tool_usage_log(estimated_cost_cents);

-- Enable RLS (default-deny, service role bypasses)
ALTER TABLE public.tool_usage_log ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- SETUP COMPLETE!
-- ============================================================================
