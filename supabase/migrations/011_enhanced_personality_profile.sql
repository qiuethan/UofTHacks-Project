-- Migration: Add detailed personality profile for storing person summary from conversations
-- This stores what the agent has learned about the person over time

-- Add profile column to agent_personality for storing accumulated knowledge about the person
ALTER TABLE agent_personality 
  ADD COLUMN IF NOT EXISTS profile_summary TEXT,
  ADD COLUMN IF NOT EXISTS communication_style TEXT,
  ADD COLUMN IF NOT EXISTS interests JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS conversation_topics JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS personality_notes TEXT;

-- Add comments for clarity
COMMENT ON COLUMN agent_personality.profile_summary IS 'Detailed summary of who this person is - accumulated from conversations';
COMMENT ON COLUMN agent_personality.communication_style IS 'How this person communicates - texting style, formality, emoji usage, etc.';
COMMENT ON COLUMN agent_personality.interests IS 'Array of interests/hobbies learned from conversations';
COMMENT ON COLUMN agent_personality.conversation_topics IS 'Array of topics this person likes to discuss';
COMMENT ON COLUMN agent_personality.personality_notes IS 'Notes about personality traits observed in conversations';

-- Add mutual_interests column to agent_social_memory
ALTER TABLE agent_social_memory
  ADD COLUMN IF NOT EXISTS mutual_interests JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS conversation_history_summary TEXT,
  ADD COLUMN IF NOT EXISTS relationship_notes TEXT;

COMMENT ON COLUMN agent_social_memory.mutual_interests IS 'Shared interests between the two people';
COMMENT ON COLUMN agent_social_memory.conversation_history_summary IS 'Summary of all past conversations with this person';
COMMENT ON COLUMN agent_social_memory.relationship_notes IS 'Notes about the relationship dynamic';

-- Function to update personality profile after conversation
CREATE OR REPLACE FUNCTION update_personality_profile(
  p_avatar_id UUID,
  p_new_profile_summary TEXT DEFAULT NULL,
  p_new_communication_style TEXT DEFAULT NULL,
  p_new_interests JSONB DEFAULT NULL,
  p_new_topics JSONB DEFAULT NULL,
  p_new_personality_notes TEXT DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  UPDATE agent_personality SET
    profile_summary = COALESCE(p_new_profile_summary, profile_summary),
    communication_style = COALESCE(p_new_communication_style, communication_style),
    interests = CASE 
      WHEN p_new_interests IS NOT NULL THEN 
        (SELECT jsonb_agg(DISTINCT value) FROM (
          SELECT jsonb_array_elements(COALESCE(interests, '[]'::jsonb)) AS value
          UNION
          SELECT jsonb_array_elements(p_new_interests) AS value
        ) combined)
      ELSE interests
    END,
    conversation_topics = CASE 
      WHEN p_new_topics IS NOT NULL THEN 
        (SELECT jsonb_agg(DISTINCT value) FROM (
          SELECT jsonb_array_elements(COALESCE(conversation_topics, '[]'::jsonb)) AS value
          UNION
          SELECT jsonb_array_elements(p_new_topics) AS value
        ) combined)
      ELSE conversation_topics
    END,
    personality_notes = COALESCE(p_new_personality_notes, personality_notes),
    updated_at = NOW()
  WHERE avatar_id = p_avatar_id;
END;
$$ LANGUAGE plpgsql;

-- Function to update social memory with detailed info
-- Note: p_mutual_interests is TEXT (JSON string) to handle Python json.dumps() output
CREATE OR REPLACE FUNCTION update_social_memory_detailed(
  p_from_avatar_id UUID,
  p_to_avatar_id UUID,
  p_sentiment_delta REAL DEFAULT 0.0,
  p_familiarity_delta REAL DEFAULT 0.05,
  p_topic TEXT DEFAULT NULL,
  p_mutual_interests TEXT DEFAULT NULL,
  p_relationship_notes TEXT DEFAULT NULL,
  p_conversation_summary TEXT DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_mutual_interests JSONB;
BEGIN
  -- Parse the mutual interests from TEXT to JSONB safely
  IF p_mutual_interests IS NOT NULL AND p_mutual_interests != '' AND p_mutual_interests != 'null' THEN
    BEGIN
      v_mutual_interests := p_mutual_interests::jsonb;
      -- Ensure it's an array
      IF jsonb_typeof(v_mutual_interests) != 'array' THEN
        v_mutual_interests := '[]'::jsonb;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_mutual_interests := '[]'::jsonb;
    END;
  ELSE
    v_mutual_interests := NULL;
  END IF;

  INSERT INTO agent_social_memory (
    from_avatar_id, 
    to_avatar_id, 
    sentiment, 
    familiarity, 
    interaction_count, 
    last_interaction, 
    last_conversation_topic,
    mutual_interests,
    conversation_history_summary,
    relationship_notes
  )
  VALUES (
    p_from_avatar_id, 
    p_to_avatar_id, 
    LEAST(1, GREATEST(-1, p_sentiment_delta)), 
    LEAST(1, GREATEST(0, p_familiarity_delta)), 
    1, 
    NOW(), 
    p_topic,
    COALESCE(v_mutual_interests, '[]'::jsonb),
    p_conversation_summary,
    p_relationship_notes
  )
  ON CONFLICT (from_avatar_id, to_avatar_id) DO UPDATE SET
    sentiment = LEAST(1, GREATEST(-1, agent_social_memory.sentiment + p_sentiment_delta)),
    familiarity = LEAST(1, agent_social_memory.familiarity + p_familiarity_delta),
    interaction_count = agent_social_memory.interaction_count + 1,
    last_interaction = NOW(),
    last_conversation_topic = COALESCE(p_topic, agent_social_memory.last_conversation_topic),
    mutual_interests = CASE 
      WHEN v_mutual_interests IS NOT NULL AND jsonb_array_length(v_mutual_interests) > 0 THEN 
        (SELECT COALESCE(jsonb_agg(DISTINCT value), '[]'::jsonb) FROM (
          SELECT jsonb_array_elements(COALESCE(agent_social_memory.mutual_interests, '[]'::jsonb)) AS value
          UNION
          SELECT jsonb_array_elements(v_mutual_interests) AS value
        ) combined)
      ELSE agent_social_memory.mutual_interests
    END,
    conversation_history_summary = CASE
      WHEN p_conversation_summary IS NOT NULL THEN
        COALESCE(agent_social_memory.conversation_history_summary || E'\n---\n', '') || p_conversation_summary
      ELSE agent_social_memory.conversation_history_summary
    END,
    relationship_notes = COALESCE(p_relationship_notes, agent_social_memory.relationship_notes),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;
