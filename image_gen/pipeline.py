"""
Pixel Art Sprite Sheet Generation Pipeline using Nano Banana (Gemini 2.5 Flash)

This pipeline generates Pokemon GBA-style pixel art sprite sheets from photos,
then extracts individual direction views with transparent backgrounds.
"""

import os
import io
import time
from pathlib import Path
from datetime import datetime
from PIL import Image
from google import genai
from google.genai import types
from google.genai.errors import ServerError
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Default input image path
DEFAULT_INPUT_IMAGE = Path(__file__).parent / "image_examples" / "william.png"

# Model priority list (primary + fallbacks)
# 1. Nano Banana Pro (Gemini 3 Pro Image) - Best quality
# 2. Nano Banana (Gemini 2.5 Flash Image) - Good quality fallback
# 3. Gemini 2.0 Flash Experimental - Stable fallback
GOOGLE_MODELS = [
    "gemini-3-pro-image-preview",      # Nano Banana Pro (primary)
    "gemini-2.5-flash-image",          # Nano Banana (fallback 1)
    "gemini-2.0-flash-exp",            # Fallback 2
]

# The exact prompt as specified (word for word)
SPRITE_SHEET_PROMPT = """Generate one pixel-art sprite sheet PNG from the provided single-person photo in a Pokemon GBA overworld sprite style.

## ABSOLUTE DETERMINISM (NO VARIATION)
- All 16 frames must be structurally identical across runs: same grid, same anchors, same character scale, same occupied pixel area, same direction per row.
- No randomness, no reinterpretation, no diagonal views, no direction flipping.

## CANVAS + GRID (LOCKED)
- Canvas: 256x256 px
- Grid: 4 columns x 4 rows
- Cell size: 64x64 px
- No padding, no margins, no offsets, no cropping

## BACKGROUND (SOLID + EXCLUSIVE COLOR)
- Entire canvas background: #00FF7F (solid).
- #00FF7F must appear ONLY in the background (0 pixels of this color in the character).
- NO GREEN ANYWHERE IN THE CHARACTER: exclude ALL green/teal/mint/lime/olive/cyan-green hues from the character, outline, shading, highlights, accessories, and any artifacts.

## FIXED CHARACTER SCALE + ANCHORS (NON-NEGOTIABLE)
Inside each 64x64 cell:
- Total character height: 58 px (identical in all frames)
- Head: 15 px, Torso: 19 px, Legs: 20 px, Feet thickness: 4 px
- Anchors for ALL frames:
  - Feet baseline: y = 60
  - Head top: y = 3
  - Character centerline: x = 32
- The character must be centered on x = 32 in every cell and grounded on y = 60 in every cell.
- No scaling, no squash/stretch, no perspective.

## BOUNDING BOX CONSISTENCY (VERY STRICT)
- The character must occupy the same pixel footprint in every frame (same width, same height, same left/right extents).
- No frame may shift the character left/right/up/down beyond permitted motion <= 1 px for walk cycles.
- Any drift or re-centering between frames is invalid.

## DIRECTION LAYOUT (ULTRA STRICT — NO MIXING WITHIN A ROW)
This is the most important rule: within each row, ALL 4 frames MUST face the SAME direction. No exceptions.

- Row 1: FRONT — all 4 frames are front-facing only.
- Row 2: LEFT  — all 4 frames face LEFT only (exact side view).
- Row 3: RIGHT — all 4 frames face RIGHT only (exact side view).
- Row 4: BACK  — all 4 frames are back-facing only.

If ANY frame in a row faces a different direction (including "two middle frames facing each other"), the output is invalid.

## MOTION / FRAME CONTENT (LOCKED)
- Row 1 (FRONT idle): subtle breathing only; torso shift <= 1 px; head locked.
- Row 2 (LEFT walk): canonical 4-frame walk cycle; fixed stride; minimal arm swing.
- Row 3 (RIGHT walk): canonical 4-frame walk cycle; fixed stride; minimal arm swing.
- Row 4 (BACK walk): canonical 4-frame walk cycle; fixed stride; no rotation.
- Max per-frame movement: 1 px.
- No turning frames, no diagonal frames, no extra actions.

## STYLE RULES (POKEMON GBA OVERWORLD)
- Clean pixel art, no anti-aliasing, no blur, no gradients, no dithering, no subpixel.
- 1 px dark-neutral outline (must not be green).
- Max 3 shades per color (base/shadow/highlight), consistent light source top-left.

## IDENTITY (PRESERVE, SIMPLIFY)
- Preserve: hair silhouette + color, glasses if present, facial hair if present, clothing silhouette/colors.
- Simplify face: eyes = 2 pixels, mouth = 1–2 pixels, nose optional 1 pixel.
- No logos, no textures; flat color blocks only.

## HARD FAILURE CONDITIONS (REJECT + REGENERATE)
Output is invalid if:
- Any row contains mixed directions (left + right in same row, or any mismatch).
- Any frame is off-center (not centered at x=32 in its cell, or baseline not at y=60).
- Character size/bounding box differs between frames.
- Any green appears in the character (any hue that reads as green/teal/mint).
- Background is not solid #00FF7F.

## OUTPUT
- Output exactly one 256x256 PNG sprite sheet (4x4 grid).
- No text, no labels, no extra variants."""

