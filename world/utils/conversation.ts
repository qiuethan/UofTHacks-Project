// ============================================================================
// CONVERSATION SYSTEM - Handles conversation initiation and state
// ============================================================================

export interface ConversationRequest {
  readonly requestId: string;
  readonly initiatorId: string;
  readonly targetId: string;
  readonly initiatorType: 'PLAYER' | 'ROBOT';
  readonly targetType: 'PLAYER' | 'ROBOT';
  readonly status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface ActiveConversation {
  readonly conversationId: string;
  readonly participant1Id: string;
  readonly participant2Id: string;
  readonly startedAt: number;
}

// Configuration
export const CONVERSATION_CONFIG = {
  INITIATION_RADIUS: 15,         // Max distance to initiate conversation
  CONVERSATION_RADIUS: 2,        // Must be within 2 cells to start conversation
  REQUEST_TIMEOUT_MS: 4000,      // Request expires after 4 seconds (quick decline)
  REJECTION_COOLDOWN_MS: 10000,  // 10 second cooldown after rejection
  REQUEST_CLEANUP_MS: 5 * 60 * 1000, // Clean up old requests after 5 minutes
  AI_INTEREST_BASE: 0.5,         // Base probability for AI interest
  AI_INTEREST_VARIANCE: 0.3,     // Variance in AI interest
};

// ============================================================================
// DISTANCE UTILITIES
// ============================================================================

export function getDistance(
  x1: number, y1: number,
  x2: number, y2: number
): number {
  // For 1x1 entities, use center-to-center distance
  // Center is at x + 0.5, y + 0.5
  const centerX1 = x1 + 0.5;
  const centerY1 = y1 + 0.5;
  const centerX2 = x2 + 0.5;
  const centerY2 = y2 + 0.5;
  
  return Math.sqrt(
    Math.pow(centerX2 - centerX1, 2) + 
    Math.pow(centerY2 - centerY1, 2)
  );
}

export function isWithinInitiationRange(
  x1: number, y1: number,
  x2: number, y2: number
): boolean {
  return getDistance(x1, y1, x2, y2) <= CONVERSATION_CONFIG.INITIATION_RADIUS;
}

export function isWithinConversationRange(
  x1: number, y1: number,
  x2: number, y2: number
): boolean {
  return getDistance(x1, y1, x2, y2) <= CONVERSATION_CONFIG.CONVERSATION_RADIUS;
}

export function areAdjacent(
  x1: number, y1: number,
  x2: number, y2: number
): boolean {
  // For 1x1 entities, check if they are close enough to converse
  // Entity 1 occupies: (x1, y1)
  // Entity 2 occupies: (x2, y2)
  
  // Adjacent means within conversation range (close enough to talk)
  // Use center-to-center distance for more flexible positioning
  return isWithinConversationRange(x1, y1, x2, y2);
}

// ============================================================================
// AI INTEREST PROBABILITY
// ============================================================================

/**
 * Calculate AI interest score for initiating a conversation.
 * Returns probability between 0 and 1.
 * 
 * TODO: Replace with actual interest calculation based on:
 * - Agent personality
 * - Previous interaction history
 * - Current goals/tasks
 * - Time since last conversation
 */
export function calculateAIInterestToInitiate(
  robotId: string,
  targetId: string,
  targetType: 'PLAYER' | 'ROBOT'
): number {
  // For now, use random probability with base and variance
  const base = CONVERSATION_CONFIG.AI_INTEREST_BASE;
  const variance = CONVERSATION_CONFIG.AI_INTEREST_VARIANCE;
  
  // Random value between (base - variance) and (base + variance)
  return Math.max(0, Math.min(1, base + (Math.random() - 0.5) * 2 * variance));
}

/**
 * Calculate AI interest in accepting a conversation request.
 * Returns probability between 0 and 1.
 * 
 * TODO: Replace with actual interest calculation based on:
 * - Who is requesting
 * - Current state/goals
 * - Personality traits
 */
export function calculateAIInterestToAccept(
  robotId: string,
  initiatorId: string,
  initiatorType: 'PLAYER' | 'ROBOT'
): number {
  if (initiatorType === 'PLAYER') {
    return 1.0; // Always accept humans
  }
  
  // Base acceptance for other robots
  const baseAcceptance = 0.5;
  const variance = 0.2;
  
  return Math.max(0, Math.min(1, baseAcceptance + (Math.random() - 0.5) * 2 * variance));
}

/**
 * Decide if AI should initiate conversation based on interest score.
 */
export function shouldAIInitiate(interestScore: number): boolean {
  return Math.random() < interestScore;
}

/**
 * Decide if AI should accept conversation based on interest score.
 */
export function shouldAIAccept(interestScore: number): boolean {
  return Math.random() < interestScore;
}

// ============================================================================
// COOLDOWN TRACKING
// ============================================================================

/**
 * Cooldown tracker for rejected conversation requests.
 * Maps "initiatorId:targetId" -> timestamp when cooldown expires
 */
export class CooldownTracker {
  private cooldowns = new Map<string, number>();
  
  private getKey(initiatorId: string, targetId: string): string {
    return `${initiatorId}:${targetId}`;
  }
  
  setCooldown(initiatorId: string, targetId: string): void {
    const key = this.getKey(initiatorId, targetId);
    this.cooldowns.set(key, Date.now() + CONVERSATION_CONFIG.REJECTION_COOLDOWN_MS);
  }
  
  isOnCooldown(initiatorId: string, targetId: string): boolean {
    const key = this.getKey(initiatorId, targetId);
    const expiresAt = this.cooldowns.get(key);
    
    if (!expiresAt) return false;
    
    if (Date.now() >= expiresAt) {
      this.cooldowns.delete(key);
      return false;
    }
    
    return true;
  }
  
