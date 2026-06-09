// Material Registry — loads shader wrangler material library, creates ShaderMaterials, caches
// Used by game client to apply wrangler-authored materials to models

class MaterialRegistry {
  constructor() {
    this.materials = new Map();    // name -> { definition, material }
    this.mappings = {};           // modelId -> { material, modelType }
    this.loaded = false;
  }

  async init() {
    try {
      await this._loadMappings();
      await this._loadMaterials();
      this.loaded = true;
      console.log(`[MaterialRegistry] Loaded ${this.materials.size} materials, ${Object.keys(this.mappings).length} mappings`);
    } catch (err) {
      console.warn('[MaterialRegistry] Init failed:', err.message);
    }
  }

  async _loadMappings() {
    try {
      const res = await fetch('/api/material-mappings');
      if (res.ok) this.mappings = await res.json();
    } catch (e) {
      console.log('[MaterialRegistry] No material mappings found');
    }
  }

  async _loadMaterials() {
    try {
      const res = await fetch('/api/materials');
      if (!res.ok) return;
      const list = await res.json();
      for (const { name } of list) {
        await this._loadMaterial(name);
      }
    } catch (e) {
      console.log('[MaterialRegistry] No materials found');
    }
  }

  async _loadMaterial(name) {
    try {
      const res = await fetch(`/api/materials/${name}`);
      if (!res.ok) return;
      const def = await res.json();
      this.materials.set(name, { definition: def, material: null });
    } catch (e) {
      console.warn(`[MaterialRegistry] Failed to load material '${name}':`, e.message);
    }
  }

  // Create a Three.js ShaderMaterial from a material definition
  createMaterial(name) {
    const entry = this.materials.get(name);
    if (!entry) return null;
    if (entry.material) return entry.material; // cached

    const def = entry.definition;
    try {
      // Recompile from node graph
      const graph = NodeGraph.fromJSON(def.nodeGraph);
      const gen = new ShaderGenerator();
      const { functions, body, uniforms, finalColor } = gen.generate(graph);

      const target = ShaderTargets[def.target] || ShaderTargets.generic;

      const uniformDecls = this._buildUniformDecls(uniforms);
      const vertexShader = this._buildVertex(target, functions, uniformDecls);
      const fragmentShader = this._buildFragment(target, functions, body, finalColor, uniformDecls);

      const uniformValues = {};
      for (const [name, info] of Object.entries(uniforms)) {
        uniformValues[`u_${name}`] = this._uniformValue(info);
      }
      for (const [name, info] of Object.entries(target.builtins)) {
        uniformValues[name] = this._uniformValue(info);
      }

      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: uniformValues,
        side: THREE.DoubleSide,
        transparent: target.transparent || false
      });

      entry.material = material;
      return material;
    } catch (err) {
      console.error(`[MaterialRegistry] Failed to create material '${name}':`, err);
      return null;
    }
  }

  // Get material for a model, or null if no mapping
  getMaterialForModel(modelId) {
    const mapping = this.mappings[modelId];
    if (!mapping) return null;
    return this.createMaterial(mapping.material);
  }

  // Reload a specific material (after wrangler save)
  async reloadMaterial(name) {
    this.materials.delete(name);
    await this._loadMaterial(name);
    return this.createMaterial(name);
  }

  _buildUniformDecls(uniforms) {
    const lines = [];
    for (const [name, info] of Object.entries(uniforms)) {
      const glslName = `u_${name}`;
      switch (info.type) {
        case 'float': lines.push(`uniform float ${glslName};`); break;
        case 'vec2':  lines.push(`uniform vec2 ${glslName};`); break;
        case 'vec3':  lines.push(`uniform vec3 ${glslName};`); break;
        case 'vec4':  lines.push(`uniform vec4 ${glslName};`); break;
        default:      lines.push(`uniform float ${glslName};`); break;
      }
    }
    return lines.join('\n');
  }

  _buildVertex(target, functions, uniformDecls) {
    let vs = '';
    if (uniformDecls) vs += uniformDecls + '\n';
    if (functions) vs += functions + '\n';
    vs += target.vertexPreamble;
    return vs;
  }

  _buildFragment(target, functions, body, finalColor, uniformDecls) {
    let fs = `precision highp float;\n`;
    if (uniformDecls) fs += uniformDecls + '\n';
    fs += `${target.fragmentPreamble}\n${functions}\n`;
    fs += `void main() {\n${body || ''}\n`;
    fs += `  vec3 gFinalColor = ${finalColor || 'vec3(0.5)'};\n`;
    fs += `  gl_FragColor = vec4(gFinalColor, 1.0);\n}\n`;
    return fs;
  }

  _uniformValue(info) {
    switch (info.type) {
      case 'float': return { value: info.value ?? 0 };
      case 'vec2':  return { value: new THREE.Vector2((info.value || [0, 0])[0], (info.value || [0, 0])[1]) };
      case 'vec3':  return { value: new THREE.Color((info.value || [0, 0, 0])[0], (info.value || [0, 0, 0])[1], (info.value || [0, 0, 0])[2]) };
      case 'vec4':  return { value: new THREE.Vector4((info.value || [0, 0, 0, 0])[0], (info.value || [0, 0, 0, 0])[1], (info.value || [0, 0, 0, 0])[2], (info.value || [0, 0, 0, 0])[3]) };
      default:      return { value: info.value ?? 0 };
    }
  }
}

// Export
if (typeof module !== 'undefined') {
  module.exports = { MaterialRegistry };
} else {
  window.MaterialRegistry = MaterialRegistry;
}
