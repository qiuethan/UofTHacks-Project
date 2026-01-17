"""
Tests for the Agent Decision System

Run with: python -m pytest tests/test_agent_system.py -v
Or for a specific test: python -m pytest tests/test_agent_system.py::TestAgentEngine::test_make_decision -v
"""

import pytest
import math
import random
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, MagicMock

# Import agent modules
from app.agent_models import (
    AgentPersonality,
    AgentState,
    SocialMemory,
    WorldLocation,
    AgentContext,
    NearbyAvatar,
    CandidateAction,
    SelectedAction,
    ActionType,
    ActionTarget,
    LocationType,
    AgentActionResponse,
)
from app.agent_engine import (
    calculate_need_satisfaction,
    calculate_personality_alignment,
    calculate_social_bias,
    calculate_world_affinity,
    calculate_recency_penalty,
    generate_candidate_actions,
    score_action,
    score_all_actions,
    softmax_select,
    check_for_interrupts,
    make_decision,
    apply_state_decay,
    apply_interaction_effects,
    DecisionConfig,
)


# ============================================================================
# FIXTURES - Reusable test data
# ============================================================================

@pytest.fixture
def sample_personality():
    """Create a sample personality for testing."""
    return AgentPersonality(
        avatar_id="test-avatar-1",
        sociability=0.7,
        curiosity=0.5,
        agreeableness=0.6,
        energy_baseline=0.5,
        world_affinities={
            "food": 0.8,
            "karaoke": 0.3,
            "rest_area": 0.5,
            "social_hub": 0.6,
            "wander_point": 0.4,
        }
    )


@pytest.fixture
def sample_state():
    """Create a sample state for testing."""
    return AgentState(
        avatar_id="test-avatar-1",
        energy=0.6,
        hunger=0.4,
        loneliness=0.5,
        mood=0.3,
        current_action="idle",
    )


@pytest.fixture
def hungry_state():
    """Create a hungry state for testing interrupts."""
    return AgentState(
        avatar_id="test-avatar-1",
        energy=0.6,
        hunger=0.85,  # Critical hunger
        loneliness=0.3,
        mood=0.3,
        current_action="idle",
    )


@pytest.fixture
def tired_state():
    """Create a tired state for testing interrupts."""
    return AgentState(
        avatar_id="test-avatar-1",
        energy=0.1,  # Critical energy
        hunger=0.3,
        loneliness=0.3,
        mood=0.3,
        current_action="idle",
    )


@pytest.fixture
def lonely_state():
    """Create a lonely state for testing social actions."""
    return AgentState(
        avatar_id="test-avatar-1",
        energy=0.6,
        hunger=0.3,
        loneliness=0.8,  # High loneliness
        mood=0.3,
        current_action="idle",
    )


@pytest.fixture
def sample_world_locations():
    """Create sample world locations."""
    return [
        WorldLocation(
            id="loc-food-1",
            name="Cafe",
            location_type=LocationType.FOOD,
            x=10, y=10,
            effects={"hunger": -0.4, "mood": 0.1},
            cooldown_seconds=180,
            duration_seconds=45,
        ),
        WorldLocation(
            id="loc-karaoke-1",
            name="Karaoke Stage",
            location_type=LocationType.KARAOKE,
            x=25, y=15,
            effects={"energy": -0.2, "mood": 0.3, "loneliness": -0.3},
            cooldown_seconds=300,
            duration_seconds=60,
        ),
        WorldLocation(
            id="loc-rest-1",
            name="Rest Bench",
            location_type=LocationType.REST_AREA,
            x=5, y=20,
            effects={"energy": 0.3, "mood": 0.1},
            cooldown_seconds=60,
            duration_seconds=30,
        ),
    ]


@pytest.fixture
def sample_nearby_avatars():
    """Create sample nearby avatars."""
    return [
        NearbyAvatar(
            avatar_id="avatar-2",
            display_name="Alice",
            x=12, y=12,
            distance=3.0,
            is_online=True,
            sentiment=0.5,
            familiarity=0.3,
        ),
        NearbyAvatar(
            avatar_id="avatar-3",
            display_name="Bob",
            x=15, y=10,
            distance=6.0,
            is_online=False,
            sentiment=-0.2,
            familiarity=0.1,
        ),
    ]


