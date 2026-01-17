-- Add facing direction to user_positions
ALTER TABLE user_positions 
ADD COLUMN facing_x INTEGER NOT NULL DEFAULT 0,
ADD COLUMN facing_y INTEGER NOT NULL DEFAULT 1;
