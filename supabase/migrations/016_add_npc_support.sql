-- Add NPC support to user_positions
-- NPCs are characters that are not tied to auth.users but are controlled by LLMs

-- First, we need to remove the foreign key constraint to allow NPCs
-- We'll add a new column to identify NPCs

-- Add is_npc column to identify NPC characters
ALTER TABLE user_positions ADD COLUMN IF NOT EXISTS is_npc BOOLEAN DEFAULT FALSE;

-- Drop the foreign key constraint on user_id to allow NPCs
-- (We'll validate auth users only when is_npc = false)
ALTER TABLE user_positions DROP CONSTRAINT IF EXISTS user_positions_user_id_fkey;

-- Create a function to validate user_id for non-NPCs
CREATE OR REPLACE FUNCTION validate_user_position_user_id()
RETURNS TRIGGER AS $$
BEGIN
  -- NPCs don't need to reference auth.users
  IF NEW.is_npc = TRUE THEN
    RETURN NEW;
  END IF;
  
  -- Non-NPCs must have a valid auth.users reference
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = NEW.user_id) THEN
    RAISE EXCEPTION 'user_id must reference an existing auth user for non-NPC entries';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply the trigger only for new inserts (existing data assumed valid)
DROP TRIGGER IF EXISTS validate_user_position_trigger ON user_positions;
CREATE TRIGGER validate_user_position_trigger
  BEFORE INSERT ON user_positions
  FOR EACH ROW
  EXECUTE FUNCTION validate_user_position_user_id();

-- Update RLS policies to allow NPCs to be read by anyone
-- (NPCs are public characters visible to all)
DROP POLICY IF EXISTS "NPCs can be read by anyone" ON user_positions;
CREATE POLICY "NPCs can be read by anyone" ON user_positions
  FOR SELECT USING (is_npc = TRUE);

-- Service role policy for NPC creation (already exists but let's ensure)
DROP POLICY IF EXISTS "Service role full access for NPCs" ON user_positions;
CREATE POLICY "Service role full access for NPCs" ON user_positions
  FOR ALL USING (auth.role() = 'service_role');

-- Also update related tables to not require auth.users for NPCs

-- conversations table - allow NPCs
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_participant_a_fkey;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_participant_b_fkey;

-- memories table - allow NPCs  
ALTER TABLE memories DROP CONSTRAINT IF EXISTS memories_owner_id_fkey;
ALTER TABLE memories DROP CONSTRAINT IF EXISTS memories_partner_id_fkey;

-- Add comment explaining the NPC system
COMMENT ON COLUMN user_positions.is_npc IS 'If true, this is an NPC character controlled by LLM, not tied to auth.users';

-- Log the migration
DO $$
BEGIN
  RAISE NOTICE 'NPC support added to user_positions table';
END $$;