@pytest.fixture
def sample_social_memories():
    """Create sample social memories."""
    return [
        SocialMemory(
            id="mem-1",
            from_avatar_id="test-avatar-1",
            to_avatar_id="avatar-2",
            sentiment=0.5,
            familiarity=0.3,
            interaction_count=5,
            last_interaction=datetime.utcnow() - timedelta(hours=1),
        ),
        SocialMemory(
            id="mem-2",
            from_avatar_id="test-avatar-1",
            to_avatar_id="avatar-3",
            sentiment=-0.2,
            familiarity=0.1,
            interaction_count=2,
            last_interaction=datetime.utcnow() - timedelta(days=1),
        ),
    ]


@pytest.fixture
def sample_context(sample_personality, sample_state, sample_world_locations, 
                   sample_nearby_avatars, sample_social_memories):
    """Create a complete agent context for testing."""
    return AgentContext(
        avatar_id="test-avatar-1",
        x=10, y=10,
        personality=sample_personality,
        state=sample_state,
        social_memories=sample_social_memories,
        nearby_avatars=sample_nearby_avatars,
        world_locations=sample_world_locations,
        active_cooldowns=[],
        in_conversation=False,
        pending_conversation_requests=[],
    )


# ============================================================================
# MODEL TESTS
# ============================================================================

class TestAgentModels:
    """Test Pydantic models validation and behavior."""
    
    def test_personality_creation(self):
        """Test personality model creation with defaults."""
        personality = AgentPersonality(avatar_id="test-1")
        assert personality.sociability == 0.5
        assert personality.curiosity == 0.5
        assert personality.agreeableness == 0.5
        assert personality.energy_baseline == 0.5
        assert "food" in personality.world_affinities
    
    def test_personality_validation(self):
        """Test personality validation bounds."""
        # Values should be clamped to 0-1
        with pytest.raises(ValueError):
            AgentPersonality(avatar_id="test-1", sociability=1.5)
        
        with pytest.raises(ValueError):
            AgentPersonality(avatar_id="test-1", curiosity=-0.1)
    
    def test_state_creation(self):
        """Test state model creation."""
        state = AgentState(avatar_id="test-1")
        assert state.energy == 0.8
        assert state.hunger == 0.3
        assert state.loneliness == 0.3
        assert state.mood == 0.5
        assert state.current_action == "idle"
    
    def test_state_needs_methods(self, hungry_state, tired_state, lonely_state):
        """Test state helper methods."""
        assert hungry_state.needs_food() == True
        assert tired_state.needs_rest() == True
        assert lonely_state.needs_socialization() == True
        
        # Normal state shouldn't trigger needs
        normal_state = AgentState(avatar_id="test", energy=0.6, hunger=0.3, loneliness=0.3)
        assert normal_state.needs_food() == False
        assert normal_state.needs_rest() == False
        assert normal_state.needs_socialization() == False
    
    def test_social_memory_creation(self):
        """Test social memory creation."""
        memory = SocialMemory(
            from_avatar_id="a1",
            to_avatar_id="a2",
            sentiment=0.5,
            familiarity=0.3,
        )
        assert memory.sentiment == 0.5
        assert memory.familiarity == 0.3
        assert memory.interaction_count == 0
    
    def test_candidate_action_creation(self):
        """Test candidate action creation."""
        action = CandidateAction(
            action_type=ActionType.IDLE,
            target=None,
        )
        assert action.utility_score == 0.0
        assert action.need_satisfaction == 0.0


# ============================================================================
# ENGINE TESTS - Need Satisfaction
# ============================================================================

class TestNeedSatisfaction:
    """Test need satisfaction calculations."""
    
    def test_food_action_when_hungry(self, hungry_state, sample_world_locations):
        """High hunger should favor food actions."""
        food_location = sample_world_locations[0]  # Cafe
        
        score = calculate_need_satisfaction(
            ActionType.WALK_TO_LOCATION,
            hungry_state,
            ActionTarget(target_type="location", target_id=food_location.id),
            food_location
        )
        
        # Should have high score due to hunger
        assert score > 1.0
    
    def test_rest_action_when_tired(self, tired_state, sample_world_locations):
        """Low energy should favor rest actions."""
        rest_location = sample_world_locations[2]  # Rest Bench
        
        score = calculate_need_satisfaction(
            ActionType.WALK_TO_LOCATION,
            tired_state,
            ActionTarget(target_type="location", target_id=rest_location.id),
            rest_location
        )
        
        # Should have high score due to low energy
        assert score > 1.0
    
    def test_social_action_when_lonely(self, lonely_state):
        """High loneliness should favor social actions."""
        score = calculate_need_satisfaction(
            ActionType.INITIATE_CONVERSATION,
            lonely_state,
            ActionTarget(target_type="avatar", target_id="someone"),
            None
        )
        
        # Should have high score due to loneliness
        assert score > 0.8
    
    def test_idle_has_low_score(self, sample_state):
        """Idle should have relatively low need satisfaction."""
        score = calculate_need_satisfaction(
            ActionType.IDLE,
            sample_state,
            None,
            None
        )
        
        # Idle has minimal need satisfaction
        assert score < 0.5


