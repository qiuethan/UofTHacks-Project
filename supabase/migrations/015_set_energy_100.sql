-- Set agents to maximum social mode
-- Energy at 100%, Hunger at 0%, Loneliness at 50% to encourage chatting
-- This is part of the "super chatty" mode where agents never need rest or food

-- Update all agent states for maximum socializing
UPDATE agent_state
SET 
    energy = 1.0,      -- Always full energy (no resting needed)
    hunger = 0.0,      -- Never hungry (no food locations)
    loneliness = 0.5,  -- Some loneliness to encourage seeking conversations
    mood = 0.5,        -- Positive mood (happy agents chat more)
    updated_at = NOW();

-- Log the update
DO $$
DECLARE
    updated_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO updated_count FROM agent_state WHERE energy = 1.0;
    RAISE NOTICE 'Set % agents to maximum social mode (energy=100%%, hunger=0%%, loneliness=50%%)', updated_count;
END $$;

