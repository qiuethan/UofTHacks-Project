# Image Generation Pipeline

Generate Pokemon GBA-style pixel art sprite sheets from photos using **Nano Banana** (Gemini 2.5 Flash).

## Overview

This pipeline:
1. Takes a single-person photo as input
2. Generates 4x4 sprite sheets (256x256 px) in Pokemon GBA overworld style
3. Extracts the first column of each sprite sheet (front, left, right, back views)
4. Removes the green background (#00FF7F) making it transparent
5. Saves individual view PNGs

## Installation

```bash
cd image_gen
pip install -r requirements.txt
```

## Setup

1. Copy the example environment file and add your API key:

```bash
cp .env.example .env
# Edit .env and add your actual Google API key
```

2. Or set it as an environment variable:

```bash
export GOOGLE_API_KEY="your-api-key-here"
```

3. Or pass it directly to the script with `--api-key`.

## Usage

### Command Line

```bash
# Generate 4 sprite sheets from a photo
python pipeline.py path/to/photo.jpg -o output_folder

# Generate with custom number of generations
python pipeline.py photo.jpg -n 8 -o my_sprites

# Use specific API key
python pipeline.py photo.jpg --api-key YOUR_API_KEY
```

### As a Python Module

```python
from image_gen import run_pipeline

results = run_pipeline(
    input_image_path="path/to/photo.jpg",
    output_folder="output",
    num_generations=4
)

# Results structure:
# {
#     "sprite_sheets": ["output/generation_1/sprite_sheet.png", ...],
#     "views": [
#         {"front": "...", "left": "...", "right": "...", "back": "..."},
#         ...
#     ]
# }
```

## Output Structure

```
output/
├── generation_1/
│   ├── sprite_sheet.png      # Full 256x256 sprite sheet
│   └── views/
│       ├── front.png         # 64x64, transparent background
│       ├── left.png
│       ├── right.png
│       └── back.png
├── generation_2/
│   └── ...
├── generation_3/
│   └── ...
└── generation_4/
    └── ...
```

## Sprite Sheet Layout

Each generated sprite sheet is a 4x4 grid (256x256 px total, 64x64 px per cell):

| Row | Direction | Content |
|-----|-----------|---------|
| 1   | Front     | 4-frame idle animation |
| 2   | Left      | 4-frame walk cycle |
| 3   | Right     | 4-frame walk cycle |
| 4   | Back      | 4-frame walk cycle |

## Technical Details

- **Model**: Gemini 2.0 Flash Experimental (Nano Banana)
- **Output Size**: 256x256 px sprite sheets, 64x64 px individual frames
- **Background Color**: #00FF7F (Spring Green) - automatically removed
- **Style**: Pokemon GBA overworld pixel art
