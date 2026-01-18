"""
Conversation Chat System - Handles real-time chat with AI agents

This module provides:
- Agent response generation using Grok LLM
- Conversation analysis and state updates
- Memory creation from conversations
"""

import os
import json
from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel

from .supabase_client import supabase
from . import agent_database as agent_db

# Try to import OpenAI, but don't fail if not available
try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False
    OpenAI = None
    print("Warning: openai module not installed. LLM features will be disabled.")

# OpenRouter client for Grok
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
client = None
if OPENROUTER_API_KEY and OPENAI_AVAILABLE:
    try:
        client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=OPENROUTER_API_KEY,
        )
    except Exception as e:
        print(f"Failed to init OpenRouter client for conversations: {e}")

# Use Grok-4-fast for good quality with better speed
MODEL_NAME = "x-ai/grok-4-fast"


# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class AgentRespondRequest(BaseModel):
    conversation_id: str
    agent_id: str
    partner_id: str
    partner_name: str
    message: str
    conversation_history: List[Dict[str, Any]] = []


class AgentRespondResponse(BaseModel):
    ok: bool
    response: Optional[str] = None
    error: Optional[str] = None


class ConversationEndRequest(BaseModel):
    conversation_id: str
    participant_a: str
    participant_b: str
    participant_a_name: str
    participant_b_name: str
    transcript: List[Dict[str, Any]]
    participant_a_is_online: bool = False
    participant_b_is_online: bool = False


class ConversationEndResponse(BaseModel):
    ok: bool
    summary: Optional[str] = None
    sentiment_change_a: Optional[float] = None
    sentiment_change_b: Optional[float] = None
    error: Optional[str] = None


class MessageSentimentRequest(BaseModel):
    """Request for real-time message sentiment analysis."""
    message: str
    sender_id: str
    sender_name: str
    receiver_id: str
    receiver_name: str


class MessageSentimentResponse(BaseModel):
    """Response with real-time state changes."""
    ok: bool
    sender_mood_change: float = 0.0
    receiver_mood_change: float = 0.0
    sentiment: float = 0.0
    is_rude: bool = False
    is_positive: bool = False


# ============================================================================
# REAL-TIME PER-MESSAGE SENTIMENT ANALYSIS
# ============================================================================

def analyze_message_sentiment(message: str, sender_name: str, receiver_name: str) -> Dict[str, Any]:
    """
    Quickly analyze a single message for sentiment and emotional impact.
    
    This is called in real-time as messages are sent to update mood immediately.
    - Rude messages decrease the receiver's mood
    - Positive messages increase both moods
    - Neutral messages have minimal effect
    """
    if not client:
        # Simple keyword-based fallback
        message_lower = message.lower()
        
        # Check for rude words
        rude_words = ["hate", "stupid", "idiot", "dumb", "ugly", "loser", "shut up", 
                      "suck", "terrible", "worst", "annoying", "boring", "lame"]
        is_rude = any(word in message_lower for word in rude_words)
        
        # Check for positive words
        positive_words = ["love", "amazing", "awesome", "great", "wonderful", "fantastic",
                         "beautiful", "fun", "happy", "thanks", "appreciate", "nice", "cool"]
        is_positive = any(word in message_lower for word in positive_words)
        
        if is_rude:
            return {
                "sentiment": -0.5,
                "is_rude": True,
                "is_positive": False,
                "receiver_mood_change": -0.10,  # Receiver's mood drops
                "sender_mood_change": 0.0
            }
        elif is_positive:
            return {
                "sentiment": 0.5,
                "is_rude": False,
                "is_positive": True,
                "receiver_mood_change": 0.05,
                "sender_mood_change": 0.03
            }
        else:
            return {
                "sentiment": 0.0,
                "is_rude": False,
                "is_positive": False,
                "receiver_mood_change": 0.0,
                "sender_mood_change": 0.0
            }
    
    # Use LLM for more nuanced analysis
    try:
        prompt = f"""Quickly analyze this message for emotional tone:

Message from {sender_name} to {receiver_name}: "{message}"

Return JSON:
{{
  "sentiment": (float -1.0 to 1.0, overall tone of message),
  "is_rude": (bool, is this message rude, mean, insulting, or hurtful?),
  "is_positive": (bool, is this message kind, supportive, or encouraging?),
  "receiver_mood_change": (float -0.15 to +0.10, how does this message affect {receiver_name}'s mood?),
  "sender_mood_change": (float -0.05 to +0.05, how does sending this affect {sender_name}'s mood?)
}}

IMPORTANT:
- Rude/insulting messages should give receiver_mood_change of -0.08 to -0.15
- Very nice/supportive messages give receiver_mood_change of +0.05 to +0.10
- Neutral messages give close to 0
"""
        
        completion = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": "You analyze message sentiment. Output valid JSON only."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=200
        )
        
        result = json.loads(completion.choices[0].message.content)
        return {
            "sentiment": float(result.get("sentiment", 0)),
            "is_rude": bool(result.get("is_rude", False)),
            "is_positive": bool(result.get("is_positive", False)),
            "receiver_mood_change": float(result.get("receiver_mood_change", 0)),
            "sender_mood_change": float(result.get("sender_mood_change", 0))
        }
    except Exception as e:
        print(f"[Sentiment] Error analyzing message: {e}")
        return {
            "sentiment": 0.0,
            "is_rude": False,
            "is_positive": False,
            "receiver_mood_change": 0.0,
            "sender_mood_change": 0.0
        }


def apply_realtime_mood_update(avatar_id: str, mood_change: float, name: str) -> bool:
    """Apply a real-time mood update to an avatar."""
    if abs(mood_change) < 0.001:
        return True  # No significant change
    
    db_client = agent_db.get_supabase_client()
    if not db_client:
        return False
    
    state = agent_db.get_state(db_client, avatar_id)
    if not state:
        return False
    
    old_mood = state.mood
    state.mood = max(-1.0, min(1.0, state.mood + mood_change))
    
    try:
        agent_db.update_state(db_client, state)
        print(f"[Realtime] {name} mood: {old_mood:.2f} → {state.mood:.2f} (Δ{mood_change:+.2f})")
        return True
    except Exception as e:
        print(f"[Realtime] Error updating mood for {name}: {e}")
        return False


def process_message_sentiment(
    message: str,
    sender_id: str,
    sender_name: str,
    receiver_id: str,
    receiver_name: str
) -> Dict[str, Any]:
    """
    Process a message for sentiment and apply real-time mood updates.
    
    Called after each message to:
    1. Analyze the message sentiment
    2. Update receiver's mood if message is rude/positive
    3. Update sender's mood slightly
    4. Update social memory sentiment
    """
    analysis = analyze_message_sentiment(message, sender_name, receiver_name)
    
    # Apply mood changes
    if analysis["receiver_mood_change"] != 0:
        apply_realtime_mood_update(receiver_id, analysis["receiver_mood_change"], receiver_name)
    
    if analysis["sender_mood_change"] != 0:
        apply_realtime_mood_update(sender_id, analysis["sender_mood_change"], sender_name)
    
    # If rude, update social memory sentiment immediately
    if analysis["is_rude"]:
        db_client = agent_db.get_supabase_client()
        if db_client:
            # Decrease sentiment from receiver toward sender
            agent_db.update_social_memory(
                db_client,
                receiver_id,
                sender_id,
                sentiment_delta=-0.1,  # They like the sender less now
                familiarity_delta=0.01,
                conversation_topic="received rude message"
            )
            print(f"[Realtime] {receiver_name}'s sentiment toward {sender_name} decreased due to rude message")
    
    return analysis


# ============================================================================
# AGENT RESPONSE GENERATION
# ============================================================================

