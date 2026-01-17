-- Fix RLS Policies for user_positions table
-- This ensures authenticated users can insert/update their own rows

-- First, let's see what policies exist
-- SELECT * FROM pg_policies WHERE tablename = 'user_positions';

-- Drop ALL existing policies on user_positions
DROP POLICY IF EXISTS "Users can read own position" ON user_positions;
DROP POLICY IF EXISTS "Users can insert own position" ON user_positions;
DROP POLICY IF EXISTS "Users can update own position" ON user_positions;
DROP POLICY IF EXISTS "Service role full access" ON user_positions;
DROP POLICY IF EXISTS "Enable read access for users" ON user_positions;
DROP POLICY IF EXISTS "Enable insert access for users" ON user_positions;
DROP POLICY IF EXISTS "Enable update access for users" ON user_positions;

-- Disable RLS temporarily to ensure clean slate
ALTER TABLE user_positions DISABLE ROW LEVEL SECURITY;

-- Re-enable RLS
ALTER TABLE user_positions ENABLE ROW LEVEL SECURITY;

-- Create simple, working policies
-- SELECT: Users can read their own position
CREATE POLICY "select_own" ON user_positions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- INSERT: Users can insert their own position  
CREATE POLICY "insert_own" ON user_positions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: Users can update their own position
CREATE POLICY "update_own" ON user_positions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE: Users can delete their own position (optional but good to have)
CREATE POLICY "delete_own" ON user_positions
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role bypasses RLS by default, but add explicit policy for clarity
CREATE POLICY "service_role_all" ON user_positions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Verify policies were created
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check 
FROM pg_policies 
WHERE tablename = 'user_positions';
