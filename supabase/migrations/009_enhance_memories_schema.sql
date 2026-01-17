-- Migration: Enhance memories table with detailed conversation analysis
-- This migration updates the memories table to store more detailed summaries

-- Add new columns for detailed conversation analysis
ALTER TABLE memories 
  ADD COLUMN IF NOT EXISTS conversation_summary TEXT,
  ADD COLUMN IF NOT EXISTS person_summary TEXT,
  ADD COLUMN IF NOT EXISTS owner_quotes JSONB DEFAULT '[]'::jsonb;

-- Migrate existing data: copy old summary to conversation_summary
UPDATE memories 
SET conversation_summary = summary 
WHERE summary IS NOT NULL AND conversation_summary IS NULL;

-- Add comments for clarity
COMMENT ON COLUMN memories.conversation_summary IS 'What was discussed in the conversation - factual summary of topics covered';
COMMENT ON COLUMN memories.person_summary IS 'What the LLM learned about the owner from this conversation - personality, communication style, preferences';
COMMENT ON COLUMN memories.owner_quotes IS 'Array of 3 important/representative quotes from the owner (not partner)';

-- Note: We keep the old summary column for backwards compatibility
-- It can be removed in a future migration after all code is updated
