-- Delete all NPCs named "Kim Kardashian"
-- This will cascade delete from related tables due to foreign key constraints

-- First, log how many we're about to delete
DO $$
DECLARE
    count_to_delete INTEGER;
BEGIN
    SELECT COUNT(*) INTO count_to_delete 
    FROM user_positions 
    WHERE display_name = 'Kim Kardashian';
    
    RAISE NOTICE 'Found % NPCs named "Kim Kardashian" to delete', count_to_delete;
END $$;

-- Delete from agent_social_memory (both directions)
DELETE FROM agent_social_memory 
WHERE from_avatar_id IN (
    SELECT user_id FROM user_positions WHERE display_name = 'Kim Kardashian'
)
OR to_avatar_id IN (
    SELECT user_id FROM user_positions WHERE display_name = 'Kim Kardashian'
);

-- Delete from agent_state
DELETE FROM agent_state 
WHERE avatar_id IN (
    SELECT user_id FROM user_positions WHERE display_name = 'Kim Kardashian'
);

-- Delete from agent_personality
DELETE FROM agent_personality 
WHERE avatar_id IN (
    SELECT user_id FROM user_positions WHERE display_name = 'Kim Kardashian'
);

-- Delete from conversations (both participant_a and participant_b)
DELETE FROM conversations 
WHERE participant_a IN (
    SELECT user_id FROM user_positions WHERE display_name = 'Kim Kardashian'
)
OR participant_b IN (
    SELECT user_id FROM user_positions WHERE display_name = 'Kim Kardashian'
);

-- Delete from memories
DELETE FROM memories 
WHERE owner_id IN (
    SELECT user_id FROM user_positions WHERE display_name = 'Kim Kardashian'
)
OR partner_id IN (
    SELECT user_id FROM user_positions WHERE display_name = 'Kim Kardashian'
);

-- Delete from world_interactions if it exists
DELETE FROM world_interactions 
WHERE avatar_id IN (
    SELECT user_id FROM user_positions WHERE display_name = 'Kim Kardashian'
);

-- Delete from agent_decisions if it exists
DELETE FROM agent_decisions 
WHERE avatar_id IN (
    SELECT user_id FROM user_positions WHERE display_name = 'Kim Kardashian'
);

-- Finally, delete from user_positions
DELETE FROM user_positions 
WHERE display_name = 'Kim Kardashian';

-- Log completion
DO $$
BEGIN
    RAISE NOTICE 'Deleted all NPCs named "Kim Kardashian"';
END $$;

