-- Migration: Add conversation chat system support
-- Extends conversations table for real-time chat during active conversations

-- Add columns to existing conversations table for active chat storage
ALTER TABLE conversations 
  ADD COLUMN IF NOT EXISTS active_transcript JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS conversation_type TEXT DEFAULT 'chat';

-- Add comments for clarity
COMMENT ON COLUMN conversations.active_transcript IS 'Array of chat messages during active conversation: [{senderId, senderName, content, timestamp}]';
COMMENT ON COLUMN conversations.started_at IS 'When the conversation started (both participants in IN_CONVERSATION state)';
COMMENT ON COLUMN conversations.ended_at IS 'When the conversation ended';
COMMENT ON COLUMN conversations.conversation_type IS 'Type of conversation: onboarding, chat';

-- Create index for finding active conversations
CREATE INDEX IF NOT EXISTS idx_conversations_active ON conversations(started_at) 
  WHERE ended_at IS NULL;

-- Create index for finding conversations between two participants
CREATE INDEX IF NOT EXISTS idx_conversations_participants ON conversations(participant_a, participant_b);

-- Function to add a message to an active conversation
CREATE OR REPLACE FUNCTION add_conversation_message(
  p_conversation_id UUID,
  p_sender_id UUID,
  p_sender_name TEXT,
  p_content TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_message JSONB;
  v_updated_transcript JSONB;
BEGIN
  -- Create the message object
  v_message := jsonb_build_object(
    'id', gen_random_uuid()::text,
    'senderId', p_sender_id::text,
    'senderName', p_sender_name,
    'content', p_content,
    'timestamp', extract(epoch from now()) * 1000
  );
  
  -- Append to transcript
  UPDATE conversations
  SET 
    active_transcript = active_transcript || v_message,
    updated_at = NOW()
  WHERE id = p_conversation_id
  RETURNING active_transcript INTO v_updated_transcript;
  
  RETURN v_message;
END;
$$ LANGUAGE plpgsql;

-- Function to get or create a conversation between two users
CREATE OR REPLACE FUNCTION get_or_create_conversation(
  p_participant_a UUID,
  p_participant_b UUID
)
RETURNS UUID AS $$
DECLARE
  v_conversation_id UUID;
BEGIN
  -- Look for existing active conversation (not ended)
  SELECT id INTO v_conversation_id
  FROM conversations
  WHERE 
    ((participant_a = p_participant_a AND participant_b = p_participant_b) OR
     (participant_a = p_participant_b AND participant_b = p_participant_a))
    AND ended_at IS NULL
    AND is_onboarding = FALSE
  ORDER BY created_at DESC
  LIMIT 1;
  
  -- If no active conversation, create one
  IF v_conversation_id IS NULL THEN
    INSERT INTO conversations (participant_a, participant_b, is_onboarding, started_at, conversation_type, active_transcript)
    VALUES (p_participant_a, p_participant_b, FALSE, NOW(), 'chat', '[]'::jsonb)
    RETURNING id INTO v_conversation_id;
  END IF;
  
  RETURN v_conversation_id;
END;
$$ LANGUAGE plpgsql;

-- Function to end a conversation
CREATE OR REPLACE FUNCTION end_conversation_record(p_conversation_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE conversations
  SET 
    ended_at = NOW(),
    updated_at = NOW()
  WHERE id = p_conversation_id;
END;
$$ LANGUAGE plpgsql;
