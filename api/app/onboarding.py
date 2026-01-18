import json
import os
from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from openai import OpenAI

from .models import OnboardingChatRequest, OnboardingChatResponse, OnboardingStateResponse, OnboardingCompleteRequest
from .supabase_client import supabase

router = APIRouter(prefix="/onboarding", tags=["onboarding"])

# Load questions
QUESTIONS_PATH = Path(__file__).parent.parent / "data" / "questions.json"
try:
    with open(QUESTIONS_PATH, "r") as f:
        QUESTIONS = json.load(f)
except Exception as e:
    print(f"Error loading questions: {e}")
    QUESTIONS = []

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
if not OPENROUTER_API_KEY:
    print("Warning: OPENROUTER_API_KEY not set. Onboarding chat will fail.")

client = None
if OPENROUTER_API_KEY:
    try:
        client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=OPENROUTER_API_KEY,
        )
    except Exception as e:
        print(f"Failed to init OpenAI/OpenRouter client: {e}")

# Use Grok-4-fast for good quality with better speed
MODEL_NAME = "x-ai/grok-4-fast"

async def get_current_user(request: Request):
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    
    token = auth_header.replace("Bearer ", "")
    try:
        user_response = supabase.auth.get_user(token)
        if not user_response.user:
             raise HTTPException(status_code=401, detail="Invalid token")
        return user_response.user
    except Exception as e:
        print(f"Auth error: {e}")
        raise HTTPException(status_code=401, detail="Invalid authentication")

@router.get("/state", response_model=OnboardingStateResponse)
async def get_onboarding_state(user = Depends(get_current_user)):
    # Find active onboarding conversation
    response = supabase.table("conversations")\
        .select("*")\
        .eq("participant_a", user.id)\
        .eq("is_onboarding", True)\
        .order("created_at", desc=True)\
        .limit(1)\
        .execute()
    
    if response.data:
        conv = response.data[0]
        return {
            "history": conv.get("transcript", []),
            "conversation_id": conv["id"],
            "is_completed": False
        }
    
    return {
        "history": [],
        "conversation_id": None,
        "is_completed": False
    }

@router.post("/chat", response_model=OnboardingChatResponse)
async def chat_onboarding(req: OnboardingChatRequest, user = Depends(get_current_user)):
    if not client:
        raise HTTPException(status_code=503, detail="AI service unavailable")

    conversation_id = req.conversation_id
    transcript = []

    # 1. Retrieve or Create Conversation
    if conversation_id:
        res = supabase.table("conversations").select("*").eq("id", conversation_id).single().execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Conversation not found")
        if res.data["participant_a"] != user.id:
            raise HTTPException(status_code=403, detail="Not your conversation")
        transcript = res.data.get("transcript", [])
    else:
        res = supabase.table("conversations")\
            .select("*")\
            .eq("participant_a", user.id)\
            .eq("is_onboarding", True)\
            .order("created_at", desc=True)\
            .limit(1)\
            .execute()
        
        if res.data:
            conv = res.data[0]
            conversation_id = conv["id"]
            transcript = conv.get("transcript", [])
        else:
            new_conv = supabase.table("conversations").insert({
                "participant_a": user.id,
                "is_onboarding": True,
                "transcript": []
            }).execute()
            conversation_id = new_conv.data[0]["id"]
            transcript = []

    # 2. Append User Message
    if req.message != "[START]":
        user_msg_obj = {"role": "user", "content": req.message}
        transcript.append(user_msg_obj)

    # 3. Construct LLM Prompt
    system_instruction = f"""
    You are a friendly, casual interviewer for a virtual world called 'Identity Matrix'. 
    Your goal is to welcome the new user and get to know them by getting answers to the following questions.
    
    REQUIRED QUESTIONS:
    {json.dumps(QUESTIONS, indent=2)}
    
    INSTRUCTIONS:
    1. Ask these questions ONE BY ONE. Do not dump them all at once.
    2. Maintain a conversational flow. React to their answers (e.g., "Oh, that's cool!", "I love pizza too!").
    3. You can change the order if it flows better, but ensure all are covered eventually.
    4. Keep your responses concise (1-2 sentences usually).
    5. If the user asks you questions, answer briefly and steer back to the interview.
    6. When you are satisfied that you have answers to ALL specific questions (or the user has declined to answer enough times), 
       you MUST signal completion by calling the 'end_interview' tool.
    7. IMPORTANT: Use plain text only. Do not use any markdown formatting such as bold, italics, bullet points, numbered lists, or any other formatting. Write naturally as if texting a friend.
    
    Current Progress:
    Review the transcript below. See which questions have been answered. Ask the next one.
    """

    messages = [{"role": "system", "content": system_instruction}]
    # Append transcript messages
    # Ensure roles are 'user' or 'assistant'. OpenRouter/OpenAI expects 'assistant' not 'model'.
    for msg in transcript:
        # My transcript uses 'assistant' internally, so it's fine.
        messages.append(msg)

    # Define the tool
    tools = [
        {
            "type": "function",
            "function": {
                "name": "end_interview",
                "description": "Call this when all questions have been answered to finish the onboarding.",
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "required": []
                }
            }
        }
    ]

    try:
        completion = client.chat.completions.create(
            model=MODEL_NAME,
            messages=messages,
            tools=tools,
            tool_choice="auto"
        )
    except Exception as e:
        print(f"OpenRouter API Error: {e}")
        return OnboardingChatResponse(
            response="I'm having a bit of trouble connecting to my brain right now. Can you say that again?",
            conversation_id=conversation_id,
            status="active"
        )

    # 5. Process Response
    ai_text = ""
    status = "active"
    
    response_message = completion.choices[0].message
    
    # Check for tool calls
    if response_message.tool_calls:
        # Check if it's the right tool
        for tool_call in response_message.tool_calls:
            if tool_call.function.name == "end_interview":
                status = "completed"
                ai_text = "Thanks! That's everything I needed. Enjoy the world!"
                break
    
    if status != "completed":
        ai_text = response_message.content or "Hmm, I didn't catch that."

    # 6. Save AI Response
    ai_msg_obj = {"role": "assistant", "content": ai_text}
    transcript.append(ai_msg_obj)
    
    supabase.table("conversations").update({
        "transcript": transcript,
        "updated_at": "now()"
    }).eq("id", conversation_id).execute()

    return OnboardingChatResponse(
        response=ai_text,
        conversation_id=conversation_id,
        status=status
    )

