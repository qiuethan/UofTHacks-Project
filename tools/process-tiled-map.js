#!/usr/bin/env node
/**
 * Tiled Map Processor
 * 
 * Parses a Tiled map (.tmj) and generates collision data for the world engine.
 * 
 * Usage: node tools/process-tiled-map.js
 */

const fs = require('fs');
const path = require('path');

// Configuration
const MAP_PATH = path.join(__dirname, '../web/public/assets/tiled/map16x16.tmj');
const OUTPUT_PATH = path.join(__dirname, '../world/map/collisionData.ts');

// Layers that create collision (blocked tiles)
// All other layers will be walkable
const BLOCKING_LAYERS = ['walls'];

function processMap() {
  console.log('Reading map from:', MAP_PATH);
  
  const mapData = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
  
  const width = mapData.width;
  const height = mapData.height;
  
  console.log(`Map dimensions: ${width}x${height} tiles`);
  
  // Initialize collision grid as all walkable (false = not blocked)
  const collisionGrid = Array(height).fill(null).map(() => Array(width).fill(false));
  
  // Process each layer
  const layers = mapData.layers.filter(layer => layer.type === 'tilelayer');
  
  console.log('\nProcessing layers:');
  
  for (const layer of layers) {
    const layerName = layer.name.toLowerCase();
    const isBlocking = BLOCKING_LAYERS.some(w => layerName.includes(w.toLowerCase()));
    
    if (!isBlocking) {
      console.log(`  - ${layer.name}: WALKABLE (skipping)`);
      continue;
    }
    
    console.log(`  - ${layer.name}: BLOCKING`);
    
    // Mark any non-zero tile in this layer as blocked
    const data = layer.data;
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== 0) {
        const x = i % width;
        const y = Math.floor(i / width);
        collisionGrid[y][x] = true;
      }
    }
  }
  
  // Count blocked and walkable tiles
  let blockedCount = 0;
  let walkableCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (collisionGrid[y][x]) {
        blockedCount++;
      } else {
        walkableCount++;
      }
    }
  }
  
  console.log(`\nCollision summary:`);
  console.log(`  - Blocked tiles: ${blockedCount}`);
  console.log(`  - Walkable tiles: ${walkableCount}`);
  console.log(`  - Total: ${blockedCount + walkableCount}`);
  
  // Generate TypeScript output
  const tsOutput = generateTypeScript(collisionGrid, width, height);
  
  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  fs.writeFileSync(OUTPUT_PATH, tsOutput);
  console.log(`\nCollision data written to: ${OUTPUT_PATH}`);
}

function generateTypeScript(grid, width, height) {
  const lines = [
    '// ============================================================================',
    '// COLLISION DATA - Auto-generated from Tiled map',
    '// DO NOT EDIT MANUALLY - Run `node tools/process-tiled-map.js` to regenerate',
    '// ============================================================================',
    '',
    `export const MAP_WIDTH = ${width};`,
    `export const MAP_HEIGHT = ${height};`,
    '',
    '/**',
    ' * Collision grid in row-major order [y][x]',
    ' * true = blocked (wall/obstacle)',
    ' * false = walkable',
    ' */',
    'export const COLLISION_GRID: ReadonlyArray<ReadonlyArray<boolean>> = [',
  ];
  
  for (let y = 0; y < height; y++) {
    const row = grid[y].map(v => v ? 'true' : 'false').join(', ');
    const comma = y < height - 1 ? ',' : '';
    lines.push(`  [${row}]${comma}`);
  }
  
  lines.push('];');
  lines.push('');
  
  return lines.join('\n');
}

// Run the processor
try {
  processMap();
} catch (error) {
  console.error('Error processing map:', error.message);
  process.exit(1);
}
