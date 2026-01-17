import os
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from app.main import app

# Mock dependencies
# We mock Supabase to avoid real DB calls and Auth checks for the unit test
# But to test integration, we might want real DB calls.
# Given the user wants to test "it works", they probably mean "end-to-end".
# But without a valid JWT, we can't hit the endpoint unless we mock `get_current_user`.

def test_onboarding_chat_flow():
    # Mock the user dependency
    mock_user = MagicMock()
    mock_user.id = "test-user-id"
    
    # We need to override the dependency
    from app.onboarding import get_current_user
    app.dependency_overrides[get_current_user] = lambda: mock_user

    client = TestClient(app)

    # 1. Get State (should be empty initially or mocked)
    # We need to mock supabase calls inside onboarding.py if we don't have a real DB running
    # OR we rely on the real DB if the user has it set up.
    # Let's assume the user has the DB set up.
    
    # We can't easily mock the internal supabase client without patching.
    # Let's try to hit the endpoint and see if we get 401 (auth) or 200 (if we override auth).
    
    print("Testing /onboarding/chat...")
    response = client.post(
        "/onboarding/chat",
        json={"message": "Hello, I am ready.", "conversation_id": None}
    )
    
    if response.status_code == 200:
        print("Success! Response:", response.json())
    else:
        print(f"Failed: {response.status_code} - {response.text}")

if __name__ == "__main__":
    test_onboarding_chat_flow()
