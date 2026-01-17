import Phaser from 'phaser'

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PreloadScene' })
  }

  preload() {
    // Load background image
    this.load.image('background', '/assets/backgrounds/background.png')
    
    // Load tileset (optional - game has fallback)
    this.load.image('tiles', '/assets/tiles/tileset.png')
    
    // Load default sprites for entities without custom avatars (SVG format)
    this.load.svg('default-front', '/assets/sprites/default-front.svg', { width: 32, height: 64 })
    this.load.svg('default-back', '/assets/sprites/default-back.svg', { width: 32, height: 64 })
    this.load.svg('default-left', '/assets/sprites/default-left.svg', { width: 32, height: 64 })
    this.load.svg('default-right', '/assets/sprites/default-right.svg', { width: 32, height: 64 })
    
    // Load wall sprite
    this.load.svg('wall', '/assets/sprites/wall.svg', { width: 64, height: 64 })
    
    // Show loading progress
    const width = this.cameras.main.width
    const height = this.cameras.main.height
    
    const progressBar = this.add.graphics()
    const progressBox = this.add.graphics()
    progressBox.fillStyle(0x222222, 0.8)
    progressBox.fillRect(width / 2 - 160, height / 2 - 25, 320, 50)
    
    const loadingText = this.add.text(width / 2, height / 2 - 50, 'Loading...', {
      fontFamily: 'Arial',
      fontSize: '20px',
      color: '#ffffff'
    }).setOrigin(0.5)

    this.load.on('progress', (value: number) => {
      progressBar.clear()
      progressBar.fillStyle(0x4ade80, 1)
      progressBar.fillRect(width / 2 - 150, height / 2 - 15, 300 * value, 30)
    })

    this.load.on('complete', () => {
      progressBar.destroy()
      progressBox.destroy()
      loadingText.destroy()
    })
  }

  create() {
    this.scene.start('GameScene')
  }
}
