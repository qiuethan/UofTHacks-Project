import Phaser from 'phaser'

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PreloadScene' })
  }

  preload() {
    // Load the Tiled map JSON
    this.load.tilemapTiledJSON('mainMap', '/assets/tiled/map16x16.tmj')
    
    // Load all tileset images referenced by the map
    // The key names must match the 'name' property in the .tmj tilesets array
    // The paths must match the 'image' property in the embedded tilesets
    const base = '/assets/tiled/'
    
    // Sprout Lands tilesets
    this.load.image('Hills_16x16', base + 'Sprout Lands - Sprites - Basic pack/Tilesets/Hills.png')
    this.load.image('Tilled_Dirt_v2', base + 'Sprout Lands - Sprites - Basic pack/Tilesets/Tilled_Dirt_v2.png')
    this.load.image('Tilled_Dirt_Wide', base + 'Sprout Lands - Sprites - Basic pack/Tilesets/Tilled_Dirt_Wide.png')
    
    // Modern tiles free
    this.load.image('interior_room_16x16', base + 'Modern tiles_Free/Interiors_free/16x16/Room_Builder_free_16x16.png')
    this.load.image('interior_furniture_16x16', base + 'Modern tiles_Free/Interiors_free/16x16/Interiors_free_16x16.png')
    
    // Modern interiors - Home designs
    this.load.image('home', base + 'moderninteriors-win/6_Home_Designs/Generic_Home_Designs/16x16/Generic_Home_1_Layer_1.png')
    this.load.image('Generic_Home_1_Layer_2_', base + 'moderninteriors-win/6_Home_Designs/Generic_Home_Designs/16x16/Generic_Home_1_Layer_2_.png')
    this.load.image('Gym_preview', base + 'moderninteriors-win/6_Home_Designs/Gym_Designs/16x16/Gym_preview.png')
    this.load.image('Tv_Studio_Design_layer_1', base + 'moderninteriors-win/6_Home_Designs/TV_Studio_Designs/16x16/Tv_Studio_Design_layer_1.png')
    this.load.image('Museum_room_1_layer_1', base + 'moderninteriors-win/6_Home_Designs/Museum_Designs/16x16/Museum_room_1_layer_1.png')
    this.load.image('Museum_room_1_layer_2', base + 'moderninteriors-win/6_Home_Designs/Museum_Designs/16x16/Museum_room_1_layer_2.png')
    
    // Modern interiors - Interiors
    // NOTE: Interiors_16x16 is 256x17024 pixels - exceeds WebGL texture size limits
    // Using split versions (256x4256 each) to try to fit within 4096 limit
    this.load.image('Room_Builder_16x16', base + 'moderninteriors-win/1_Interiors/16x16/Room_Builder_16x16.png')
    // this.load.image('Interiors_16x16', base + 'moderninteriors-win/1_Interiors/16x16/Interiors_16x16.png') // Too large!
    this.load.image('Interiors_16x16_part1', base + 'Interiors_16x16_part1.png')
    this.load.image('Interiors_16x16_part2', base + 'Interiors_16x16_part2.png')
    this.load.image('Interiors_16x16_part3', base + 'Interiors_16x16_part3.png')
    this.load.image('Interiors_16x16_part4', base + 'Interiors_16x16_part4.png')
    this.load.image('8_Gym_Black_Shadow_16x16', base + 'moderninteriors-win/1_Interiors/16x16/Theme_Sorter_Black_Shadow/8_Gym_Black_Shadow_16x16.png')
    this.load.image('14_Basement_Black_Shadow_16x16', base + 'moderninteriors-win/1_Interiors/16x16/Theme_Sorter_Black_Shadow/14_Basement_Black_Shadow_16x16.png')
    
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
