-- Agent Decision System Migration
-- Creates all tables needed for offline AI agent decision making
--
-- ============================================================================
-- TABLE POPULATION & UPDATE REQUIREMENTS
-- ============================================================================
--
-- This section documents WHEN and HOW each table should be populated/updated.
--
-- ┌─────────────────────┬─────────────────────┬─────────────────────────────────┐
-- │ TABLE               │ WHEN TO POPULATE    │ WHO UPDATES IT                  │
-- ├─────────────────────┼─────────────────────┼─────────────────────────────────┤
-- │ world_locations     │ Seed data (once)    │ Admin/migrations only           │
-- │ agent_personality   │ Avatar creation     │ initialize_agent_for_avatar()   │
-- │ agent_state         │ Avatar creation     │ Agent tick + state decay        │
-- │ agent_social_memory │ After conversations │ Conversation end handler        │
-- │ world_interactions  │ Location visits     │ Agent action execution          │
-- │ agent_decisions     │ Each decision       │ Agent decision endpoint         │
-- └─────────────────────┴─────────────────────┴─────────────────────────────────┘
--
-- DETAILED REQUIREMENTS:
--
-- 1. agent_personality & agent_state (INITIALIZATION)
--    - TRIGGER: When a new avatar is created (INSERT into user_positions)
--    - ACTION: Call initialize_agent_for_avatar(user_id)
--    - STATUS: Function exists, needs to be called from:
--      * Option A: Trigger on user_positions INSERT (see bottom of file)
--      * Option B: Python API when creating avatar
--    - NOTE: Personality uses neutral defaults (0.5) until intro survey is completed
--    - TODO: Implement intro survey -> call update_agent_personality_from_survey()
--
-- 2. agent_state (DECAY OVER TIME)
--    - TRIGGER: Each agent tick (when requesting new action)  
--    - ACTION: Apply time-based decay to needs:
--      * energy -= 0.01 per minute (tiredness)
--      * hunger += 0.02 per minute (getting hungry)
--      * loneliness += 0.01 per minute (social need builds)
--      * mood drifts toward 0 (neutral)
--    - STATUS: apply_state_decay() exists in Python agent_engine.py
--    - TODO: Call apply_state_decay() in agent_worker.py before making decision
--
-- 3. agent_state (ACTION EFFECTS)
--    - TRIGGER: When agent completes an action at a location
--    - ACTION: Apply location.effects to agent_state
--    - STATUS: Not implemented
--    - TODO: Add apply_location_effects() function in agent_database.py
--          Called when action_expires_at passes and action was at a location
--
-- 4. agent_social_memory (CONVERSATION UPDATES)
--    - TRIGGER: When conversation ends (conversation_state -> IDLE)
--    - ACTION: 
--      * Increment interaction_count
--      * Update familiarity (increases with interactions)
--      * Update sentiment (based on conversation outcome/sentiment analysis)
--      * Set last_interaction and last_conversation_topic
--    - STATUS: Not implemented
--    - TODO: Add update_social_memory() in agent_database.py
--          Called from realtime-server when conversation ends
--          See function template at bottom of this file
--
-- 5. world_interactions (LOCATION TRACKING)
--    - TRIGGER: When agent arrives at and interacts with a location
--    - ACTION:
--      * INSERT new interaction record
--      * Set cooldown_until = NOW() + location.cooldown_seconds
--    - TRIGGER: When interaction completes
--    - ACTION: Set completed_at = NOW()
--    - STATUS: Not implemented  
--    - TODO: Add start_location_interaction() and complete_location_interaction()
--          in agent_database.py
--
-- 6. agent_decisions (AUDIT LOG)
--    - TRIGGER: Each time make_decision() is called
--    - ACTION: INSERT with state snapshot, all scored actions, selected action
--    - STATUS: Partially implemented (save_decision exists but may not be called)
--    - TODO: Verify save_decision() is called in agent action endpoint
--
-- ============================================================================