# Grid configuration
CELL_WIDTH = 64
CELL_HEIGHT = 64
GRID_COLS = 4
GRID_ROWS = 4
CANVAS_SIZE = (256, 256)

# Background color to remove (Spring Green)
BACKGROUND_COLOR = (0, 255, 127)  # #00FF7F

# View names for the four directions (first column of each row)
VIEW_NAMES = ["front", "left", "right", "back"]


def get_client(api_key: str = None) -> genai.Client:
    """
    Get a configured Google GenAI client.
    
    Args:
        api_key: The API key. If None, uses GOOGLE_API_KEY environment variable.
    
    Returns:
        Configured genai.Client instance.
    """
    if api_key is None:
        api_key = os.environ.get("GOOGLE_API_KEY")
    
    if not api_key:
        raise ValueError(
            "No API key provided. Set GOOGLE_API_KEY environment variable "
            "or pass api_key parameter."
        )
    
    return genai.Client(api_key=api_key)


def load_image(image_path: str) -> Image.Image:
    """Load an image from a file path."""
    return Image.open(image_path)


def generate_sprite_sheet_with_model(
    client: genai.Client,
    input_image_path: str,
    model_name: str
) -> Image.Image:
    """
    Generate a sprite sheet using a specific model.
    
    Args:
        client: The genai.Client instance.
        input_image_path: Path to the input image.
        model_name: The Gemini model to use.
    
    Returns:
        PIL Image of the generated sprite sheet.
    """
    # Read the image file
    with open(input_image_path, "rb") as f:
        image_bytes = f.read()
    
    # Create the image part for the API
    image_part = types.Part.from_bytes(
        data=image_bytes,
        mime_type="image/png"
    )
    
    # Generate the sprite sheet
    response = client.models.generate_content(
        model=model_name,
        contents=[
            image_part,
            SPRITE_SHEET_PROMPT
        ],
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE", "TEXT"]
        )
    )
    
    # Extract the image from the response
    if response.candidates and response.candidates[0].content.parts:
        for part in response.candidates[0].content.parts:
            if part.inline_data is not None:
                # Convert to PIL Image
                image_data = part.inline_data.data
                return Image.open(io.BytesIO(image_data))
    
    raise RuntimeError("Failed to generate sprite sheet - no image in response")


def count_sprite_islands(image: Image.Image, bg_color: tuple = BACKGROUND_COLOR, tolerance: int = 30) -> int:
    """
    Count the number of distinct sprite islands (connected components) in the image.
    
    Uses flood fill to identify connected regions of non-background pixels.
    Sprites are separated by the green background.
    
    Args:
        image: The sprite sheet image.
        bg_color: RGB tuple of the background color.
        tolerance: Color matching tolerance for background.
    
    Returns:
        Number of distinct sprite islands found.
    """
    img = image.convert("RGB")
    pixels = img.load()
    width, height = img.size
    
    # Create a mask of non-background pixels
    visited = [[False] * width for _ in range(height)]
    
    def is_background(r, g, b):
        # Check if pixel matches background color
        if (abs(r - bg_color[0]) <= tolerance and 
            abs(g - bg_color[1]) <= tolerance and 
            abs(b - bg_color[2]) <= tolerance):
            return True
        # Check for bright green variants
        if g > 200 and r < 100 and b < 180:
            return True
        if g > 180 and g > r + 60 and g > b + 40:
            return True
        return False
    
    def flood_fill(start_x, start_y):
        """Flood fill to mark all connected non-background pixels."""
        stack = [(start_x, start_y)]
        pixel_count = 0
        
        while stack:
            x, y = stack.pop()
            
            if x < 0 or x >= width or y < 0 or y >= height:
                continue
            if visited[y][x]:
                continue
            
            r, g, b = pixels[x, y]
            if is_background(r, g, b):
                continue
            
            visited[y][x] = True
            pixel_count += 1
            
            # Add 4-connected neighbors
            stack.append((x + 1, y))
            stack.append((x - 1, y))
            stack.append((x, y + 1))
            stack.append((x, y - 1))
        
        return pixel_count
    
    # Count islands
    island_count = 0
    min_island_size = 100  # Minimum pixels to count as a sprite (ignore noise)
    
    for y in range(height):
        for x in range(width):
            if not visited[y][x]:
                r, g, b = pixels[x, y]
                if not is_background(r, g, b):
                    pixel_count = flood_fill(x, y)
                    if pixel_count >= min_island_size:
                        island_count += 1
    
    return island_count


