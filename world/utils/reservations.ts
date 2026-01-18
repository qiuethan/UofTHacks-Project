/**
 * Centralized Reservation Table for Space-Time Coordination
 * 
 * Lightweight system to prevent:
 * 1. Simultaneous claims to the same cell (vertex conflicts)
 * 2. Swap-through collisions (edge conflicts)
 * 
 * Each agent proposes a move, and the resolver accepts in priority order.
 */

interface Point {
  x: number;
  y: number;
}

export interface MoveProposal {
  entityId: string;
  from: Point;
  to: Point;
  priority: number; // Lower = higher priority
}

export class ReservationTable {
  // Vertex reservations: "x,y,t" -> entityId
  private vertexReservations = new Map<string, string>();
  
  // Edge reservations: "x1,y1,x2,y2,t" -> entityId
  private edgeReservations = new Map<string, string>();
  
  /**
   * Clear all reservations (call at start of each tick)
   */
  clear(): void {
    this.vertexReservations.clear();
    this.edgeReservations.clear();
  }
  
  /**
   * Check if a 1x1 entity can reserve a position at time t
   */
  canReserve(entityId: string, pos: Point, time: number): boolean {
    // Check the cell of the 1x1 entity
    const cells = [{ x: pos.x, y: pos.y }];
    
    for (const cell of cells) {
      const key = `${cell.x},${cell.y},${time}`;
      const reserved = this.vertexReservations.get(key);
      if (reserved && reserved !== entityId) {
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Check if an edge (movement from -> to) can be reserved at time t
   * Also checks for swap conflicts (opposite edge)
   */
  canReserveEdge(entityId: string, from: Point, to: Point, time: number): boolean {
    // For 1x1 entities, check the cell movement
    const edgeKey = `${from.x},${from.y},${to.x},${to.y},${time}`;
    const swapKey = `${to.x},${to.y},${from.x},${from.y},${time}`;
    
    const edgeReserved = this.edgeReservations.get(edgeKey);
    const swapReserved = this.edgeReservations.get(swapKey);
    
    if (edgeReserved && edgeReserved !== entityId) {
      return false;
    }
    
    if (swapReserved && swapReserved !== entityId) {
      return false; // Prevent swap-through
    }
    
    return true;
  }
  
  /**
   * Reserve a position for a 1x1 entity at time t
   */
  reserveVertex(entityId: string, pos: Point, time: number): void {
    const cells = [{ x: pos.x, y: pos.y }];
    
    for (const cell of cells) {
      const key = `${cell.x},${cell.y},${time}`;
      this.vertexReservations.set(key, entityId);
    }
  }
  
  /**
   * Reserve an edge (movement from -> to) at time t
   */
  reserveEdge(entityId: string, from: Point, to: Point, time: number): void {
    const edgeKey = `${from.x},${from.y},${to.x},${to.y},${time}`;
    this.edgeReservations.set(edgeKey, entityId);
  }
  
  /**
   * Reserve both vertex and edge for a move
   */
  reserveMove(entityId: string, from: Point, to: Point, time: number): void {
    this.reserveVertex(entityId, to, time);
    this.reserveEdge(entityId, from, to, time);
  }
}

/**
 * Resolve move proposals in priority order
 * Returns map of entityId -> approved move (or null if should wait)
 */
export function resolveMoves(
  proposals: MoveProposal[],
  reservations: ReservationTable,
  time: number
): Map<string, Point | null> {
  const approvedMoves = new Map<string, Point | null>();
  
  // Sort by priority (lower number = higher priority)
  const sorted = [...proposals].sort((a, b) => a.priority - b.priority);
  
  for (const proposal of sorted) {
    const { entityId, from, to } = proposal;
    
    // Check if this is a wait action (from === to)
    const isWait = from.x === to.x && from.y === to.y;
    
    if (isWait) {
      // Wait action - just reserve current position
      if (reservations.canReserve(entityId, from, time)) {
        reservations.reserveVertex(entityId, from, time);
        approvedMoves.set(entityId, null); // null means wait
      } else {
        // Can't even wait here (someone else claimed it)
        approvedMoves.set(entityId, null);
      }
    } else {
      // Movement action - check both vertex and edge
      const canReserveVertex = reservations.canReserve(entityId, to, time);
      const canReserveEdge = reservations.canReserveEdge(entityId, from, to, time);
      
      if (canReserveVertex && canReserveEdge) {
        // Approve move
        reservations.reserveMove(entityId, from, to, time);
        approvedMoves.set(entityId, to);
      } else {
        // Conflict - make agent wait
        // Reserve current position so others don't claim it
        if (reservations.canReserve(entityId, from, time)) {
          reservations.reserveVertex(entityId, from, time);
        }
        approvedMoves.set(entityId, null); // Wait
      }
    }
  }
  
  return approvedMoves;
}