# ============================================================================
# ENGINE TESTS - Personality Alignment
# ============================================================================

class TestPersonalityAlignment:
    """Test personality alignment calculations."""
    
    def test_sociable_prefers_conversation(self, sample_personality):
        """High sociability should favor conversations."""
        score = calculate_personality_alignment(
            ActionType.INITIATE_CONVERSATION,
            sample_personality,
            None
        )
        
        # 0.7 sociability should give decent score
        assert score > 0.4
    
    def test_curious_prefers_wander(self):
        """High curiosity should favor wandering."""
        curious = AgentPersonality(
            avatar_id="test",
            curiosity=0.9,
            sociability=0.3,
        )
        
        score = calculate_personality_alignment(
            ActionType.WANDER,
            curious,
            None
        )
        
        assert score > 0.4
    
    def test_low_energy_baseline_prefers_rest(self):
        """Low energy baseline should favor rest."""
        low_energy = AgentPersonality(
            avatar_id="test",
            energy_baseline=0.2,
        )
        
        score = calculate_personality_alignment(
            ActionType.IDLE,
            low_energy,
            None
        )
        
        # Low energy baseline means preference for rest
        assert score > 0.2


# ============================================================================
# ENGINE TESTS - Social Bias
# ============================================================================

class TestSocialBias:
    """Test social memory bias calculations."""
    
    def test_positive_sentiment_increases_score(self, sample_nearby_avatars, sample_social_memories):
        """Positive sentiment should increase desire to interact."""
        alice = sample_nearby_avatars[0]  # sentiment=0.5
        alice_memory = sample_social_memories[0]
        
        score = calculate_social_bias(
            ActionType.INITIATE_CONVERSATION,
            alice,
            alice_memory
        )
        
        # Positive sentiment should give positive score
        assert score > 0.2
    
    def test_negative_sentiment_decreases_score(self, sample_nearby_avatars, sample_social_memories):
        """Negative sentiment should decrease desire to interact."""
        bob = sample_nearby_avatars[1]  # sentiment=-0.2
        bob_memory = sample_social_memories[1]
        
        score = calculate_social_bias(
            ActionType.INITIATE_CONVERSATION,
            bob,
            bob_memory
        )
        
        # Negative sentiment should lower score
        assert score < 0.1
    
    def test_unknown_avatar_gets_curiosity_bonus(self):
        """Unknown avatars should get a small curiosity bonus."""
        unknown = NearbyAvatar(
            avatar_id="unknown-1",
            x=5, y=5,
            distance=3.0,
            is_online=False,
        )
        
        score = calculate_social_bias(
            ActionType.INITIATE_CONVERSATION,
            unknown,
            None  # No memory
        )
        
        # Should have small positive score for curiosity
        assert score == 0.1
    
    def test_online_player_bonus(self, sample_nearby_avatars, sample_social_memories):
        """Online players should get a bonus."""
        alice = sample_nearby_avatars[0]  # is_online=True
        alice_memory = sample_social_memories[0]
        
        score_online = calculate_social_bias(
            ActionType.INITIATE_CONVERSATION,
            alice,
            alice_memory
        )
        
        # Make alice offline
        alice.is_online = False
        score_offline = calculate_social_bias(
            ActionType.INITIATE_CONVERSATION,
            alice,
            alice_memory
        )
        
        # Online should have higher score
        assert score_online > score_offline


# ============================================================================
# ENGINE TESTS - Action Generation
# ============================================================================

