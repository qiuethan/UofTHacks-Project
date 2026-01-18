import Phaser from 'phaser'

// Tile size in pixels
export const TILE_SIZE = 32

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
    mode: Phaser.Scale.FIT, // Keep canvas at fixed size, fit within container
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width,
    height
  },
  render: {
    antialias: false,
    pixelArt: true,
    roundPixels: true
  }
})
