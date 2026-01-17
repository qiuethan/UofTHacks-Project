"""
Demo: Agent Decision System in Action
Run with: python3 demo_agent.py
"""
from app.agent_models import (
    AgentPersonality, AgentState, AgentContext,
    WorldLocation, NearbyAvatar, SocialMemory, LocationType
)
from app.agent_engine import (
    make_decision, generate_candidate_actions, score_all_actions,
    apply_state_decay, DecisionConfig
)

print("=" * 60)
print("🤖 AGENT DECISION SYSTEM DEMO")
print("=" * 60)

# Create a test agent: "Luna"
personality = AgentPersonality(
    avatar_id="luna-123",
    sociability=0.7,
    curiosity=0.5,
    agreeableness=0.6,
    energy_baseline=0.5,
    world_affinities={
        "food": 0.9,
        "karaoke": 0.3,
        "rest_area": 0.5,
        "social_hub": 0.6,
        "wander_point": 0.4
    }
)

state = AgentState(
    avatar_id="luna-123",
    energy=0.55,
    hunger=0.75,
    loneliness=0.4,
    mood=0.2
)

locations = [
    WorldLocation(
        id="cafe-1", name="Cozy Cafe", location_type=LocationType.FOOD,
        x=10, y=10, effects={"hunger": -0.4, "mood": 0.1, "energy": 0.1},
        cooldown_seconds=180, duration_seconds=45
    ),
    WorldLocation(
        id="karaoke-1", name="Karaoke Stage", location_type=LocationType.KARAOKE,
        x=25, y=15, effects={"energy": -0.2, "mood": 0.3, "loneliness": -0.3},
        cooldown_seconds=300, duration_seconds=60
    ),
    WorldLocation(
        id="bench-1", name="Rest Bench", location_type=LocationType.REST_AREA,
        x=5, y=20, effects={"energy": 0.3, "mood": 0.1},
        cooldown_seconds=60, duration_seconds=30
    ),
]

nearby = [
    NearbyAvatar(avatar_id="bob-456", display_name="Bob", x=12, y=8, distance=3.0, 
                 is_online=False, sentiment=0.5, familiarity=0.6),
    NearbyAvatar(avatar_id="alice-789", display_name="Alice", x=8, y=5, distance=6.0, 
                 is_online=True, sentiment=None, familiarity=None),
]

context = AgentContext(
    avatar_id="luna-123",
    x=8, y=8,
    personality=personality,
    state=state,
    social_memories=[
        SocialMemory(from_avatar_id="luna-123", to_avatar_id="bob-456", 
                     sentiment=0.5, familiarity=0.6, interaction_count=5)
    ],
    nearby_avatars=nearby,
    world_locations=locations,
    active_cooldowns=[],
    in_conversation=False
)

print(f"\n📋 AGENT: Luna")
print(f"   Position: ({context.x}, {context.y})")
print(f"   Personality: sociability={personality.sociability}, food_affinity={personality.world_affinities['food']}")

print(f"\n📊 CURRENT NEEDS:")
print(f"   Energy:     {state.energy:.0%}  {'⚠️ Low!' if state.energy < 0.3 else '✓'}")
print(f"   Hunger:     {state.hunger:.0%}  {'🍽️ HIGH!' if state.hunger > 0.7 else '✓'}")
print(f"   Loneliness: {state.loneliness:.0%}")
print(f"   Mood:       {state.mood:+.0%}")

print(f"\n🗺️  NEARBY:")
print(f"   Locations: {', '.join(l.name for l in locations)}")
avatars_str = ', '.join([f"{a.display_name} ({'online' if a.is_online else 'offline'})" for a in nearby])
print(f"   Avatars:   {avatars_str}")

print(f"\n🎯 GENERATING CANDIDATE ACTIONS...")
candidates = generate_candidate_actions(context)
scored = score_all_actions(candidates, context)

