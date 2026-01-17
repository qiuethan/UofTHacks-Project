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


def generate_sprite_sheet(
    client: genai.Client,
    input_image_path: str,
    model_name: str = None,
    max_retries: int = 3,
    retry_delay: float = 5.0
) -> Image.Image:
    """
    Generate a sprite sheet with automatic fallback to alternative models.
    
    Tries the primary model first, then falls back to alternatives if the
    model is overloaded (503 error). Includes retry logic with delays.
    
    Args:
        client: The genai.Client instance.
        input_image_path: Path to the input image.
        model_name: Preferred model (optional, uses GOOGLE_MODELS if None).
        max_retries: Max retry attempts per model.
        retry_delay: Seconds to wait between retries.
    
    Returns:
        PIL Image of the generated sprite sheet.
    """
    # Build list of models to try
    if model_name:
        models_to_try = [model_name] + [m for m in GOOGLE_MODELS if m != model_name]
    else:
        models_to_try = GOOGLE_MODELS.copy()
    
    last_error = None
    
    for model in models_to_try:
        print(f"  Trying model: {model}")
        
        for attempt in range(max_retries):
            try:
                result = generate_sprite_sheet_with_model(client, input_image_path, model)
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
        
        print(f"  Model {model} failed, trying next fallback...")
    
    # Try OpenAI as final fallback
    print("  Trying OpenAI DALL-E as final fallback...")
    try:
        result = generate_sprite_sheet_openai(input_image_path)
        if result:
            print("  ✓ Success with OpenAI DALL-E")
            return result
    except Exception as e:
        print(f"  ✗ OpenAI fallback failed: {e}")
        last_error = e
    
    # All models failed
    raise RuntimeError(f"All models failed. Last error: {last_error}")


def generate_sprite_sheet_openai(input_image_path: str) -> Image.Image:
    """
    Generate a sprite sheet using OpenAI's DALL-E/GPT-Image API as fallback.
    
    Args:
        input_image_path: Path to the input image.
    
    Returns:
        PIL Image of the generated sprite sheet.
    """
    import base64
    import requests
    
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
    
    # Use GPT-4o with vision to describe the person, then generate sprite
    # First, get a description of the person
    vision_response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Describe this person's appearance in detail for a pixel art sprite: hair color/style, glasses, clothing colors, skin tone. Be concise but specific."
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{base64_image}"
                        }
                    }
                ]
            }
        ],
        max_tokens=200
    )
    
    person_description = vision_response.choices[0].message.content
    print(f"    Person description: {person_description[:100]}...")
    
    # Generate sprite sheet with DALL-E 3
    dalle_prompt = f"""Create a 256x256 pixel art sprite sheet in Pokemon GBA overworld style.
The character should match this description: {person_description}

The sprite sheet must be a 4x4 grid (64x64 pixels per cell):
- Row 1: Front-facing idle (4 frames)
- Row 2: Left-facing walk cycle (4 frames)
- Row 3: Right-facing walk cycle (4 frames)  
- Row 4: Back-facing walk cycle (4 frames)

Use solid #00FF7F green background. Clean pixel art style, no anti-aliasing.
The character should have a 1-pixel dark outline."""

    response = client.images.generate(
        model="dall-e-3",
        prompt=dalle_prompt,
        size="1024x1024",
        quality="hd",
        n=1
    )
    
    # Download the generated image
    image_url = response.data[0].url
    img_response = requests.get(image_url)
    img_response.raise_for_status()
    
    return Image.open(io.BytesIO(img_response.content))


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


def extract_first_column(sprite_sheet: Image.Image) -> list[Image.Image]:
    """
    Extract the first column (first frame) from each row of the sprite sheet.
    
    The sprite sheet is a 4x4 grid where:
    - Row 0: Front view (idle)
    - Row 1: Left view (walk)
    - Row 2: Right view (walk)
    - Row 3: Back view (walk)
    
    Args:
        sprite_sheet: The sprite sheet image (any size, assumes 4x4 grid).
    
    Returns:
        List of 4 PIL Images, one for each direction.
    """
    # Calculate actual cell size based on sprite sheet dimensions
    width, height = sprite_sheet.size
    cell_width = width // GRID_COLS
    cell_height = height // GRID_ROWS
    
    print(f"  Sprite sheet size: {width}x{height}, cell size: {cell_width}x{cell_height}")
    
    frames = []
    
    for row in range(GRID_ROWS):
        # Extract the first column (column 0) of each row
        left = 0
        top = row * cell_height
        right = cell_width
        bottom = (row + 1) * cell_height
        
        frame = sprite_sheet.crop((left, top, right, bottom))
        frames.append(frame)
    
    return frames


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
        
        # Extract first column and save front, left, right, back directly in the output folder
        frames = extract_first_column(sprite_sheet)
        
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
