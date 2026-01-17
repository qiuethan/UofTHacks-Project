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

MODEL_NAME = "xiaomi/mimo-v2-flash:free"

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
    You are a friendly, casual interviewer for a virtual world called 'Avatar World'. 
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
    
    # 2. Generate Memory Summary
    summary_prompt = f"""
    Analyze the following onboarding transcript for user '{user.id}'.
    
    Transcript:
    {json.dumps(transcript)}
    
    Task:
    1. Extract key facts (Name, Job, Hobbies, etc.).
    2. Analyze their speaking style (Formal/Casual, Emoji usage, Length).
    3. Create a concise summary paragraph.
    
    Output JSON:
    {{
      "facts": {{ ... }},
      "style": "...",
      "summary": "..."
    }}
    """
    
    try:
        completion = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": "You are a helpful assistant that outputs JSON."},
                {"role": "user", "content": summary_prompt}
            ],
            response_format={"type": "json_object"}
        )
        content = completion.choices[0].message.content
        summary_data = json.loads(content)
        summary_text = summary_data.get("summary", "New user joined the world.")
    except Exception as e:
        print(f"Summary generation failed: {e}")
        summary_text = "User completed onboarding."

    # 3. Save Memory
    supabase.table("memories").insert({
        "conversation_id": req.conversation_id,
        "owner_id": user.id,
        "partner_id": None, 
        "summary": summary_text,
        "conversation_score": 10
    }).execute()

    # 4. Update User Metadata
    try:
        supabase.auth.admin.update_user_by_id(
            user.id,
            {"user_metadata": {"onboarding_completed": True}}
        )
    except Exception as e:
        print(f"Failed to update user metadata: {e}")
        # Note: If service key is invalid/missing rights, this fails.
        raise HTTPException(status_code=500, detail="Failed to finalize onboarding.")

    return {"ok": True}