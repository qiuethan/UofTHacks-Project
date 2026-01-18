#!/usr/bin/env python3
"""
Pad tileset images to dimensions that are multiples of 16x16.
This fixes the "Image tile area not tile size multiple" error in Phaser.
"""

from PIL import Image
import sys

def pad_image_to_multiple_of_16(input_path, output_path=None):
    """Pad an image to the nearest multiple of 16 pixels with transparency."""
    if output_path is None:
        output_path = input_path
    
    # Open the image
    img = Image.open(input_path)
    width, height = img.size
    
    print(f"Original size: {width}x{height}")
    
    # Calculate new dimensions (round up to nearest multiple of 16)
    new_width = ((width + 15) // 16) * 16
    new_height = ((height + 15) // 16) * 16
    
    print(f"New size: {new_width}x{new_height}")
    
    # If already correct size, nothing to do
    if width == new_width and height == new_height:
        print("Image already has correct dimensions!")
        return
    
    # Create new image with transparency
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    
    new_img = Image.new('RGBA', (new_width, new_height), (0, 0, 0, 0))
    
    # Paste original image at top-left (0, 0)
    new_img.paste(img, (0, 0))
    
    # Save the padded image
    new_img.save(output_path, 'PNG')
    print(f"Saved padded image to: {output_path}")

if __name__ == '__main__':
    base_path = '/Users/zacharytang/Desktop/Coding/uofthacks-13/web/public/assets/tiled/moderninteriors-win/6_Home_Designs/Generic_Home_Designs/16x16'
    
    images_to_pad = [
        f'{base_path}/Generic_Home_1_Layer_1.png',
        f'{base_path}/Generic_Home_1_Layer_2_.png',
    ]
    
    for img_path in images_to_pad:
        print(f"\nProcessing: {img_path}")
        try:
            pad_image_to_multiple_of_16(img_path)
            print("✓ Success!")
        except Exception as e:
            print(f"✗ Error: {e}")