class TestActionGeneration:
    """Test action generation."""
    
    def test_generates_idle_and_wander(self, sample_context):
        """Should always generate idle and wander actions."""
        actions = generate_candidate_actions(sample_context)
        action_types = [a.action_type for a in actions]
        
        assert ActionType.IDLE in action_types
        assert ActionType.WANDER in action_types
    
    def test_generates_location_actions(self, sample_context):
        """Should generate actions for world locations."""
        actions = generate_candidate_actions(sample_context)
        location_actions = [a for a in actions if a.action_type == ActionType.WALK_TO_LOCATION]
        
        # Should have actions for locations not on cooldown
        assert len(location_actions) >= 2  # At least karaoke and rest (cafe is at same position)
    
    def test_generates_social_actions(self, sample_context):
        """Should generate conversation actions for nearby avatars."""
        actions = generate_candidate_actions(sample_context)
        social_actions = [a for a in actions if a.action_type == ActionType.INITIATE_CONVERSATION]
        
        # Should have actions for nearby avatars within radius
        assert len(social_actions) >= 1
    
    def test_respects_cooldowns(self, sample_context):
        """Should not generate actions for locations on cooldown."""
        sample_context.active_cooldowns = ["loc-food-1"]  # Cafe on cooldown
        
        actions = generate_candidate_actions(sample_context)
        location_targets = [
            a.target.target_id for a in actions 
            if a.target and a.target.target_type == "location"
        ]
        
        assert "loc-food-1" not in location_targets
    
    def test_no_social_when_in_conversation(self, sample_context):
        """Should not generate initiate actions when in conversation."""
        sample_context.in_conversation = True
        
        actions = generate_candidate_actions(sample_context)
        action_types = [a.action_type for a in actions]
        
        assert ActionType.INITIATE_CONVERSATION not in action_types
        assert ActionType.LEAVE_CONVERSATION in action_types


# ============================================================================
# ENGINE TESTS - Action Scoring
# ============================================================================

class TestActionScoring:
    """Test action scoring."""
    
    def test_scoring_populates_components(self, sample_context):
        """Scoring should populate all score components."""
        action = CandidateAction(
            action_type=ActionType.IDLE,
            target=None,
        )
        
        scored = score_action(action, sample_context)
        
        # Should have non-zero components
        assert scored.utility_score != 0
        # Randomness should be small but present
        assert abs(scored.randomness) < 0.1
    
    def test_hungry_prefers_food(self, sample_context, hungry_state, sample_world_locations):
        """Hungry avatar should score food actions higher."""
        sample_context.state = hungry_state
        
        food_action = CandidateAction(
            action_type=ActionType.WALK_TO_LOCATION,
            target=ActionTarget(
                target_type="location",
                target_id="loc-food-1",
                x=10, y=10
            ),
        )
        idle_action = CandidateAction(
            action_type=ActionType.IDLE,
            target=None,
        )
        
        food_scored = score_action(food_action, sample_context)
        idle_scored = score_action(idle_action, sample_context)
        
        assert food_scored.utility_score > idle_scored.utility_score
    
    def test_lonely_prefers_social(self, sample_context, lonely_state):
        """Lonely avatar should score social actions higher."""
        sample_context.state = lonely_state
        
        social_action = CandidateAction(
            action_type=ActionType.INITIATE_CONVERSATION,
            target=ActionTarget(
                target_type="avatar",
                target_id="avatar-2",
            ),
        )
        idle_action = CandidateAction(
            action_type=ActionType.IDLE,
            target=None,
        )
        
        social_scored = score_action(social_action, sample_context)
        idle_scored = score_action(idle_action, sample_context)
        
        assert social_scored.utility_score > idle_scored.utility_score


# ============================================================================
# ENGINE TESTS - Action Selection
# ============================================================================

class TestActionSelection:
    """Test softmax action selection."""
    
    def test_softmax_returns_action(self):
        """Softmax should return one action."""
        actions = [
            CandidateAction(action_type=ActionType.IDLE, utility_score=0.5),
            CandidateAction(action_type=ActionType.WANDER, utility_score=0.3),
        ]
        
        selected = softmax_select(actions)
        
        assert selected in actions
    
    def test_softmax_single_action(self):
        """Softmax with single action should return that action."""
        action = CandidateAction(action_type=ActionType.IDLE, utility_score=0.5)
        
        selected = softmax_select([action])
        
        assert selected == action
    
    def test_softmax_prefers_higher_score(self):
        """Higher scored actions should be selected more often."""
        high = CandidateAction(action_type=ActionType.IDLE, utility_score=2.0)
        low = CandidateAction(action_type=ActionType.WANDER, utility_score=0.1)
        
        # Run many selections
        selections = [softmax_select([high, low], temperature=0.3) for _ in range(100)]
        high_count = sum(1 for s in selections if s == high)
        
        # High score should be selected much more often
        assert high_count > 70
    
    def test_softmax_temperature_effect(self):
        """Lower temperature should be more deterministic."""
        high = CandidateAction(action_type=ActionType.IDLE, utility_score=1.0)
        low = CandidateAction(action_type=ActionType.WANDER, utility_score=0.5)
        
        # Very low temperature
        low_temp_selections = [softmax_select([high, low], temperature=0.1) for _ in range(100)]
        low_temp_high_count = sum(1 for s in low_temp_selections if s == high)
        
        # High temperature
        high_temp_selections = [softmax_select([high, low], temperature=2.0) for _ in range(100)]
        high_temp_high_count = sum(1 for s in high_temp_selections if s == high)
        
        # Low temp should select high more consistently
        assert low_temp_high_count > high_temp_high_count


