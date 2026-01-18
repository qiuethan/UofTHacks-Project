import Phaser from 'phaser'
import type { GameEntity, SceneData, WorldLocation } from '../types'
import type { ChatMessage, LocationType } from '../../types/game'

// Character sprite dimensions
const SPRITE_WIDTH = 80
const SPRITE_HEIGHT = 120  // Taller characters
const GRID_SIZE = 32

// Location type colors for rendering
const LOCATION_COLORS: Record<LocationType, number> = {
  food: 0x22c55e,       // green - eating
  karaoke: 0xec4899,    // pink - singing
  rest_area: 0x3b82f6,  // blue - resting
  social_hub: 0xf59e0b, // amber - socializing
  wander_point: 0x8b5cf6 // purple - wandering
}

// Location dot size
const LOCATION_DOT_SIZE = 16

// Sprite loading configuration
const SPRITE_LOAD_MAX_RETRIES = 3
const SPRITE_LOAD_RETRY_DELAY = 1000

// Chat bubble configuration
const CHAT_BUBBLE_MAX_WIDTH = 220
const CHAT_BUBBLE_MIN_WIDTH = 80
const CHAT_BUBBLE_MAX_CHARS = 80  // Max characters before truncation
const CHAT_BUBBLE_DISPLAY_TIME = 6000  // ms to show each message

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

// Location sprite interface
interface LocationSprite {
  container: Phaser.GameObjects.Container
  dot: Phaser.GameObjects.Graphics
  hoverBanner?: Phaser.GameObjects.Container
}

