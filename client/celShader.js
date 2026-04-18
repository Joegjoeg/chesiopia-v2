// Cel Shading Implementation for Chessopia
class CelShaderSystem {
    constructor() {
        console.log('[CelShader] CelShaderSystem constructor called');
        this.enabled = false;
        this.originalMaterials = new Map();
        this.celMaterials = new Map();
        
        // Cel shader uniforms
        this.celUniforms = {
            diffuse: { value: new THREE.Color(0xffffff) },
            emissive: { value: new THREE.Color(0x000000) },
            specular: { value: new THREE.Color(0x111111) },
            shininess: { value: 30 },
            uLightDirection: { value: new THREE.Vector3(0.5, 1.0, 0.5).normalize() },
            uCelLevels: { value: 4 }, // Number of color bands
            uEdgeThreshold: { value: 0.1 }, // Edge detection threshold
            uEdgeColor: { value: new THREE.Color(0x000000) },
            uEdgeThickness: { value: 0.003 }
        };
        
        // Custom cel vertex shader
        this.celVertexShader = `
            varying vec3 vNormal;
            varying vec3 vPosition;
            varying vec3 vViewPosition;
            
            void main() {
                vNormal = normalize(normalMatrix * normal);
                vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
                vViewPosition = -vPosition;
                
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;
        
        // Custom cel fragment shader
        this.celFragmentShader = `
            uniform vec3 diffuse;
            uniform vec3 emissive;
            uniform vec3 specular;
            uniform float shininess;
            uniform vec3 uLightDirection;
            uniform float uCelLevels;
            uniform float uEdgeThreshold;
            uniform vec3 uEdgeColor;
            uniform float uEdgeThickness;
            
            varying vec3 vNormal;
            varying vec3 vPosition;
            varying vec3 vViewPosition;
            
            float celShade(float value) {
                return floor(value * uCelLevels) / uCelLevels;
            }
            
            float edgeDetection() {
                vec3 normal = normalize(vNormal);
                vec3 viewDir = normalize(vViewPosition);
                
                // Edge detection based on normal and view angle
                float edgeFactor = dot(normal, viewDir);
                edgeFactor = smoothstep(uEdgeThreshold, 1.0, edgeFactor);
                
                return 1.0 - edgeFactor;
            }
            
            void main() {
                vec3 normal = normalize(vNormal);
                vec3 lightDir = normalize(uLightDirection);
                vec3 viewDir = normalize(vViewPosition);
                
                // Diffuse lighting with cel shading
                float diffuseFactor = max(dot(normal, lightDir), 0.0);
                diffuseFactor = celShade(diffuseFactor);
                
                // Specular lighting with cel shading
                vec3 reflectDir = reflect(-lightDir, normal);
                float specularFactor = pow(max(dot(viewDir, reflectDir), 0.0), shininess);
                specularFactor = celShade(specularFactor);
                
                // Edge detection
                float edgeFactor = edgeDetection();
                
                // Combine lighting
                vec3 color = diffuse * diffuseFactor + emissive + specular * specularFactor;
                
                // Apply edge highlighting
                color = mix(color, uEdgeColor, edgeFactor * uEdgeThickness);
                
                gl_FragColor = vec4(color, 1.0);
            }
        `;
    }
    
    createCelMaterial(baseColor, darkColor) {
        const uniforms = {
            ...this.celUniforms,
            diffuse: { value: new THREE.Color(baseColor) },
            emissive: { value: new THREE.Color(darkColor) }
        };
        
        return new THREE.ShaderMaterial({
            uniforms: uniforms,
            vertexShader: this.celVertexShader,
            fragmentShader: this.celFragmentShader,
            side: THREE.DoubleSide
        });
    }
    
    // Built-in ToonShader alternative (simpler)
    createToonMaterial(baseColor, darkColor) {
        return new THREE.MeshToonMaterial({
            color: baseColor,
            emissive: darkColor,
            emissiveIntensity: 0.1
        });
    }
    
    enableCelShading(scene, useCustomShader = true) {
        if (this.enabled) return;
        
        console.log('[CelShader] Enabling cel shading mode');
        console.log('[CelShader] Scene provided:', !!scene);
        console.log('[CelShader] Scene children count:', scene ? scene.children.length : 'null');
        
        let meshCount = 0;
        scene.traverse((object) => {
            if (object.isMesh && object.material) {
                meshCount++;
                console.log('[CelShader] Processing mesh:', object.name || 'unnamed', 'UUID:', object.uuid);
                // Store original material
                this.originalMaterials.set(object.uuid, object.material);
                
                // Create cel material based on original color
                let baseColor = 0xffffff;
                let darkColor = 0x000000;
                
                if (object.material.color) {
                    baseColor = object.material.color.getHex();
                }
                if (object.material.emissive) {
                    darkColor = object.material.emissive.getHex();
                }
                
                // Create appropriate cel material
                let celMaterial;
                try {
                    celMaterial = useCustomShader 
                        ? this.createCelMaterial(baseColor, darkColor)
                        : this.createToonMaterial(baseColor, darkColor);
                    console.log('[CelShader] Created cel material for mesh:', object.name || 'unnamed');
                } catch (error) {
                    console.error('[CelShader] Error creating cel material:', error);
                    // Fallback to toon material
                    celMaterial = this.createToonMaterial(baseColor, darkColor);
                }
                
                // Store cel material
                this.celMaterials.set(object.uuid, celMaterial);
                
                // Apply cel material
                object.material = celMaterial;
            }
        });
        
        console.log('[CelShader] Processed', meshCount, 'meshes');
        console.log('[CelShader] Cel shading enabled');
        this.enabled = true;
    }
    
    disableCelShading(scene) {
        if (!this.enabled) return;
        
        console.log('[CelShader] Disabling cel shading mode');
        
        scene.traverse((object) => {
            if (object.isMesh && this.originalMaterials.has(object.uuid)) {
                // Restore original material
                object.material = this.originalMaterials.get(object.uuid);
            }
        });
        
        this.enabled = false;
    }
    
    toggleCelShading(scene, useCustomShader = true) {
        console.log('[CelShader] toggleCelShading called, enabled:', this.enabled);
        if (this.enabled) {
            this.disableCelShading(scene);
        } else {
            this.enableCelShading(scene, useCustomShader);
        }
    }
    
    // Update cel shading parameters
    updateCelLevels(levels) {
        this.celUniforms.uCelLevels.value = levels;
        
        // Update all cel materials
        for (const material of this.celMaterials.values()) {
            if (material.uniforms && material.uniforms.uCelLevels) {
                material.uniforms.uCelLevels.value = levels;
            }
        }
    }
    
    updateEdgeThreshold(threshold) {
        this.celUniforms.uEdgeThreshold.value = threshold;
        
        // Update all cel materials
        for (const material of this.celMaterials.values()) {
            if (material.uniforms && material.uniforms.uEdgeThreshold) {
                material.uniforms.uEdgeThreshold.value = threshold;
            }
        }
    }
    
    updateLightDirection(direction) {
        this.celUniforms.uLightDirection.value = direction.normalize();
        
        // Update all cel materials
        for (const material of this.celMaterials.values()) {
            if (material.uniforms && material.uniforms.uLightDirection) {
                material.uniforms.uLightDirection.value = direction.normalize();
            }
        }
    }
    
    cleanup() {
        this.originalMaterials.clear();
        this.celMaterials.clear();
    }
}

// Export for use in main game
window.CelShaderSystem = CelShaderSystem;