def validate_sprite_sheet_grid(image: Image.Image) -> tuple[bool, str]:
    """
    Validate that a sprite sheet is a proper 4x4 grid by counting sprite islands.
    
    Uses connected component analysis to count distinct sprite regions
    after removing the green background. Validates exactly 16 sprites.
    
    Args:
        image: The sprite sheet image to validate.
    
    Returns:
        Tuple of (is_valid, error_message).
    """
    width, height = image.size
    
    # Check minimum size
    if width < 256 or height < 256:
        return (False, f"Image too small: {width}x{height} (minimum 256x256)")
    
    # Count sprite islands using connected component analysis
    island_count = count_sprite_islands(image)
    
    if island_count != 16:
        return (False, f"Expected 16 sprite islands, found {island_count}")
    
    return (True, "")


def generate_sprite_sheet(
    client: genai.Client,
    input_image_path: str,
    model_name: str = None,
    max_retries: int = 3,
    retry_delay: float = 5.0,
    max_validation_retries: int = 3
) -> Image.Image:
    """
    Generate a sprite sheet with automatic fallback to alternative models.
    
    Tries the primary model first, then falls back to alternatives if the
    model is overloaded (503 error). Includes retry logic with delays.
    Also validates that the generated sprite sheet is a proper 4x4 grid
    and retries if validation fails.
    
    Args:
        client: The genai.Client instance.
        input_image_path: Path to the input image.
        model_name: Preferred model (optional, uses GOOGLE_MODELS if None).
        max_retries: Max retry attempts per model.
        retry_delay: Seconds to wait between retries.
        max_validation_retries: Max attempts to get a valid 4x4 grid.
    
    Returns:
        PIL Image of the generated sprite sheet.
    """
    # Build list of models to try
    if model_name:
        models_to_try = [model_name] + [m for m in GOOGLE_MODELS if m != model_name]
    else:
        models_to_try = GOOGLE_MODELS.copy()
    
    last_error = None
    
    # Outer loop for validation retries
    for validation_attempt in range(max_validation_retries):
        if validation_attempt > 0:
            print(f"\n  Validation retry {validation_attempt + 1}/{max_validation_retries} (previous image was not 4x4)")
        
        for model in models_to_try:
            print(f"  Trying model: {model}")
            
            for attempt in range(max_retries):
                try:
                    result = generate_sprite_sheet_with_model(client, input_image_path, model)
                    
                    # Validate the sprite sheet is 4x4
                    is_valid, error_msg = validate_sprite_sheet_grid(result)
                    if not is_valid:
                        print(f"    ⚠ Invalid sprite sheet: {error_msg}")
                        last_error = RuntimeError(f"Invalid grid: {error_msg}")
                        # Break to try validation retry
                        break
                    
                    print(f"  ✓ Success with model: {model}")
                    return result
                    
                except ServerError as e:
                    last_error = e
                    error_str = str(e)
                    
                    if '503' in error_str or 'overloaded' in error_str.lower():
                        print(f"    ⚠ Model overloaded (attempt {attempt + 1}/{max_retries})")
                        if attempt < max_retries - 1:
                            print(f"    Waiting {retry_delay}s before retry...")
                            time.sleep(retry_delay)
                        continue
                    else:
                        # Other server error, try next model
                        print(f"    ✗ Server error: {e}")
                        break
                        
                except Exception as e:
                    last_error = e
                    print(f"    ✗ Error: {e}")
                    break
            
            # If we got a valid result, it would have returned already
            # If validation failed, break model loop to retry with validation
            if isinstance(last_error, RuntimeError) and "Invalid grid" in str(last_error):
                break
            
            print(f"  Model {model} failed, trying next fallback...")
        
        # If we got here due to validation failure, continue to next validation attempt
        if isinstance(last_error, RuntimeError) and "Invalid grid" in str(last_error):
            continue
        
        # Otherwise, all models failed for other reasons, try OpenAI
        break
    
    # Try OpenAI GPT-Image-1 as final fallback
    print("  Trying OpenAI GPT-Image-1 as final fallback...")
    try:
        result = generate_sprite_sheet_openai(input_image_path)
        if result:
            # Validate OpenAI result too
            is_valid, error_msg = validate_sprite_sheet_grid(result)
            if not is_valid:
                print(f"    ⚠ Invalid sprite sheet from OpenAI: {error_msg}")
                raise RuntimeError(f"OpenAI generated invalid grid: {error_msg}")
            
            print("  ✓ Success with OpenAI GPT-Image-1")
            return result
    except Exception as e:
        print(f"  ✗ OpenAI GPT-Image-1 fallback failed: {e}")
        last_error = e
    
    # All models failed
    raise RuntimeError(f"All models failed to generate valid 4x4 sprite sheet. Last error: {last_error}")


