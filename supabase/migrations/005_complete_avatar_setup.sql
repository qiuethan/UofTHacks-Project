-- Complete Avatar Setup Migration
-- Run this in Supabase SQL Editor to set up all required columns and policies

-- 1. Add avatar columns if they don't exist
ALTER TABLE user_positions ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE user_positions ADD COLUMN IF NOT EXISTS sprite_front TEXT;
ALTER TABLE user_positions ADD COLUMN IF NOT EXISTS sprite_back TEXT;
ALTER TABLE user_positions ADD COLUMN IF NOT EXISTS sprite_left TEXT;
ALTER TABLE user_positions ADD COLUMN IF NOT EXISTS sprite_right TEXT;
ALTER TABLE user_positions ADD COLUMN IF NOT EXISTS has_avatar BOOLEAN DEFAULT FALSE;

-- 2. Add facing columns if they don't exist (from migration 002)
ALTER TABLE user_positions ADD COLUMN IF NOT EXISTS facing_x INTEGER DEFAULT 0;
ALTER TABLE user_positions ADD COLUMN IF NOT EXISTS facing_y INTEGER DEFAULT 1;

-- 3. Add updated_at column if it doesn't exist
ALTER TABLE user_positions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 4. Drop and recreate RLS policies to ensure they work correctly
-- First, drop existing policies (ignore errors if they don't exist)
DROP POLICY IF EXISTS "Users can read own position" ON user_positions;
DROP POLICY IF EXISTS "Users can insert own position" ON user_positions;
DROP POLICY IF EXISTS "Users can update own position" ON user_positions;
DROP POLICY IF EXISTS "Service role full access" ON user_positions;

-- 5. Enable RLS
ALTER TABLE user_positions ENABLE ROW LEVEL SECURITY;

-- 6. Create new policies
-- Allow users to read their own data
CREATE POLICY "Users can read own position" ON user_positions
  FOR SELECT USING (auth.uid() = user_id);

-- Allow users to insert their own data
CREATE POLICY "Users can insert own position" ON user_positions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Allow users to update their own data
CREATE POLICY "Users can update own position" ON user_positions
  FOR UPDATE USING (auth.uid() = user_id);

-- Allow service role (server-side) full access
CREATE POLICY "Service role full access" ON user_positions
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- 7. Create index for avatar lookup
CREATE INDEX IF NOT EXISTS idx_user_positions_has_avatar ON user_positions(has_avatar);

-- 8. Verify the table structure
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'user_positions'
ORDER BY ordinal_position;
