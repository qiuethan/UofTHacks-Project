-- Migration: Fix update_social_memory_detailed function to handle TEXT parameter for mutual_interests
-- This fixes the 'cannot extract elements from a scalar' error when calling from Python

-- Drop and recreate the function with TEXT parameter instead of JSONB
-- Note: p_mutual_interests is now TEXT (JSON string) to handle Python json.dumps() output
DROP FUNCTION IF EXISTS update_social_memory_detailed(UUID, UUID, REAL, REAL, TEXT, JSONB, TEXT, TEXT);

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