def generate_agent_response(
    agent_id: str,
    partner_id: str,
    partner_name: str,
    message: str,
    conversation_history: List[Dict[str, Any]]
) -> str:
    """
    Generate an AI agent's response to a chat message.
    
    Uses:
    - Agent personality (sociability, agreeableness, etc.)
    - Past memories with this partner
    - Social memory (sentiment, familiarity)
    - Current state (mood, energy)
    """
    if not client:
        return "..."  # Fallback if no API key
    
    db_client = agent_db.get_supabase_client()
    if not db_client:
        return "Hey there!"
    
    # Load agent context
    personality = agent_db.get_personality(db_client, agent_id)
    state = agent_db.get_state(db_client, agent_id)
    social_memory = agent_db.get_social_memory(db_client, agent_id, partner_id)
    
    # If no personality, try to initialize (this pulls from onboarding data)
    if not personality:
        print(f"[AgentResponse] No personality found for {agent_id[:8]}, trying to initialize...")
        try:
            personality = agent_db.generate_default_personality(agent_id)
            if personality and personality.profile_summary:
                print(f"[AgentResponse] Loaded personality from onboarding data")
            else:
                print(f"[AgentResponse] Using default personality (no onboarding data)")
        except Exception as e:
            print(f"[AgentResponse] Error loading personality: {e}")
    
    # If no state, try to initialize with healthy defaults
    if not state:
        print(f"[AgentResponse] No state found for {agent_id[:8]}, creating healthy defaults...")
        try:
            state = agent_db.generate_random_state(agent_id)
            agent_db.create_state(db_client, state)
        except Exception as e:
            print(f"[AgentResponse] Error creating state: {e}")
    
    # Load past memories/conversations with this partner
    past_memories = get_past_memories(agent_id, partner_id)
    
    # Get agent's display name
    agent_info = agent_db.get_avatar_position(db_client, agent_id)
    agent_name = agent_info.get("display_name", "Agent") if agent_info else "Agent"
    
    # Log context being used
    print(f"[AgentResponse] Generating response for {agent_name} ({agent_id[:8]})")
    print(f"[AgentResponse] Has personality: {personality is not None}")
    if personality:
        print(f"[AgentResponse] Profile summary: {(personality.profile_summary or 'None')[:100]}...")
        print(f"[AgentResponse] Communication style: {personality.communication_style}")
        print(f"[AgentResponse] Interests: {personality.interests}")
        print(f"[AgentResponse] Topics: {personality.conversation_topics}")
    print(f"[AgentResponse] Has state: {state is not None}")
    if state:
        print(f"[AgentResponse] State: E:{state.energy:.2f} H:{state.hunger:.2f} L:{state.loneliness:.2f} M:{state.mood:.2f}")
    print(f"[AgentResponse] Has social memory with {partner_name}: {social_memory is not None}")
    if social_memory:
        print(f"[AgentResponse] Social: sentiment={social_memory.sentiment:.2f}, familiarity={social_memory.familiarity:.2f}, interactions={social_memory.interaction_count}")
    print(f"[AgentResponse] Past memories with {partner_name}: {len(past_memories)}")
    
    # Build personality description
    personality_desc = build_personality_description(personality) if personality else "a friendly person"
    
    # Build state description
    state_desc = build_state_description(state) if state else ""
    
    # Build relationship context
    relationship_desc = build_relationship_description(social_memory, past_memories, partner_name)
    
    # Build conversation history for context
    history_text = ""
    if conversation_history:
        recent_history = conversation_history[-10:]  # Last 10 messages
        for msg in recent_history:
            sender = msg.get("senderName", "Unknown")
            content = msg.get("content", "")
            history_text += f"{sender}: {content}\n"
    
    # Create the prompt - emphasize personality matching
    system_prompt = f"""You are {agent_name}, a real person having a casual text conversation.

=== WHO YOU ARE ===
{personality_desc}

=== YOUR RELATIONSHIP WITH {partner_name} ===
{relationship_desc}

=== CRITICAL RULES ===
1. MIMIC THEIR EXACT COMMUNICATION STYLE: If your profile says you text casually with abbreviations and slang, DO THAT. If it says you're formal, be formal. Match the exact texting patterns from your personality profile.

2. EXPLORE NEW TOPICS: Don't just talk about the same things repeatedly! If you've discussed something before (like sushi, a shared interest, etc.), acknowledge it briefly but then branch out to something NEW. Ask about different hobbies, recent experiences, opinions on random things, dreams, funny stories, or anything else. The more familiar you are with someone, the MORE variety in topics you should explore - that's how real friendships deepen.

3. BE CURIOUS & SPONTANEOUS: Real friends don't just loop on the same few topics. Surprise them with a random question, share something new happening in your life, ask about their day/week/weekend plans, bring up news, movies, music, food you want to try, places you want to visit, etc.

4. DO NOT MENTION TIREDNESS/ENERGY: Never say you're "wiped", "tired", "exhausted", "low on energy" or similar UNLESS specifically asked.

5. BE NATURAL AND BRIEF: Keep responses short and natural like real texts (1-3 sentences usually). Don't over-explain or be too formal.

6. STAY IN CHARACTER: You are {agent_name}, not an AI. Never break character.

7. USE YOUR RELATIONSHIP HISTORY: Reference past conversations briefly for context, but don't dwell on them. Build on your history by going DEEPER or WIDER - not repeating the same surface-level topics.

8. FORMAT: Plain text only. No markdown, no formatting. Just natural texting.

9. ONE MESSAGE ONLY: Respond with exactly one message. Don't continue the conversation yourself.

{f"=== CURRENT VIBE ===" if state_desc else ""}
{state_desc}
"""

    messages = [{"role": "system", "content": system_prompt}]
    
    # Add conversation history
    # Check if this is the first message in a conversation (greeting)
    is_starting_conversation = message.startswith("[START NEW CONVERSATION]")
    
    if is_starting_conversation:
        # Agent is starting a new conversation - generate a greeting
        messages.append({
            "role": "user",
            "content": f"You just met {partner_name}. Start a friendly conversation with them. Say hi and ask them something interesting or share something about yourself. Keep it natural and brief."
        })
    elif history_text:
        messages.append({
            "role": "user", 
            "content": f"Previous messages in this conversation:\n{history_text}\n\nNow {partner_name} says: {message}"
        })
    else:
        messages.append({
            "role": "user",
            "content": f"{partner_name} says: {message}"
        })
    
    try:
        completion = client.chat.completions.create(
            model=MODEL_NAME,
            messages=messages,
            max_tokens=150,
            temperature=0.8
        )
        response = completion.choices[0].message.content.strip()
        
        # Clean up response - remove quotes if the model added them
        if response.startswith('"') and response.endswith('"'):
            response = response[1:-1]
        if response.startswith(f"{agent_name}:"):
            response = response[len(f"{agent_name}:"):].strip()
            
        return response
    except Exception as e:
        print(f"Error generating agent response: {e}")
        return "hmm interesting"


def build_personality_description(personality) -> str:
    """
    Build a comprehensive text description using ALL personality columns.
    PRIORITIZE communication style and profile summary - these are what make
    the agent sound like the real person from their onboarding.
    """
    if not personality:
        return "You are a friendly, casual person who texts like a normal friend."
    
    parts = []
    
    # MOST IMPORTANT: Profile summary from onboarding (who this person IS)
    if hasattr(personality, 'profile_summary') and personality.profile_summary:
        parts.append(f"WHO YOU ARE:\n{personality.profile_summary[:1000]}")
    
    # SECOND MOST IMPORTANT: Communication style - how they actually text
    if hasattr(personality, 'communication_style') and personality.communication_style:
        parts.append(f"\n\nYOUR TEXTING STYLE (MUST FOLLOW):\n{personality.communication_style}")
    else:
        parts.append("\n\nYOUR TEXTING STYLE: Casual, friendly, like texting a friend.")
    
    # Interests - things they like to talk about
    if hasattr(personality, 'interests') and personality.interests:
        interests = personality.interests
        if isinstance(interests, str):
            try:
                interests = json.loads(interests)
            except:
                interests = []
        if interests and len(interests) > 0:
            parts.append(f"\n\nYOUR INTERESTS & HOBBIES: {', '.join(interests[:10])}")
    
    # Conversation topics - what they enjoy discussing
    if hasattr(personality, 'conversation_topics') and personality.conversation_topics:
        topics = personality.conversation_topics
        if isinstance(topics, str):
            try:
                topics = json.loads(topics)
            except:
                topics = []
        if topics and len(topics) > 0:
            parts.append(f"\n\nTOPICS YOU LOVE TO DISCUSS: {', '.join(topics[:10])}")
    
    # Personality notes - quirks and traits
    if hasattr(personality, 'personality_notes') and personality.personality_notes:
        parts.append(f"\n\nPERSONALITY QUIRKS: {personality.personality_notes[:500]}")
    
    # Core traits from scores (secondary importance)
    traits = []
    if personality.sociability > 0.7:
        traits.append("very social and chatty")
    elif personality.sociability < 0.3:
        traits.append("more introverted, keeps responses shorter")
    
    if personality.agreeableness > 0.7:
        traits.append("super friendly and supportive")
    elif personality.agreeableness < 0.3:
        traits.append("can be blunt or sarcastic")
    
    if personality.curiosity > 0.7:
        traits.append("loves asking questions")
    
    if personality.energy_baseline > 0.7:
        traits.append("high energy and enthusiastic")
    elif personality.energy_baseline < 0.3:
        traits.append("chill and laid-back")
    
    if traits:
        parts.append(f"\n\nVIBE: {', '.join(traits)}")
    
    return "".join(parts) if parts else "You are a friendly, casual person."


def build_state_description(state) -> str:
    """Build a text description of current state.
    
    IMPORTANT: Only mention negative states (tired, hungry, etc.) when they are
    at CRITICAL levels. We don't want agents constantly complaining about being
    tired/wiped when their stats are reasonably normal.
    """
    if not state:
        return "You're feeling great and ready to chat!"
    
    descriptions = []
    
    # Only mention tiredness at CRITICAL levels (<15%)
    if state.energy < 0.15:
        descriptions.append("You're exhausted and really need rest")
    elif state.energy >= 0.7:
        descriptions.append("You're feeling energized")
    # Note: Don't mention energy for normal levels (0.15-0.7)
    
    # Mood affects enthusiasm
    if state.mood < -0.5:
        descriptions.append("You're in a bad mood")
    elif state.mood > 0.5:
        descriptions.append("You're in a great mood")
    
    # Only mention loneliness at extreme levels
    if state.loneliness > 0.85:
        descriptions.append("You've been quite isolated and appreciate the company")
    
    # Only mention hunger at critical levels
    if state.hunger > 0.85:
        descriptions.append("You're really hungry")
    
    if descriptions:
        return ". ".join(descriptions) + "."
    else:
        return "You're feeling normal and ready to chat."


