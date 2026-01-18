import Phaser from 'phaser'

// Tile size in pixels (matches Tiled map: 16px tiles)
export const TILE_SIZE = 16

// Game configuration
export const createGameConfig = (
  parent: string,
  width: number,
  height: number,
  scenes: Phaser.Types.Scenes.SceneType[]
): Phaser.Types.Core.GameConfig => ({
  type: Phaser.AUTO,
  parent,
  width,
  height,
  pixelArt: true,
  transparent: true, // Transparent background - only show the game world
  scene: scenes,
  scale: {
    mode: Phaser.Scale.NONE, // Don't scale - we handle sizing ourselves
    width,
    height
  },
  render: {
    antialias: false,
    pixelArt: true,
    roundPixels: true
  }
})