-- ============================================================================
-- WORLD LOCATIONS - Fixed locations in the world (food, karaoke, etc.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS world_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  location_type TEXT NOT NULL CHECK (location_type IN ('food', 'karaoke', 'rest_area', 'social_hub', 'wander_point')),
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  description TEXT,
  -- Effects when interacting (JSON: {hunger: -0.3, energy: -0.1, mood: +0.2})
  effects JSONB DEFAULT '{}',
  -- Cooldown in seconds before same avatar can use again
  cooldown_seconds INTEGER DEFAULT 300,
  -- Interaction duration in seconds
  duration_seconds INTEGER DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_world_locations_type ON world_locations(location_type);
CREATE INDEX idx_world_locations_position ON world_locations(x, y);

-- Insert some default world locations
INSERT INTO world_locations (name, location_type, x, y, description, effects, cooldown_seconds, duration_seconds)
VALUES
  ('Cafe', 'food', 10, 10, 'A cozy cafe serving snacks', '{"hunger": -0.4, "mood": 0.1, "energy": 0.1}', 180, 45),
  ('Karaoke Stage', 'karaoke', 25, 15, 'A small stage for karaoke', '{"energy": -0.2, "mood": 0.3, "loneliness": -0.3}', 300, 60),
  ('Rest Bench', 'rest_area', 5, 20, 'A comfortable bench to rest', '{"energy": 0.3, "mood": 0.1}', 60, 30),
  ('Town Square', 'social_hub', 15, 15, 'The central meeting place', '{"loneliness": -0.1}', 30, 15),
  ('Garden Path', 'wander_point', 20, 5, 'A scenic path through the garden', '{"mood": 0.1, "energy": -0.05}', 60, 20)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- AGENT PERSONALITY - Static personality traits per avatar (bias decisions)
-- ============================================================================
CREATE TABLE IF NOT EXISTS agent_personality (
  avatar_id UUID PRIMARY KEY REFERENCES user_positions(user_id) ON DELETE CASCADE,
  -- Personality traits (0.0 to 1.0)
  sociability REAL NOT NULL DEFAULT 0.5 CHECK (sociability >= 0 AND sociability <= 1),
  curiosity REAL NOT NULL DEFAULT 0.5 CHECK (curiosity >= 0 AND curiosity <= 1),
  agreeableness REAL NOT NULL DEFAULT 0.5 CHECK (agreeableness >= 0 AND agreeableness <= 1),
  energy_baseline REAL NOT NULL DEFAULT 0.5 CHECK (energy_baseline >= 0 AND energy_baseline <= 1),
  -- Affinities for world locations (JSON: {food: 0.8, karaoke: 0.3, ...})
  world_affinities JSONB DEFAULT '{"food": 0.5, "karaoke": 0.5, "rest_area": 0.5, "social_hub": 0.5, "wander_point": 0.5}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- AGENT STATE - Dynamic internal state (needs) updated each tick
-- ============================================================================
-- NOTE: This table links to user_positions via avatar_id = user_positions.user_id
-- 
-- RELATIONSHIP TO user_positions.conversation_state:
--   - user_positions.conversation_state: Real-time conversation flow (managed by websocket)
--   - agent_state.current_action: High-level agent decision (managed by agent system)
--   
-- Example flow:
--   1. Agent decides: current_action = 'initiate_conversation', target = {avatar_id: '...'}
--   2. Game server picks this up and sets conversation_state = 'PENDING_REQUEST'
--   3. After conversation ends, agent requests next action
-- ============================================================================
CREATE TABLE IF NOT EXISTS agent_state (
  avatar_id UUID PRIMARY KEY REFERENCES user_positions(user_id) ON DELETE CASCADE,
  -- Dynamic needs (0.0 to 1.0, except mood which is -1.0 to 1.0)
  energy REAL NOT NULL DEFAULT 0.8 CHECK (energy >= 0 AND energy <= 1),
  hunger REAL NOT NULL DEFAULT 0.3 CHECK (hunger >= 0 AND hunger <= 1),
  loneliness REAL NOT NULL DEFAULT 0.3 CHECK (loneliness >= 0 AND loneliness <= 1),
  mood REAL NOT NULL DEFAULT 0.5 CHECK (mood >= -1 AND mood <= 1),
  -- Current action state (high-level decision from agent system)
  -- Values: 'idle', 'wander', 'walk_to_location', 'interact_food', 'interact_karaoke', 
  --         'interact_rest', 'initiate_conversation', 'in_conversation'
  current_action TEXT DEFAULT 'idle',
  current_action_target JSONB DEFAULT NULL,  -- {target_type: 'location'|'avatar', target_id: uuid, x: int, y: int}
  action_started_at TIMESTAMPTZ DEFAULT NULL,
  action_expires_at TIMESTAMPTZ DEFAULT NULL,
  -- Tick tracking
  last_tick TIMESTAMPTZ DEFAULT NOW(),
  tick_lock_until TIMESTAMPTZ DEFAULT NULL,  -- For concurrency control
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_state_last_tick ON agent_state(last_tick);
CREATE INDEX idx_agent_state_current_action ON agent_state(current_action);

-- ============================================================================
-- AGENT SOCIAL MEMORY - Directional relationship memory (from -> to)
-- ============================================================================
CREATE TABLE IF NOT EXISTS agent_social_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_avatar_id UUID NOT NULL REFERENCES user_positions(user_id) ON DELETE CASCADE,
  to_avatar_id UUID NOT NULL REFERENCES user_positions(user_id) ON DELETE CASCADE,
  -- Relationship metrics
  sentiment REAL NOT NULL DEFAULT 0.0 CHECK (sentiment >= -1 AND sentiment <= 1),
  familiarity REAL NOT NULL DEFAULT 0.0 CHECK (familiarity >= 0 AND familiarity <= 1),
  -- Interaction tracking
  interaction_count INTEGER NOT NULL DEFAULT 0,
  last_interaction TIMESTAMPTZ DEFAULT NULL,
  last_conversation_topic TEXT DEFAULT NULL,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- Unique constraint for directional relationship
  UNIQUE(from_avatar_id, to_avatar_id)
);

CREATE INDEX idx_social_memory_from ON agent_social_memory(from_avatar_id);
CREATE INDEX idx_social_memory_to ON agent_social_memory(to_avatar_id);
CREATE INDEX idx_social_memory_sentiment ON agent_social_memory(sentiment);

-- ============================================================================
-- WORLD INTERACTIONS - Track active interactions and cooldowns
-- ============================================================================
CREATE TABLE IF NOT EXISTS world_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  avatar_id UUID NOT NULL REFERENCES user_positions(user_id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES world_locations(id) ON DELETE CASCADE,
  interaction_type TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ DEFAULT NULL,
  cooldown_until TIMESTAMPTZ DEFAULT NULL,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_world_interactions_avatar ON world_interactions(avatar_id);
CREATE INDEX idx_world_interactions_location ON world_interactions(location_id);
CREATE INDEX idx_world_interactions_cooldown ON world_interactions(cooldown_until);

-- ============================================================================
-- AGENT DECISIONS - Debug/audit log for decisions (optional but useful)
-- ============================================================================
CREATE TABLE IF NOT EXISTS agent_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  avatar_id UUID NOT NULL REFERENCES user_positions(user_id) ON DELETE CASCADE,
  tick_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Decision context
  state_snapshot JSONB NOT NULL,  -- {energy, hunger, loneliness, mood, position}
  available_actions JSONB NOT NULL,  -- [{action, score, ...}]
  selected_action JSONB NOT NULL,  -- {action, target, score}
  -- Execution
  action_result TEXT DEFAULT NULL,  -- 'success', 'failed', 'interrupted'
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_decisions_avatar ON agent_decisions(avatar_id);
CREATE INDEX idx_agent_decisions_timestamp ON agent_decisions(tick_timestamp DESC);

-- ============================================================================
-- CONVERSATIONS - Extended for agent system
-- ============================================================================
-- Add agent-related columns to existing conversations if table exists
DO $$
BEGIN
  -- Check if conversations table exists and add columns if needed
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'conversations') THEN
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS initiated_by_agent BOOLEAN DEFAULT FALSE;
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS agent_auto_accepted BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- ============================================================================
-- ADD is_online to user_positions if not exists
-- ============================================================================
ALTER TABLE user_positions ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_user_positions_is_online ON user_positions(is_online);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to initialize agent data for a new avatar
-- TODO: Personality values should come from intro survey (see update_agent_personality_from_survey)
--       For now, uses neutral defaults (0.5)
CREATE OR REPLACE FUNCTION initialize_agent_for_avatar(p_avatar_id UUID)
RETURNS void AS $$
BEGIN
  -- Create personality with NEUTRAL defaults (0.5)
  -- TODO: These should be populated from intro survey later
  INSERT INTO agent_personality (avatar_id, sociability, curiosity, agreeableness, energy_baseline, world_affinities)
  VALUES (
    p_avatar_id,
    0.5,  -- sociability: TODO from survey
    0.5,  -- curiosity: TODO from survey
    0.5,  -- agreeableness: TODO from survey
    0.5,  -- energy_baseline: TODO from survey
    '{"food": 0.5, "karaoke": 0.5, "rest_area": 0.5, "social_hub": 0.5, "wander_point": 0.5}'::jsonb  -- TODO from survey
  )
  ON CONFLICT (avatar_id) DO NOTHING;
  
  -- Create initial state (these CAN be random - they're current state, not personality)
  INSERT INTO agent_state (avatar_id, energy, hunger, loneliness, mood)
  VALUES (
    p_avatar_id,
    0.8,   -- energy: start well-rested
    0.3,   -- hunger: slightly hungry
    0.4,   -- loneliness: somewhat social need
    0.5    -- mood: neutral
  )
  ON CONFLICT (avatar_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- TODO: Function to update personality from intro survey
-- Call this after user completes the intro survey
-- CREATE OR REPLACE FUNCTION update_agent_personality_from_survey(
--   p_avatar_id UUID,
--   p_sociability REAL,
--   p_curiosity REAL,
--   p_agreeableness REAL,
--   p_energy_baseline REAL,
--   p_food_affinity REAL,
--   p_karaoke_affinity REAL,
--   p_rest_affinity REAL,
--   p_social_affinity REAL,
--   p_wander_affinity REAL
-- )
-- RETURNS void AS $$
-- BEGIN
--   UPDATE agent_personality SET
--     sociability = p_sociability,
--     curiosity = p_curiosity,
--     agreeableness = p_agreeableness,
--     energy_baseline = p_energy_baseline,
--     world_affinities = jsonb_build_object(
--       'food', p_food_affinity,
--       'karaoke', p_karaoke_affinity,
--       'rest_area', p_rest_affinity,
--       'social_hub', p_social_affinity,
--       'wander_point', p_wander_affinity
--     ),
--     updated_at = NOW()
--   WHERE avatar_id = p_avatar_id;
-- END;
-- $$ LANGUAGE plpgsql;

-- Function to get offline avatars needing a tick
CREATE OR REPLACE FUNCTION get_offline_avatars_for_tick(
  p_tick_interval_seconds INTEGER DEFAULT 300,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  avatar_id UUID,
  x INTEGER,
  y INTEGER,
  display_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    up.user_id as avatar_id,
    up.x,
    up.y,
    up.display_name
  FROM user_positions up
  LEFT JOIN agent_state ast ON up.user_id = ast.avatar_id
  WHERE 
    up.is_online = FALSE
    AND (ast.tick_lock_until IS NULL OR ast.tick_lock_until < NOW())
    AND (ast.last_tick IS NULL OR ast.last_tick < NOW() - (p_tick_interval_seconds || ' seconds')::interval)
  ORDER BY COALESCE(ast.last_tick, '1970-01-01'::timestamptz) ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to acquire tick lock for an avatar
CREATE OR REPLACE FUNCTION acquire_agent_tick_lock(
  p_avatar_id UUID,
  p_lock_duration_seconds INTEGER DEFAULT 60
)
RETURNS BOOLEAN AS $$
DECLARE
  v_locked BOOLEAN;
BEGIN
  UPDATE agent_state
  SET tick_lock_until = NOW() + (p_lock_duration_seconds || ' seconds')::interval
  WHERE 
    avatar_id = p_avatar_id
    AND (tick_lock_until IS NULL OR tick_lock_until < NOW())
  RETURNING TRUE INTO v_locked;
  
  RETURN COALESCE(v_locked, FALSE);
END;
$$ LANGUAGE plpgsql;

-- Function to release tick lock and update last_tick
CREATE OR REPLACE FUNCTION release_agent_tick_lock(p_avatar_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE agent_state
  SET 
    tick_lock_until = NULL,
    last_tick = NOW(),
    updated_at = NOW()
  WHERE avatar_id = p_avatar_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get nearby avatars
CREATE OR REPLACE FUNCTION get_nearby_avatars(
  p_avatar_id UUID,
  p_radius INTEGER DEFAULT 10
)
RETURNS TABLE (
  avatar_id UUID,
  display_name TEXT,
  x INTEGER,
  y INTEGER,
  distance REAL,
  is_online BOOLEAN
) AS $$
DECLARE
  v_my_x INTEGER;
  v_my_y INTEGER;
BEGIN
  -- Get my position
  SELECT up.x, up.y INTO v_my_x, v_my_y
  FROM user_positions up
  WHERE up.user_id = p_avatar_id;
  
  RETURN QUERY
  SELECT 
    up.user_id as avatar_id,
    up.display_name,
    up.x,
    up.y,
    sqrt(power(up.x - v_my_x, 2) + power(up.y - v_my_y, 2))::REAL as distance,
    up.is_online
  FROM user_positions up
  WHERE 
    up.user_id != p_avatar_id
    AND sqrt(power(up.x - v_my_x, 2) + power(up.y - v_my_y, 2)) <= p_radius
  ORDER BY distance ASC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS on new tables
ALTER TABLE world_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_personality ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_social_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE world_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_decisions ENABLE ROW LEVEL SECURITY;

-- World locations are readable by everyone
CREATE POLICY "World locations are public readable" ON world_locations
  FOR SELECT USING (true);

-- Agent data is readable by owner, writable by service role
CREATE POLICY "Users can read own personality" ON agent_personality
  FOR SELECT USING (auth.uid() = avatar_id);

CREATE POLICY "Service role full access personality" ON agent_personality
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Users can read own state" ON agent_state
  FOR SELECT USING (auth.uid() = avatar_id);

CREATE POLICY "Service role full access state" ON agent_state
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Users can read own social memory" ON agent_social_memory
  FOR SELECT USING (auth.uid() = from_avatar_id);

CREATE POLICY "Service role full access social memory" ON agent_social_memory
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Users can read own interactions" ON world_interactions
  FOR SELECT USING (auth.uid() = avatar_id);

CREATE POLICY "Service role full access interactions" ON world_interactions
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Users can read own decisions" ON agent_decisions
  FOR SELECT USING (auth.uid() = avatar_id);

CREATE POLICY "Service role full access decisions" ON agent_decisions
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- ============================================================================
-- UNIFIED VIEWS - Join tables for easy querying
-- ============================================================================

-- Full agent context view: combines user_positions + agent_state + agent_personality
-- Use this to get everything about an agent in one query
CREATE OR REPLACE VIEW agent_full_context AS
SELECT 
  -- From user_positions (core avatar data)
  up.user_id AS avatar_id,
  up.display_name,
  up.x,
  up.y,
  up.facing_x,
  up.facing_y,
  up.is_online,
  up.has_avatar,
  up.sprite_front,
  up.sprite_back,
  up.sprite_left,
  up.sprite_right,
  -- Conversation state (from user_positions - managed by websocket/game server)
  up.conversation_state,
  up.conversation_partner_id,
  up.conversation_target_id,
  -- From agent_personality (static traits)
  ap.sociability,
  ap.curiosity,
  ap.agreeableness,
  ap.energy_baseline,
  ap.world_affinities,
  -- From agent_state (dynamic needs)
  ast.energy,
  ast.hunger,
  ast.loneliness,
  ast.mood,
  -- Agent action state (from agent_state - managed by agent system)
  ast.current_action AS agent_action,
  ast.current_action_target AS agent_action_target,
  ast.action_started_at,
  ast.action_expires_at,
  ast.last_tick,
  -- Computed: is agent initialized?
  (ap.avatar_id IS NOT NULL AND ast.avatar_id IS NOT NULL) AS is_agent_initialized,
  -- Computed: is agent busy with an action?
  (ast.action_expires_at IS NOT NULL AND ast.action_expires_at > NOW()) AS is_agent_busy,
  -- Computed: is in any kind of conversation activity?
  (up.conversation_state != 'IDLE' OR ast.current_action IN ('initiate_conversation', 'in_conversation')) AS is_in_conversation_activity
FROM user_positions up
LEFT JOIN agent_personality ap ON up.user_id = ap.avatar_id
LEFT JOIN agent_state ast ON up.user_id = ast.avatar_id;

-- View for offline agents ready for action (not busy, not in conversation)
CREATE OR REPLACE VIEW agents_ready_for_action AS
SELECT 
  afc.*
FROM agent_full_context afc
WHERE 
  afc.is_online = FALSE
  AND afc.is_agent_initialized = TRUE
  AND afc.is_agent_busy = FALSE
  AND afc.conversation_state = 'IDLE'
  AND (afc.agent_action IS NULL OR afc.agent_action = 'idle');

-- ============================================================================
-- LINKING FUNCTIONS - Coordinate between tables
-- ============================================================================

-- Function to check if an agent can take a new action
-- Returns: TRUE if agent is free, FALSE if busy
CREATE OR REPLACE FUNCTION can_agent_take_action(p_avatar_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_conversation_state TEXT;
  v_action_expires TIMESTAMPTZ;
BEGIN
  SELECT 
    up.conversation_state,
    ast.action_expires_at
  INTO v_conversation_state, v_action_expires
  FROM user_positions up
  LEFT JOIN agent_state ast ON up.user_id = ast.avatar_id
  WHERE up.user_id = p_avatar_id;
  
  -- Can't take action if in conversation
  IF v_conversation_state IS NOT NULL AND v_conversation_state != 'IDLE' THEN
    RETURN FALSE;
  END IF;
  
  -- Can't take action if current action hasn't expired
  IF v_action_expires IS NOT NULL AND v_action_expires > NOW() THEN
    RETURN FALSE;
  END IF;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to set agent action (validates state first)
CREATE OR REPLACE FUNCTION set_agent_action(
  p_avatar_id UUID,
  p_action TEXT,
  p_target JSONB DEFAULT NULL,
  p_duration_seconds INTEGER DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_can_act BOOLEAN;
BEGIN
  -- Check if agent can take action
  SELECT can_agent_take_action(p_avatar_id) INTO v_can_act;
  
  IF NOT v_can_act THEN
    RETURN FALSE;
  END IF;
  
  -- Update agent state
  UPDATE agent_state
  SET 
    current_action = p_action,
    current_action_target = p_target,
    action_started_at = NOW(),
    action_expires_at = CASE 
      WHEN p_duration_seconds IS NOT NULL THEN NOW() + (p_duration_seconds || ' seconds')::interval
      ELSE NULL
    END,
    updated_at = NOW()
  WHERE avatar_id = p_avatar_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to sync conversation state to agent state
-- Call this when conversation_state changes in user_positions
CREATE OR REPLACE FUNCTION sync_conversation_to_agent(p_avatar_id UUID)
RETURNS void AS $$
DECLARE
  v_conv_state TEXT;
  v_partner_id UUID;
BEGIN
  -- Get current conversation state
  SELECT conversation_state, conversation_partner_id
  INTO v_conv_state, v_partner_id
  FROM user_positions
  WHERE user_id = p_avatar_id;
  
  -- Sync to agent_state
  IF v_conv_state = 'IN_CONVERSATION' THEN
    UPDATE agent_state
    SET 
      current_action = 'in_conversation',
      current_action_target = jsonb_build_object(
        'target_type', 'avatar',
        'target_id', v_partner_id
      ),
      action_started_at = NOW(),
      action_expires_at = NULL,  -- Conversations have no fixed duration
      updated_at = NOW()
    WHERE avatar_id = p_avatar_id;
  ELSIF v_conv_state = 'IDLE' THEN
    -- Clear action when conversation ends
    UPDATE agent_state
    SET 
      current_action = 'idle',
      current_action_target = NULL,
      action_started_at = NULL,
      action_expires_at = NULL,
      updated_at = NOW()
    WHERE avatar_id = p_avatar_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to get full context for an agent (used by Python code)
CREATE OR REPLACE FUNCTION get_agent_context(p_avatar_id UUID)
RETURNS TABLE (
  avatar_id UUID,
  x INTEGER,
  y INTEGER,
  display_name TEXT,
  is_online BOOLEAN,
  conversation_state TEXT,
  -- Personality
  sociability REAL,
  curiosity REAL,
  agreeableness REAL,
  energy_baseline REAL,
  world_affinities JSONB,
  -- State
  energy REAL,
  hunger REAL,
  loneliness REAL,
  mood REAL,
  current_action TEXT,
  current_action_target JSONB,
  action_expires_at TIMESTAMPTZ,
  last_tick TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    up.user_id,
    up.x,
    up.y,
    up.display_name,
    up.is_online,
    up.conversation_state,
    ap.sociability,
    ap.curiosity,
    ap.agreeableness,
    ap.energy_baseline,
    ap.world_affinities,
    ast.energy,
    ast.hunger,
    ast.loneliness,
    ast.mood,
    ast.current_action,
    ast.current_action_target,
    ast.action_expires_at,
    ast.last_tick
  FROM user_positions up
  LEFT JOIN agent_personality ap ON up.user_id = ap.avatar_id
  LEFT JOIN agent_state ast ON up.user_id = ast.avatar_id
  WHERE up.user_id = p_avatar_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- OPTIONAL: Trigger to auto-sync conversation state changes
-- Uncomment if you want automatic sync when conversation_state changes
-- ============================================================================
/*
CREATE OR REPLACE FUNCTION trigger_sync_conversation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.conversation_state IS DISTINCT FROM NEW.conversation_state THEN
    PERFORM sync_conversation_to_agent(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_conversation_state_change
  AFTER UPDATE OF conversation_state ON user_positions
  FOR EACH ROW
  EXECUTE FUNCTION trigger_sync_conversation();
*/

-- ============================================================================
-- OPTIONAL: Trigger to auto-initialize agent on avatar creation
-- Uncomment to automatically create agent_personality and agent_state
-- when a new user_positions row is inserted
-- ============================================================================
/*
CREATE OR REPLACE FUNCTION trigger_initialize_agent()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM initialize_agent_for_avatar(NEW.user_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_avatar_created
  AFTER INSERT ON user_positions
  FOR EACH ROW
  EXECUTE FUNCTION trigger_initialize_agent();
*/

-- ============================================================================
-- TODO: MISSING FUNCTIONS (implement these in Python or SQL)
-- ============================================================================

-- TODO #1: Update social memory after conversation
-- Call this when conversation ends in realtime-server
-- 
-- CREATE OR REPLACE FUNCTION update_social_memory_after_conversation(
--   p_avatar_a UUID,
--   p_avatar_b UUID,
--   p_sentiment_delta REAL DEFAULT 0.0,  -- How much sentiment changed (-1 to 1)
--   p_topic TEXT DEFAULT NULL
-- )
-- RETURNS void AS $$
-- BEGIN
--   -- Update A -> B relationship
--   INSERT INTO agent_social_memory (from_avatar_id, to_avatar_id, sentiment, familiarity, interaction_count, last_interaction, last_conversation_topic)
--   VALUES (p_avatar_a, p_avatar_b, p_sentiment_delta, 0.1, 1, NOW(), p_topic)
--   ON CONFLICT (from_avatar_id, to_avatar_id) DO UPDATE SET
--     sentiment = LEAST(1, GREATEST(-1, agent_social_memory.sentiment + p_sentiment_delta)),
--     familiarity = LEAST(1, agent_social_memory.familiarity + 0.05),  -- Familiarity grows slowly
--     interaction_count = agent_social_memory.interaction_count + 1,
--     last_interaction = NOW(),
--     last_conversation_topic = COALESCE(p_topic, agent_social_memory.last_conversation_topic),
--     updated_at = NOW();
--   
--   -- Update B -> A relationship (mirror)
--   INSERT INTO agent_social_memory (from_avatar_id, to_avatar_id, sentiment, familiarity, interaction_count, last_interaction, last_conversation_topic)
--   VALUES (p_avatar_b, p_avatar_a, p_sentiment_delta, 0.1, 1, NOW(), p_topic)
--   ON CONFLICT (from_avatar_id, to_avatar_id) DO UPDATE SET
--     sentiment = LEAST(1, GREATEST(-1, agent_social_memory.sentiment + p_sentiment_delta)),
--     familiarity = LEAST(1, agent_social_memory.familiarity + 0.05),
--     interaction_count = agent_social_memory.interaction_count + 1,
--     last_interaction = NOW(),
--     last_conversation_topic = COALESCE(p_topic, agent_social_memory.last_conversation_topic),
--     updated_at = NOW();
-- END;
-- $$ LANGUAGE plpgsql;

-- TODO #2: Start a location interaction (creates cooldown)
--
-- CREATE OR REPLACE FUNCTION start_location_interaction(
--   p_avatar_id UUID,
--   p_location_id UUID
-- )
-- RETURNS UUID AS $$  -- Returns interaction ID
-- DECLARE
--   v_location RECORD;
--   v_interaction_id UUID;
-- BEGIN
--   -- Get location details
--   SELECT * INTO v_location FROM world_locations WHERE id = p_location_id;
--   
--   -- Check if on cooldown
--   IF EXISTS (
--     SELECT 1 FROM world_interactions 
--     WHERE avatar_id = p_avatar_id 
--       AND location_id = p_location_id 
--       AND cooldown_until > NOW()
--   ) THEN
--     RETURN NULL;  -- Still on cooldown
--   END IF;
--   
--   -- Create interaction record
--   INSERT INTO world_interactions (avatar_id, location_id, interaction_type, cooldown_until)
--   VALUES (
--     p_avatar_id, 
--     p_location_id, 
--     v_location.location_type,
--     NOW() + (v_location.cooldown_seconds || ' seconds')::interval
--   )
--   RETURNING id INTO v_interaction_id;
--   
--   RETURN v_interaction_id;
-- END;
-- $$ LANGUAGE plpgsql;

-- TODO #3: Complete location interaction (applies effects)
--
-- CREATE OR REPLACE FUNCTION complete_location_interaction(
--   p_interaction_id UUID
-- )
-- RETURNS void AS $$
-- DECLARE
--   v_interaction RECORD;
--   v_location RECORD;
--   v_effects JSONB;
-- BEGIN
--   -- Get interaction
--   SELECT * INTO v_interaction FROM world_interactions WHERE id = p_interaction_id;
--   
--   -- Get location effects
--   SELECT effects INTO v_effects FROM world_locations WHERE id = v_interaction.location_id;
--   
--   -- Apply effects to agent state
--   UPDATE agent_state SET
--     energy = LEAST(1, GREATEST(0, energy + COALESCE((v_effects->>'energy')::REAL, 0))),
--     hunger = LEAST(1, GREATEST(0, hunger + COALESCE((v_effects->>'hunger')::REAL, 0))),
--     loneliness = LEAST(1, GREATEST(0, loneliness + COALESCE((v_effects->>'loneliness')::REAL, 0))),
--     mood = LEAST(1, GREATEST(-1, mood + COALESCE((v_effects->>'mood')::REAL, 0))),
--     updated_at = NOW()
--   WHERE avatar_id = v_interaction.avatar_id;
--   
--   -- Mark interaction complete
--   UPDATE world_interactions SET completed_at = NOW() WHERE id = p_interaction_id;
-- END;
-- $$ LANGUAGE plpgsql;

-- TODO #4: Apply time-based state decay
-- Call this before each decision to simulate passage of time
--
-- CREATE OR REPLACE FUNCTION apply_state_decay(
--   p_avatar_id UUID,
--   p_minutes_elapsed REAL DEFAULT 5.0
-- )
-- RETURNS void AS $$
-- DECLARE
--   v_energy_baseline REAL;
-- BEGIN
--   -- Get personality baseline
--   SELECT energy_baseline INTO v_energy_baseline 
--   FROM agent_personality WHERE avatar_id = p_avatar_id;
--   
--   UPDATE agent_state SET
--     energy = GREATEST(0, energy - (0.01 * p_minutes_elapsed)),  -- Tiredness
--     hunger = LEAST(1, hunger + (0.02 * p_minutes_elapsed)),     -- Getting hungry
--     loneliness = LEAST(1, loneliness + (0.01 * p_minutes_elapsed)), -- Social need
--     mood = mood + (0 - mood) * 0.02 * p_minutes_elapsed,        -- Drift to neutral
--     updated_at = NOW()
--   WHERE avatar_id = p_avatar_id;
-- END;
-- $$ LANGUAGE plpgsql;
