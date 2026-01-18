#!/usr/bin/env node
/**
 * Embed Tilesets Script
 * 
 * Merges external .tsj tileset files into the .tmj map file.
 * Phaser 3 requires embedded tilesets for reliable loading.
 */

const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, '../web/public/assets/tiled');
const MAP_PATH = path.join(ASSETS_DIR, 'map16x16.tmj');

console.log('Reading map from:', MAP_PATH);

const mapData = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));

if (mapData.tilesets) {
  const newTilesets = [];
  
  for (const tilesetRef of mapData.tilesets) {
    if (tilesetRef.source) {
      const sourcePath = path.join(ASSETS_DIR, tilesetRef.source);
      console.log(`Embedding tileset: ${tilesetRef.source}`);
      
      try {
        const tilesetData = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
        
        // Merge: keep 'firstgid' from map ref, add everything else from file
        const embeddedTileset = { ...tilesetRef };
        Object.assign(embeddedTileset, tilesetData);
        delete embeddedTileset.source; // Remove source to make it embedded
        
        newTilesets.push(embeddedTileset);
      } catch (err) {
        console.error(`Error reading tileset ${sourcePath}:`, err.message);
        // Keep original ref if file not found
        newTilesets.push(tilesetRef);
      }
    } else {
      // Already embedded
      newTilesets.push(tilesetRef);
    }
  }
  
  mapData.tilesets = newTilesets;
}

// Save back to file
console.log(`Saving updated map to ${MAP_PATH}...`);
fs.writeFileSync(MAP_PATH, JSON.stringify(mapData, null, 4));

console.log('Done. Tilesets embedded.');

// Print layer names for reference
console.log('\nLayers in map:');
if (mapData.layers) {
  mapData.layers
    .filter(l => l.type === 'tilelayer')
    .forEach(l => console.log(`  - ${l.name}`));
}

// Print tileset names for reference
console.log('\nTilesets in map:');
if (mapData.tilesets) {
  mapData.tilesets.forEach(ts => console.log(`  - ${ts.name} (firstgid: ${ts.firstgid})`));
}
