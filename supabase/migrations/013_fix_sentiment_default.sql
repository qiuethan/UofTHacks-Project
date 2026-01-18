-- ============================================================================
-- FIX SENTIMENT DEFAULT TO 0.5 (neutral)
-- 0.5 = neutral, <0.5 = dislike, >0.5 = like
-- ============================================================================

-- Update the default for new social memories
ALTER TABLE agent_social_memory 
ALTER COLUMN sentiment SET DEFAULT 0.5;

-- Update existing records that have 0 sentiment to neutral 0.5
UPDATE agent_social_memory 
SET sentiment = 0.5 
WHERE sentiment = 0.0;

-- Verify
SELECT 'Updated sentiment defaults to 0.5' as status;