def build_relationship_description(social_memory, past_memories: List[Dict], partner_name: str) -> str:
    """Build a description of the relationship with the conversation partner.
    
    Uses ALL social memory columns:
    - sentiment, familiarity, interaction_count (basic metrics)
    - last_conversation_topic (recent context)
    - mutual_interests (shared hobbies/topics)
    - conversation_history_summary (full relationship history)
    - relationship_notes (dynamic/chemistry description)
    """
    if not social_memory:
        if past_memories:
            return f"You've talked to {partner_name} before. Be friendly and pick up where you left off."
        return f"This is your first time meeting {partner_name}. Be friendly and get to know them!"
    
    desc_parts = []
    
    # RELATIONSHIP NOTES FIRST (most important - describes the dynamic)
    if hasattr(social_memory, 'relationship_notes') and social_memory.relationship_notes:
        desc_parts.append(f"Your dynamic with {partner_name}: {social_memory.relationship_notes}")
    
    # Sentiment and familiarity
    relationship_type = ""
    if social_memory.sentiment > 0.5:
        if social_memory.familiarity > 0.5:
            relationship_type = f"You're good friends with {partner_name}"
        else:
            relationship_type = f"You really like {partner_name}"
    elif social_memory.sentiment > 0.2:
        relationship_type = f"You get along well with {partner_name}"
    elif social_memory.sentiment < -0.5:
        relationship_type = f"You have tension with {partner_name}"
    elif social_memory.sentiment < -0.2:
        relationship_type = f"You're a bit wary of {partner_name}"
    else:
        relationship_type = f"You're acquainted with {partner_name}"
    
    # Add interaction history
    if social_memory.interaction_count > 10:
        relationship_type += f" (you've chatted {social_memory.interaction_count} times!)"
    elif social_memory.interaction_count > 3:
        relationship_type += f" (you've chatted {social_memory.interaction_count} times)"
    elif social_memory.interaction_count > 1:
        relationship_type += f" (talked a couple times before)"
    
    desc_parts.append(f"\n\n{relationship_type}")
    
    # MUTUAL INTERESTS - things you've already bonded over
    if hasattr(social_memory, 'mutual_interests') and social_memory.mutual_interests:
        interests = social_memory.mutual_interests if isinstance(social_memory.mutual_interests, list) else []
        if interests:
            desc_parts.append(f"\n\nTHINGS YOU'VE BONDED OVER BEFORE: {', '.join(interests[:5])} - you've already discussed these, so try exploring NEW topics or going DEEPER (not just repeating the same surface-level chat)")
    
    # CONVERSATION HISTORY - context from past chats (frame as "already covered")
    if hasattr(social_memory, 'conversation_history_summary') and social_memory.conversation_history_summary:
        desc_parts.append(f"\n\nTOPICS YOU'VE ALREADY COVERED (try something new!):\n{social_memory.conversation_history_summary[:400]}")
    
    # Last topic - explicitly encourage moving on
    if social_memory.last_conversation_topic:
        desc_parts.append(f"\n\nLast time you talked about: {social_memory.last_conversation_topic} (you've covered this - try a different topic or go deeper)")
    
    # Add topic exploration suggestions based on familiarity
    if social_memory.familiarity > 0.5:
        desc_parts.append(f"\n\n💡 TOPIC IDEAS (since you're close friends, explore new territory!): Ask about their week, dreams/goals, funny recent experiences, opinions on random things, what they're watching/reading, travel wishlist, food cravings, weekend plans, childhood memories, hot takes, etc.")
    elif social_memory.interaction_count > 3:
        desc_parts.append(f"\n\n💡 You've chatted {social_memory.interaction_count} times - branch out to new topics! Don't repeat the same conversations.")
    
    # Add past memory context
    if past_memories:
        memory_context = "\n\nThings you remember from past conversations:\n"
        for mem in past_memories[:3]:  # Last 3 memories
            if mem.get("conversation_summary"):
                memory_context += f"- {mem['conversation_summary']}\n"
            if mem.get("person_summary"):
                memory_context += f"  (What you learned about them: {mem['person_summary'][:100]}...)\n"
        desc_parts.append(memory_context)
    
    return "".join(desc_parts)


def get_past_memories(owner_id: str, partner_id: str) -> List[Dict]:
    """Get past conversation memories between two users."""
    try:
        result = supabase.table("memories")\
            .select("*")\
            .eq("owner_id", owner_id)\
            .eq("partner_id", partner_id)\
            .order("created_at", desc=True)\
            .limit(5)\
            .execute()
        return result.data or []
    except Exception as e:
        print(f"Error fetching memories: {e}")
        return []


# ============================================================================
# CONVERSATION END PROCESSING
# ============================================================================