print(f"\n📈 ACTION SCORES (top 6):")
sorted_actions = sorted(scored, key=lambda a: a.utility_score, reverse=True)[:6]
for i, action in enumerate(sorted_actions, 1):
    target_str = ""
    if action.target:
        if action.target.target_type == "location":
            loc = next((l for l in locations if l.id == action.target.target_id), None)
            target_str = f" -> {loc.name}" if loc else ""
        elif action.target.target_type == "avatar":
            av = next((a for a in nearby if a.avatar_id == action.target.target_id), None)
            target_str = f" -> {av.display_name}" if av else ""
    print(f"   {i}. {action.action_type.value}{target_str}: {action.utility_score:.2f}")

print(f"\n🎲 MAKING DECISION (softmax selection)...")
decision = make_decision(context)

target_desc = ""
if decision.target:
    if decision.target.target_type == "location":
        loc = next((l for l in locations if l.id == decision.target.target_id), None)
        target_desc = f" -> {loc.name}" if loc else ""
    elif decision.target.target_type == "avatar":
        av = next((a for a in nearby if a.avatar_id == decision.target.target_id), None)
        target_desc = f" -> {av.display_name}" if av else ""

print(f"\n✅ DECISION: {decision.action_type.value}{target_desc}")
print(f"   Score: {decision.utility_score:.2f}")
print(f"   Duration: {decision.duration_seconds}s")

# Generate REAL dynamic justification based on the actual decision
print(f"\n💡 WHY THIS DECISION?")
if decision.action_type.value == "walk_to_location" and decision.target:
    loc = next((l for l in locations if l.id == decision.target.target_id), None)
    if loc:
        loc_type = loc.location_type.value
        affinity = personality.world_affinities.get(loc_type, 0.5)
        print(f"   • Location type: {loc_type} (affinity: {affinity:.0%})")
        print(f"   • Effects: {loc.effects}")
        # Explain which needs it addresses
        for need, effect in loc.effects.items():
            current = getattr(state, need, None)
            if current is not None:
                if effect < 0 and current > 0.5:
                    print(f"   • {need.upper()} is high ({current:.0%}) and this reduces it by {abs(effect):.0%}")
                elif effect > 0 and current < 0.5:
                    print(f"   • {need.upper()} is low ({current:.0%}) and this increases it by {effect:.0%}")
elif decision.action_type.value == "initiate_conversation" and decision.target:
    av = next((a for a in nearby if a.avatar_id == decision.target.target_id), None)
    if av:
        print(f"   • Target: {av.display_name} (distance: {av.distance:.1f})")
        print(f"   • Agent sociability: {personality.sociability:.0%}")
        print(f"   • Current loneliness: {state.loneliness:.0%}")
        if av.familiarity:
            print(f"   • Familiarity with {av.display_name}: {av.familiarity:.0%}")
        if av.sentiment:
            print(f"   • Sentiment toward {av.display_name}: {av.sentiment:+.0%}")
elif decision.action_type.value == "wander":
    print(f"   • Curiosity: {personality.curiosity:.0%}")
    print(f"   • No urgent needs or high-value targets nearby")
elif decision.action_type.value == "idle":
    print(f"   • Energy is moderate ({state.energy:.0%})")
    print(f"   • No compelling actions available")

print("\n" + "=" * 60)
print("🔄 SIMULATING 10 DECISIONS...")
print("=" * 60)

action_counts = {}
for i in range(10):
    d = make_decision(context)
    action_name = d.action_type.value
    if d.target and d.target.target_type == "location":
        loc = next((l for l in locations if l.id == d.target.target_id), None)
        if loc:
            action_name = f"{d.action_type.value}({loc.name})"
    elif d.target and d.target.target_type == "avatar":
        av = next((a for a in nearby if a.avatar_id == d.target.target_id), None)
        if av:
            action_name = f"{d.action_type.value}({av.display_name})"
    action_counts[action_name] = action_counts.get(action_name, 0) + 1

print("\n📊 Action distribution over 10 runs:")
for action, count in sorted(action_counts.items(), key=lambda x: -x[1]):
    bar = "*" * count
    print(f"   {action}: {bar} ({count})")

