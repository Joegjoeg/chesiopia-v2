// Simple Cel Shading Implementation for Chessopia (fallback)
class SimpleCelShaderSystem {
    constructor() {
        console.log('[SimpleCelShader] SimpleCelShaderSystem constructor called');
        this.enabled = false;
        this.originalMaterials = new Map();
        this.celMaterials = new Map();
    }
    
    // Simple toon material using Three.js built-in
    createToonMaterial(baseColor, darkColor) {
        console.log('[SimpleCelShader] Creating toon material with color:', baseColor);
        return new THREE.MeshToonMaterial({
            color: baseColor,
            emissive: darkColor,
            emissiveIntensity: 0.1
        });
    }
    
    enableCelShading(scene) {
        if (this.enabled) return;
        
        console.log('[SimpleCelShader] Enabling cel shading mode');
        console.log('[SimpleCelShader] Scene provided:', !!scene);
        console.log('[SimpleCelShader] Scene children count:', scene ? scene.children.length : 'null');
        
        let meshCount = 0;
        scene.traverse((object) => {
            if (object.isMesh && object.material) {
                meshCount++;
                console.log('[SimpleCelShader] Processing mesh:', object.name || 'unnamed', 'UUID:', object.uuid);
                
                // Store original material
                this.originalMaterials.set(object.uuid, object.material);
                
                // Create toon material based on original color
                let baseColor = 0xffffff;
                let darkColor = 0x000000;
                
                if (object.material.color) {
                    baseColor = object.material.color.getHex();
                }
                if (object.material.emissive) {
                    darkColor = object.material.emissive.getHex();
                }
                
                console.log('[SimpleCelShader] Colors - Base:', baseColor.toString(16), 'Dark:', darkColor.toString(16));
                
                // Create toon material
                const toonMaterial = this.createToonMaterial(baseColor, darkColor);
                
                // Store toon material
                this.celMaterials.set(object.uuid, toonMaterial);
                
                // Apply toon material
                object.material = toonMaterial;
                console.log('[SimpleCelShader] Applied toon material to:', object.name || 'unnamed');
            }
        });
        
        console.log('[SimpleCelShader] Processed', meshCount, 'meshes');
        console.log('[SimpleCelShader] Cel shading enabled');
        this.enabled = true;
    }
    
    disableCelShading(scene) {
        if (!this.enabled) return;
        
        console.log('[SimpleCelShader] Disabling cel shading mode');
        
        scene.traverse((object) => {
            if (object.isMesh && this.originalMaterials.has(object.uuid)) {
                // Restore original material
                object.material = this.originalMaterials.get(object.uuid);
            }
        });
        
        this.enabled = false;
        console.log('[SimpleCelShader] Cel shading disabled');
    }
    
    toggleCelShading(scene) {
        console.log('[SimpleCelShader] toggleCelShading called, enabled:', this.enabled);
        if (this.enabled) {
            this.disableCelShading(scene);
        } else {
            this.enableCelShading(scene);
        }
    }
    
    cleanup() {
        this.originalMaterials.clear();
        this.celMaterials.clear();
    }
}

// Export for use in main game
window.SimpleCelShaderSystem = SimpleCelShaderSystem;
