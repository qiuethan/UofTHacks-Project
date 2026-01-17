-- Add conversation state fields to user_positions
ALTER TABLE user_positions 
ADD COLUMN conversation_state TEXT DEFAULT 'IDLE',
ADD COLUMN conversation_target_id UUID,
ADD COLUMN conversation_partner_id UUID,
ADD COLUMN pending_conversation_request_id TEXT;

-- Add check constraint for valid conversation states
ALTER TABLE user_positions
ADD CONSTRAINT valid_conversation_state 
CHECK (conversation_state IN ('IDLE', 'PENDING_REQUEST', 'WALKING_TO_CONVERSATION', 'IN_CONVERSATION'));