# ============================================================================
# ENGINE TESTS - Interrupts
# ============================================================================

class TestInterrupts:
    """Test interrupt handling."""
    
    def test_critical_hunger_interrupt(self, sample_context, hungry_state):
        """Critical hunger should trigger food interrupt."""
        sample_context.state = hungry_state
        
        interrupt = check_for_interrupts(sample_context)
        
        assert interrupt is not None
        assert interrupt.action_type == ActionType.WALK_TO_LOCATION
        # Should target food location
        assert interrupt.target.target_id == "loc-food-1"
    
    def test_critical_energy_interrupt(self, sample_context, tired_state):
        """Critical energy should trigger rest interrupt."""
        sample_context.state = tired_state
        
        interrupt = check_for_interrupts(sample_context)
        
        assert interrupt is not None
        assert interrupt.action_type == ActionType.WALK_TO_LOCATION
        # Should target rest location
        assert interrupt.target.target_id == "loc-rest-1"
    
    def test_player_request_auto_accept(self, sample_context):
        """Player conversation requests should be auto-accepted."""
        sample_context.pending_conversation_requests = [
            {"initiator_id": "player-1", "initiator_type": "PLAYER", "request_id": "req-1"}
        ]
        
        interrupt = check_for_interrupts(sample_context)
        
        assert interrupt is not None
        assert interrupt.action_type == ActionType.JOIN_CONVERSATION
    
    def test_no_interrupt_normal_state(self, sample_context):
        """Normal state should not trigger interrupts."""
        interrupt = check_for_interrupts(sample_context)
        
        assert interrupt is None


# ============================================================================
# ENGINE TESTS - State Updates
# ============================================================================

class TestStateUpdates:
    """Test state update functions."""
    
    def test_state_decay(self, sample_state):
        """State should decay over time."""
        decayed = apply_state_decay(sample_state, elapsed_seconds=300)  # 5 minutes
        
        # Energy should decrease
        assert decayed.energy < sample_state.energy
        # Hunger should increase
        assert decayed.hunger > sample_state.hunger
        # Loneliness should increase
        assert decayed.loneliness > sample_state.loneliness
    
    def test_state_decay_respects_bounds(self):
        """Decay should not exceed bounds."""
        extreme_state = AgentState(
            avatar_id="test",
            energy=0.01,  # Nearly empty
            hunger=0.99,  # Nearly full
            loneliness=0.99,
            mood=-0.9,
        )
        
        decayed = apply_state_decay(extreme_state, elapsed_seconds=600)  # 10 minutes
        
        assert decayed.energy >= 0.0
        assert decayed.hunger <= 1.0
        assert decayed.loneliness <= 1.0
    
    def test_interaction_effects(self, sample_state):
        """Interaction effects should modify state."""
        effects = {"hunger": -0.3, "mood": 0.2, "energy": 0.1}
        
        updated = apply_interaction_effects(sample_state, effects)
        
        assert updated.hunger == sample_state.hunger - 0.3
        assert updated.mood == sample_state.mood + 0.2
        assert updated.energy == sample_state.energy + 0.1
    
    def test_interaction_effects_clamped(self, sample_state):
        """Interaction effects should be clamped to bounds."""
        effects = {"hunger": -1.0, "mood": 2.0}  # Would exceed bounds
        
        updated = apply_interaction_effects(sample_state, effects)
        
        assert updated.hunger >= 0.0
        assert updated.mood <= 1.0


# ============================================================================
# ENGINE TESTS - Full Decision
# ============================================================================

class TestMakeDecision:
    """Test the full decision making process."""
    
    def test_make_decision_returns_action(self, sample_context):
        """Make decision should return a valid action."""
        decision = make_decision(sample_context)
        
        assert isinstance(decision, SelectedAction)
        assert decision.action_type in ActionType
    
    def test_make_decision_interrupt_priority(self, sample_context, hungry_state):
        """Interrupts should take priority."""
        sample_context.state = hungry_state
        
        decision = make_decision(sample_context)
        
        # Should go to food due to interrupt
        assert decision.action_type == ActionType.WALK_TO_LOCATION
    
    def test_make_decision_has_duration(self, sample_context):
        """Decision should include duration."""
        decision = make_decision(sample_context)
        
        assert decision.duration_seconds is not None
        assert decision.duration_seconds > 0


