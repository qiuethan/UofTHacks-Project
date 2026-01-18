import Phaser from 'phaser'
import type { GameEntity, SceneData } from '../types'
import type { ChatMessage } from '../../types/game'

// Character sprite dimensions
const SPRITE_WIDTH = 80
const SPRITE_HEIGHT = 120  // Taller characters
const GRID_SIZE = 32

// Sprite loading configuration
const SPRITE_LOAD_MAX_RETRIES = 3
const SPRITE_LOAD_RETRY_DELAY = 1000

// Chat bubble configuration
const CHAT_BUBBLE_WIDTH = 200
const CHAT_BUBBLE_HEIGHT = 60
const CHAT_BUBBLE_DISPLAY_TIME = 5000  // ms to show each message

interface EntitySprite {
  container: Phaser.GameObjects.Container
  sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image
  hoverBanner?: Phaser.GameObjects.Container
  chatBubble?: Phaser.GameObjects.Container
  loadingIndicator?: Phaser.GameObjects.Graphics
  lastFacing?: { x: number; y: number }
  loadAttempts: number
  isLoading: boolean
  lastMessageId?: string
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
  private isInConversation = false
  private conversationZoomTween?: Phaser.Tweens.Tween
  private lastProcessedMessageId?: string

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

  updateChatBubbles(messages: ChatMessage[], inConversationWith: string | null | undefined) {
    const { myEntityId, mode } = this.sceneDataRef.current
    
    // Handle conversation zoom
    if (inConversationWith && !this.isInConversation && mode === 'play') {
      this.isInConversation = true
      this.zoomInOnConversation(myEntityId || '', inConversationWith)
    } else if (!inConversationWith && this.isInConversation) {
      this.isInConversation = false
      this.zoomOutFromConversation()
    }
    
    // Get the latest message
    if (messages.length === 0) return
    
    const latestMessage = messages[messages.length - 1]
    
    // Skip if we've already processed this message
    if (latestMessage.id === this.lastProcessedMessageId) return
    this.lastProcessedMessageId = latestMessage.id
    
    // Show chat bubble above the sender
    const senderSprite = this.entitySprites.get(latestMessage.senderId)
    if (senderSprite) {
      this.showChatBubble(senderSprite, latestMessage.content, latestMessage.senderId === myEntityId)
    }
  }

  // Track which messages we've shown for each entity
  private shownEntityMessages: Map<string, string> = new Map()

  updateAllEntityBubbles(allEntityMessages: Map<string, ChatMessage>) {
    const { myEntityId } = this.sceneDataRef.current
    
    // Show chat bubbles for all entities with recent messages
    for (const [entityId, message] of allEntityMessages) {
      // Skip if we've already shown this exact message
      if (this.shownEntityMessages.get(entityId) === message.id) continue
      this.shownEntityMessages.set(entityId, message.id)
      
      const entitySprite = this.entitySprites.get(entityId)
      if (entitySprite) {
        const isMe = entityId === myEntityId
        this.showChatBubble(entitySprite, message.content, isMe)
      }
    }
    
    // Clean up tracking for entities that no longer have messages
    for (const [entityId] of this.shownEntityMessages) {
      if (!allEntityMessages.has(entityId)) {
        this.shownEntityMessages.delete(entityId)
      }
    }
  }

  private zoomInOnConversation(myEntityId: string, partnerId: string) {
    const mySprite = this.entitySprites.get(myEntityId)
    const partnerSprite = this.entitySprites.get(partnerId)
    
    if (!mySprite || !partnerSprite) return
    
    // Calculate center point between the two entities
    const centerX = (mySprite.container.x + partnerSprite.container.x) / 2
    const centerY = (mySprite.container.y + partnerSprite.container.y) / 2
    
    // Stop following player
    this.cameras.main.stopFollow()
    
    // Smoothly zoom in and pan to conversation center
    if (this.conversationZoomTween) {
      this.conversationZoomTween.stop()
    }
    
    this.conversationZoomTween = this.tweens.add({
      targets: this.cameras.main,
      zoom: 1.5,
      scrollX: centerX - this.cameras.main.width / 2 / 1.5,
      scrollY: centerY - this.cameras.main.height / 2 / 1.5,
      duration: 500,
      ease: 'Sine.easeInOut'
    })
  }