def generate_sprite_sheet_openai(input_image_path: str) -> Image.Image:
    """
    Generate a sprite sheet using OpenAI's GPT-Image-1 API with reference image.
    
    Uses the new responses.create API with image_generation tool to generate
    a sprite sheet based on the input reference image.
    
    Args:
        input_image_path: Path to the input image.
    
    Returns:
        PIL Image of the generated sprite sheet.
    """
    import base64
    
    try:
        from openai import OpenAI
    except ImportError:
        raise RuntimeError("OpenAI package not installed. Run: pip install openai")
    
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set in environment")
    
    client = OpenAI(api_key=api_key)
    
    # Read and encode the input image
    with open(input_image_path, "rb") as f:
        image_bytes = f.read()
    
    base64_image = base64.b64encode(image_bytes).decode("utf-8")
    
    # Prompt for sprite sheet generation with reference image
    prompt = """Generate a pixel-art sprite sheet PNG based on the person in the reference image.
Style: Pokemon GBA overworld sprite style.

Requirements:
- Canvas: 1024x1024 px (will be a 4x4 grid, each cell 256x256)
- Background: solid #00FF7F (spring green)
- Row 1: Front-facing idle (4 frames)
- Row 2: Left-facing walk cycle (4 frames)
- Row 3: Right-facing walk cycle (4 frames)
- Row 4: Back-facing walk cycle (4 frames)

The character should match the person in the reference image:
- Preserve hair color/style
- Preserve glasses if present
- Preserve clothing colors and style
- Use clean pixel art with 1px dark outline
- No anti-aliasing, no gradients"""

    print("    Using GPT-Image-1 with reference image...")
    
    # Use the new responses.create API with image_generation tool
    response = client.responses.create(
        model="gpt-image-1",
        input=[
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {
                        "type": "input_image",
                        "image_url": f"data:image/png;base64,{base64_image}",
                    }
                ],
            }
        ],
        tools=[{"type": "image_generation"}],
    )
    
    # Extract image from response
    image_generation_calls = [
        output
        for output in response.output
        if output.type == "image_generation_call"
    ]
    
    if image_generation_calls:
        image_base64 = image_generation_calls[0].result
        image_data = base64.b64decode(image_base64)
        return Image.open(io.BytesIO(image_data))
    
    # Fallback: check for other output types
    raise RuntimeError("GPT-Image-1 did not return an image")


def remove_background(image: Image.Image, bg_color: tuple = BACKGROUND_COLOR, tolerance: int = 30) -> Image.Image:
    """
    Remove ALL green from an image, making it transparent.
    Also applies edge smoothing to reduce sharp edges.
    
    This function AGGRESSIVELY removes all green pixels including:
    1. The exact background color (#00FF7F) with high tolerance
    2. Any color close to the background color
    3. Any pixel where green is the dominant channel
    4. Edge artifacts and anti-aliasing green fringing
    5. Any greenish, teal, cyan, lime, mint colors
    
    Args:
        image: PIL Image to process.
        bg_color: RGB tuple of the background color to remove.
        tolerance: Color matching tolerance for background color.
    
    Returns:
        PIL Image with transparent background (RGBA) and smoothed edges.
    """
    from PIL import ImageFilter
    
    # Convert to RGBA if not already
    image = image.convert("RGBA")
    pixels = image.load()
    width, height = image.size
    
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            
            # Skip already transparent pixels
            if a == 0:
                continue
            
            should_remove = False
            
            # 1. Check if pixel matches background color (#00FF7F) with tolerance
            if (abs(r - bg_color[0]) <= tolerance and 
                abs(g - bg_color[1]) <= tolerance and 
                abs(b - bg_color[2]) <= tolerance):
                should_remove = True
            
            # 2. Check for bright green (high G, low R) - the main background color
            elif g > 200 and r < 100 and b < 180:
                should_remove = True
            
            # 3. Check for green-dominant pixels (green MUCH higher than red and blue)
            # Only remove if green is significantly dominant and bright
            elif g > 180 and g > r + 60 and g > b + 40:
                should_remove = True
            
            # 4. Check for cyan-green tints (high green + blue, very low red)
            elif g > 180 and b > 100 and r < 60:
                should_remove = True
            
            # 5. Check for lime/spring green (very high green, low red)
            elif g > 220 and r < 120:
                should_remove = True
            
            if should_remove:
                pixels[x, y] = (0, 0, 0, 0)
    
    # Second pass: Remove any remaining green fringe pixels near edges
    # by checking neighbors
    pixels = image.load()
    for y in range(1, height - 1):
        for x in range(1, width - 1):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            
            # Count transparent neighbors
            transparent_neighbors = 0
            for dy in [-1, 0, 1]:
                for dx in [-1, 0, 1]:
                    if dx == 0 and dy == 0:
                        continue
                    nr, ng, nb, na = pixels[x + dx, y + dy]
                    if na == 0:
                        transparent_neighbors += 1
            
            # If pixel has transparent neighbors and has strong green tint, remove it
            # Only remove if green is bright and clearly dominant
            if transparent_neighbors >= 3 and g > 180 and g > r + 50 and g > b + 30:
                pixels[x, y] = (0, 0, 0, 0)
    
    # Split into channels
    r_channel, g_channel, b_channel, a_channel = image.split()
    
    # Erode the alpha channel by 3 pixels to remove edge artifacts
    # MinFilter shrinks the opaque area by removing edge pixels
    for _ in range(3):
        a_channel = a_channel.filter(ImageFilter.MinFilter(size=3))
    
    # Apply a slight blur to the alpha channel for smoother edges
    a_channel = a_channel.filter(ImageFilter.GaussianBlur(radius=0.5))
    
    # Merge channels back
    image = Image.merge("RGBA", (r_channel, g_channel, b_channel, a_channel))
    
    return image


