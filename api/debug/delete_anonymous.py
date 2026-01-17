"""
Delete Anonymous user from all Supabase tables.
This script removes any user with display_name = 'Anonymous' from:
- user_positions
- conversations
- memories
"""

import os
import sys
from dotenv import load_dotenv
from supabase import create_client

# Load env vars from parent directory
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("Error: SUPABASE_URL or SUPABASE_SERVICE_KEY not set in .env")
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

def delete_anonymous_users():
    print("=" * 50)
    print("Deleting Anonymous users from all tables...")
    print("=" * 50)
    
    try:
        # 1. Find all users with display_name = 'Anonymous' or NULL/empty display_name
        print("\n[1] Finding Anonymous users in user_positions...")
        
        result = supabase.table("user_positions").select("user_id, display_name, has_avatar").or_(
            "display_name.eq.Anonymous,display_name.is.null,display_name.eq."
        ).execute()
        
        if not result.data:
            print("No Anonymous users found.")
            return
        
        print(f"Found {len(result.data)} users to delete:")
        for user in result.data:
            name = user.get('display_name') or '(no name)'
            has_avatar = user.get('has_avatar', False)
            print(f"  - {name} | has_avatar: {has_avatar} | id: {user['user_id'][:8]}...")
        
        # Confirm deletion
        confirm = input("\nProceed with deletion? (yes/no): ")
        if confirm.lower() != 'yes':
            print("Aborted.")
            return
        
        user_ids = [user['user_id'] for user in result.data]
        
        # 2. Delete from conversations
        print("\n[2] Deleting from conversations table...")
        for user_id in user_ids:
            res = supabase.table("conversations").delete().or_(
                f"participant_a.eq.{user_id},participant_b.eq.{user_id}"
            ).execute()
            if res.data:
                print(f"  Deleted {len(res.data)} conversation(s) for {user_id[:8]}...")
        
        # 3. Delete from memories
        print("\n[3] Deleting from memories table...")
        for user_id in user_ids:
            res = supabase.table("memories").delete().or_(
                f"owner_id.eq.{user_id},about_user_id.eq.{user_id}"
            ).execute()
            if res.data:
                print(f"  Deleted {len(res.data)} memory(ies) for {user_id[:8]}...")
        
        # 4. Delete from user_positions
        print("\n[4] Deleting from user_positions table...")
        for user_id in user_ids:
            res = supabase.table("user_positions").delete().eq("user_id", user_id).execute()
            if res.data:
                print(f"  Deleted user_position for {user_id[:8]}...")
        
        print("\n" + "=" * 50)
        print("✅ Deletion complete!")
        print("=" * 50)
        
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()

def delete_user_by_name(display_name: str):
    """Delete a specific user by display name."""
    print(f"\nDeleting user with display_name: '{display_name}'...")
    
    try:
        # Find user
        result = supabase.table("user_positions").select("user_id, display_name").eq(
            "display_name", display_name
        ).execute()
        
        if not result.data:
            print(f"User '{display_name}' not found.")
            return
        
        user_id = result.data[0]['user_id']
        print(f"Found user_id: {user_id}")
        
        # Delete from all tables
        tables_to_clean = [
            ("conversations", ["participant_a", "participant_b"]),
            ("memories", ["owner_id", "about_user_id"]),
            ("user_positions", ["user_id"])
        ]
        
        for table, columns in tables_to_clean:
            for col in columns:
                try:
                    res = supabase.table(table).delete().eq(col, user_id).execute()
                    if res.data:
                        print(f"  Deleted {len(res.data)} row(s) from {table}.{col}")
                except Exception as e:
                    print(f"  Warning: Could not delete from {table}.{col}: {e}")
        
        print(f"\n✅ User '{display_name}' deleted successfully!")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        # Delete specific user by name
        delete_user_by_name(sys.argv[1])
    else:
        # Delete all Anonymous users
        delete_anonymous_users()
