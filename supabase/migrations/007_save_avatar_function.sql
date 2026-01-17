-- Create a function to save avatar data (bypasses schema cache issues)
-- This function is called from the frontend via supabase.rpc()

CREATE OR REPLACE FUNCTION save_user_avatar(
  p_user_id UUID,
  p_display_name TEXT,
  p_sprite_front TEXT DEFAULT NULL,
  p_sprite_back TEXT DEFAULT NULL,
  p_sprite_left TEXT DEFAULT NULL,
  p_sprite_right TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify the caller is the same user (security check)
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Not authorized to update this user';
  END IF;

  -- Check if user already has a row
  IF EXISTS (SELECT 1 FROM user_positions WHERE user_id = p_user_id) THEN
    -- Update existing row
    UPDATE user_positions
    SET 
      display_name = p_display_name,
      sprite_front = p_sprite_front,
      sprite_back = p_sprite_back,
      sprite_left = p_sprite_left,
      sprite_right = p_sprite_right,
      has_avatar = true,
      updated_at = NOW()
    WHERE user_id = p_user_id;
  ELSE
    -- Insert new row with random starting position
    INSERT INTO user_positions (
      user_id, x, y, display_name, 
      sprite_front, sprite_back, sprite_left, sprite_right,
      has_avatar, facing_x, facing_y, updated_at
    ) VALUES (
      p_user_id,
      floor(random() * 20 + 5)::int,
      floor(random() * 15 + 5)::int,
      p_display_name,
      p_sprite_front, p_sprite_back, p_sprite_left, p_sprite_right,
      true, 0, 1, NOW()
    );
  END IF;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION save_user_avatar TO authenticated;

-- Also reload the schema cache
NOTIFY pgrst, 'reload schema';
