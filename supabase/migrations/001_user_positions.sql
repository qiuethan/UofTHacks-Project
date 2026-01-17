-- Create user_positions table to persist avatar locations
CREATE TABLE IF NOT EXISTS user_positions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  x INTEGER NOT NULL DEFAULT 0,
  y INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE user_positions ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own position
CREATE POLICY "Users can read own position" ON user_positions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own position" ON user_positions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own position" ON user_positions
  FOR UPDATE USING (auth.uid() = user_id);

-- Service role can do anything (for server-side operations)
CREATE POLICY "Service role full access" ON user_positions
  FOR ALL USING (auth.role() = 'service_role');