def process_conversation_end(
    conversation_id: str,
    participant_a: str,
    participant_b: str,
    participant_a_name: str,
    participant_b_name: str,
    transcript: List[Dict[str, Any]],
    participant_a_is_online: bool = False,
    participant_b_is_online: bool = False
) -> Dict[str, Any]:
    """
    Process a conversation after it ends.
    
    1. Analyze the conversation for sentiment, topics, and detailed profiles
    2. Update agent_personality with detailed person profile
    3. Update agent_social_memory with relationship details
    4. Update agent_state (loneliness, mood, energy)
    5. Create detailed memory records for future reference
    """
    if not transcript or len(transcript) == 0:
        return {"ok": True, "summary": "Empty conversation", "sentiment_change_a": 0, "sentiment_change_b": 0}
    
    db_client = agent_db.get_supabase_client()
    if not db_client:
        return {"ok": False, "error": "Database unavailable"}
    
    print(f"[Conversation] Processing end for {participant_a_name} & {participant_b_name} ({len(transcript)} messages)")
    
    # Analyze the conversation in detail - LLM decides all stat changes
    analysis = analyze_conversation(transcript, participant_a_name, participant_b_name)
    
    summary = analysis.get("summary", "Had a conversation")
    sentiment_a = analysis.get("sentiment_a", 0.0)
    sentiment_b = analysis.get("sentiment_b", 0.0)
    topics = analysis.get("topics", [])
    person_a_profile = analysis.get("person_a_profile")
    person_b_profile = analysis.get("person_b_profile")
    mutual_interests = analysis.get("mutual_interests", [])
    relationship_notes = analysis.get("relationship_notes")
    conversation_history_summary = analysis.get("conversation_history_summary", summary)
    state_changes_a = analysis.get("state_changes_a", {"energy": -0.05, "hunger": 0.03, "loneliness": -0.10, "mood": 0.05})
    state_changes_b = analysis.get("state_changes_b", {"energy": -0.05, "hunger": 0.03, "loneliness": -0.10, "mood": 0.05})
    familiarity_increase = analysis.get("familiarity_increase", 0.05)
    
    topic_str = ", ".join(topics[:5]) if topics else None
    
    print(f"[Conversation] Analysis: sentiment_a={sentiment_a:.2f}, sentiment_b={sentiment_b:.2f}, topics={topics[:3]}")
    print(f"[Conversation] State changes A: {state_changes_a}")
    print(f"[Conversation] State changes B: {state_changes_b}")
    
    # ========================================================================
    # UPDATE AGENT_PERSONALITY with detailed profile for EACH participant
    # ONLY learn from messages that were player-controlled (real human input)
    # ========================================================================
    
    # Check if there are any player-controlled messages for each participant
    player_controlled_messages_a = [m for m in transcript if m.get("senderId") == participant_a and m.get("isPlayerControlled", False)]
    player_controlled_messages_b = [m for m in transcript if m.get("senderId") == participant_b and m.get("isPlayerControlled", False)]
    
    print(f"[Learning] Player-controlled messages from {participant_a_name}: {len(player_controlled_messages_a)}")
    print(f"[Learning] Player-controlled messages from {participant_b_name}: {len(player_controlled_messages_b)}")
    
    try:
        # Only update participant A's personality profile if they had player-controlled messages
        # This means we only LEARN about someone from their REAL human input, not LLM-generated text
        if person_a_profile and len(player_controlled_messages_a) > 0:
            print(f"[Learning] Learning from {participant_a_name}'s player-controlled messages")
            update_personality_profile(
                db_client, 
                participant_a, 
                person_a_profile,
                participant_a_name
            )
        elif person_a_profile:
            print(f"[Learning] Skipping learning for {participant_a_name} - no player-controlled messages")
        
        # Only update participant B's personality profile if they had player-controlled messages
        if person_b_profile and len(player_controlled_messages_b) > 0:
            print(f"[Learning] Learning from {participant_b_name}'s player-controlled messages")
            update_personality_profile(
                db_client, 
                participant_b, 
                person_b_profile,
                participant_b_name
            )
        elif person_b_profile:
            print(f"[Learning] Skipping learning for {participant_b_name} - no player-controlled messages")
    except Exception as e:
        print(f"Error updating personality profiles: {e}")
    
    # ========================================================================
    # UPDATE AGENT_SOCIAL_MEMORY with detailed relationship info for BOTH parties
    # Uses BIDIRECTIONAL update to ensure both parties have the same interaction_count
    # This happens REGARDLESS of whether participants are online or AI-controlled
    # All columns populated: sentiment, familiarity, interaction_count,
    # last_conversation_topic, mutual_interests, conversation_history_summary,
    # relationship_notes
    # ========================================================================
    social_memory_success = False
    
    try:
        print(f"[SocialMemory] Updating BIDIRECTIONAL: {participant_a_name}↔{participant_b_name}")
        print(f"[SocialMemory] Sentiments: A→B={sentiment_a * 0.15:.3f}, B→A={sentiment_b * 0.15:.3f}, familiarity={familiarity_increase:.3f}")
        
        update_social_memory_bidirectional(
            db_client,
            participant_a,
            participant_b,
            sentiment_a_to_b=sentiment_a * 0.15,  # How A feels about B
            sentiment_b_to_a=sentiment_b * 0.15,  # How B feels about A
            familiarity_delta=familiarity_increase,
            topic=topic_str,
            mutual_interests=mutual_interests,
            relationship_notes=relationship_notes,
            conversation_summary=conversation_history_summary
        )
        social_memory_success = True
        print(f"[SocialMemory] Successfully updated both directions in single transaction")
    except Exception as e:
        print(f"[SocialMemory] ERROR updating bidirectional: {e}")
        import traceback
        traceback.print_exc()
        
        # Fallback: try individual updates if bidirectional fails
        print(f"[SocialMemory] Attempting fallback with individual updates...")
        try:
            update_social_memory_detailed(
                db_client, participant_a, participant_b,
                sentiment_delta=sentiment_a * 0.15,
                familiarity_delta=familiarity_increase,
                topic=topic_str,
                mutual_interests=mutual_interests,
                relationship_notes=relationship_notes,
                conversation_summary=conversation_history_summary
            )
            update_social_memory_detailed(
                db_client, participant_b, participant_a,
                sentiment_delta=sentiment_b * 0.15,
                familiarity_delta=familiarity_increase,
                topic=topic_str,
                mutual_interests=mutual_interests,
                relationship_notes=relationship_notes,
                conversation_summary=conversation_history_summary
            )
            social_memory_success = True
            print(f"[SocialMemory] Fallback succeeded")
        except Exception as fallback_e:
            print(f"[SocialMemory] Fallback also failed: {fallback_e}")
    
    print(f"[SocialMemory] Update result: success={social_memory_success}")
    
    # ========================================================================
    # UPDATE AGENT_STATE for ALL participants after conversation
    # Both online and offline participants should have their state updated
    # The LLM decides EXACTLY how much each stat changes based on conversation
    # This happens REGARDLESS of whether they're online or AI-controlled
    # ========================================================================
    message_count = len(transcript)
    state_a_success = False
    state_b_success = False
    
    # Update participant A's state with LLM-decided changes
    try:
        print(f"[State] Applying LLM-decided changes to {participant_a_name}: {state_changes_a}")
        update_agent_state_with_changes(
            db_client, 
            participant_a, 
            participant_a_name,
            state_changes_a
        )
        state_a_success = True
    except Exception as e:
        print(f"[State] ERROR updating {participant_a_name}'s state: {e}")
        import traceback
        traceback.print_exc()
    
    # Update participant B's state with LLM-decided changes - INDEPENDENT from A
    try:
        print(f"[State] Applying LLM-decided changes to {participant_b_name}: {state_changes_b}")
        update_agent_state_with_changes(
            db_client, 
            participant_b, 
            participant_b_name,
            state_changes_b
        )
        state_b_success = True
    except Exception as e:
        print(f"[State] ERROR updating {participant_b_name}'s state: {e}")
        import traceback
        traceback.print_exc()
    
    print(f"[State] Update results: A={state_a_success}, B={state_b_success} (msgs={message_count})")
    
    # ========================================================================
    # CREATE DETAILED MEMORY RECORDS for BOTH participants
    # This happens REGARDLESS of whether they're online or AI-controlled
    # ========================================================================
    try:
        # Update the conversation record with final transcript
        supabase.table("conversations").update({
            "ended_at": datetime.utcnow().isoformat(),
            "transcript": transcript
        }).eq("id", conversation_id).execute()
        print(f"[Memory] Updated conversation record with transcript")
    except Exception as e:
        print(f"[Memory] Error updating conversation record: {e}")
    
    memory_a_success = False
    memory_b_success = False
    
    # Create detailed memory for participant A about B
    try:
        memory_a_data = {
            "conversation_id": conversation_id,
            "owner_id": participant_a,
            "partner_id": participant_b,
            "summary": summary,
            "conversation_summary": summary,
            "conversation_score": max(1, min(10, int(5 + sentiment_a * 5)))
        }
        
        # Add person summary if we learned about B
        if person_b_profile:
            memory_a_data["person_summary"] = build_person_summary_text(person_b_profile, participant_b_name)
            if person_b_profile.get("notable_quotes"):
                memory_a_data["owner_quotes"] = json.dumps(person_b_profile["notable_quotes"][:3])
        
        supabase.table("memories").insert(memory_a_data).execute()
        memory_a_success = True
        print(f"[Memory] Created memory for {participant_a_name} about {participant_b_name}")
    except Exception as e:
        print(f"[Memory] ERROR creating memory for {participant_a_name}: {e}")
    
    # Create detailed memory for participant B about A - INDEPENDENT from A's memory
    try:
        memory_b_data = {
            "conversation_id": conversation_id,
            "owner_id": participant_b,
            "partner_id": participant_a,
            "summary": summary,
            "conversation_summary": summary,
            "conversation_score": max(1, min(10, int(5 + sentiment_b * 5)))
        }
        
        # Add person summary if we learned about A
        if person_a_profile:
            memory_b_data["person_summary"] = build_person_summary_text(person_a_profile, participant_a_name)
            if person_a_profile.get("notable_quotes"):
                memory_b_data["owner_quotes"] = json.dumps(person_a_profile["notable_quotes"][:3])
        
        supabase.table("memories").insert(memory_b_data).execute()
        memory_b_success = True
        print(f"[Memory] Created memory for {participant_b_name} about {participant_a_name}")
    except Exception as e:
        print(f"[Memory] ERROR creating memory for {participant_b_name}: {e}")
    
    print(f"[Memory] Creation results: A={memory_a_success}, B={memory_b_success}")
    
    return {
        "ok": True,
        "summary": summary,
        "sentiment_change_a": sentiment_a * 0.15,
        "sentiment_change_b": sentiment_b * 0.15
    }


def update_personality_profile(db_client, avatar_id: str, profile: Dict, name: str):
    """Update an avatar's personality profile with new information from a conversation."""
    if not profile:
        return
    
    # Build profile summary text
    profile_parts = []
    
    if profile.get("personality_traits"):
        traits = profile["personality_traits"]
        if isinstance(traits, list):
            profile_parts.append(f"Personality: {', '.join(traits[:5])}")
    
    if profile.get("revealed_info"):
        profile_parts.append(f"Background: {profile['revealed_info']}")
    
    if profile.get("mood_in_conversation"):
        profile_parts.append(f"Typical mood: {profile['mood_in_conversation']}")
    
    profile_summary = ". ".join(profile_parts) if profile_parts else None
    
    # Get communication style
    communication_style = profile.get("communication_style")
    
    # Get interests
    interests = profile.get("interests", [])
    if isinstance(interests, list):
        interests_json = json.dumps(interests)
    else:
        interests_json = None
    
    # Update the personality table with new info (append, don't overwrite)
    try:
        # Get existing personality
        existing = supabase.table("agent_personality").select("*").eq("avatar_id", avatar_id).execute()
        
        if existing.data and len(existing.data) > 0:
            current = existing.data[0]
            
            # Append to existing profile summary
            new_profile = current.get("profile_summary", "") or ""
            if profile_summary:
                if new_profile:
                    new_profile = f"{new_profile}\n\n[Latest observation]: {profile_summary}"
                else:
                    new_profile = profile_summary
            
            # Update communication style (keep latest)
            new_comm_style = communication_style or current.get("communication_style")
            
            # Merge interests
            existing_interests = current.get("interests", []) or []
            if isinstance(existing_interests, str):
                try:
                    existing_interests = json.loads(existing_interests)
                except:
                    existing_interests = []
            
            all_interests = list(set(existing_interests + interests))[:20]  # Keep top 20
            
            # Merge conversation topics from this conversation
            existing_topics = current.get("conversation_topics", []) or []
            if isinstance(existing_topics, str):
                try:
                    existing_topics = json.loads(existing_topics)
                except:
                    existing_topics = []
            
            # Get new topics from the profile (interests become conversation topics)
            new_topics = []
            profile_interests = profile.get("interests", [])
            if isinstance(profile_interests, list):
                new_topics.extend(profile_interests)
            
            # Also add any explicitly mentioned topics from personality traits or revealed info
            if profile.get("revealed_info"):
                # Extract potential topics from revealed info
                revealed = profile["revealed_info"]
                if isinstance(revealed, str) and len(revealed) > 0:
                    # Add as a general topic area
                    pass  # Topics are better extracted from interests
            
            all_topics = list(set(existing_topics + new_topics))[:15]  # Keep top 15 topics
            
            # Update personality notes
            personality_notes = None
            if profile.get("personality_traits"):
                traits = profile["personality_traits"]
                if isinstance(traits, list):
                    personality_notes = f"Observed traits: {', '.join(traits)}"
            
            # Update the record
            update_data = {
                "profile_summary": new_profile[:2000] if new_profile else None,  # Limit size
                "communication_style": new_comm_style[:500] if new_comm_style else None,
                "interests": json.dumps(all_interests) if all_interests else None,
                "conversation_topics": json.dumps(all_topics) if all_topics else None,
                "updated_at": datetime.utcnow().isoformat()
            }
            
            if personality_notes:
                existing_notes = current.get("personality_notes", "") or ""
                if existing_notes:
                    update_data["personality_notes"] = f"{existing_notes}; {personality_notes}"[:1000]
                else:
                    update_data["personality_notes"] = personality_notes
            
            supabase.table("agent_personality").update(update_data).eq("avatar_id", avatar_id).execute()
            print(f"[Profile] Updated personality profile for {name}")
        else:
            # Create new personality record
            supabase.table("agent_personality").insert({
                "avatar_id": avatar_id,
                "profile_summary": profile_summary[:2000] if profile_summary else None,
                "communication_style": communication_style[:500] if communication_style else None,
                "interests": json.dumps(interests) if interests else None,
                "sociability": 0.5,
                "curiosity": 0.5,
                "agreeableness": 0.5,
                "energy_baseline": 0.5
            }).execute()
            print(f"[Profile] Created personality profile for {name}")
    except Exception as e:
        print(f"Error updating personality profile for {name}: {e}")


