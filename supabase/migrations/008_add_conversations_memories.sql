-- Create Conversations Table
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_a UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_b UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- NULL for System/AI
  transcript JSONB DEFAULT '[]'::jsonb,
  is_onboarding BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create Memories Table
CREATE TABLE memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- NULL for System's memory
  partner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  summary TEXT,
  conversation_score INTEGER CHECK (conversation_score BETWEEN 1 AND 10),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexing for AI "Recollection"
CREATE INDEX idx_memories_owner_partner ON memories (owner_id, partner_id);

-- Enable RLS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;

-- Policies for Conversations
-- Users can read conversations they are part of
CREATE POLICY "Users can read own conversations" ON conversations
  FOR SELECT USING (auth.uid() = participant_a OR auth.uid() = participant_b);

-- Users can insert conversations if they are participant_a
CREATE POLICY "Users can insert own conversations" ON conversations
  FOR INSERT WITH CHECK (auth.uid() = participant_a);

-- Users can update conversations they are part of (e.g. appending messages)
CREATE POLICY "Users can update own conversations" ON conversations
  FOR UPDATE USING (auth.uid() = participant_a OR auth.uid() = participant_b);

-- Policies for Memories
-- Users can read their own memories
CREATE POLICY "Users can read own memories" ON memories
  FOR SELECT USING (auth.uid() = owner_id);

-- Service role has full access
CREATE POLICY "Service role full access conversations" ON conversations
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access memories" ON memories
  FOR ALL USING (auth.role() = 'service_role');
