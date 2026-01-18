-- Migration: Create function to update social memory for BOTH directions atomically
-- This ensures both parties have the same interaction_count after a conversation

CREATE OR REPLACE FUNCTION update_social_memory_bidirectional(
  p_avatar_a UUID,
  p_avatar_b UUID,
  p_sentiment_a_to_b REAL DEFAULT 0.0,  -- How A feels about B (delta)
  p_sentiment_b_to_a REAL DEFAULT 0.0,  -- How B feels about A (delta)
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
      IF jsonb_typeof(v_mutual_interests) != 'array' THEN
        v_mutual_interests := '[]'::jsonb;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_mutual_interests := '[]'::jsonb;
    END;
  ELSE
    v_mutual_interests := NULL;
  END IF;

  -- =========================================
  -- Update A -> B direction
  -- =========================================
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
    p_avatar_a, 
    p_avatar_b, 
    LEAST(1, GREATEST(-1, 0.5 + p_sentiment_a_to_b)),  -- Start at 0.5 neutral
    LEAST(1, GREATEST(0, p_familiarity_delta)), 
    1, 
    NOW(), 
    p_topic,
    COALESCE(v_mutual_interests, '[]'::jsonb),
    p_conversation_summary,
    p_relationship_notes
  )
  ON CONFLICT (from_avatar_id, to_avatar_id) DO UPDATE SET
    sentiment = LEAST(1, GREATEST(-1, agent_social_memory.sentiment + p_sentiment_a_to_b)),
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

  -- =========================================
  -- Update B -> A direction
  -- =========================================
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
    p_avatar_b, 
    p_avatar_a, 
    LEAST(1, GREATEST(-1, 0.5 + p_sentiment_b_to_a)),  -- Start at 0.5 neutral
    LEAST(1, GREATEST(0, p_familiarity_delta)), 
    1, 
    NOW(), 
    p_topic,
    COALESCE(v_mutual_interests, '[]'::jsonb),
    p_conversation_summary,
    p_relationship_notes
  )
  ON CONFLICT (from_avatar_id, to_avatar_id) DO UPDATE SET
    sentiment = LEAST(1, GREATEST(-1, agent_social_memory.sentiment + p_sentiment_b_to_a)),
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

-- Also create a function to sync interaction counts if they ever get out of sync
CREATE OR REPLACE FUNCTION sync_interaction_counts(
  p_avatar_a UUID,
  p_avatar_b UUID
)
RETURNS void AS $$
DECLARE
  v_count_a_to_b INT;
  v_count_b_to_a INT;
  v_max_count INT;
BEGIN
  -- Get current counts
  SELECT interaction_count INTO v_count_a_to_b
  FROM agent_social_memory
  WHERE from_avatar_id = p_avatar_a AND to_avatar_id = p_avatar_b;
  
  SELECT interaction_count INTO v_count_b_to_a
  FROM agent_social_memory
  WHERE from_avatar_id = p_avatar_b AND to_avatar_id = p_avatar_a;
  
  -- Use the max of both (or 0 if null)
  v_max_count := GREATEST(COALESCE(v_count_a_to_b, 0), COALESCE(v_count_b_to_a, 0));
  
  -- Update both to the max
  UPDATE agent_social_memory
  SET interaction_count = v_max_count
  WHERE (from_avatar_id = p_avatar_a AND to_avatar_id = p_avatar_b)
     OR (from_avatar_id = p_avatar_b AND to_avatar_id = p_avatar_a);
END;
$$ LANGUAGE plpgsql;