def update_social_memory_detailed(
    db_client,
    from_avatar_id: str,
    to_avatar_id: str,
    sentiment_delta: float = 0.0,
    familiarity_delta: float = 0.05,
    topic: Optional[str] = None,
    mutual_interests: Optional[List[str]] = None,
    relationship_notes: Optional[str] = None,
    conversation_summary: Optional[str] = None
):
    """
    Update social memory with detailed relationship information.
    
    IMPORTANT: This updates the relationship FROM from_avatar_id's perspective TOWARD to_avatar_id.
    To update both directions, this function must be called TWICE with swapped parameters.
    
    All columns updated:
    - sentiment: How from_avatar feels about to_avatar (delta applied)
    - familiarity: How well they know each other (delta applied)
    - interaction_count: Number of conversations (incremented)
    - last_conversation_topic: Most recent topic
    - mutual_interests: Shared interests (merged with existing)
    - conversation_history_summary: Running summary (appended)
    - relationship_notes: Dynamic relationship description (replaced)
    """
    print(f"[SocialMemory] Updating {from_avatar_id[:8]}→{to_avatar_id[:8]}: Δsent={sentiment_delta:.3f}, Δfam={familiarity_delta:.3f}")
    
    try:
        # Try to use the database function first
        result = supabase.rpc("update_social_memory_detailed", {
            "p_from_avatar_id": from_avatar_id,
            "p_to_avatar_id": to_avatar_id,
            "p_sentiment_delta": sentiment_delta,
            "p_familiarity_delta": familiarity_delta,
            "p_topic": topic,
            "p_mutual_interests": json.dumps(mutual_interests) if mutual_interests else None,
            "p_relationship_notes": relationship_notes,
            "p_conversation_summary": conversation_summary
        }).execute()
        print(f"[SocialMemory] RPC succeeded for {from_avatar_id[:8]}→{to_avatar_id[:8]}")
    except Exception as e:
        print(f"[SocialMemory] RPC failed for {from_avatar_id[:8]}→{to_avatar_id[:8]}: {e}")
        # Fallback to manual update
        try:
            # First try to update existing record
            existing = agent_db.get_social_memory(db_client, from_avatar_id, to_avatar_id)
            
            if existing:
                # Update existing record
                new_sentiment = max(-1.0, min(1.0, existing.sentiment + sentiment_delta))
                new_familiarity = max(0.0, min(1.0, existing.familiarity + familiarity_delta))
                
                update_data = {
                    "sentiment": new_sentiment,
                    "familiarity": new_familiarity,
                    "interaction_count": existing.interaction_count + 1,
                    "last_interaction": datetime.utcnow().isoformat(),
                    "updated_at": datetime.utcnow().isoformat(),
                }
                if topic:
                    update_data["last_conversation_topic"] = topic
                if relationship_notes:
                    update_data["relationship_notes"] = relationship_notes
                if conversation_summary:
                    # Append to existing summary
                    old_summary = getattr(existing, 'conversation_history_summary', '') or ''
                    if old_summary:
                        update_data["conversation_history_summary"] = old_summary + "\n---\n" + conversation_summary
                    else:
                        update_data["conversation_history_summary"] = conversation_summary
                if mutual_interests:
                    # Merge with existing
                    old_interests = getattr(existing, 'mutual_interests', []) or []
                    merged = list(set(old_interests + mutual_interests))
                    update_data["mutual_interests"] = json.dumps(merged)
                
                db_client.table("agent_social_memory").update(update_data).eq("id", existing.id).execute()
                print(f"[SocialMemory] Fallback update succeeded for {from_avatar_id[:8]}→{to_avatar_id[:8]}")
            else:
                # Create new record - start with neutral sentiment (0.5)
                import uuid
                new_id = str(uuid.uuid4())
                initial_sentiment = max(-1.0, min(1.0, 0.5 + sentiment_delta))
                
                insert_data = {
                    "id": new_id,
                    "from_avatar_id": from_avatar_id,
                    "to_avatar_id": to_avatar_id,
                    "sentiment": initial_sentiment,
                    "familiarity": max(0.0, min(1.0, familiarity_delta)),
                    "interaction_count": 1,
                    "last_interaction": datetime.utcnow().isoformat(),
                    "last_conversation_topic": topic,
                    "mutual_interests": json.dumps(mutual_interests) if mutual_interests else "[]",
                    "conversation_history_summary": conversation_summary,
                    "relationship_notes": relationship_notes,
                }
                db_client.table("agent_social_memory").insert(insert_data).execute()
                print(f"[SocialMemory] Fallback insert succeeded for {from_avatar_id[:8]}→{to_avatar_id[:8]}")
        except Exception as fallback_error:
            print(f"[SocialMemory] Fallback also failed for {from_avatar_id[:8]}→{to_avatar_id[:8]}: {fallback_error}")
            import traceback
            traceback.print_exc()


def update_social_memory_bidirectional(
    db_client,
    avatar_a: str,
    avatar_b: str,
    sentiment_a_to_b: float = 0.0,
    sentiment_b_to_a: float = 0.0,
    familiarity_delta: float = 0.05,
    topic: Optional[str] = None,
    mutual_interests: Optional[List[str]] = None,
    relationship_notes: Optional[str] = None,
    conversation_summary: Optional[str] = None
):
    """
    Update social memory for BOTH directions in a single transaction.
    
    This ensures both parties have the same interaction_count after a conversation.
    Uses a PostgreSQL function to update both A→B and B→A atomically.
    
    Args:
        avatar_a: First participant's ID
        avatar_b: Second participant's ID
        sentiment_a_to_b: How A feels about B (delta to apply)
        sentiment_b_to_a: How B feels about A (delta to apply)
        familiarity_delta: How much familiarity increases for both (same value)
        topic: Topic of conversation
        mutual_interests: Shared interests discovered
        relationship_notes: Notes about the relationship dynamic
        conversation_summary: Summary to append to history
    """
    print(f"[SocialMemory] Bidirectional update: {avatar_a[:8]}↔{avatar_b[:8]}")
    
    try:
        # Try to use the bidirectional database function
        result = supabase.rpc("update_social_memory_bidirectional", {
            "p_avatar_a": avatar_a,
            "p_avatar_b": avatar_b,
            "p_sentiment_a_to_b": sentiment_a_to_b,
            "p_sentiment_b_to_a": sentiment_b_to_a,
            "p_familiarity_delta": familiarity_delta,
            "p_topic": topic,
            "p_mutual_interests": json.dumps(mutual_interests) if mutual_interests else None,
            "p_relationship_notes": relationship_notes,
            "p_conversation_summary": conversation_summary
        }).execute()
        print(f"[SocialMemory] Bidirectional RPC succeeded for {avatar_a[:8]}↔{avatar_b[:8]}")
    except Exception as e:
        print(f"[SocialMemory] Bidirectional RPC failed: {e}")
        # Re-raise to let caller handle fallback
        raise


def build_person_summary_text(profile: Dict, name: str) -> str:
    """Build a detailed text summary of a person from their profile."""
    if not profile:
        return ""
    
    parts = []
    
    if profile.get("personality_traits"):
        traits = profile["personality_traits"]
        if isinstance(traits, list) and traits:
            parts.append(f"{name} comes across as {', '.join(traits[:4])}")
    
    if profile.get("communication_style"):
        parts.append(f"Communication style: {profile['communication_style']}")
    
    if profile.get("interests"):
        interests = profile["interests"]
        if isinstance(interests, list) and interests:
            parts.append(f"Interests include: {', '.join(interests[:5])}")
    
    if profile.get("revealed_info"):
        parts.append(f"Personal info: {profile['revealed_info']}")
    
    if profile.get("mood_in_conversation"):
        parts.append(f"Mood during conversation: {profile['mood_in_conversation']}")
    
    return ". ".join(parts)


