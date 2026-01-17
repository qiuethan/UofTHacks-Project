import Phaser from 'phaser'
import type { GameEntity, SceneData } from '../types'

// Character sprite size
const SPRITE_SIZE = 64

interface EntitySprite {
  container: Phaser.GameObjects.Container
  sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image
  nameText: Phaser.GameObjects.Text
  lastFacing?: { x: number; y: number }
}

export class GameScene extends Phaser.Scene {
  private sceneDataRef: React.MutableRefObject<SceneData>
  private entitySprites: Map<string, EntitySprite> = new Map()
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd?: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key }
  private lastDirection = { x: 0, y: 0 }
  private worldWidth = 0
  private worldHeight = 0
  private background?: Phaser.GameObjects.Image

  constructor(sceneDataRef: React.MutableRefObject<SceneData>) {
    super({ key: 'GameScene' })
    this.sceneDataRef = sceneDataRef
  }

  create() {
    const { mode } = this.sceneDataRef.current

    // Create background from the loaded image - this defines the world size
    this.createBackground()

    // Setup camera based on mode
    if (mode === 'watch') {
      this.setupWatchModeCamera()
    } else {
      // Play mode: set world bounds, camera will follow player
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

    // Listen for resize events
    this.scale.on('resize', () => {
      if (this.sceneDataRef.current.mode === 'watch') {
        this.setupWatchModeCamera()
      }
    })
  }

  private createBackground() {
    if (this.textures.exists('background')) {
      // Get the actual background image dimensions
      const texture = this.textures.get('background')
      const frame = texture.get()
      
      // World size matches the background image exactly
      this.worldWidth = frame.width
      this.worldHeight = frame.height

      // Add background at origin, no scaling needed
      this.background = this.add.image(0, 0, 'background')
      this.background.setOrigin(0, 0)
      this.background.setDepth(-1)
    } else {
      // Fallback if no background loaded
      this.worldWidth = 1920
      this.worldHeight = 1080
      
      const bg = this.add.rectangle(
        this.worldWidth / 2,
        this.worldHeight / 2,
        this.worldWidth,
        this.worldHeight,
        0x2d5a27
      )
      bg.setDepth(-1)
    }
  }

  private setupWatchModeCamera() {
    const viewportWidth = this.cameras.main.width
    const viewportHeight = this.cameras.main.height
    
    // Calculate zoom to fit entire background in viewport
    const zoomX = viewportWidth / this.worldWidth
    const zoomY = viewportHeight / this.worldHeight
    const zoom = Math.min(zoomX, zoomY)
    
    this.cameras.main.setZoom(zoom)
    this.cameras.main.removeBounds()
    this.cameras.main.centerOn(this.worldWidth / 2, this.worldHeight / 2)
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
    // Skip walls - they're invisible
    if (entity.kind === 'WALL') return

    const existing = this.entitySprites.get(entity.entityId)
    
    // Convert grid position to pixel position
    // Using a simple 32px grid for positioning
    const GRID_SIZE = 32
    const targetX = entity.x * GRID_SIZE + GRID_SIZE / 2
    const targetY = entity.y * GRID_SIZE + GRID_SIZE / 2

    if (existing) {
      // Smooth movement with tween
      if (existing.container.x !== targetX || existing.container.y !== targetY) {
        this.tweens.add({
          targets: existing.container,
          x: targetX,
          y: targetY,
          duration: 100,
          ease: 'Linear'
        })
      }

      // Update sprite facing
      this.updateEntitySprite(existing, entity)
      existing.container.setDepth(10 + entity.y)
    } else {
      this.createEntity(entity, isMe, targetX, targetY)
    }
  }

  private createEntity(entity: GameEntity, isMe: boolean, x: number, y: number) {
    const container = this.add.container(x, y)
    container.setDepth(10 + entity.y)

    let sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image

    const spriteUrl = this.getSpriteUrl(entity)
    
    if (spriteUrl && spriteUrl.startsWith('http')) {
      // Load external sprite
      const textureKey = `entity-${entity.entityId}-${this.getFacingKey(entity.facing)}`
      
      if (!this.textures.exists(textureKey)) {
        // Placeholder while loading
        const placeholder = this.add.rectangle(0, 0, SPRITE_SIZE, SPRITE_SIZE, isMe ? 0x4ade80 : 0xf87171)
        container.add(placeholder)
        
        this.loadExternalTexture(textureKey, spriteUrl, container, entity)
        sprite = placeholder as unknown as Phaser.GameObjects.Sprite
      } else {
        sprite = this.add.sprite(0, 0, textureKey)
        this.scaleSprite(sprite, SPRITE_SIZE)
        container.add(sprite)
      }
    } else {
      // Default colored square with direction arrow
      const color = isMe ? 0x4ade80 : (entity.color ? parseInt(entity.color.replace('#', ''), 16) : 0xf87171)
      const rect = this.add.rectangle(0, 0, SPRITE_SIZE, SPRITE_SIZE, color)
      rect.setStrokeStyle(2, 0xffffff)
      container.add(rect)
      
      const arrow = this.add.text(0, 0, this.getFacingArrow(entity.facing), {
        fontSize: '24px',
        color: '#ffffff'
      }).setOrigin(0.5)
      container.add(arrow)
      
      sprite = rect as unknown as Phaser.GameObjects.Sprite
    }

    // Name label (shown on hover)
    const nameText = this.add.text(0, -SPRITE_SIZE / 2 - 12, entity.displayName || '', {
      fontSize: '14px',
      color: '#ffffff',
      backgroundColor: '#000000cc',
      padding: { x: 6, y: 3 }
    }).setOrigin(0.5).setVisible(false)
    container.add(nameText)

    // Hover interaction
    container.setInteractive(
      new Phaser.Geom.Rectangle(-SPRITE_SIZE / 2, -SPRITE_SIZE / 2, SPRITE_SIZE, SPRITE_SIZE),
      Phaser.Geom.Rectangle.Contains
    )
    container.on('pointerover', () => nameText.setVisible(true))
    container.on('pointerout', () => nameText.setVisible(false))

    // Player highlight and camera setup
    if (isMe) {
      const highlight = this.add.circle(0, SPRITE_SIZE / 2 + 8, 6, 0x4ade80)
      highlight.setAlpha(0.9)
      container.add(highlight)
      
      if (this.sceneDataRef.current.mode === 'play') {
        this.cameras.main.startFollow(container, true, 0.1, 0.1)
        this.cameras.main.setZoom(1.5)
        this.cameras.main.setDeadzone(0, 0)
      }
    }

    this.entitySprites.set(entity.entityId, {
      container,
      sprite,
      nameText,
      lastFacing: entity.facing
    })
  }

  private loadExternalTexture(
    textureKey: string,
    url: string,
    container: Phaser.GameObjects.Container,
    entity: GameEntity
  ) {
    this.load.image(textureKey, url)
    this.load.once('complete', () => {
      if (this.textures.exists(textureKey)) {
        // Remove placeholder rectangles
        container.getAll().forEach(child => {
          if (child instanceof Phaser.GameObjects.Rectangle) {
            child.destroy()
          }
        })
        
        const sprite = this.add.sprite(0, 0, textureKey)
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

  private scaleSprite(sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image, maxSize: number) {
    const frame = sprite.texture.get()
    if (frame && frame.width > 0 && frame.height > 0) {
      const scale = maxSize / Math.max(frame.width, frame.height)
      sprite.setScale(scale)
    } else {
      sprite.setDisplaySize(maxSize, maxSize)
    }
  }

  private updateEntitySprite(entitySprite: EntitySprite, entity: GameEntity) {
    const facingChanged = !entitySprite.lastFacing ||
      entitySprite.lastFacing.x !== entity.facing?.x ||
      entitySprite.lastFacing.y !== entity.facing?.y

    if (facingChanged && entity.sprites) {
      entitySprite.lastFacing = entity.facing
      const spriteUrl = this.getSpriteUrl(entity)
      
      if (spriteUrl && spriteUrl.startsWith('http')) {
        const textureKey = `entity-${entity.entityId}-${this.getFacingKey(entity.facing)}`
        
        if (!this.textures.exists(textureKey)) {
          this.load.image(textureKey, spriteUrl)
          this.load.once('complete', () => {
            if (this.textures.exists(textureKey) && entitySprite.sprite instanceof Phaser.GameObjects.Sprite) {
              entitySprite.sprite.setTexture(textureKey)
              this.scaleSprite(entitySprite.sprite, SPRITE_SIZE)
            }
          })
          this.load.start()
        } else if (entitySprite.sprite instanceof Phaser.GameObjects.Sprite) {
          entitySprite.sprite.setTexture(textureKey)
          this.scaleSprite(entitySprite.sprite, SPRITE_SIZE)
        }
      }
    }

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

    if (this.cursors) {
      if (this.cursors.up.isDown) dy = -1
      else if (this.cursors.down.isDown) dy = 1
      if (this.cursors.left.isDown) dx = -1
      else if (this.cursors.right.isDown) dx = 1
    }

    if (this.wasd) {
      if (this.wasd.W.isDown) dy = -1
      else if (this.wasd.S.isDown) dy = 1
      if (this.wasd.A.isDown) dx = -1
      else if (this.wasd.D.isDown) dx = 1
    }

    if (dx !== this.lastDirection.x || dy !== this.lastDirection.y) {
      this.lastDirection = { x: dx, y: dy }
      onDirectionChange(dx, dy)
    }
  }
}
