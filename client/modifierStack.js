/**
 * ModifierStack — Layered noise-based biome surface modifier system.
 *
 * Each layer is an independent noise modifier that targets a specific biome
 * edge range. Layers are evaluated bottom-to-top (higher layers override
 * lower ones according to their blendOp).
 *
 * The stack serialises to/from JSON so it can be saved as a preset, loaded
 * from a file, or persisted to localStorage.
 */

class ModifierStack {
  static NOISE_TYPES = ['fbm', 'simplex', 'voronoi', 'ridge', 'billow', 'turbulence'];
  static BLEND_OPS = ['add', 'multiply', 'mix', 'subtract', 'replace'];

  static defaultStack() {
    return new ModifierStack([
      {
        id: 'lyr_edge_wiggle',
        name: 'Edge Wiggle',
        enabled: true,
        noiseType: 'fbm',
        targetBiomeLow: 3,
        targetBiomeHigh: 4,
        blendOp: 'add',
        params: { scale: 0.3, strength: 1.0, octaves: 4, lacunarity: 2.0, gain: 0.5, offset: 0.0, contrast: 1.0 }
      },
      {
        id: 'lyr_splatter',
        name: 'Splatter',
        enabled: true,
        noiseType: 'fbm',
        targetBiomeLow: 3,
        targetBiomeHigh: 4,
        blendOp: 'mix',
        params: { scale: 0.5, strength: 0.5, octaves: 4, lacunarity: 2.0, gain: 0.5, offset: 0.0, contrast: 1.0 }
      }
    ]);
  }

  constructor(layers = []) {
    this.layers = layers.map(l => this._normaliseLayer(l));
    this.globalBlend = 0.5;
    this.globalScale = 1.0;
    this.listeners = new Set();
  }

  // ---------- Layer CRUD ----------

  addLayer(config = {}) {
    const layer = this._normaliseLayer(Object.assign({
      id: 'lyr_' + Math.random().toString(36).slice(2, 9),
      name: 'Layer ' + (this.layers.length + 1),
      enabled: true,
      noiseType: 'fbm',
      targetBiomeLow: 3,
      targetBiomeHigh: 4,
      blendOp: 'add',
      params: { scale: 0.3, strength: 1.0, octaves: 4, lacunarity: 2.0, gain: 0.5, offset: 0.0, contrast: 1.0 }
    }, config));
    this.layers.push(layer);
    this._notify('add', { layer, index: this.layers.length - 1 });
    return layer;
  }

  removeLayer(id) {
    const idx = this.layers.findIndex(l => l.id === id);
    if (idx >= 0) {
      const removed = this.layers.splice(idx, 1)[0];
      this._notify('remove', { layer: removed, index: idx });
      return removed;
    }
    return null;
  }