export class GameScene extends Phaser.Scene {
  private sceneDataRef: React.MutableRefObject<SceneData>
  private entitySprites: Map<string, EntitySprite> = new Map()
  private locationSprites: Map<string, LocationSprite> = new Map()
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd?: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key }
  private lastDirection = { x: 0, y: 0 }
  private worldWidth = 0
  private worldHeight = 0
  private background?: Phaser.GameObjects.Image
  private isInConversation = false
  private conversationZoomTween?: Phaser.Tweens.Tween
  private lastProcessedMessageId?: string
  // Watch mode drag-to-pan state
  private isDragging = false
  private dragStartX = 0
  private dragStartY = 0
  private cameraStartX = 0
  private cameraStartY = 0
  private defaultWatchZoom = 1 // Stores the fit-to-screen zoom level
  private watchModeInputSetup = false // Prevent duplicate event listeners
  private lastWheelTime = 0 // Track last wheel event to debounce
  private wheelDebounceMs = 50 // Minimum time between wheel events
  private followingEntityId: string | null = null

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

    // Initial world location rendering
    if (this.sceneDataRef.current.worldLocations) {
      this.updateWorldLocations(this.sceneDataRef.current.worldLocations)
    }

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
    const { watchZoom } = this.sceneDataRef.current
    
    // Calculate default zoom to fit entire background in viewport
    const zoomX = viewportWidth / this.worldWidth
    const zoomY = viewportHeight / this.worldHeight
    this.defaultWatchZoom = Math.min(zoomX, zoomY)
    
    // watchZoom is a multiplier: undefined/1.0 = default, 2.0 = 2x default, etc.
    const zoomMultiplier = watchZoom !== undefined ? watchZoom : 1.0
    const actualZoom = this.defaultWatchZoom * zoomMultiplier
    
    this.cameras.main.setZoom(actualZoom)
    this.cameras.main.removeBounds()
    
    // Always center on world center
    this.cameras.main.centerOn(this.worldWidth / 2, this.worldHeight / 2)
    
    // Enable drag-to-pan in watch mode
    this.setupWatchModeDragPan()
  }

  private setupWatchModeDragPan() {
    // Only setup once to prevent duplicate event listeners
    if (this.watchModeInputSetup) return
    this.watchModeInputSetup = true
    
    // Enable drag-to-pan (only when zoomed in past default)
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.sceneDataRef.current.mode !== 'watch') return
      // Only allow dragging when zoomed in past default
      if (this.cameras.main.zoom <= this.defaultWatchZoom * 1.05) return
      
      this.isDragging = true
      this.dragStartX = pointer.x
      this.dragStartY = pointer.y
      this.cameraStartX = this.cameras.main.scrollX
      this.cameraStartY = this.cameras.main.scrollY
    })

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.isDragging || this.sceneDataRef.current.mode !== 'watch') return
      
      const camera = this.cameras.main
      const dx = (this.dragStartX - pointer.x) / camera.zoom
      const dy = (this.dragStartY - pointer.y) / camera.zoom
      
      camera.scrollX = this.cameraStartX + dx
      camera.scrollY = this.cameraStartY + dy
    })

    this.input.on('pointerup', () => {
      this.isDragging = false
    })

    this.input.on('pointerupoutside', () => {
      this.isDragging = false
    })

    // Mouse wheel zoom - zoom relative to default
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: any[], _deltaX: number, deltaY: number, event: WheelEvent) => {
      if (this.sceneDataRef.current.mode !== 'watch') return
      
      // Debounce wheel events to prevent glitches
      const now = Date.now()
      if (now - this.lastWheelTime < this.wheelDebounceMs) {
        event.preventDefault()
        return
      }
      this.lastWheelTime = now
      
      // Prevent default browser scroll behavior
      event.preventDefault()
      event.stopPropagation()
      
      const camera = this.cameras.main
      const currentZoom = camera.zoom
      const zoomFactor = deltaY > 0 ? 0.9 : 1.1 // Scroll down = zoom out, scroll up = zoom in
      
      // Calculate new zoom, clamped between default and 4x default
      const minZoom = this.defaultWatchZoom
      const maxZoom = this.defaultWatchZoom * 4
      const newZoom = Phaser.Math.Clamp(currentZoom * zoomFactor, minZoom, maxZoom)
      
      // Only apply if zoom actually changed (prevents issues when at limits)
      if (Math.abs(newZoom - currentZoom) > 0.001) {
        camera.setZoom(newZoom)
        
        // If at or near default zoom, ensure centered
        if (newZoom <= this.defaultWatchZoom * 1.05) {
          camera.centerOn(this.worldWidth / 2, this.worldHeight / 2)
        }
      }
    })
  }

  // Public method to update camera from React props
  updateWatchCamera(zoomMultiplier?: number, _pan?: { x: number; y: number }) {
    if (this.sceneDataRef.current.mode !== 'watch') return
    
    const camera = this.cameras.main
    
    // zoomMultiplier: undefined/1.0 = default, 2.0 = 2x default, etc.
    const multiplier = zoomMultiplier !== undefined ? zoomMultiplier : 1.0
    const actualZoom = this.defaultWatchZoom * multiplier
    
    camera.setZoom(actualZoom)
    
    // If at default zoom (multiplier <= 1), center on world
    if (multiplier <= 1.05) {
      camera.centerOn(this.worldWidth / 2, this.worldHeight / 2)
    }
  }

  // Follow a specific entity by ID (for agent monitor)
  followEntity(entityId: string | null) {
    this.followingEntityId = entityId
    
    if (!entityId) {
      // Stop following the selected agent
      this.cameras.main.stopFollow()
      
      if (this.sceneDataRef.current.mode === 'play') {
        // In play mode, return to following the player
        const myEntityId = this.sceneDataRef.current.myEntityId
        if (myEntityId) {
          const mySprite = this.entitySprites.get(myEntityId)
          if (mySprite) {
            this.cameras.main.setBounds(0, 0, this.worldWidth, this.worldHeight)
            this.cameras.main.startFollow(mySprite.container, true, 0.1, 0.1)
            this.cameras.main.setZoom(0.75)
            this.cameras.main.setDeadzone(0, 0)
          }
        }
      } else {
        // In watch mode, return to overview
        this.setupWatchModeCamera()
      }
      return
    }
    
    const entitySprite = this.entitySprites.get(entityId)
    if (entitySprite) {
      // Match exact play mode camera settings
      this.cameras.main.setBounds(0, 0, this.worldWidth, this.worldHeight)
      this.cameras.main.startFollow(entitySprite.container, true, 0.1, 0.1)
      this.cameras.main.setZoom(0.75)
      this.cameras.main.setDeadzone(0, 0)
    }
  }
  
  // Get the currently followed entity ID
  getFollowingEntityId(): string | null {
    return this.followingEntityId
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

  // Render world locations as colored dots
  updateWorldLocations(locations: WorldLocation[]) {
    const currentIds = new Set(locations.map(l => l.id))
    
    // Remove locations that no longer exist
    for (const [id, locationSprite] of this.locationSprites) {
      if (!currentIds.has(id)) {
        locationSprite.container.destroy()
        this.locationSprites.delete(id)
      }
    }
    
    // Update or create locations
    for (const location of locations) {
      if (!this.locationSprites.has(location.id)) {
        this.createLocationSprite(location)
      }
    }
  }

  private createLocationSprite(location: WorldLocation) {
    // Convert grid position to pixel position
    const pixelX = location.x * GRID_SIZE + GRID_SIZE / 2
    const pixelY = location.y * GRID_SIZE + GRID_SIZE / 2
    
    const container = this.add.container(pixelX, pixelY)
    container.setDepth(5) // Below entities but above background
    
    // Create the colored dot
    const dot = this.add.graphics()
    const color = LOCATION_COLORS[location.location_type] || 0xffffff
    
    // Draw outer ring (border)
    dot.fillStyle(0x000000, 1)
    dot.fillCircle(0, 0, LOCATION_DOT_SIZE / 2 + 2)
    
    // Draw inner colored circle
    dot.fillStyle(color, 1)
    dot.fillCircle(0, 0, LOCATION_DOT_SIZE / 2)
    
    // Add pulsing animation
    this.tweens.add({
      targets: container,
      scaleX: 1.15,
      scaleY: 1.15,
      duration: 1000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    })
    
    container.add(dot)
    
    // Create hover banner
    const hoverBanner = this.createLocationHoverBanner(location)
    hoverBanner.setPosition(0, -LOCATION_DOT_SIZE - 15)
    hoverBanner.setVisible(false)
    container.add(hoverBanner)
    
    // Add hover interaction
    container.setInteractive(
      new Phaser.Geom.Circle(0, 0, LOCATION_DOT_SIZE),
      Phaser.Geom.Circle.Contains
    )
    
    container.on('pointerover', () => {
      hoverBanner.setVisible(true)
    })
    container.on('pointerout', () => {
      hoverBanner.setVisible(false)
    })
    
    this.locationSprites.set(location.id, {
      container,
      dot,
      hoverBanner
    })
  }

  private createLocationHoverBanner(location: WorldLocation): Phaser.GameObjects.Container {
    const banner = this.add.container(0, 0)
    
    // Create text first to measure its width
    const nameText = this.add.text(0, 0, location.name, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#000000'
    }).setOrigin(0.5)
    
    // Size background based on text
    const padding = 8
    const bannerWidth = nameText.width + padding * 2
    const bannerHeight = nameText.height + padding
    
    // Background with border
    const bg = this.add.graphics()
    const color = LOCATION_COLORS[location.location_type] || 0xffffff
    
    // Colored background
    bg.fillStyle(color, 0.95)
    bg.fillRect(-bannerWidth / 2, -bannerHeight / 2, bannerWidth, bannerHeight)
    
    // Black border
    bg.lineStyle(2, 0x000000, 1)
    bg.strokeRect(-bannerWidth / 2, -bannerHeight / 2, bannerWidth, bannerHeight)
    
    banner.add(bg)
    
    // White text for better contrast
    nameText.setStyle({ color: '#ffffff' })
    banner.add(nameText)
    
    banner.setDepth(1000)
    
    return banner
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
    
    // Truncate long messages with ellipsis
    let displayMessage = message.trim()
    if (displayMessage.length > CHAT_BUBBLE_MAX_CHARS) {
      displayMessage = displayMessage.substring(0, CHAT_BUBBLE_MAX_CHARS - 3) + '...'
    }
    
    // Create new chat bubble - position above sprite
    const bubble = this.add.container(0, -SPRITE_HEIGHT - 25)
    bubble.setDepth(2000)
    
    // Text style with word wrap
    const textStyle = {
      fontFamily: '"Nunito", Arial, sans-serif',
      fontSize: '13px',
      color: '#000000',
      wordWrap: { width: CHAT_BUBBLE_MAX_WIDTH - 20, useAdvancedWrap: true }
    }
    
    // Create temp text to measure dimensions
    const tempText = this.add.text(0, 0, displayMessage, textStyle)
    const measuredWidth = tempText.width
    const measuredHeight = tempText.height
    tempText.destroy()
    
    // Calculate bubble dimensions
    const padding = 12
    const bubbleWidth = Math.max(CHAT_BUBBLE_MIN_WIDTH, Math.min(measuredWidth + padding * 2, CHAT_BUBBLE_MAX_WIDTH))
    const bubbleHeight = Math.max(28, measuredHeight + padding)
    
    // Background colors based on who's speaking
    const bgColor = isMe ? 0x007a28 : 0xFFF8F0  // Green for me, cream for others
    const borderColor = isMe ? 0x005018 : 0x000000
    const textColor = isMe ? '#ffffff' : '#000000'
    
    // Draw background
    const bg = this.add.graphics()
    
    // Main bubble rectangle with slight rounding effect via shadow
    bg.fillStyle(borderColor, 1)
    bg.fillRect(-bubbleWidth / 2 - 2, -bubbleHeight / 2 - 2, bubbleWidth + 4, bubbleHeight + 4)
    bg.fillStyle(bgColor, 1)
    bg.fillRect(-bubbleWidth / 2, -bubbleHeight / 2, bubbleWidth, bubbleHeight)
    
    // Draw tail pointing down (small triangle)
    const tailOffset = isMe ? 8 : -8
    bg.fillStyle(borderColor, 1)
    bg.fillTriangle(
      tailOffset - 6, bubbleHeight / 2,
      tailOffset + 6, bubbleHeight / 2,
      tailOffset, bubbleHeight / 2 + 10
    )
    bg.fillStyle(bgColor, 1)
    bg.fillTriangle(
      tailOffset - 4, bubbleHeight / 2 - 1,
      tailOffset + 4, bubbleHeight / 2 - 1,
      tailOffset, bubbleHeight / 2 + 6
    )
    
    bubble.add(bg)
    
    // Add text centered in bubble
    const text = this.add.text(0, 0, displayMessage, {
      ...textStyle,
      color: textColor,
      wordWrap: { width: bubbleWidth - padding * 2, useAdvancedWrap: true },
      align: 'center'
    }).setOrigin(0.5)
    bubble.add(text)
    
    // Add to entity container
    entitySprite.container.add(bubble)
    entitySprite.chatBubble = bubble
    
    // Fade in animation with bounce
    bubble.setAlpha(0)
    bubble.setScale(0.8)
    this.tweens.add({
      targets: bubble,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      y: bubble.y - 8,
      duration: 250,
      ease: 'Back.easeOut'
    })
    
    // Auto-hide after delay
    this.time.delayedCall(CHAT_BUBBLE_DISPLAY_TIME, () => {
      if (entitySprite.chatBubble === bubble) {
        this.tweens.add({
          targets: bubble,
          alpha: 0,
          y: bubble.y - 15,
          scaleX: 0.9,
          scaleY: 0.9,
          duration: 300,
          ease: 'Quad.easeIn',
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
        const borderColor = 0x000000
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
      const color = 0xffffff
      const rect = this.add.rectangle(0, -SPRITE_HEIGHT / 2 + GRID_SIZE / 2, SPRITE_WIDTH, SPRITE_HEIGHT, color)
      rect.setStrokeStyle(2, 0x000000)
      container.add(rect)
      
      const arrowText = this.add.text(0, -SPRITE_HEIGHT / 2 + GRID_SIZE / 2, this.getFacingArrow(entity.facing), {
        fontSize: '24px',
        color: '#000000'
      }).setOrigin(0.5)
      container.add(arrowText)
      
      sprite = rect as unknown as Phaser.GameObjects.Sprite
    }

    // Create hover banner (shown on hover) - positioned above the sprite
    const hoverBanner = this.createHoverBanner(entity, isMe)
    hoverBanner.setPosition(0, -SPRITE_HEIGHT + GRID_SIZE / 2 - 30)
    hoverBanner.setVisible(false)
    container.add(hoverBanner)

    // Hover interaction - cover the full visual sprite area
    container.setInteractive(
      new Phaser.Geom.Rectangle(-SPRITE_WIDTH / 2, -SPRITE_HEIGHT + GRID_SIZE / 2, SPRITE_WIDTH, SPRITE_HEIGHT),
      Phaser.Geom.Rectangle.Contains
    )
    
    container.on('pointerover', () => {
      hoverBanner.setVisible(true)
    })
    container.on('pointerout', () => {
      hoverBanner.setVisible(false)
    })

    // Player highlight and camera setup
    if (isMe) {
      // Arrow pointing down above the player's head (moved up higher)
      const arrow = this.add.text(0, -SPRITE_HEIGHT + GRID_SIZE / 2 - 40, '▼', {
        fontSize: '36px',
        color: '#000000'
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

  private showFallbackSprite(container: Phaser.GameObjects.Container, entity: GameEntity, _isMe: boolean) {
    // Remove loading elements
    container.getAll().forEach(child => {
      if (child instanceof Phaser.GameObjects.Rectangle || child instanceof Phaser.GameObjects.Graphics) {
        child.destroy()
      }
    })
    
    // Create fallback colored square with initial
    const color = 0xffffff
    const rect = this.add.rectangle(0, 0, SPRITE_WIDTH, SPRITE_HEIGHT, color)
    rect.setStrokeStyle(2, 0x000000)
    container.addAt(rect, 0)
    
    const initial = (entity.displayName || '?')[0].toUpperCase()
    const text = this.add.text(0, 0, initial, {
      fontSize: '28px',
      fontStyle: 'bold',
      color: '#000000'
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
        
        // Check if sprite URL has changed - if so, load new texture before removing old one
        const existingTexture = this.textures.get(textureKey)
        let urlChanged = false
        if (existingTexture && existingTexture.source[0]) {
          const source = existingTexture.source[0].source
          if (source instanceof HTMLImageElement && source.src !== spriteUrl) {
            console.log(`[GameScene] Sprite URL changed for ${entity.displayName}, will reload`)
            urlChanged = true
          }
        }
        
        if (urlChanged) {
          // URL changed - load new texture with temp key, then swap (prevents flickering)
          const tempKey = `${textureKey}-reload-${Date.now()}`
          this.load.image(tempKey, spriteUrl)
          this.load.once('complete', () => {
            if (this.textures.exists(tempKey) && entitySprite.sprite instanceof Phaser.GameObjects.Sprite) {
              // Swap to new texture
              entitySprite.sprite.setTexture(tempKey)
              this.scaleSprite(entitySprite.sprite)
              // Now safe to remove old texture
              if (this.textures.exists(textureKey)) {
                this.textures.remove(textureKey)
              }
            }
          })
          this.load.start()
        } else if (!this.textures.exists(textureKey)) {
          // First time loading this texture
          this.load.image(textureKey, spriteUrl)
          this.load.once('complete', () => {
            if (this.textures.exists(textureKey) && entitySprite.sprite instanceof Phaser.GameObjects.Sprite) {
              entitySprite.sprite.setTexture(textureKey)
              this.scaleSprite(entitySprite.sprite)
            }
          })
          this.load.start()
        } else if (entitySprite.sprite instanceof Phaser.GameObjects.Sprite) {
          // Texture already cached, just switch to it
          entitySprite.sprite.setTexture(textureKey)
          this.scaleSprite(entitySprite.sprite)
        }
      }
    }

    // Banner updates handled by recreating if needed
  }

  private createHoverBanner(entity: GameEntity, _isMe: boolean): Phaser.GameObjects.Container {
    const banner = this.add.container(0, 0)
    
    // Simple name display with translucent background
    const name = entity.displayName || 'Unknown'
    
    // Create text first to measure its width
    const nameText = this.add.text(0, 0, name, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
      fontStyle: 'bold',
      color: '#000000'
    }).setOrigin(0.5)
    
    // Size background based on text - larger padding for retro look
    const padding = 10
    const bannerWidth = nameText.width + padding * 2
    const bannerHeight = nameText.height + padding
    // Sharp corners for pixel aesthetic (cornerRadius = 2)
    
    // Background with border
    const bg = this.add.graphics()
    
    // White background
    bg.fillStyle(0xffffff, 0.95)
    bg.fillRect(-bannerWidth / 2, -bannerHeight / 2, bannerWidth, bannerHeight)
    
    // Black border
    bg.lineStyle(2, 0x000000, 1)
    bg.strokeRect(-bannerWidth / 2, -bannerHeight / 2, bannerWidth, bannerHeight)
    
    banner.add(bg)
    banner.add(nameText)
    
    banner.setDepth(1000)
    
    return banner
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