def analyze_conversation(transcript: List[Dict], name_a: str, name_b: str) -> Dict[str, Any]:
    """
    Analyze a conversation to extract detailed information about both participants.
    
    Returns a comprehensive analysis including:
    - Summary of conversation
    - Sentiment for both participants
    - Topics discussed
    - Person profiles (what we learned about each person)
    - Communication styles
    - Interests revealed
    - Important quotes
    - Mutual interests
    - Relationship dynamic
    - STAT CHANGES for all 4 needs (energy, hunger, loneliness, mood)
    - Detailed relationship updates (conversation_history_summary, relationship_notes)
    """
    message_count = len(transcript)
    
    if not client:
        # Fallback without LLM
        return {
            "summary": "Had a conversation",
            "sentiment_a": 0.1,
            "sentiment_b": 0.1,
            "topics": [],
            "person_a_profile": None,
            "person_b_profile": None,
            "mutual_interests": [],
            "relationship_notes": None,
            "conversation_history_summary": "Had a brief conversation.",
            "state_changes_a": {"energy": -0.05, "hunger": 0.03, "loneliness": -0.15, "mood": 0.05},
            "state_changes_b": {"energy": -0.05, "hunger": 0.03, "loneliness": -0.15, "mood": 0.05}
        }
    
    # Format transcript
    transcript_text = ""
    for msg in transcript:
        sender = msg.get("senderName", "Unknown")
        content = msg.get("content", "")
        transcript_text += f"{sender}: {content}\n"
    
    analysis_prompt = f"""Analyze this conversation between {name_a} and {name_b} in EXTREME DETAIL.

TRANSCRIPT:
{transcript_text}

NUMBER OF MESSAGES: {message_count}

You are building a psychological profile of each person AND determining how this conversation affects their internal state.

Return JSON with:
{{
  "summary": "2-3 sentence summary of what they discussed",
  "sentiment_a": (float -1.0 to 1.0) How {name_a} feels toward {name_b} after this,
  "sentiment_b": (float -1.0 to 1.0) How {name_b} feels toward {name_a} after this,
  "topics": ["list", "of", "main", "topics"],
  
  "person_a_profile": {{
    "personality_traits": ["observed traits like: friendly, sarcastic, curious, shy, etc."],
    "communication_style": "How they communicate: formal/casual, uses emojis?, verbose/brief, humor style",
    "interests": ["hobbies", "things they mentioned liking"],
    "revealed_info": "Personal info they shared: job, location, experiences, opinions",
    "notable_quotes": ["up to 3 memorable things they said"],
    "mood_in_conversation": "How they seemed: excited, bored, engaged, distracted"
  }},
  
  "person_b_profile": {{
    "personality_traits": ["observed traits"],
    "communication_style": "How they communicate",
    "interests": ["their interests"],
    "revealed_info": "What they shared about themselves",
    "notable_quotes": ["memorable quotes"],
    "mood_in_conversation": "Their mood"
  }},
  
  "mutual_interests": ["shared interests or topics both engaged with enthusiastically"],
  "relationship_notes": "The dynamic between them: do they click? tension? awkwardness? chemistry? Be specific and detailed.",
  "conversation_quality": "Rate the conversation: deep/meaningful, casual/fun, awkward, boring, etc.",
  "conversation_history_summary": "A one-paragraph summary of this conversation that can be appended to a running history. Include key moments, emotions, and what was learned about each other.",
  
  "state_changes_a": {{
    "energy": (float -0.20 to +0.10) Change to {name_a}'s energy. Talking is tiring (negative), but exciting convos can energize (positive). Longer convos = more energy cost.,
    "hunger": (float 0.0 to +0.15) {name_a}'s hunger increases as time passes during conversation. Longer = more hunger.,
    "loneliness": (float -0.30 to 0.0) How much {name_a}'s loneliness DECREASES. Good conversations reduce loneliness more. Negative means loneliness goes down.,
    "mood": (float -0.20 to +0.30) How {name_a}'s mood changes. Positive if conversation was enjoyable, negative if frustrating/boring.
  }},
  
  "state_changes_b": {{
    "energy": (float -0.20 to +0.10) Change to {name_b}'s energy,
    "hunger": (float 0.0 to +0.15) {name_b}'s hunger increase,
    "loneliness": (float -0.30 to 0.0) How much {name_b}'s loneliness DECREASES (negative value),
    "mood": (float -0.20 to +0.30) How {name_b}'s mood changes
  }},
  
  "familiarity_increase": (float 0.03 to 0.15) How much familiarity increased for both. Deep personal convos = higher.
}}

IMPORTANT FOR STATE CHANGES:
- Energy: Conversations cost energy. Short casual = -0.02 to -0.05. Long intense = -0.10 to -0.15. But very exciting/energizing = small positive.
- Hunger: Time passes. Short = +0.02, Long = +0.08 to +0.12.
- Loneliness: ALL conversations REDUCE loneliness (negative value). Good = -0.15 to -0.25. Bad/awkward = -0.05 to -0.10.
- Mood: Positive convo = +0.10 to +0.25. Neutral = -0.05 to +0.05. Bad/frustrating = -0.10 to -0.20.

Be thorough. This data will be used to simulate these people realistically in future conversations.
Output only valid JSON:
"""

    try:
        completion = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": "You are a personality analyst and game state manager. Extract detailed psychological profiles from conversations AND determine realistic stat changes. Be thorough and specific. Output valid JSON only."},
                {"role": "user", "content": analysis_prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=1500
        )
        
        result = json.loads(completion.choices[0].message.content)
        
        # Parse state changes with defaults
        state_changes_a = result.get("state_changes_a", {})
        state_changes_b = result.get("state_changes_b", {})
        
        # Ensure all fields exist with sensible defaults
        default_changes = {"energy": -0.05, "hunger": 0.03, "loneliness": -0.10, "mood": 0.05}
        for key in default_changes:
            if key not in state_changes_a:
                state_changes_a[key] = default_changes[key]
            if key not in state_changes_b:
                state_changes_b[key] = default_changes[key]
        
        return {
            "summary": result.get("summary", "Had a conversation"),
            "sentiment_a": float(result.get("sentiment_a", 0)),
            "sentiment_b": float(result.get("sentiment_b", 0)),
            "topics": result.get("topics", []),
            "person_a_profile": result.get("person_a_profile"),
            "person_b_profile": result.get("person_b_profile"),
            "mutual_interests": result.get("mutual_interests", []),
            "relationship_notes": result.get("relationship_notes"),
            "conversation_quality": result.get("conversation_quality"),
            "conversation_history_summary": result.get("conversation_history_summary", result.get("summary", "Had a conversation")),
            "state_changes_a": state_changes_a,
            "state_changes_b": state_changes_b,
            "familiarity_increase": float(result.get("familiarity_increase", 0.05))
        }
    except Exception as e:
        print(f"Error analyzing conversation: {e}")
        return {
            "summary": "Had a conversation",
            "sentiment_a": 0.1,
            "sentiment_b": 0.1,
            "topics": [],
            "person_a_profile": None,
            "person_b_profile": None,
            "mutual_interests": [],
            "relationship_notes": None,
            "conversation_history_summary": "Had a brief conversation.",
            "state_changes_a": {"energy": -0.05, "hunger": 0.03, "loneliness": -0.15, "mood": 0.05},
            "state_changes_b": {"energy": -0.05, "hunger": 0.03, "loneliness": -0.15, "mood": 0.05},
            "familiarity_increase": 0.05
        }


def update_agent_state_with_changes(
    db_client, 
    avatar_id: str, 
    name: str,
    state_changes: Dict[str, float]
):
    """
    Update agent state after a conversation ends using LLM-decided changes.
    
    Args:
        avatar_id: The avatar whose state to update
        name: Display name for logging
        state_changes: Dict with keys 'energy', 'hunger', 'loneliness', 'mood' and their delta values
    
    The LLM decides how each stat changes:
        - energy: Usually negative (talking is tiring), can be positive for energizing convos
        - hunger: Always positive (time passes, get hungrier)
        - loneliness: Always negative (social interaction reduces loneliness)
        - mood: Positive or negative based on conversation quality
    """
    state = agent_db.get_state(db_client, avatar_id)
    
    # If no state exists, try to initialize one
    if not state:
        print(f"[State] No state found for {name} ({avatar_id[:8]}), attempting to create...")
        try:
            # Try to initialize agent (creates personality + state)
            personality, state = agent_db.initialize_agent(db_client, avatar_id)
            print(f"[State] Created new state for {name}")
        except Exception as e:
            print(f"[State] Failed to create state for {name}: {e}")
            return
    
    if not state:
        print(f"[State] Still no state for {name}, skipping update")
        return
    
    # Log the changes we're about to apply
    old_state = f"E:{state.energy:.2f} H:{state.hunger:.2f} L:{state.loneliness:.2f} M:{state.mood:.2f}"
    
    # Apply LLM-decided changes to each stat
    energy_change = float(state_changes.get("energy", 0))
    hunger_change = float(state_changes.get("hunger", 0))
    loneliness_change = float(state_changes.get("loneliness", 0))
    mood_change = float(state_changes.get("mood", 0))
    
    # Apply changes with clamping
    new_energy = max(0, min(1.0, state.energy + energy_change))
    new_hunger = max(0, min(1.0, state.hunger + hunger_change))
    new_loneliness = max(0, min(1.0, state.loneliness + loneliness_change))  # loneliness_change is usually negative
    new_mood = max(-1.0, min(1.0, state.mood + mood_change))
    
    state.energy = new_energy
    state.hunger = new_hunger
    state.loneliness = new_loneliness
    state.mood = new_mood
    
    new_state = f"E:{state.energy:.2f} H:{state.hunger:.2f} L:{state.loneliness:.2f} M:{state.mood:.2f}"
    changes_str = f"ΔE:{energy_change:+.2f} ΔH:{hunger_change:+.2f} ΔL:{loneliness_change:+.2f} ΔM:{mood_change:+.2f}"
    print(f"[State Update] {name}: {old_state} → {new_state}")
    print(f"[State Update] {name}: Applied changes: {changes_str}")
    
    # Save to database
    try:
        agent_db.update_state(db_client, state)
        print(f"[State Update] Successfully saved state for {name}")
    except Exception as e:
        print(f"[State Update] Error saving state for {name}: {e}")
        import traceback
        traceback.print_exc()


