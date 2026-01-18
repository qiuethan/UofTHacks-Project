#!/usr/bin/env python3
"""
Reset all agent states to 100% healthy stats.

This fixes the issue where agents were initialized with low energy
and keep saying "I'm wiped" or "I'm tired".

Run this once to reset all existing agents.
"""

import os
import sys

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.supabase_client import supabase


def reset_all_agent_stats():
    """Reset all agent states to healthy defaults (100%)."""
    
    print("Fetching all agent states...")
    
    # Get all agent states
    result = supabase.table("agent_state").select("*").execute()
    
    if not result.data:
        print("No agent states found.")
        return
    
    print(f"Found {len(result.data)} agents to reset.")
    
    for agent in result.data:
        avatar_id = agent["avatar_id"]
        old_energy = agent.get("energy", 0)
        old_hunger = agent.get("hunger", 0)
        old_loneliness = agent.get("loneliness", 0)
        old_mood = agent.get("mood", 0)
        
        print(f"\n{avatar_id[:8]}...")
        print(f"  Old: E:{old_energy:.2f} H:{old_hunger:.2f} L:{old_loneliness:.2f} M:{old_mood:.2f}")
        
        # Reset to healthy defaults
        supabase.table("agent_state").update({
            "energy": 1.0,      # Fully rested
            "hunger": 0.0,      # Not hungry
            "loneliness": 0.0,  # Not lonely
            "mood": 1.0         # Great mood
        }).eq("avatar_id", avatar_id).execute()
        
        print(f"  New: E:1.00 H:0.00 L:0.00 M:1.00")
    
    print(f"\n✅ Reset {len(result.data)} agents to 100% healthy stats!")


if __name__ == "__main__":
    reset_all_agent_stats()