def get_sprite_pixels(image: Image.Image, bg_color: tuple = BACKGROUND_COLOR, tolerance: int = 30) -> list[tuple]:
    """
    Extract non-background pixel positions from a sprite.
    
    Args:
        image: PIL Image of a single sprite cell.
        bg_color: RGB tuple of the background color.
        tolerance: Color matching tolerance.
    
    Returns:
        List of (x, y) tuples for non-background pixels.
    """
    img = image.convert("RGBA")
    pixels = img.load()
    width, height = img.size
    
    content_pixels = []
    
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            
            is_background = False
            
            # Check if pixel matches background color
            if (abs(r - bg_color[0]) <= tolerance and 
                abs(g - bg_color[1]) <= tolerance and 
                abs(b - bg_color[2]) <= tolerance):
                is_background = True
            # Check for bright green variants
            elif g > 200 and r < 100 and b < 180:
                is_background = True
            elif g > 180 and g > r + 60 and g > b + 40:
                is_background = True
            
            if not is_background:
                content_pixels.append((x, y))
    
    return content_pixels


def detect_sprite_direction(image: Image.Image) -> tuple[str, float]:
    """
    Detect which direction a sprite is facing using a decision tree.
    
    Decision tree:
    1. Check if symmetric
       - If YES: Check facial area variance
         - High variance (facial features) -> FRONT
         - Low variance (uniform) -> BACK
       - If NO: Check horizontal asymmetry
         - More mass on right -> LEFT
         - More mass on left -> RIGHT
    
    Args:
        image: PIL Image of a single sprite cell.
    
    Returns:
        Tuple of (direction_name, confidence_score).
        direction_name is one of: "front", "left", "right", "back"
    """
    content_pixels = get_sprite_pixels(image)
    
    if len(content_pixels) < 10:
        return ("unknown", 0.0)
    
    width, height = image.size
    img = image.convert("RGB")
    pixels_img = img.load()
    
    xs = [p[0] for p in content_pixels]
    ys = [p[1] for p in content_pixels]
    
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    sprite_width = max_x - min_x + 1
    sprite_height = max_y - min_y + 1
    bbox_center_x = (min_x + max_x) / 2
    
    # STEP 1: Calculate horizontal symmetry
    # Build pixel dictionary with colors
    pixels_dict = {}
    for x, y in content_pixels:
        r, g, b = pixels_img[x, y]
        pixels_dict[(x, y)] = (r, g, b)
    
    # Count symmetric matches (with color tolerance)
    symmetric_matches = 0
    for x, y in content_pixels:
        mirror_x = int(2 * bbox_center_x - x)
        if (mirror_x, y) in pixels_dict:
            r1, g1, b1 = pixels_dict[(x, y)]
            r2, g2, b2 = pixels_dict[(mirror_x, y)]
            # Check if colors are similar (tolerance of 30)
            if abs(r1 - r2) < 30 and abs(g1 - g2) < 30 and abs(b1 - b2) < 30:
                symmetric_matches += 1
    
    symmetry_ratio = symmetric_matches / len(content_pixels) if content_pixels else 0
    
    # Calculate horizontal mass distribution for asymmetry check
    left_mass = sum(1 for x, y in content_pixels if x < bbox_center_x)
    right_mass = sum(1 for x, y in content_pixels if x >= bbox_center_x)
    total_mass = left_mass + right_mass
    
    if total_mass == 0:
        return ("unknown", 0.0)
    
    # Asymmetry: positive = more on right, negative = more on left
    mass_asymmetry = (right_mass - left_mass) / total_mass
    
    # Also check edge distribution
    quarter_width = sprite_width / 4
    left_quarter_x = min_x + quarter_width
    right_quarter_x = max_x - quarter_width
    
    left_edge_pixels = sum(1 for x, y in content_pixels if x < left_quarter_x)
    right_edge_pixels = sum(1 for x, y in content_pixels if x > right_quarter_x)
    edge_asymmetry = (right_edge_pixels - left_edge_pixels) / len(content_pixels)
    
    # Combine asymmetry metrics
    combined_asymmetry = (mass_asymmetry * 0.5 + edge_asymmetry * 0.5)
    
    # DECISION TREE:
    # 1. Check if it's a side view (asymmetric) using threshold
    # 2. If not side view, check if symmetric (front or back)
    
    side_threshold = 0.015  # Threshold for left/right detection (very sensitive)
    
    if abs(combined_asymmetry) > side_threshold:
        # ASYMMETRIC -> Left or Right
        # Positive asymmetry = more mass on right = facing LEFT (we see their right side)
        # Negative asymmetry = more mass on left = facing RIGHT (we see their left side)
        if combined_asymmetry > 0:
            confidence = 0.6 + min(0.3, abs(combined_asymmetry) * 2)
            return ("left", confidence)
        else:
            confidence = 0.6 + min(0.3, abs(combined_asymmetry) * 2)
            return ("right", confidence)
    
    # Check if symmetric (for front/back classification)
    if symmetry_ratio > 0.65:
        # SYMMETRIC -> Front or Back
        # Distinguish by checking facial area variance
        
        # Get head region (top 30% of sprite)
        head_cutoff = min_y + sprite_height * 0.30
        head_pixels = [(x, y) for x, y in content_pixels if y < head_cutoff]
        
        if len(head_pixels) < 5:
            return ("front", 0.5)
        
        # Get colors in facial area (top 30% of sprite)
        head_colors = [pixels_img[x, y] for x, y in head_pixels]
        
        # Isolate the face region - position it BELOW the hair/top of head
        # Focus on the lower portion of the head region where actual face/eyes would be
        head_height = head_cutoff - min_y
        face_top = min_y + head_height * 0.50  # Start at middle of head (below hair)
        face_bottom = min_y + head_height * 0.85  # End near bottom of head region
        face_pixels = [(x, y) for x, y in head_pixels if face_top <= y < face_bottom]
        
        if len(face_pixels) < 5:
            return ("front", 0.5)
        
        face_colors = [pixels_img[x, y] for x, y in face_pixels]
        
        # Check for HIGH CONTRAST between dark (eyes) and light (skin) pixels
        # Front view: dark eyes on lighter skin = high contrast
        # Back view: uniform hair color = low contrast
        
        dark_pixels = [(r, g, b) for r, g, b in face_colors if r < 80 and g < 80 and b < 80]
        light_pixels = [(r, g, b) for r, g, b in face_colors if r > 120 or g > 120 or b > 120]
        
        dark_count = len(dark_pixels)
        light_count = len(light_pixels)
        dark_ratio = dark_count / len(face_colors) if face_colors else 0
        light_ratio = light_count / len(face_colors) if face_colors else 0
        
        # High contrast = both dark and light pixels present
        has_high_contrast = dark_ratio > 0.02 and light_ratio > 0.15
        
        # Check for color diversity in face region
        face_colors_quantized = set((r // 30, g // 30, b // 30) for r, g, b in face_colors)
        face_color_diversity = len(face_colors_quantized)
        
        # Calculate color variance in facial area
        if len(face_colors) > 1:
            r_values = [r for r, g, b in face_colors]
            g_values = [g for r, g, b in face_colors]
            b_values = [b for r, g, b in face_colors]
            
            r_mean = sum(r_values) / len(r_values)
            g_mean = sum(g_values) / len(g_values)
            b_mean = sum(b_values) / len(b_values)
            
            r_var = sum((r - r_mean) ** 2 for r in r_values) / len(r_values)
            g_var = sum((g - g_mean) ** 2 for g in g_values) / len(g_values)
            b_var = sum((b - b_mean) ** 2 for b in b_values) / len(b_values)
            
            # Standard deviation (variance measure)
            facial_variance = ((r_var + g_var + b_var) / 3) ** 0.5
        else:
            facial_variance = 0
        
        # DECISION: Does facial area have sufficient contrast/features?
        # Front has: dark pixels (eyes), color diversity (features), high variance
        # Back has: uniform color (hair), no dark pixels, low variance
        
        front_score = 0
        
        # HIGH CONTRAST check - most important indicator
        # Front: dark eyes on light skin = high contrast
        # Back: uniform hair = low contrast
        if has_high_contrast:
            front_score += 4  # Strong indicator of front
        else:
            front_score -= 2  # Likely back
        
        # Dark pixels ratio analysis
        # Front: should have SOME dark (eyes) but not ALL dark
        # Back: usually ALL dark (uniform hair) or ALL light
        if dark_ratio > 0.90:
            # Almost all dark = uniform hair = BACK
            front_score -= 3
        elif dark_ratio > 0.03 and dark_ratio < 0.70:
            # Some dark pixels (eyes) but not uniform = FRONT
            front_score += 2
        elif dark_ratio > 0.01 and dark_ratio < 0.70:
            front_score += 1
        
        # Color diversity in face
        if face_color_diversity >= 4:
            front_score += 1
        elif face_color_diversity >= 3:
            front_score += 1
        elif face_color_diversity <= 2:
            front_score -= 1
        
        # Facial variance
        if facial_variance > 15:
            front_score += 1
        elif facial_variance > 10:
            front_score += 1
        elif facial_variance < 8:
            front_score -= 1
        
        # Threshold: >= 2 = front, < 2 = back
        if front_score >= 2:
            # FRONT
            confidence = 0.7 + min(0.2, front_score / 10)
            return ("front", confidence)
        else:
            # BACK
            confidence = 0.7 + min(0.2, abs(front_score) / 10)
            return ("back", confidence)
    
    # Fallback: not clearly asymmetric and not clearly symmetric
    # Default to front with low confidence
    return ("front", 0.5)


def score_sprite_quality(image: Image.Image) -> float:
    """
    Score a sprite's quality independent of direction.
    
    Evaluates:
    - Content amount (should have reasonable sprite content)
    - Centeredness
    - Proper proportions
    
    Args:
        image: PIL Image of a single sprite cell.
    
    Returns:
        Float score (higher is better).
    """
    content_pixels = get_sprite_pixels(image)
    content_count = len(content_pixels)
    
    if content_count == 0:
        return 0.0
    
    width, height = image.size
    total_pixels = width * height
    
    xs = [p[0] for p in content_pixels]
    ys = [p[1] for p in content_pixels]
    
    center_x = sum(xs) / content_count
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    bbox_width = max_x - min_x + 1
    bbox_height = max_y - min_y + 1
    
    # Score components:
    
    # 1. Content ratio (ideal: 10-50% of cell area)
    content_ratio = content_count / total_pixels
    if content_ratio < 0.05:
        content_score = content_ratio * 10
    elif content_ratio > 0.60:
        content_score = max(0, 1.0 - (content_ratio - 0.60) * 2)
    else:
        content_score = 1.0
    
    # 2. Horizontal centeredness
    ideal_center_x = width / 2
    x_deviation = abs(center_x - ideal_center_x) / (width / 2)
    center_score = max(0, 1.0 - x_deviation)
    
    # 3. Vertical coverage (should span most of cell height)
    vertical_coverage = bbox_height / height
    coverage_score = min(1.0, vertical_coverage / 0.7)
    
    # 4. Aspect ratio (taller than wide)
    if bbox_height > 0:
        aspect = bbox_width / bbox_height
        aspect_score = 1.0 if 0.3 <= aspect <= 0.9 else max(0, 1.0 - abs(aspect - 0.6) * 0.5)
    else:
        aspect_score = 0.0
    
    return content_score * 0.3 + center_score * 0.3 + coverage_score * 0.2 + aspect_score * 0.2


def extract_best_sprites(sprite_sheet: Image.Image) -> list[Image.Image]:
    """
    Extract the best sprite for each direction from all 16 sprites.
    
    Analyzes all 16 sprites to detect which direction each is facing,
    then picks the best quality sprite for each direction.
    
    Args:
        sprite_sheet: The sprite sheet image (any size, assumes 4x4 grid).
    
    Returns:
        List of 4 PIL Images in order: [front, left, right, back]
    """
    width, height = sprite_sheet.size
    cell_width = width // GRID_COLS
    cell_height = height // GRID_ROWS
    
    print(f"  Sprite sheet size: {width}x{height}, cell size: {cell_width}x{cell_height}")
    print("  Analyzing all 16 sprites for direction...")
    
    # Extract all 16 sprites with their detected direction and quality
    all_sprites = []  # List of (image, row, col, direction, direction_confidence, quality_score)
    
    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            left = col * cell_width
            top = row * cell_height
            right = (col + 1) * cell_width
            bottom = (row + 1) * cell_height
            
            frame = sprite_sheet.crop((left, top, right, bottom))
            direction, confidence = detect_sprite_direction(frame)
            quality = score_sprite_quality(frame)
            
            all_sprites.append({
                "image": frame,
                "row": row,
                "col": col,
                "direction": direction,
                "confidence": confidence,
                "quality": quality,
                "combined_score": confidence * 0.6 + quality * 0.4
            })
            
            print(f"    [{row},{col}]: direction={direction}, conf={confidence:.2f}, quality={quality:.2f}")
    
    # Group sprites by detected direction
    by_direction = {"front": [], "left": [], "right": [], "back": []}
    for sprite in all_sprites:
        if sprite["direction"] in by_direction:
            by_direction[sprite["direction"]].append(sprite)
    
    # Select best sprite for each direction
    best_frames = []
    
    for direction in VIEW_NAMES:  # ["front", "left", "right", "back"]
        candidates = by_direction[direction]
        
        if candidates:
            # Pick the one with highest combined score
            best = max(candidates, key=lambda s: s["combined_score"])
            best_frames.append(best["image"])
            print(f"  Selected for {direction}: row={best['row']}, col={best['col']}, "
                  f"score={best['combined_score']:.3f}")
        else:
            # Fallback: no sprite detected for this direction
            # Use the expected row's first column as fallback
            fallback_row = VIEW_NAMES.index(direction)
            fallback = [s for s in all_sprites if s["row"] == fallback_row][0]
            best_frames.append(fallback["image"])
            print(f"  WARNING: No {direction} sprite detected, using fallback [{fallback_row},0]")
    
    return best_frames


def run_pipeline(
    input_image_path: str = None,
    output_folder: str = None,
    api_key: str = None,
    model_name: str = "gemini-3-pro-image-preview"
) -> dict:
    """
    Run the full sprite generation pipeline.
    
    Generates a sprite sheet and extracts the first column views (front, left, right, back)
    saving them with transparent backgrounds in a timestamp-named folder.
    
    Args:
        input_image_path: Path to the input photo (default: image_examples/william.png).
        output_folder: Folder to save outputs (default: timestamp-based folder).
        api_key: Google API key (optional, uses env var if not provided).
        model_name: Gemini model name to use.
    
    Returns:
        Dictionary with paths to all generated files.
    """
    # Get API client
    client = get_client(api_key)
    
    # Use default input image if not provided
    if input_image_path is None:
        input_image_path = str(DEFAULT_INPUT_IMAGE)
    
    # Load the input image
    print(f"Loading input image: {input_image_path}")
    
    # Create timestamp-based output folder if not provided
    if output_folder is None:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_folder = Path(__file__).parent / "output" / timestamp
    else:
        output_folder = Path(output_folder)
    
    output_folder = Path(output_folder)
    output_folder.mkdir(parents=True, exist_ok=True)
    
    print(f"Output folder: {output_folder}")
    
    results = {
        "output_folder": str(output_folder),
        "sprite_sheet": None,
        "views": {}
    }
    
    print("\n--- Generating sprite sheet ---")
    
    try:
        # Generate the sprite sheet
        sprite_sheet = generate_sprite_sheet(client, input_image_path, model_name)
        
        # Save the full sprite sheet
        sheet_path = output_folder / "sprite_sheet.png"
        sprite_sheet.save(sheet_path, "PNG")
        print(f"  Saved sprite sheet: {sheet_path}")
        results["sprite_sheet"] = str(sheet_path)
        
        # Extract best sprites from each row and save front, left, right, back directly in the output folder
        frames = extract_best_sprites(sprite_sheet)
        
        for frame, view_name in zip(frames, VIEW_NAMES):
            # Remove the green background
            transparent_frame = remove_background(frame)
            
            # Save the image directly in the output folder
            output_path = output_folder / f"{view_name}.png"
            transparent_frame.save(output_path, "PNG")
            results["views"][view_name] = str(output_path)
            print(f"  Saved: {output_path}")
        
    except Exception as e:
        print(f"  Error generating sprite sheet: {e}")
        raise
    
    print(f"\n=== Pipeline complete ===")
    print(f"Output folder: {output_folder.absolute()}")
    
    return results


def main():
    """Main entry point for CLI usage."""
    import argparse
    
    parser = argparse.ArgumentParser(
        description="Generate Pokemon GBA-style pixel art sprites from photos"
    )
    parser.add_argument(
        "input_image",
        nargs="?",
        default=None,
        help="Path to the input photo (default: image_examples/william.png)"
    )
    parser.add_argument(
        "-o", "--output",
        default=None,
        help="Output folder (default: timestamp-based folder)"
    )
    parser.add_argument(
        "--api-key",
        help="Google API key (or set GOOGLE_API_KEY env var)"
    )
    parser.add_argument(
        "--model",
        default="gemini-3-pro-image-preview",
        help="Gemini model name (default: gemini-3-pro-image-preview / Nano Banana Pro)"
    )
    
    args = parser.parse_args()
    
    results = run_pipeline(
        input_image_path=args.input_image,
        output_folder=args.output,
        api_key=args.api_key,
        model_name=args.model
    )
    
    return results


if __name__ == "__main__":
    main()
