import os
import sys
from dotenv import load_dotenv
from supabase import create_client

# Load env vars
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("Error: SUPABASE_URL or SUPABASE_SERVICE_KEY not set in .env")
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

def reset_user(email: str):
    print(f"Resetting onboarding for {email}...")

    # 1. Get User ID
    # Admin list_users is the way, but might be slow if many users.
    # Alternative: Sign in as them? No.
    # We can query user_positions if it exists to get ID, or just iterate.
    # Actually, supabase-py admin client usually has `list_users`.
    
    try:
        # Note: listing users might be paginated.
        # Ideally we'd have a get_user_by_email admin function but it's not always exposed in py client.
        # Let's try to query our `user_positions` table first as a shortcut if they have a position.
        
        # Strategy A: Use RPC if available? No.
        # Strategy B: List users (limit 100) and find email.
        
        users_response = supabase.auth.admin.list_users()
        target_user = None
        for u in users_response:
            if u.email == email:
                target_user = u
                break
        
        if not target_user:
            print(f"User {email} not found in first page of users.")
            return

        user_id = target_user.id
        print(f"Found User ID: {user_id}")

        # 2. Delete Conversations
        # is_onboarding = true AND participant_a = user_id
        res = supabase.table("conversations").delete().eq("participant_a", user_id).eq("is_onboarding", True).execute()
        print(f"Deleted {len(res.data)} onboarding conversations.")

        # 3. Delete Memories (Optional, but good for clean slate)
        # owner_id = user_id
        res_mem = supabase.table("memories").delete().eq("owner_id", user_id).execute()
        print(f"Deleted {len(res_mem.data)} memories.")

        # 4. Reset Metadata
        supabase.auth.admin.update_user_by_id(
            user_id,
            {"user_metadata": {"onboarding_completed": False}}
        )
        print("Reset 'onboarding_completed' to False.")
        
        print("------------------------------------------------")
        print("✅ Reset Complete! You can now log in and restart onboarding.")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python reset_user.py <email>")
    else:
        reset_user(sys.argv[1])