@router.post("/complete")
async def complete_onboarding(req: OnboardingCompleteRequest, user = Depends(get_current_user)):
    if not client:
        raise HTTPException(status_code=503, detail="AI service unavailable")

    # 1. Fetch Transcript
    res = supabase.table("conversations").select("*").eq("id", req.conversation_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    conversation = res.data
    transcript = conversation.get("transcript", [])
    
    # 2. Generate Memory Summary with detailed analysis
    # In the transcript, "user" role = the owner (the person being onboarded)
    # "assistant" role = the AI interviewer (partner)
    summary_prompt = f"""
    Analyze the following onboarding conversation transcript in detail.
    
    IMPORTANT: In this transcript:
    - Messages with role "user" are from the OWNER (the person being interviewed/onboarded) - user ID: '{user.id}'
    - Messages with role "assistant" are from the AI interviewer (the partner/system)
    
    Transcript:
    {json.dumps(transcript)}
    
    Perform a comprehensive analysis:
    
    1. CONVERSATION SUMMARY (conversation_summary):
       - What topics were discussed?
       - What questions were asked and answered?
       - Key information exchanged during the conversation
       - Keep it factual and comprehensive (2-4 sentences)
    
    2. PERSON ANALYSIS (person_summary):
       Analyze the OWNER's (user role) texting patterns and personality in detail:
       - Communication style: Are they formal or casual? Do they use complete sentences or fragments?
       - Emoji/punctuation usage: Do they use emojis, exclamation marks, abbreviations?
       - Response length: Are they brief and concise or elaborate and detailed?
       - Personality traits: Are they enthusiastic, reserved, humorous, sarcastic, friendly?
       - Vocabulary: Simple or sophisticated? Any unique phrases or expressions?
       - Topics they seem passionate about based on their responses
       - Any notable quirks or patterns in how they communicate
       Write this as a detailed paragraph about who this person is based on how they text (3-5 sentences)
    
    3. OWNER QUOTES (owner_quotes):
       Extract exactly 3 important or representative quotes from the OWNER (messages with role "user" only).
       Choose quotes that:
       - Reveal something about their personality or interests
       - Are memorable or characteristic of how they communicate
       - Provide insight into who they are
       Only include the exact text they wrote, nothing from the assistant.
    
    4. WORLD AFFINITIES (world_affinities):
       Based on the user's answers about their preferences, rate their affinity for each world location type.
       Score each from 0.0 to 1.0:
       
       - "food": How much do they like food, cafes, eating out, cooking? 
         High (0.7-1.0): Foodie, loves cafes, cooking enthusiast, mentions favorite foods with passion
         Medium (0.4-0.7): Casual interest in food, mentions eating but not a focus
         Low (0.0-0.4): Doesn't mention food much, or prefers to eat quickly
       
       - "karaoke": How much do they enjoy music, singing, performing, karaoke?
         High (0.7-1.0): Music lover, would do karaoke, enjoys singing, mentions bands/artists passionately
         Medium (0.4-0.7): Likes music casually, might sing along but not perform
         Low (0.0-0.4): Not interested in performing, doesn't mention music
       
       - "rest_area": How much do they value rest, relaxation, quiet time?
         High (0.7-1.0): Values alone time, mentions needing rest, prefers quiet, introverted tendencies
         Medium (0.4-0.7): Balanced between activity and rest
         Low (0.0-0.4): Always active, doesn't mention needing downtime
       
       - "social_hub": How social are they? Do they enjoy crowds, meeting people?
         High (0.7-1.0): Social butterfly, loves meeting people, mentions parties, hangouts
         Medium (0.4-0.7): Enjoys some socializing but also alone time
         Low (0.0-0.4): Prefers solitude, avoids crowds, introverted
       
       - "wander_point": Do they enjoy outdoors, walking, exploring, nature?
         High (0.7-1.0): Loves outdoors, hiking, walking, gardens, nature, exploring
         Medium (0.4-0.7): Occasionally enjoys outdoors
         Low (0.0-0.4): Indoor person, doesn't mention outdoor activities
    
    Output JSON:
    {{
      "conversation_summary": "Factual summary of what was discussed...",
      "person_summary": "Detailed analysis of the owner's personality and communication style...",
      "owner_quotes": ["quote1", "quote2", "quote3"],
      "facts": {{
        "name": "...",
        "occupation": "...",
        "hobbies": ["..."],
        "favorite_food": "...",
        "music_preferences": "...",
        "other_details": {{}}
      }},
      "communication_style": {{
        "formality": "casual/formal/mixed",
        "emoji_usage": "none/light/heavy",
        "response_length": "brief/moderate/detailed",
        "tone": "description of their overall communication tone"
      }},
      "personality_traits": ["list of personality traits observed like: friendly, curious, sarcastic, etc."],
      "interests": ["list of hobbies and interests they mentioned"],
      "conversation_topics": ["topics they mentioned enjoying or wanting to discuss"],
      "personality_scores": {{
        "sociability": 0.0 to 1.0 (how social/extroverted they seem),
        "curiosity": 0.0 to 1.0 (how curious/exploratory they are),
        "agreeableness": 0.0 to 1.0 (how agreeable/friendly they are),
        "energy_baseline": 0.0 to 1.0 (their natural energy level)
      }},
      "world_affinities": {{
        "food": 0.0 to 1.0 (affinity for cafes, food, eating),
        "karaoke": 0.0 to 1.0 (affinity for music, singing, performing),
        "rest_area": 0.0 to 1.0 (affinity for rest, quiet, relaxation),
        "social_hub": 0.0 to 1.0 (affinity for socializing, crowds, meeting people),
        "wander_point": 0.0 to 1.0 (affinity for outdoors, walking, exploring)
      }}
    }}
    """
    
    try:
        completion = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": "You are an expert at analyzing conversations and understanding people through their communication patterns. You output detailed, insightful JSON analysis."},
                {"role": "user", "content": summary_prompt}
            ],
            response_format={"type": "json_object"}
        )
        content = completion.choices[0].message.content
        summary_data = json.loads(content)
        
        conversation_summary = summary_data.get("conversation_summary", "New user joined the world.")
        person_summary = summary_data.get("person_summary", "User completed onboarding.")
        owner_quotes = summary_data.get("owner_quotes", [])
        
        # Ensure we have exactly 3 quotes (or pad with empty if not enough)
        if len(owner_quotes) < 3:
            owner_quotes.extend([""] * (3 - len(owner_quotes)))
        elif len(owner_quotes) > 3:
            owner_quotes = owner_quotes[:3]
            
    except Exception as e:
        print(f"Summary generation failed: {e}")
        conversation_summary = "User completed onboarding conversation."
        person_summary = "User completed onboarding."
        owner_quotes = []

    # 3. Save Memory with enhanced fields
    supabase.table("memories").insert({
        "conversation_id": req.conversation_id,
        "owner_id": user.id,
        "partner_id": None, 
        "summary": conversation_summary,  # Keep for backwards compatibility
        "conversation_summary": conversation_summary,
        "person_summary": person_summary,
        "owner_quotes": owner_quotes,
        "conversation_score": 10
    }).execute()

    # 4. Update agent_personality with onboarding data
    try:
        # Extract personality data from analysis
        personality_traits = summary_data.get("personality_traits", [])
        interests = summary_data.get("interests", [])
        conversation_topics = summary_data.get("conversation_topics", [])
        comm_style = summary_data.get("communication_style", {})
        personality_scores = summary_data.get("personality_scores", {})
        facts = summary_data.get("facts", {})
        
        # Build communication style string
        comm_style_str = ""
        if comm_style:
            parts = []
            if comm_style.get("formality"):
                parts.append(f"Formality: {comm_style['formality']}")
            if comm_style.get("emoji_usage"):
                parts.append(f"Emoji usage: {comm_style['emoji_usage']}")
            if comm_style.get("response_length"):
                parts.append(f"Response length: {comm_style['response_length']}")
            if comm_style.get("tone"):
                parts.append(f"Tone: {comm_style['tone']}")
            comm_style_str = ". ".join(parts)
        
        # Build personality notes
        personality_notes = ""
        if personality_traits:
            personality_notes = f"Traits: {', '.join(personality_traits)}"
        if facts.get("occupation"):
            personality_notes += f". Occupation: {facts['occupation']}"
        if facts.get("name"):
            personality_notes += f". Preferred name: {facts['name']}"
        
        # Get personality scores with defaults
        sociability = float(personality_scores.get("sociability", 0.5))
        curiosity = float(personality_scores.get("curiosity", 0.5))
        agreeableness = float(personality_scores.get("agreeableness", 0.5))
        energy_baseline = float(personality_scores.get("energy_baseline", 0.5))
        
        # Clamp values to valid range
        sociability = max(0.0, min(1.0, sociability))
        curiosity = max(0.0, min(1.0, curiosity))
        agreeableness = max(0.0, min(1.0, agreeableness))
        energy_baseline = max(0.0, min(1.0, energy_baseline))
        
        # Extract world affinities from analysis (determines where agent likes to go)
        world_affinities_raw = summary_data.get("world_affinities", {})
        world_affinities = {
            "food": max(0.0, min(1.0, float(world_affinities_raw.get("food", 0.5)))),
            "karaoke": max(0.0, min(1.0, float(world_affinities_raw.get("karaoke", 0.5)))),
            "rest_area": max(0.0, min(1.0, float(world_affinities_raw.get("rest_area", 0.5)))),
            "social_hub": max(0.0, min(1.0, float(world_affinities_raw.get("social_hub", 0.5)))),
            "wander_point": max(0.0, min(1.0, float(world_affinities_raw.get("wander_point", 0.5))))
        }
        
        # Upsert to agent_personality
        personality_data = {
            "avatar_id": user.id,
            "sociability": sociability,
            "curiosity": curiosity,
            "agreeableness": agreeableness,
            "energy_baseline": energy_baseline,
            "profile_summary": person_summary[:2000] if person_summary else None,
            "communication_style": comm_style_str[:500] if comm_style_str else None,
            "interests": json.dumps(interests) if interests else None,
            "conversation_topics": json.dumps(conversation_topics) if conversation_topics else None,
            "personality_notes": personality_notes[:1000] if personality_notes else None,
            "world_affinities": json.dumps(world_affinities)
        }
        
        supabase.table("agent_personality").upsert(personality_data).execute()
        print(f"[onboarding] Saved personality data for {user.id}")
        print(f"[onboarding] Personality scores: sociability={sociability:.2f}, curiosity={curiosity:.2f}, agreeableness={agreeableness:.2f}, energy={energy_baseline:.2f}")
        print(f"[onboarding] Interests: {interests}")
        print(f"[onboarding] Conversation topics: {conversation_topics}")
        print(f"[onboarding] World affinities: {world_affinities}")
        
        # Also initialize agent_state with HEALTHY defaults (100% stats)
        # All users start fully rested, not hungry, social, and happy
        existing_state = supabase.table("agent_state").select("*").eq("avatar_id", user.id).execute()
        if not existing_state.data:
            supabase.table("agent_state").insert({
                "avatar_id": user.id,
                "energy": 1.0,      # Fully rested - 100%
                "hunger": 0.0,      # Not hungry at all - 0%
                "loneliness": 0.0,  # Not lonely at all - 0%
                "mood": 1.0,        # Great mood - 100%
                "current_action": "idle"
            }).execute()
            print(f"[onboarding] Initialized agent state for {user.id} (100% healthy)")
        else:
            # Reset existing state to healthy defaults as well
            supabase.table("agent_state").update({
                "energy": 1.0,
                "hunger": 0.0,
                "loneliness": 0.0,
                "mood": 1.0
            }).eq("avatar_id", user.id).execute()
            print(f"[onboarding] Reset agent state to healthy for {user.id}")
        
    except Exception as e:
        print(f"[onboarding] Error saving personality data: {e}")
        # Don't fail the whole onboarding if personality save fails

    # 5. Update User Metadata
    try:
        print(f"[onboarding] Attempting to update user metadata for user {user.id}")
        result = supabase.auth.admin.update_user_by_id(
            user.id,
            {"user_metadata": {"onboarding_completed": True}}
        )
        print(f"[onboarding] User metadata update result: {result}")
    except Exception as e:
        print(f"[onboarding] Failed to update user metadata: {type(e).__name__}: {e}")
        # Note: If service key is invalid/missing rights, this fails.
        raise HTTPException(status_code=500, detail=f"Failed to finalize onboarding: {str(e)}")

    return {"ok": True}