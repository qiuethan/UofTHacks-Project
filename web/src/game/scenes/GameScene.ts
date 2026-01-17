import Phaser from 'phaser'
import type { GameEntity, SceneData } from '../types'

// Character sprite dimensions
const SPRITE_WIDTH = 80
const SPRITE_HEIGHT = 120  // Taller characters
const GRID_SIZE = 32

interface EntitySprite {
  container: Phaser.GameObjects.Container
  sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image
  hoverBanner?: Phaser.GameObjects.Container
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
    // Entity hitbox is 2x1 (bottom row only), so position at the hitbox center
    // Visual sprite extends upward from the hitbox
    const targetX = entity.x * GRID_SIZE + GRID_SIZE  // Center of 2-wide hitbox
    const targetY = entity.y * GRID_SIZE + GRID_SIZE / 2  // Center of 1-tall hitbox

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
        // Placeholder while loading - offset upward so bottom aligns with hitbox
        const placeholder = this.add.rectangle(0, -SPRITE_HEIGHT / 2 + GRID_SIZE / 2, SPRITE_WIDTH, SPRITE_HEIGHT, isMe ? 0x4ade80 : 0xf87171)
        container.add(placeholder)
        
        this.loadExternalTexture(textureKey, spriteUrl, container, entity)
        sprite = placeholder as unknown as Phaser.GameObjects.Sprite
      } else {
        sprite = this.add.sprite(0, -SPRITE_HEIGHT / 2 + GRID_SIZE / 2, textureKey)
        this.scaleSprite(sprite)
        container.add(sprite)
      }
    } else {
      // Default colored rectangle with direction arrow - offset upward
      const color = isMe ? 0x4ade80 : (entity.color ? parseInt(entity.color.replace('#', ''), 16) : 0xf87171)
      const rect = this.add.rectangle(0, -SPRITE_HEIGHT / 2 + GRID_SIZE / 2, SPRITE_WIDTH, SPRITE_HEIGHT, color)
      rect.setStrokeStyle(2, 0xffffff)
      container.add(rect)
      
      const arrow = this.add.text(0, -SPRITE_HEIGHT / 2 + GRID_SIZE / 2, this.getFacingArrow(entity.facing), {
        fontSize: '24px',
        color: '#ffffff'
      }).setOrigin(0.5)
      container.add(arrow)
      
      sprite = rect as unknown as Phaser.GameObjects.Sprite
    }

    // Create hover banner (shown on hover) - positioned above the sprite
    const hoverBanner = this.createHoverBanner(entity, isMe)
    hoverBanner.setPosition(0, -SPRITE_HEIGHT + GRID_SIZE / 2 - 60)
    hoverBanner.setVisible(false)
    container.add(hoverBanner)

    // Hover interaction - cover the full visual sprite area
    container.setInteractive(
      new Phaser.Geom.Rectangle(-SPRITE_WIDTH / 2, -SPRITE_HEIGHT + GRID_SIZE / 2, SPRITE_WIDTH, SPRITE_HEIGHT),
      Phaser.Geom.Rectangle.Contains
    )
    container.on('pointerover', () => hoverBanner.setVisible(true))
    container.on('pointerout', () => hoverBanner.setVisible(false))

    // Player highlight and camera setup
    if (isMe) {
      // Arrow pointing down above the player's head
      const arrow = this.add.text(0, -SPRITE_HEIGHT + GRID_SIZE / 2 + 10, '▼', {
        fontSize: '36px',
        color: '#4ade80'
      }).setOrigin(0.5)
      container.add(arrow)
      
      // Add bobbing animation to the arrow
      this.tweens.add({
        targets: arrow,
        y: arrow.y - 8,
        duration: 500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      })
      
      if (this.sceneDataRef.current.mode === 'play') {
        this.cameras.main.startFollow(container, true, 0.1, 0.1)
        this.cameras.main.setZoom(0.75)
        this.cameras.main.setDeadzone(0, 0)
      }
    }

    this.entitySprites.set(entity.entityId, {
      container,
      sprite,
      hoverBanner,
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
        
        const sprite = this.add.sprite(0, -SPRITE_HEIGHT / 2 + GRID_SIZE / 2, textureKey)
        this.scaleSprite(sprite)
        container.addAt(sprite, 0)
        
        const entitySprite = this.entitySprites.get(entity.entityId)
        if (entitySprite) {
          entitySprite.sprite = sprite
        }
      }
    })
    this.load.start()
  }

  private scaleSprite(sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image) {
    const texture = sprite.texture
    const frame = texture.get()
    
    if (frame && frame.width > 0 && frame.height > 0) {
      // Try to measure actual content bounds from non-transparent pixels
      const contentBounds = this.getContentBounds(texture, frame)
      
      if (contentBounds) {
        // Scale based on content height to standardize all sprites
        const contentHeight = contentBounds.bottom - contentBounds.top
        const scale = SPRITE_HEIGHT / contentHeight
        sprite.setScale(scale)
        
        // Adjust origin to align bottom of content with bottom of sprite area
        // Content bottom should align with the hitbox
        const frameHeight = frame.height
        const contentCenterY = (contentBounds.top + contentBounds.bottom) / 2
        const originY = contentCenterY / frameHeight
        sprite.setOrigin(0.5, originY)
      } else {
        // Fallback: scale to fit height
        const scale = SPRITE_HEIGHT / frame.height
        sprite.setScale(scale)
      }
    } else {
      sprite.setDisplaySize(SPRITE_WIDTH, SPRITE_HEIGHT)
    }
  }
  
  private getContentBounds(texture: Phaser.Textures.Texture, frame: Phaser.Textures.Frame): { top: number; bottom: number } | null {
    try {
      // Get the source image
      const source = texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement
      if (!source) return null
      
      // Create a temporary canvas to read pixel data
      const canvas = document.createElement('canvas')
      canvas.width = frame.width
      canvas.height = frame.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      
      // Draw the image onto the canvas
      ctx.drawImage(source, 0, 0)
      
      // Get pixel data
      const imageData = ctx.getImageData(0, 0, frame.width, frame.height)
      const data = imageData.data
      
      let topmost = frame.height
      let bottommost = 0
      
      // Scan for non-transparent pixels
      for (let y = 0; y < frame.height; y++) {
        for (let x = 0; x < frame.width; x++) {
          const alpha = data[(y * frame.width + x) * 4 + 3]
          if (alpha > 10) { // Non-transparent threshold
            if (y < topmost) topmost = y
            if (y > bottommost) bottommost = y
          }
        }
      }
      
      if (topmost >= bottommost) return null
      
      return { top: topmost, bottom: bottommost }
    } catch {
      return null
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
              this.scaleSprite(entitySprite.sprite)
            }
          })
          this.load.start()
        } else if (entitySprite.sprite instanceof Phaser.GameObjects.Sprite) {
          entitySprite.sprite.setTexture(textureKey)
          this.scaleSprite(entitySprite.sprite)
        }
      }
    }

    // Banner updates handled by recreating if needed
  }

  private createHoverBanner(entity: GameEntity, isMe: boolean): Phaser.GameObjects.Container {
    const banner = this.add.container(0, 0)
    const isPlayMode = this.sceneDataRef.current.mode === 'play'
    const showButton = isPlayMode && !isMe && entity.kind !== 'WALL'
    
    // Calculate banner size
    const bannerWidth = 200
    const bannerHeight = showButton ? 80 : 50
    
    // Translucent tinted background
    const bg = this.add.rectangle(0, 0, bannerWidth, bannerHeight, 0x1a1a2e, 0.85)
    bg.setStrokeStyle(2, 0x4ade80, 0.6)
    banner.add(bg)
    
    // Display name with sophisticated font
    const nameText = this.add.text(0, showButton ? -15 : 0, entity.displayName || 'Unknown', {
      fontFamily: 'Georgia, "Times New Roman", serif',
      fontSize: '20px',
      fontStyle: 'italic',
      color: '#ffffff',
      shadow: {
        offsetX: 2,
        offsetY: 2,
        color: '#000000',
        blur: 4,
        fill: true
      }
    }).setOrigin(0.5)
    banner.add(nameText)
    
    // Conversation button (only in play mode, for other entities, not self)
    if (showButton) {
      const canConverse = entity.conversationState === 'IDLE' || !entity.conversationState
      
      const btnBg = this.add.rectangle(0, 20, 120, 30, canConverse ? 0x4ade80 : 0x555555, 0.9)
      btnBg.setStrokeStyle(1, 0xffffff, 0.5)
      banner.add(btnBg)
      
      const btnText = this.add.text(0, 20, canConverse ? '💬 Talk' : 'Busy', {
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontSize: '14px',
        color: canConverse ? '#1a1a2e' : '#888888'
      }).setOrigin(0.5)
      banner.add(btnText)
      
      if (canConverse) {
        btnBg.setInteractive({ useHandCursor: true })
        btnBg.on('pointerover', () => {
          btnBg.setFillStyle(0x22c55e, 1)
        })
        btnBg.on('pointerout', () => {
          btnBg.setFillStyle(0x4ade80, 0.9)
        })
        btnBg.on('pointerdown', () => {
          this.initiateConversation(entity.entityId)
        })
      }
    }
    
    // Set high depth so it appears above other sprites
    banner.setDepth(1000)
    
    return banner
  }

  private initiateConversation(targetEntityId: string) {
    // Emit event to parent React component to handle conversation initiation
    const myEntityId = this.sceneDataRef.current.myEntityId
    if (myEntityId && myEntityId !== targetEntityId) {
      // Dispatch a custom event that React can listen to
      window.dispatchEvent(new CustomEvent('initiateConversation', {
        detail: { targetEntityId }
      }))
    }
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
