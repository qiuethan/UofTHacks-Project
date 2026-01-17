import Phaser from 'phaser'
import { TILE_SIZE } from '../config'
import type { GameEntity, SceneData } from '../types'

// Sprite display size - keep consistent for all avatars
const SPRITE_SIZE = TILE_SIZE * 2 // 64px square sprites

interface EntitySprite {
  container: Phaser.GameObjects.Container
  sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image
  nameText: Phaser.GameObjects.Text
  lastFacing?: { x: number; y: number }
  loadedSprites: Map<string, Phaser.Textures.Texture>
}

export class GameScene extends Phaser.Scene {
  private sceneDataRef: React.MutableRefObject<SceneData>
  private entitySprites: Map<string, EntitySprite> = new Map()
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd?: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key }
  private lastDirection = { x: 0, y: 0 }
  private _playerContainer?: Phaser.GameObjects.Container
  private worldWidth = 0
  private worldHeight = 0

  constructor(sceneDataRef: React.MutableRefObject<SceneData>) {
    super({ key: 'GameScene' })
    this.sceneDataRef = sceneDataRef
  }

  create() {
    const { mapSize, mode } = this.sceneDataRef.current

    // Calculate world size
    this.worldWidth = mapSize.width * TILE_SIZE
    this.worldHeight = mapSize.height * TILE_SIZE

    // Add background image
    this.createBackground(mapSize.width, mapSize.height)

    // Setup camera based on mode
    if (mode === 'watch') {
      // Watch mode: fit entire world in viewport, centered
      this.setupWatchModeCamera()
    } else {
      // Play mode: camera will follow player once they spawn
      // Set world bounds so camera can scroll anywhere in the world
      this.cameras.main.setBounds(0, 0, this.worldWidth, this.worldHeight)
    }

    // Setup keyboard input
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys()
      this.wasd = {
        W: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        A: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        D: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D)
      }
    }

    // Initial entity rendering
    this.updateEntities(this.sceneDataRef.current.entities, this.sceneDataRef.current.myEntityId || null)

    // Listen for resize events to update camera
    this.scale.on('resize', () => {
      if (this.sceneDataRef.current.mode === 'watch') {
        this.setupWatchModeCamera()
      }
    })
  }

  private setupWatchModeCamera() {
    // Calculate zoom to fit entire world in viewport
    const viewportWidth = this.cameras.main.width
    const viewportHeight = this.cameras.main.height
    
    // Calculate zoom to fit the world entirely within the viewport
    const zoomX = viewportWidth / this.worldWidth
    const zoomY = viewportHeight / this.worldHeight
    
    // Use the smaller zoom so entire world fits, but use larger if world is smaller than viewport
    // This ensures the world always fills the available space optimally
    const fitZoom = Math.min(zoomX, zoomY)
    
    // If world is smaller than viewport, scale it up to fill
    // If world is larger, scale it down to fit
    const zoom = fitZoom
    
    this.cameras.main.setZoom(zoom)
    
    // Remove bounds and center on world
    this.cameras.main.removeBounds()
    this.cameras.main.centerOn(this.worldWidth / 2, this.worldHeight / 2)
  }

  private createBackground(width: number, height: number) {
    const gameWidth = width * TILE_SIZE
    const gameHeight = height * TILE_SIZE

    // Check if background image is loaded
    if (this.textures.exists('background')) {
      // Add background image, scaled to cover the game area
      const bg = this.add.image(0, 0, 'background')
      bg.setOrigin(0, 0)
      bg.setDepth(-1) // Behind everything
      
      // Scale to cover the entire game world
      const texture = this.textures.get('background')
      const frame = texture.get()
      
      // Calculate scale to cover (not just fit) the area
      const scaleX = gameWidth / frame.width
      const scaleY = gameHeight / frame.height
      const scale = Math.max(scaleX, scaleY)
      
      bg.setScale(scale)
    } else {
      // Fallback: create a simple colored background
      const bg = this.add.rectangle(
        gameWidth / 2,
        gameHeight / 2,
        gameWidth,
        gameHeight,
        0x2d5a27 // Dark green
      )
      bg.setDepth(-1)
    }
  }

  updateEntities(entities: Map<string, GameEntity>, myEntityId: string | null) {
    const currentIds = new Set(entities.keys())
    
    // Remove entities that no longer exist
    for (const [id, entitySprite] of this.entitySprites) {
      if (!currentIds.has(id)) {
        entitySprite.container.destroy()
        this.entitySprites.delete(id)
      }
    }

    // Update or create entities
    for (const [id, entity] of entities) {
      const isMe = id === myEntityId
      this.updateOrCreateEntity(entity, isMe)
    }
  }

  private updateOrCreateEntity(entity: GameEntity, isMe: boolean) {
    const existing = this.entitySprites.get(entity.entityId)
    
    const targetX = entity.x * TILE_SIZE + TILE_SIZE / 2
    const targetY = entity.y * TILE_SIZE + TILE_SIZE / 2

    if (existing) {
      // Update position with tween for smooth movement
      if (existing.container.x !== targetX || existing.container.y !== targetY) {
        this.tweens.add({
          targets: existing.container,
          x: targetX,
          y: targetY,
          duration: 100,
          ease: 'Linear'
        })
      }

      // Update sprite based on facing direction
      this.updateEntitySprite(existing, entity)
      
      // Update depth for proper layering
      existing.container.setDepth(10 + entity.y)
    } else {
      // Create new entity
      this.createEntity(entity, isMe, targetX, targetY)
    }
  }

  private async createEntity(entity: GameEntity, isMe: boolean, x: number, y: number) {
    const container = this.add.container(x, y)
    container.setDepth(10 + entity.y)

    let sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image

    if (entity.kind === 'WALL') {
      // Walls are invisible collision boundaries - don't render them
      // The background image shows the visual boundaries
      container.destroy()
      return
    } else {
      // Create player/robot sprite
      const spriteUrl = this.getSpriteUrl(entity)
      
      if (spriteUrl && spriteUrl.startsWith('http')) {
        // Load external sprite from Supabase
        const textureKey = `entity-${entity.entityId}-${this.getFacingKey(entity.facing)}`
        
        if (!this.textures.exists(textureKey)) {
          // Create placeholder while loading - square aspect ratio
          const placeholder = this.add.rectangle(0, -SPRITE_SIZE / 4, SPRITE_SIZE, SPRITE_SIZE, 
            isMe ? 0x4ade80 : 0xf87171)
          container.add(placeholder)
          
          // Load the texture
          this.loadExternalTexture(textureKey, spriteUrl, container, entity, isMe)
          sprite = placeholder as unknown as Phaser.GameObjects.Sprite
        } else {
          sprite = this.add.sprite(0, -SPRITE_SIZE / 4, textureKey)
          // Scale to fit while preserving aspect ratio
          this.scaleSprite(sprite, SPRITE_SIZE)
          container.add(sprite)
        }
      } else {
        // Use default colored rectangle - square
        const color = isMe ? 0x4ade80 : (entity.color ? parseInt(entity.color.replace('#', ''), 16) : 0xf87171)
        const rect = this.add.rectangle(0, -SPRITE_SIZE / 4, SPRITE_SIZE, SPRITE_SIZE, color)
        rect.setStrokeStyle(2, 0xffffff)
        container.add(rect)
        
        // Add facing arrow
        const arrow = this.add.text(0, -SPRITE_SIZE / 4, this.getFacingArrow(entity.facing), {
          fontSize: '20px',
          color: '#ffffff'
        }).setOrigin(0.5)
        container.add(arrow)
        
        sprite = rect as unknown as Phaser.GameObjects.Sprite
      }
    }

    // Add name text (hidden by default, shown on hover)
    const nameText = this.add.text(0, -SPRITE_SIZE - 8, entity.displayName || '', {
      fontSize: '12px',
      color: '#ffffff',
      backgroundColor: '#000000aa',
      padding: { x: 4, y: 2 }
    }).setOrigin(0.5).setVisible(false)
    container.add(nameText)

    // Setup hover interaction - sized to match sprite
    container.setInteractive(
      new Phaser.Geom.Rectangle(-SPRITE_SIZE / 2, -SPRITE_SIZE, SPRITE_SIZE, SPRITE_SIZE + TILE_SIZE / 2), 
      Phaser.Geom.Rectangle.Contains
    )
    container.on('pointerover', () => nameText.setVisible(true))
    container.on('pointerout', () => nameText.setVisible(false))

    // Highlight player's own entity and setup camera follow
    if (isMe) {
      const highlight = this.add.circle(0, TILE_SIZE / 2, 5, 0x4ade80)
      highlight.setAlpha(0.8)
      container.add(highlight)
      
      // Store reference to player container for camera follow
      this._playerContainer = container
      
      // Setup camera to follow player in play mode - keep player centered
      if (this.sceneDataRef.current.mode === 'play') {
        // Smooth camera follow with player always centered
        this.cameras.main.startFollow(container, true, 0.08, 0.08)
        this.cameras.main.setZoom(1.5) // Slightly zoomed in for play mode
        this.cameras.main.setDeadzone(0, 0) // No deadzone - always centered
      }
    }

    this.entitySprites.set(entity.entityId, {
      container,
      sprite,
      nameText,
      lastFacing: entity.facing,
      loadedSprites: new Map()
    })
  }

  private loadExternalTexture(
    textureKey: string, 
    url: string, 
    container: Phaser.GameObjects.Container,
    entity: GameEntity,
    _isMe: boolean
  ) {
    this.load.image(textureKey, url)
    this.load.once('complete', () => {
      if (this.textures.exists(textureKey)) {
        // Remove placeholder
        const children = container.getAll()
        children.forEach(child => {
          if (child instanceof Phaser.GameObjects.Rectangle) {
            child.destroy()
          }
        })
        
        // Add loaded sprite - preserve aspect ratio
        const sprite = this.add.sprite(0, -SPRITE_SIZE / 4, textureKey)
        this.scaleSprite(sprite, SPRITE_SIZE)
        container.addAt(sprite, 0)
        
        const entitySprite = this.entitySprites.get(entity.entityId)
        if (entitySprite) {
          entitySprite.sprite = sprite
        }
      }
    })
    this.load.start()
  }

  // Scale sprite to fit within maxSize while preserving aspect ratio
  private scaleSprite(sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image, maxSize: number) {
    const texture = sprite.texture
    const frame = texture.get()
    
    if (frame && frame.width > 0 && frame.height > 0) {
      const scale = maxSize / Math.max(frame.width, frame.height)
      sprite.setScale(scale)
    } else {
      // Fallback if dimensions not available
      sprite.setDisplaySize(maxSize, maxSize)
    }
  }

  private updateEntitySprite(entitySprite: EntitySprite, entity: GameEntity) {
    // Check if facing changed
    const facingChanged = !entitySprite.lastFacing || 
      entitySprite.lastFacing.x !== entity.facing?.x || 
      entitySprite.lastFacing.y !== entity.facing?.y

    if (facingChanged && entity.sprites) {
      entitySprite.lastFacing = entity.facing
      const spriteUrl = this.getSpriteUrl(entity)
      
      if (spriteUrl && spriteUrl.startsWith('http')) {
        const textureKey = `entity-${entity.entityId}-${this.getFacingKey(entity.facing)}`
        
        if (!this.textures.exists(textureKey)) {
          // Load new facing texture
          this.load.image(textureKey, spriteUrl)
          this.load.once('complete', () => {
            if (this.textures.exists(textureKey) && entitySprite.sprite instanceof Phaser.GameObjects.Sprite) {
              entitySprite.sprite.setTexture(textureKey)
              // Re-apply scaling after texture change
              this.scaleSprite(entitySprite.sprite, SPRITE_SIZE)
            }
          })
          this.load.start()
        } else if (entitySprite.sprite instanceof Phaser.GameObjects.Sprite) {
          entitySprite.sprite.setTexture(textureKey)
          // Re-apply scaling after texture change
          this.scaleSprite(entitySprite.sprite, SPRITE_SIZE)
        }
      }
    }

    // Update name
    entitySprite.nameText.setText(entity.displayName || '')
  }

  private getSpriteUrl(entity: GameEntity): string | undefined {
    if (!entity.sprites) return undefined
    
    const facing = entity.facing || { x: 0, y: 1 }
    
    if (facing.x === 0 && facing.y === -1) return entity.sprites.back
    if (facing.x === 1 && facing.y === 0) return entity.sprites.right
    if (facing.x === 0 && facing.y === 1) return entity.sprites.front
    if (facing.x === -1 && facing.y === 0) return entity.sprites.left
    
    return entity.sprites.front
  }

  private getFacingKey(facing?: { x: number; y: number }): string {
    if (!facing) return 'front'
    if (facing.x === 0 && facing.y === -1) return 'back'
    if (facing.x === 1 && facing.y === 0) return 'right'
    if (facing.x === 0 && facing.y === 1) return 'front'
    if (facing.x === -1 && facing.y === 0) return 'left'
    return 'front'
  }

  private getFacingArrow(facing?: { x: number; y: number }): string {
    if (!facing) return '↓'
    if (facing.x === 0 && facing.y === -1) return '↑'
    if (facing.x === 1 && facing.y === 0) return '→'
    if (facing.x === 0 && facing.y === 1) return '↓'
    if (facing.x === -1 && facing.y === 0) return '←'
    return '↓'
  }

  update() {
    const { mode, inputEnabled, onDirectionChange } = this.sceneDataRef.current
    
    if (mode !== 'play' || !inputEnabled || !onDirectionChange) return
    if (!this.cursors && !this.wasd) return

    let dx: -1 | 0 | 1 = 0
    let dy: -1 | 0 | 1 = 0

    // Check arrow keys
    if (this.cursors) {
      if (this.cursors.up.isDown) dy = -1
      else if (this.cursors.down.isDown) dy = 1
      if (this.cursors.left.isDown) dx = -1
      else if (this.cursors.right.isDown) dx = 1
    }

    // Check WASD (override if pressed)
    if (this.wasd) {
      if (this.wasd.W.isDown) dy = -1
      else if (this.wasd.S.isDown) dy = 1
      if (this.wasd.A.isDown) dx = -1
      else if (this.wasd.D.isDown) dx = 1
    }

    // Only send if direction changed
    if (dx !== this.lastDirection.x || dy !== this.lastDirection.y) {
      this.lastDirection = { x: dx, y: dy }
      onDirectionChange(dx, dy)
    }
  }
}
