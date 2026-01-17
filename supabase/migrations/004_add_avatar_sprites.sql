-- Add avatar/sprite fields to user_positions table
-- Stores user display name and sprite URLs for each direction

-- Add new columns (use DO block for IF NOT EXISTS compatibility)
DO $$ 
BEGIN
  -- display_name column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_positions' AND column_name = 'display_name') THEN
    ALTER TABLE user_positions ADD COLUMN display_name TEXT;
  END IF;
  
  -- sprite columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_positions' AND column_name = 'sprite_front') THEN
    ALTER TABLE user_positions ADD COLUMN sprite_front TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_positions' AND column_name = 'sprite_back') THEN
    ALTER TABLE user_positions ADD COLUMN sprite_back TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_positions' AND column_name = 'sprite_left') THEN
    ALTER TABLE user_positions ADD COLUMN sprite_left TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_positions' AND column_name = 'sprite_right') THEN
    ALTER TABLE user_positions ADD COLUMN sprite_right TEXT;
  END IF;
  
  -- has_avatar flag
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_positions' AND column_name = 'has_avatar') THEN
    ALTER TABLE user_positions ADD COLUMN has_avatar BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- Index for checking if user has avatar
CREATE INDEX IF NOT EXISTS idx_user_positions_has_avatar ON user_positions(has_avatar);