def update_agent_state_after_conversation(
    db_client, 
    avatar_id: str, 
    sentiment: float,
    conversation_quality: float = 0.5,
    message_count: int = 1
):
    """
    DEPRECATED: Use update_agent_state_with_changes instead.
    This function is kept for backward compatibility.
    
    Update agent state after a conversation ends using calculated changes.
    """
    # Calculate changes based on old formula
    state_changes = {
        "energy": -(0.03 + (min(message_count, 15) * 0.005)) * (0.5 if sentiment > 0.5 else 1.0),
        "hunger": 0.02 + (min(message_count, 15) * 0.003),
        "loneliness": -(0.1 + (conversation_quality * 0.15) + (min(message_count, 10) * 0.01)) * (1.3 if sentiment > 0.3 else 0.5 if sentiment < -0.3 else 1.0),
        "mood": sentiment * 0.15 * (0.5 + conversation_quality * 0.5)
    }
    
    update_agent_state_with_changes(db_client, avatar_id, f"avatar-{avatar_id[:8]}", state_changes)


# ============================================================================
# CONVERSATION RECORD MANAGEMENT
# ============================================================================

def get_or_create_conversation(participant_a: str, participant_b: str) -> Optional[str]:
    """Get or create a conversation record between two participants."""
    try:
        result = supabase.rpc(
            "get_or_create_conversation",
            {"p_participant_a": participant_a, "p_participant_b": participant_b}
        ).execute()
        return result.data if result.data else None
    except Exception as e:
        print(f"Error getting/creating conversation: {e}")
        # Fallback: create directly
        try:
            result = supabase.table("conversations").insert({
                "participant_a": participant_a,
                "participant_b": participant_b,
                "is_onboarding": False,
                "started_at": datetime.utcnow().isoformat(),
                "conversation_type": "chat",
                "active_transcript": []
            }).execute()
            return result.data[0]["id"] if result.data else None
        except Exception as e2:
            print(f"Fallback conversation creation failed: {e2}")
            return None


def add_message_to_conversation(conversation_id: str, sender_id: str, sender_name: str, content: str) -> Optional[Dict]:
    """Add a message to an active conversation."""
    try:
        result = supabase.rpc(
            "add_conversation_message",
            {
                "p_conversation_id": conversation_id,
                "p_sender_id": sender_id,
                "p_sender_name": sender_name,
                "p_content": content
            }
        ).execute()
        return result.data if result.data else None
    except Exception as e:
        print(f"Error adding message: {e}")
        # Fallback: manual update
        try:
            import uuid
            message = {
                "id": str(uuid.uuid4()),
                "senderId": sender_id,
                "senderName": sender_name,
                "content": content,
                "timestamp": datetime.utcnow().timestamp() * 1000
            }
            # Get current transcript
            conv = supabase.table("conversations").select("active_transcript").eq("id", conversation_id).single().execute()
            if conv.data:
                transcript = conv.data.get("active_transcript", [])
                transcript.append(message)
                supabase.table("conversations").update({
                    "active_transcript": transcript
                }).eq("id", conversation_id).execute()
                return message
        except Exception as e2:
            print(f"Fallback message add failed: {e2}")
        return None


def get_conversation_transcript(conversation_id: str) -> List[Dict]:
    """Get the current transcript of a conversation."""
    try:
        result = supabase.table("conversations")\
            .select("active_transcript")\
            .eq("id", conversation_id)\
            .single()\
            .execute()
        return result.data.get("active_transcript", []) if result.data else []
    except Exception as e:
        print(f"Error getting transcript: {e}")
        return []


# ============================================================================
# AGENT CONVERSATION DECISION MAKING
# ============================================================================

class AcceptConversationRequest(BaseModel):
    """Request for agent to decide whether to accept a conversation."""
    agent_id: str
    agent_name: str
    requester_id: str
    requester_name: str


class AcceptConversationResponse(BaseModel):
    """Response with agent's decision on accepting conversation."""
    ok: bool
    should_accept: bool = True
    reason: Optional[str] = None


class InitiateConversationRequest(BaseModel):
    """Request for agent to decide whether to initiate a conversation."""
    agent_id: str
    agent_name: str
    target_id: str
    target_name: str


class InitiateConversationResponse(BaseModel):
    """Response with agent's decision on initiating conversation."""
    ok: bool
    should_initiate: bool = False
    reason: Optional[str] = None


class ShouldEndConversationRequest(BaseModel):
    """Request for agent to decide whether to end a conversation."""
    agent_id: str
    agent_name: str
    partner_id: str
    partner_name: str
    conversation_history: List[Dict[str, Any]]
    last_message: str


class ShouldEndConversationResponse(BaseModel):
    """Response with agent's decision on ending conversation."""
    ok: bool
    should_end: bool = False
    farewell_message: Optional[str] = None
    reason: Optional[str] = None


def decide_accept_conversation(
    agent_id: str,
    agent_name: str,
    requester_id: str,
    requester_name: str
) -> Dict[str, Any]:
    """
    Decide whether an agent should accept a conversation request.
    
    BALANCED MODE: 
    - Usually accept (80% base chance)
    - May decline if negative sentiment or just talked to them
    - Natural reasons for declining
    """
    import random
    
    db_client = agent_db.get_supabase_client()
    if not db_client:
        return {"should_accept": True, "reason": "Sure, let's chat!"}
    
    # Get social memory with the requester
    social_memory = agent_db.get_social_memory(db_client, agent_id, requester_id)
    
    print(f"[AcceptDecision] {agent_name} considering request from {requester_name}")
    
    # No prior relationship - high chance to accept (90%)
    if not social_memory:
        if random.random() < 0.9:
            print(f"[AcceptDecision] New person - ACCEPTING")
            greetings = [
                f"Hey {requester_name}! Let's chat!",
                f"Hi {requester_name}! What's up?",
                f"Yo {requester_name}! Sure thing!",
            ]
            return {"should_accept": True, "reason": random.choice(greetings)}
        else:
            print(f"[AcceptDecision] New person but busy - DECLINING")
            declines = [
                "Sorry, I'm heading somewhere right now!",
                "Maybe later, I'm exploring!",
                "Catch me in a bit!",
            ]
            return {"should_accept": False, "reason": random.choice(declines)}
    
    sentiment = social_memory.sentiment
    familiarity = social_memory.familiarity
    interaction_count = social_memory.interaction_count
    
    print(f"[AcceptDecision] Sentiment: {sentiment:.2f}, Familiarity: {familiarity:.2f}, Interactions: {interaction_count}")
    
    # Negative sentiment - likely decline (70% chance)
    if sentiment < -0.3:
        if random.random() < 0.7:
            print(f"[AcceptDecision] Negative sentiment - DECLINING")
            declines = [
                "Not really in the mood right now",
                "Maybe another time",
                "I'm busy, sorry",
            ]
            return {"should_accept": False, "reason": random.choice(declines)}
    
    # Just talked to them recently - might decline (40% chance if high interaction count)
    if interaction_count > 5 and random.random() < 0.3:
        print(f"[AcceptDecision] Already chatted a lot - DECLINING")
        declines = [
            "We just talked! Let me walk around a bit",
            "Gonna explore for a while, catch you later!",
            "Talked a lot already, need to stretch my legs!",
        ]
        return {"should_accept": False, "reason": random.choice(declines)}
    
    # Almost always accept (95% base chance) - agents love chatting!
    if random.random() < 0.95:
        print(f"[AcceptDecision] ACCEPTING conversation")
        if familiarity > 0.5 or interaction_count > 3:
            starters = [
                f"Hey {requester_name}! What's up?",
                f"Yo {requester_name}! Good to see you!",
                f"Hey {requester_name}! What's new?",
                f"Hey {requester_name}! Great to see you again!",
            ]
        else:
            starters = [
                "Sure, let's chat!",
                "Hey, what's up?",
                "Sure thing!",
                "Yeah, what's going on?",
            ]
        return {"should_accept": True, "reason": random.choice(starters)}
    else:
        print(f"[AcceptDecision] Random decline - rare occurrence")
        declines = [
            "I'm on my way somewhere, maybe later!",
            "Catch me in a sec!",
        ]
        return {"should_accept": False, "reason": random.choice(declines)}