  private zoomOutFromConversation() {
    const { myEntityId, mode } = this.sceneDataRef.current
    const mySprite = myEntityId ? this.entitySprites.get(myEntityId) : null
    
    if (this.conversationZoomTween) {
      this.conversationZoomTween.stop()
    }
    
    // Zoom back out
    this.conversationZoomTween = this.tweens.add({
      targets: this.cameras.main,
      zoom: 0.75,
      duration: 300,
      ease: 'Sine.easeOut',
      onComplete: () => {
        // Resume following the player
        if (mySprite && mode === 'play') {
          this.cameras.main.startFollow(mySprite.container, true, 0.1, 0.1)
        }
      }
    })
    
    // Clear all chat bubbles
    for (const [, entitySprite] of this.entitySprites) {
      if (entitySprite.chatBubble) {
        entitySprite.chatBubble.destroy()
        entitySprite.chatBubble = undefined
      }
    }
  }

  private showChatBubble(entitySprite: EntitySprite, message: string, isMe: boolean) {
    // Remove existing bubble
    if (entitySprite.chatBubble) {
      entitySprite.chatBubble.destroy()
    }
    
    // Create new chat bubble
    const bubble = this.add.container(0, -SPRITE_HEIGHT - 30)
    bubble.setDepth(2000)
    
    // Truncate long messages
    const displayMessage = message.length > 50 ? message.substring(0, 47) + '...' : message
    
    // Calculate text dimensions first
    const textStyle = {
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
      color: '#000000',
      wordWrap: { width: CHAT_BUBBLE_WIDTH - 20 }
    }
    const tempText = this.add.text(0, 0, displayMessage, textStyle)
    const textWidth = Math.min(tempText.width + 24, CHAT_BUBBLE_WIDTH)
    const textHeight = tempText.height + 16
    tempText.destroy()
    
    // Background with tail
    const bgColor = isMe ? 0x4ade80 : 0xffffff
    const bg = this.add.graphics()
    
    // Draw rounded rectangle
    bg.fillStyle(bgColor, 0.95)
    bg.fillRoundedRect(-textWidth / 2, -textHeight / 2, textWidth, textHeight, 12)
    
    // Draw tail pointing down
    bg.fillTriangle(
      isMe ? 10 : -10, textHeight / 2 - 2,
      isMe ? 20 : -20, textHeight / 2 + 12,
      isMe ? 25 : -25, textHeight / 2 - 2
    )
    
    // Add border
    bg.lineStyle(2, 0x333333, 0.3)
    bg.strokeRoundedRect(-textWidth / 2, -textHeight / 2, textWidth, textHeight, 12)
    
    bubble.add(bg)
    
    // Add text
    const text = this.add.text(0, 0, displayMessage, {
      ...textStyle,
      wordWrap: { width: textWidth - 20 }
    }).setOrigin(0.5)
    bubble.add(text)
    
    // Add to entity container
    entitySprite.container.add(bubble)
    entitySprite.chatBubble = bubble
    
    // Fade in animation
    bubble.setAlpha(0)
    this.tweens.add({
      targets: bubble,
      alpha: 1,
      y: bubble.y - 10,
      duration: 200,
      ease: 'Back.easeOut'
    })
    
    // Auto-hide after delay
    this.time.delayedCall(CHAT_BUBBLE_DISPLAY_TIME, () => {
      if (entitySprite.chatBubble === bubble) {
        this.tweens.add({
          targets: bubble,
          alpha: 0,
          y: bubble.y - 20,
          duration: 300,
          onComplete: () => {
            if (entitySprite.chatBubble === bubble) {
              bubble.destroy()
              entitySprite.chatBubble = undefined
            }
          }
        })
      }
    })
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
        const halfSize = SPRITE_WIDTH / 2
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
        const placeholder = this.add.rectangle(0, 0, SPRITE_WIDTH, SPRITE_HEIGHT, 0x000000, 0)
        container.add(placeholder)
        
        // Start loading with retry
        this.loadExternalTextureWithRetry(textureKey, spriteUrl, container, entity, isMe)
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
      
      const arrowText = this.add.text(0, -SPRITE_HEIGHT / 2 + GRID_SIZE / 2, this.getFacingArrow(entity.facing), {
        fontSize: '24px',
        color: '#ffffff'
      }).setOrigin(0.5)
      container.add(arrowText)
      
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

    const textureKey = `entity-${entity.entityId}-${this.getFacingKey(entity.facing)}`
    this.entitySprites.set(entity.entityId, {
      container,
      sprite,
      hoverBanner,
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
        
        const sprite = this.add.sprite(0, -SPRITE_HEIGHT / 2 + GRID_SIZE / 2, textureKey)
        this.scaleSprite(sprite)
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
    const rect = this.add.rectangle(0, 0, SPRITE_WIDTH, SPRITE_HEIGHT, color)
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