  moveLayer(id, direction) {
    const idx = this.layers.findIndex(l => l.id === id);
    if (idx < 0) return false;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= this.layers.length) return false;
    [this.layers[idx], this.layers[newIdx]] = [this.layers[newIdx], this.layers[idx]];
    this._notify('reorder', { layer: this.layers[newIdx], from: idx, to: newIdx });
    return true;
  }

  duplicateLayer(id) {
    const src = this.layers.find(l => l.id === id);
    if (!src) return null;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = 'lyr_' + Math.random().toString(36).slice(2, 9);
    copy.name = src.name + ' (copy)';
    this.layers.push(copy);
    this._notify('add', { layer: copy, index: this.layers.length - 1 });
    return copy;
  }

  // ---------- Per-layer updates ----------

  setLayerField(id, field, value) {
    const layer = this.layers.find(l => l.id === id);
    if (!layer) return false;
    const old = layer[field];
    if (field === 'params') {
      Object.assign(layer.params, value);
    } else {
      layer[field] = value;
    }
    this._notify('update', { layer, field, oldValue: old, newValue: value });
    return true;
  }

  setLayerParam(id, paramName, value) {
    return this.setLayerField(id, 'params', { [paramName]: value });
  }

  toggleLayer(id) {
    const layer = this.layers.find(l => l.id === id);
    if (!layer) return false;
    layer.enabled = !layer.enabled;
    this._notify('toggle', { layer, enabled: layer.enabled });
    return true;
  }

  // ---------- Global properties ----------

  setGlobal(key, value) {
    if (this[key] === undefined) return false;
    const old = this[key];
    this[key] = value;
    this._notify('global', { key, oldValue: old, newValue: value });
    return true;
  }

  // ---------- Evaluation (shader-facing) ----------

  /**
   * Flatten the stack to a compact array of uniforms that the
   * vertex shader can consume. Each active layer becomes one entry.
   */
  toShaderUniforms() {
    const active = this.layers.filter(l => l.enabled);
    return {
      uModLayerCount: active.length,
      uModGlobalBlend: this.globalBlend,
      uModGlobalScale: this.globalScale,
      uModLayerData: active.map(l => ({
        noiseType: ModifierStack.NOISE_TYPES.indexOf(l.noiseType),
        targetLow: l.targetBiomeLow,
        targetHigh: l.targetBiomeHigh,
        blendOp: ModifierStack.BLEND_OPS.indexOf(l.blendOp),
        scale: l.params.scale,
        strength: l.params.strength,
        octaves: l.params.octaves,
        lacunarity: l.params.lacunarity,
        gain: l.params.gain,
        offset: l.params.offset,
        contrast: l.params.contrast
      }))
    };
  }

  /**
   * Backwards-compatible extraction: return the first active layer
   * that matches the legacy wiggle/splatter roles so existing
   * flat uniforms can still be driven.
   */
  toLegacyUniforms() {
    const active = this.layers.filter(l => l.enabled);
    // Try to map layer 0 -> wiggle, layer 1 -> splatter
    const wiggle = active[0];
    const splatter = active[1];
    const edgeIdx = wiggle ? Math.min(wiggle.targetBiomeLow, wiggle.targetBiomeHigh) : 3;
    const mode = active.length > 0 ? 2 : 0;
    return {
      _edgeIndex: edgeIdx,
      _edgeMode: mode,
      uBiomeEdgeScales: wiggle ? wiggle.params.scale : 0.3,
      uBiomeEdgeStrengths: wiggle ? wiggle.params.strength : 1.0,
      uBiomeSplatterScales: splatter ? splatter.params.scale : 0.5,
      uBiomeSplatterAmounts: splatter ? splatter.params.strength : 0.5,
      uBiomeEdgeSplatterMixes: splatter ? (splatter.blendOp === 'mix' ? 0.5 : 0.0) : 0.0
    };
  }

  // ---------- Serialisation ----------

  toJSON() {
    return {
      layers: this.layers,
      globalBlend: this.globalBlend,
      globalScale: this.globalScale,
      version: 1
    };
  }

  static fromJSON(json) {
    const stack = new ModifierStack(json.layers || []);
    stack.globalBlend = json.globalBlend ?? 0.5;
    stack.globalScale = json.globalScale ?? 1.0;
    return stack;
  }

  clone() {
    return ModifierStack.fromJSON(this.toJSON());
  }

  // ---------- Presets ----------

  static presetNames() {
    try {
      return JSON.parse(localStorage.getItem('modifierStackPresets') || '{}');
    } catch (e) { return {}; }
  }

  savePreset(name) {
    const presets = ModifierStack.presetNames();
    presets[name] = this.toJSON();
    localStorage.setItem('modifierStackPresets', JSON.stringify(presets));
  }

  static loadPreset(name) {
    const presets = ModifierStack.presetNames();
    if (!presets[name]) return null;
    return ModifierStack.fromJSON(presets[name]);
  }

  static deletePreset(name) {
    const presets = ModifierStack.presetNames();
    delete presets[name];
    localStorage.setItem('modifierStackPresets', JSON.stringify(presets));
  }

  static listPresets() {
    return Object.keys(ModifierStack.presetNames());
  }

  exportToFile() {
    const blob = new Blob([JSON.stringify(this.toJSON(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modifier-stack-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  static async importFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const data = JSON.parse(e.target.result);
          resolve(ModifierStack.fromJSON(data));
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsText(file);
    });
  }

  // ---------- Helpers ----------

  _normaliseLayer(l) {
    return Object.assign({
      id: 'lyr_' + Math.random().toString(36).slice(2, 9),
      name: 'Layer',
      enabled: true,
      noiseType: 'fbm',
      targetBiomeLow: 3,
      targetBiomeHigh: 4,
      blendOp: 'add',
      params: { scale: 0.3, strength: 1.0, octaves: 4, lacunarity: 2.0, gain: 0.5, offset: 0.0, contrast: 1.0 }
    }, l, { params: Object.assign({ scale: 0.3, strength: 1.0, octaves: 4, lacunarity: 2.0, gain: 0.5, offset: 0.0, contrast: 1.0 }, l.params || {}) });
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _notify(type, data) { this.listeners.forEach(fn => { try { fn(type, data); } catch (e) {} }); }
}

// Expose globally for script-tag loading
window.ModifierStack = ModifierStack;
