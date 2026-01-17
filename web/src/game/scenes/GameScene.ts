import Phaser from 'phaser'
import type { GameEntity, SceneData } from '../types'

// Character sprite size
const SPRITE_SIZE = 64

// Sprite loading configuration
const SPRITE_LOAD_MAX_RETRIES = 3
const SPRITE_LOAD_RETRY_DELAY = 1000

interface EntitySprite {
  container: Phaser.GameObjects.Container
  sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image
  nameText: Phaser.GameObjects.Text
  loadingIndicator?: Phaser.GameObjects.Graphics
  lastFacing?: { x: number; y: number }
  loadAttempts: number
  isLoading: boolean
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
    // Filter out walls - we don't render them at all
    const visibleEntities = new Map<string, GameEntity>()
    for (const [id, entity] of entities) {
      if (entity.kind !== 'WALL') {
        visibleEntities.set(id, entity)
      }
    }
    
    const currentIds = new Set(visibleEntities.keys())
    
    // Remove entities that no longer exist
    for (const [id, entitySprite] of this.entitySprites) {
      if (!currentIds.has(id)) {
        entitySprite.container.destroy()
        this.entitySprites.delete(id)
      }
    }

    // Update or create entities
    for (const [id, entity] of visibleEntities) {
      const isMe = id === myEntityId
      this.updateOrCreateEntity(entity, isMe)
    }
  }

  private updateOrCreateEntity(entity: GameEntity, isMe: boolean) {

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
    let loadingIndicator: Phaser.GameObjects.Graphics | undefined

    const spriteUrl = this.getSpriteUrl(entity)
    const hasValidSprite = spriteUrl && spriteUrl.startsWith('http')
    
    if (hasValidSprite) {
      // Load external sprite with loading indicator
      const textureKey = `entity-${entity.entityId}-${this.getFacingKey(entity.facing)}`
      
      if (!this.textures.exists(textureKey)) {
        // Create pixelated loading placeholder with transparent background
        loadingIndicator = this.add.graphics()
        
        // Draw pixelated dotted border (transparent center)
        const borderColor = isMe ? 0x4ade80 : 0x8b5cf6
        const halfSize = SPRITE_SIZE / 2
        const pixelSize = 4
        
        // Draw pixelated corners and edges
        loadingIndicator.fillStyle(borderColor, 0.8)
        
        // Top-left corner pixels
        loadingIndicator.fillRect(-halfSize, -halfSize, pixelSize * 2, pixelSize)
        loadingIndicator.fillRect(-halfSize, -halfSize + pixelSize, pixelSize, pixelSize)
        
        // Top-right corner pixels
        loadingIndicator.fillRect(halfSize - pixelSize * 2, -halfSize, pixelSize * 2, pixelSize)
        loadingIndicator.fillRect(halfSize - pixelSize, -halfSize + pixelSize, pixelSize, pixelSize)
        
        // Bottom-left corner pixels
        loadingIndicator.fillRect(-halfSize, halfSize - pixelSize, pixelSize * 2, pixelSize)
        loadingIndicator.fillRect(-halfSize, halfSize - pixelSize * 2, pixelSize, pixelSize)
        
        // Bottom-right corner pixels
        loadingIndicator.fillRect(halfSize - pixelSize * 2, halfSize - pixelSize, pixelSize * 2, pixelSize)
        loadingIndicator.fillRect(halfSize - pixelSize, halfSize - pixelSize * 2, pixelSize, pixelSize)
        
        // Center loading dots (will animate)
        loadingIndicator.fillStyle(borderColor, 1)
        loadingIndicator.fillRect(-pixelSize * 1.5, 0, pixelSize, pixelSize)
        loadingIndicator.fillRect(pixelSize * 0.5, 0, pixelSize, pixelSize)
        
        container.add(loadingIndicator)
        
        // Create invisible placeholder for hitbox
        const placeholder = this.add.rectangle(0, 0, SPRITE_SIZE, SPRITE_SIZE, 0x000000, 0)
        container.add(placeholder)
        
        // Start loading with retry
        this.loadExternalTextureWithRetry(textureKey, spriteUrl, container, entity, isMe)
        sprite = placeholder as unknown as Phaser.GameObjects.Sprite
      } else {
        sprite = this.add.sprite(0, 0, textureKey)
        this.scaleSprite(sprite, SPRITE_SIZE)
        container.add(sprite)
      }
    } else {
      // No sprite available - show colored square with first letter
      const color = isMe ? 0x4ade80 : 0x6366f1 // Green for me, indigo for others
      const rect = this.add.rectangle(0, 0, SPRITE_SIZE, SPRITE_SIZE, color)
      rect.setStrokeStyle(2, 0xffffff)
      container.add(rect)
      
      // Show first letter of name instead of arrow
      const initial = (entity.displayName || '?')[0].toUpperCase()
      const text = this.add.text(0, 0, initial, {
        fontSize: '28px',
        fontStyle: 'bold',
        color: '#ffffff'
      }).setOrigin(0.5)
      container.add(text)
      
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

    const textureKey = `entity-${entity.entityId}-${this.getFacingKey(entity.facing)}`
    this.entitySprites.set(entity.entityId, {
      container,
      sprite,
      nameText,
      loadingIndicator,
      lastFacing: entity.facing,
      loadAttempts: 0,
      isLoading: Boolean(hasValidSprite) && !this.textures.exists(textureKey)
    })
  }

  private loadExternalTextureWithRetry(
    textureKey: string,
    url: string,
    container: Phaser.GameObjects.Container,
    entity: GameEntity,
    isMe: boolean,
    attempt: number = 1
  ) {
    const entitySprite = this.entitySprites.get(entity.entityId)
    if (entitySprite) {
      entitySprite.loadAttempts = attempt
      entitySprite.isLoading = true
    }
    
    console.log(`[GameScene] Loading texture for ${entity.displayName} (attempt ${attempt}/${SPRITE_LOAD_MAX_RETRIES})`)
    
    // Add cache-busting parameter for retries
    const urlWithCacheBust = attempt > 1 ? `${url}${url.includes('?') ? '&' : '?'}_retry=${attempt}` : url
    
    this.load.image(textureKey, urlWithCacheBust)
    
    const onError = (file: Phaser.Loader.File) => {
      if (file.key !== textureKey) return
      
      console.warn(`[GameScene] Failed to load texture for ${entity.displayName} (attempt ${attempt})`)
      
      this.load.off('loaderror', onError)
      this.load.off('complete', onComplete)
      
      if (attempt < SPRITE_LOAD_MAX_RETRIES) {
        // Retry after delay
        this.time.delayedCall(SPRITE_LOAD_RETRY_DELAY, () => {
          // Remove failed texture key so we can retry
          if (this.textures.exists(textureKey)) {
            this.textures.remove(textureKey)
          }
          this.loadExternalTextureWithRetry(textureKey, url, container, entity, isMe, attempt + 1)
        })
      } else {
        // Max retries reached - show fallback
        console.error(`[GameScene] Failed to load sprite for ${entity.displayName} after ${SPRITE_LOAD_MAX_RETRIES} attempts`)
        this.showFallbackSprite(container, entity, isMe)
        
        if (entitySprite) {
          entitySprite.isLoading = false
        }
      }
    }
    
    const onComplete = () => {
      this.load.off('loaderror', onError)
      this.load.off('complete', onComplete)
      
      if (this.textures.exists(textureKey)) {
        console.log(`[GameScene] Texture loaded successfully for ${entity.displayName}`)
        
        // Remove placeholder and loading indicator
        container.getAll().forEach(child => {
          if (child instanceof Phaser.GameObjects.Rectangle || child instanceof Phaser.GameObjects.Graphics) {
            child.destroy()
          }
        })
        
        const sprite = this.add.sprite(0, 0, textureKey)
        this.scaleSprite(sprite, SPRITE_SIZE)
        container.addAt(sprite, 0)
        
        const entitySprite = this.entitySprites.get(entity.entityId)
        if (entitySprite) {
          entitySprite.sprite = sprite
          entitySprite.loadingIndicator = undefined
          entitySprite.isLoading = false
        }
      } else {
        // Treat as error
        onError({ key: textureKey } as Phaser.Loader.File)
      }
    }
    
    this.load.on('loaderror', onError)
    this.load.on('complete', onComplete)
    this.load.start()
  }

  private showFallbackSprite(container: Phaser.GameObjects.Container, entity: GameEntity, isMe: boolean) {
    // Remove loading elements
    container.getAll().forEach(child => {
      if (child instanceof Phaser.GameObjects.Rectangle || child instanceof Phaser.GameObjects.Graphics) {
        child.destroy()
      }
    })
    
    // Create fallback colored square with initial
    const color = isMe ? 0x4ade80 : 0x6366f1
    const rect = this.add.rectangle(0, 0, SPRITE_SIZE, SPRITE_SIZE, color)
    rect.setStrokeStyle(2, 0xffffff)
    container.addAt(rect, 0)
    
    const initial = (entity.displayName || '?')[0].toUpperCase()
    const text = this.add.text(0, 0, initial, {
      fontSize: '28px',
      fontStyle: 'bold',
      color: '#ffffff'
    }).setOrigin(0.5)
    container.addAt(text, 1)
    
    const entitySprite = this.entitySprites.get(entity.entityId)
    if (entitySprite) {
      entitySprite.sprite = rect as unknown as Phaser.GameObjects.Sprite
      entitySprite.loadingIndicator = undefined
    }
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

  update(time: number) {
    const { mode, inputEnabled, onDirectionChange } = this.sceneDataRef.current
    
    // Animate loading indicators with pulsing effect
    for (const [, entitySprite] of this.entitySprites) {
      if (entitySprite.isLoading && entitySprite.loadingIndicator) {
        // Pulsing alpha effect
        const pulse = Math.sin(time * 0.005) * 0.3 + 0.7
        entitySprite.loadingIndicator.setAlpha(pulse)
      }
    }
    
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