# ============================================================================
# API TESTS (with mocking)
# ============================================================================

class TestAPIEndpoints:
    """Test API endpoints with mocked database."""
    
    @pytest.fixture
    def test_client(self):
        """Create test client."""
        try:
            from fastapi.testclient import TestClient
            from app.main import app
            return TestClient(app)
        except Exception as e:
            pytest.skip(f"FastAPI test client not available: {e}")
    
    def test_health_check(self, test_client):
        """Health endpoint should return ok."""
        response = test_client.get("/health")
        assert response.status_code == 200
        assert response.json()["ok"] == True
    
    @patch('app.main.agent_db.get_supabase_client')
    @patch('app.main.process_all_pending_ticks')
    def test_agent_tick_endpoint(self, mock_process, mock_client, test_client):
        """Agent tick endpoint should process ticks."""
        mock_client.return_value = MagicMock()
        mock_process.return_value = AgentTickResponse(
            ok=True,
            processed_count=3,
            decisions=[],
            errors=[]
        )
        
        response = test_client.post("/agent/tick", json={
            "tick_interval_seconds": 300,
            "max_agents_per_tick": 10,
            "debug": False
        })
        
        assert response.status_code == 200
        data = response.json()
        assert data["ok"] == True
        assert data["processed_count"] == 3
    
    @patch('app.main.agent_db.get_supabase_client')
    @patch('app.main.agent_db.get_personality')
    def test_get_personality_endpoint(self, mock_get_personality, mock_client, test_client):
        """Get personality endpoint should return personality data."""
        mock_client.return_value = MagicMock()
        mock_get_personality.return_value = AgentPersonality(
            avatar_id="test-1",
            sociability=0.7,
        )
        
        response = test_client.get("/agent/test-1/personality")
        
        assert response.status_code == 200
        data = response.json()
        assert data["ok"] == True
        assert data["data"]["sociability"] == 0.7
    
    @patch('app.main.agent_db.get_supabase_client')
    @patch('app.main.agent_db.get_state')
    def test_get_state_endpoint(self, mock_get_state, mock_client, test_client):
        """Get state endpoint should return state data."""
        mock_client.return_value = MagicMock()
        mock_get_state.return_value = AgentState(
            avatar_id="test-1",
            energy=0.6,
            hunger=0.4,
        )
        
        response = test_client.get("/agent/test-1/state")
        
        assert response.status_code == 200
        data = response.json()
        assert data["ok"] == True
        assert data["data"]["energy"] == 0.6
    
    @patch('app.main.agent_db.get_supabase_client')
    @patch('app.main.agent_db.get_all_world_locations')
    def test_world_locations_endpoint(self, mock_get_locations, mock_client, test_client):
        """World locations endpoint should return locations."""
        mock_client.return_value = MagicMock()
        mock_get_locations.return_value = [
            WorldLocation(
                id="loc-1",
                name="Cafe",
                location_type=LocationType.FOOD,
                x=10, y=10,
            )
        ]
        
        response = test_client.get("/world/locations")
        
        assert response.status_code == 200
        data = response.json()
        assert data["ok"] == True
        assert len(data["data"]) == 1
        assert data["data"][0]["name"] == "Cafe"


# ============================================================================
# INTEGRATION TEST (requires Supabase - skip if not configured)
# ============================================================================

class TestIntegration:
    """Integration tests that require a real Supabase connection."""
    
    @pytest.fixture
    def supabase_client(self):
        """Get real Supabase client, skip if not configured."""
        from app.agent_database import get_supabase_client
        client = get_supabase_client()
        if not client:
            pytest.skip("Supabase not configured")
        return client
    
    def test_can_connect_to_supabase(self, supabase_client):
        """Should be able to connect to Supabase."""
        # Try a simple query
        result = supabase_client.table("world_locations").select("id").limit(1).execute()
        assert result is not None
    
    def test_world_locations_exist(self, supabase_client):
        """World locations should exist in database."""
        from app.agent_database import get_all_world_locations
        locations = get_all_world_locations(supabase_client)
        
        # Should have at least the default locations
        assert len(locations) >= 1


# ============================================================================
# RUN TESTS
# ============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