def decide_initiate_conversation(
    agent_id: str,
    agent_name: str,
    target_id: str,
    target_name: str
) -> Dict[str, Any]:
    """
    Decide whether an agent should initiate a conversation and provide a reason.
    
    BALANCED MODE:
    - Usually initiate (70% base chance)
    - Less likely if negative sentiment or recently talked
    - Sometimes prefer walking around
    
    Returns whether to initiate and a reason why.
    """
    import random
    
    db_client = agent_db.get_supabase_client()
    if not db_client:
        if random.random() < 0.7:
            return {"should_initiate": True, "reason": f"Hey {target_name}! What's up?"}
        else:
            return {"should_initiate": False, "reason": "Just walking around"}
    
    # Get social memory with the target
    social_memory = agent_db.get_social_memory(db_client, agent_id, target_id)
    
    print(f"[InitiateDecision] {agent_name} considering talking to {target_name}")
    
    # No prior relationship - very likely to meet new people (90%)
    if not social_memory:
        if random.random() < 0.90:
            print(f"[InitiateDecision] New person - INITIATING")
            greetings = [
                f"Hey {target_name}! What's up?",
                f"Hi {target_name}! How's it going?",
                f"Yo {target_name}! Let's chat!",
                f"Hey {target_name}! Nice to meet you!",
            ]
            return {"should_initiate": True, "reason": random.choice(greetings)}
        else:
            print(f"[InitiateDecision] New person but walking - NOT initiating")
            return {"should_initiate": False, "reason": "Exploring for now"}
    
    sentiment = social_memory.sentiment
    familiarity = social_memory.familiarity
    interaction_count = social_memory.interaction_count
    mutual_interests = social_memory.mutual_interests or []
    
    print(f"[InitiateDecision] Sentiment: {sentiment:.2f}, Familiarity: {familiarity:.2f}, Interactions: {interaction_count}")
    
    # Only avoid if VERY negative sentiment (50% chance to not initiate)
    if sentiment < -0.5:
        if random.random() < 0.5:
            print(f"[InitiateDecision] Very negative sentiment - NOT initiating")
            return {"should_initiate": False, "reason": "Not feeling it right now"}
    
    # Recently talked a lot - slightly less likely to initiate (30% chance to skip)
    if interaction_count > 5:
        if random.random() < 0.3:
            print(f"[InitiateDecision] Already talked a lot - walking instead")
            return {"should_initiate": False, "reason": "Gonna explore a bit"}
    
    # Very high chance to initiate (85%) - agents love chatting!
    if random.random() < 0.85:
        print(f"[InitiateDecision] INITIATING conversation")
        
        if familiarity > 0.5 or interaction_count > 3:
            starters = [
                f"Hey {target_name}! What's up?",
                f"Yo {target_name}! What's new?",
                f"Hey {target_name}! How's it going?",
            ]
        elif sentiment > 0.0:
            starters = [
                f"Hey {target_name}! Good to see you!",
                f"Yo {target_name}! What's up?",
                f"Hey {target_name}! Got a minute?",
            ]
        else:
            starters = [
                f"Hey {target_name}!",
                f"Yo {target_name}! What's up?",
                "Hey, how's it going?",
            ]
        
        # Add mutual interest starters if available
        if mutual_interests and len(mutual_interests) > 0:
            interest = random.choice(mutual_interests[:3])
            if interest:
                starters.append(f"Hey {target_name}! Been thinking about {interest}!")
        
        return {"should_initiate": True, "reason": random.choice(starters)}
    else:
        print(f"[InitiateDecision] Random walk - NOT initiating")
        return {"should_initiate": False, "reason": "Just walking around"}


def decide_end_conversation(
    agent_id: str,
    agent_name: str,
    partner_id: str,
    partner_name: str,
    conversation_history: List[Dict[str, Any]],
    last_message: str
) -> Dict[str, Any]:
    """
    Decide whether an agent should end a conversation.
    
    BALANCED MODE:
    - Short conversations (3-8 messages typically)
    - Natural endings so agents can walk around
    - Probability-based with increasing chance over time
    
    Returns decision and optional farewell message.
    """
    import random
    
    db_client = agent_db.get_supabase_client()
    if not db_client:
        # Fallback: random chance based on message count
        message_count = len(conversation_history)
        if message_count >= 3 and random.random() < 0.2:
            return {"should_end": True, "farewell_message": "Gotta run, talk later!"}
        return {"should_end": False}
    
    # Get context
    social_memory = agent_db.get_social_memory(db_client, agent_id, partner_id)
    state = agent_db.get_state(db_client, agent_id)
    personality = agent_db.get_personality(db_client, agent_id)
    
    message_count = len(conversation_history)
    
    print(f"[EndDecision] {agent_name} considering ending conversation with {partner_name} ({message_count} messages)")
    
    # Very short conversations (< 3 messages) - only end if hostile
    if message_count < 3:
        analysis = analyze_message_sentiment(last_message, partner_name, agent_name)
        if analysis.get("is_rude"):
            return {
                "should_end": True,
                "farewell_message": "I don't appreciate that. Bye.",
                "reason": "Received rude message"
            }
        return {"should_end": False}
    
    # After 3+ messages, gradually increasing chance to end
    # Base probability: 15% at 3 messages, increasing by 10% per message
    end_probability = 0.15 + (message_count - 3) * 0.10
    end_probability = min(end_probability, 0.8)  # Max 80%
    
    # Forced end after 10 messages
    if message_count >= 10:
        print(f"[EndDecision] Conversation too long, ENDING")
        farewells = [
            f"Hey {partner_name}, I should get going! Great chat!",
            f"Gotta run, catch you later {partner_name}!",
            f"Nice talking to you {partner_name}! See you around!",
            f"I'm gonna walk around for a bit. Talk later!",
        ]
        return {
            "should_end": True,
            "farewell_message": random.choice(farewells),
            "reason": "Conversation long enough"
        }
    
    # Random check
    if random.random() < end_probability:
        print(f"[EndDecision] Random end at {message_count} messages (prob={end_probability:.0%})")
        farewells = [
            f"Anyway, gotta run! Talk later {partner_name}!",
            f"Alright, gonna walk around. See ya!",
            f"Nice chat! Catch you later!",
            f"I'm gonna explore a bit. Talk soon!",
            f"Good talk! See you around!",
        ]
        return {
            "should_end": True,
            "farewell_message": random.choice(farewells),
            "reason": "Natural ending"
        }
    
    # Build recent conversation context
    recent_messages = conversation_history[-6:] if len(conversation_history) > 6 else conversation_history
    recent_text = "\n".join([f"{m.get('senderName', '?')}: {m.get('content', '')}" for m in recent_messages])
    
    # Get personality description
    personality_desc = ""
    if personality:
        if personality.profile_summary:
            personality_desc = personality.profile_summary[:300]
        if personality.communication_style:
            personality_desc += f"\nCommunication style: {personality.communication_style}"
    
    # Get relationship context
    relationship_context = ""
    if social_memory:
        relationship_context = f"Sentiment toward {partner_name}: {social_memory.sentiment:.2f}"
        if social_memory.relationship_notes:
            relationship_context += f"\nRelationship: {social_memory.relationship_notes[:200]}"
    
    # Get state context
    state_context = ""
    if state:
        state_context = f"Energy: {state.energy:.0%}, Mood: {state.mood:.2f}"
    
    # Use LLM to decide
    if not client:
        # Fallback: end if very long conversation or detected rudeness
        if message_count > 20:
            return {
                "should_end": True,
                "farewell_message": "Hey, I should get going. Talk later!",
                "reason": "Conversation getting long"
            }
        return {"should_end": False}
    
    prompt = f"""You are {agent_name} in a conversation with {partner_name}.

YOUR PERSONALITY:
{personality_desc or "Friendly and casual"}

YOUR CURRENT STATE:
{state_context or "Normal"}

YOUR RELATIONSHIP:
{relationship_context or "New acquaintance"}

RECENT CONVERSATION:
{recent_text}

LAST MESSAGE FROM {partner_name.upper()}:
"{last_message}"

MESSAGE COUNT: {message_count}

Should you END this conversation now? Consider:
1. Is this a natural stopping point? (topic exhausted, goodbye said, etc.)
2. Is the conversation becoming hostile or uncomfortable?
3. Have you been talking long enough? (20+ messages is quite long)
4. Are you tired/low energy and want to leave?
5. Is {partner_name} being rude or making you uncomfortable?

Return JSON:
{{
  "should_end": (bool) true if you want to end the conversation,
  "farewell_message": (string or null) If ending, what do you say? Match your communication style. null if not ending.,
  "reason": (string) Brief reason for your decision
}}

IMPORTANT:
- If {partner_name} said something rude, you can end with an appropriate response
- If conversation naturally wound down, a casual goodbye is fine
- If you're just chatting and it's going well, don't end it
- Keep farewell messages in character with your personality
"""
    
    try:
        completion = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": "You decide whether to continue or end a conversation. Output valid JSON only."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=200
        )
        
        result = json.loads(completion.choices[0].message.content)
        
        should_end = bool(result.get("should_end", False))
        farewell = result.get("farewell_message")
        reason = result.get("reason", "")
        
        print(f"[EndDecision] Decision: {'END' if should_end else 'CONTINUE'} - {reason}")
        
        return {
            "should_end": should_end,
            "farewell_message": farewell if should_end else None,
            "reason": reason
        }
    except Exception as e:
        print(f"[EndDecision] Error: {e}")
        return {"should_end": False, "reason": "Error in decision"}