  getCooldownRemaining(initiatorId: string, targetId: string): number {
    const key = this.getKey(initiatorId, targetId);
    const expiresAt = this.cooldowns.get(key);
    
    if (!expiresAt) return 0;
    
    const remaining = expiresAt - Date.now();
    return remaining > 0 ? remaining : 0;
  }
  
  clearExpired(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.cooldowns.entries()) {
      if (now >= expiresAt) {
        this.cooldowns.delete(key);
      }
    }
  }
}

// ============================================================================
// REQUEST MANAGER
// ============================================================================

export class ConversationRequestManager {
  private requests = new Map<string, ConversationRequest>();
  private cooldowns = new CooldownTracker();
  
  createRequest(
    initiatorId: string,
    targetId: string,
    initiatorType: 'PLAYER' | 'ROBOT',
    targetType: 'PLAYER' | 'ROBOT'
  ): ConversationRequest | null {
    // Check cooldown
    if (this.cooldowns.isOnCooldown(initiatorId, targetId)) {
      return null;
    }
    
    // Check if there's already a pending request from this initiator (to ANYONE)
    // This prevents an entity from sending multiple conversation requests at once
    for (const request of this.requests.values()) {
      if (request.status === 'PENDING' && request.initiatorId === initiatorId) {
        return null; // Initiator already has a pending request
      }
    }
    
    // Also check if target already has a pending request FROM someone else
    // This prevents overwhelming a target with multiple requests
    for (const request of this.requests.values()) {
      if (request.status === 'PENDING' && request.targetId === targetId) {
        return null; // Target already has a pending request from someone
      }
    }
    
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();
    
    const request: ConversationRequest = {
      requestId,
      initiatorId,
      targetId,
      initiatorType,
      targetType,
      status: 'PENDING',
      createdAt: now,
      expiresAt: now + CONVERSATION_CONFIG.REQUEST_TIMEOUT_MS,
    };
    
    this.requests.set(requestId, request);
    return request;
  }
  
  acceptRequest(requestId: string): ConversationRequest | null {
    const request = this.requests.get(requestId);
    if (!request || request.status !== 'PENDING') return null;
    
    // Check if expired
    if (Date.now() >= request.expiresAt) {
      this.requests.set(requestId, { ...request, status: 'EXPIRED' });
      return null;
    }
    
    const accepted = { ...request, status: 'ACCEPTED' as const };
    this.requests.set(requestId, accepted);
    return accepted;
  }
  
  rejectRequest(requestId: string): ConversationRequest | null {
    const request = this.requests.get(requestId);
    if (!request || request.status !== 'PENDING') return null;
    
    const rejected = { ...request, status: 'REJECTED' as const };
    this.requests.set(requestId, rejected);
    
    // Set cooldown
    this.cooldowns.setCooldown(request.initiatorId, request.targetId);
    
    return rejected;
  }
  
  getRequest(requestId: string): ConversationRequest | undefined {
    return this.requests.get(requestId);
  }
  
  getPendingRequestsFor(entityId: string): ConversationRequest[] {
    const results: ConversationRequest[] = [];
    const now = Date.now();
    
    for (const request of this.requests.values()) {
      if (request.status === 'PENDING' && request.targetId === entityId) {
        if (now < request.expiresAt) {
          results.push(request);
        } else {
          // Mark as expired
          this.requests.set(request.requestId, { ...request, status: 'EXPIRED' });
        }
      }
    }
    
    return results;
  }
  
  getPendingRequestFrom(initiatorId: string): ConversationRequest | null {
    const now = Date.now();
    
    for (const request of this.requests.values()) {
      if (request.status === 'PENDING' && request.initiatorId === initiatorId) {
        if (now < request.expiresAt) {
          return request;
        } else {
          this.requests.set(request.requestId, { ...request, status: 'EXPIRED' });
        }
      }
    }
    
    return null;
  }
  
  /**
   * Cancel all pending requests involving an entity (as initiator or target).
   * Used to prevent group chats by cleaning up when a conversation is accepted.
   * @param entityId - The entity ID to cancel requests for
   * @param exceptRequestId - Optional request ID to NOT cancel (the one being accepted)
   */
  cancelRequestsInvolving(entityId: string, exceptRequestId?: string): void {
    for (const request of this.requests.values()) {
      if (request.status === 'PENDING' && request.requestId !== exceptRequestId) {
        if (request.initiatorId === entityId || request.targetId === entityId) {
          this.requests.set(request.requestId, { ...request, status: 'REJECTED' });
        }
      }
    }
  }
  
  isOnCooldown(initiatorId: string, targetId: string): boolean {
    return this.cooldowns.isOnCooldown(initiatorId, targetId);
  }
  
  getCooldownRemaining(initiatorId: string, targetId: string): number {
    return this.cooldowns.getCooldownRemaining(initiatorId, targetId);
  }
  
  cleanupExpired(): ConversationRequest[] {
    const now = Date.now();
    const expired: ConversationRequest[] = [];
    
    for (const [id, request] of this.requests.entries()) {
      if (request.status === 'PENDING' && now >= request.expiresAt) {
        const expiredReq = { ...request, status: 'EXPIRED' as const };
        this.requests.set(id, expiredReq);
        expired.push(expiredReq);
      }
      
      // Remove old completed requests
      if (
        request.status !== 'PENDING' &&
        now - request.createdAt > CONVERSATION_CONFIG.REQUEST_CLEANUP_MS
      ) {
        this.requests.delete(id);
      }
    }
    
    this.cooldowns.clearExpired();
    return expired;
  }
}

// Global instance
export const conversationRequests = new ConversationRequestManager();
