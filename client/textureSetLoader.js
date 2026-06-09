// TextureSetLoader — loads PBR texture sets from /textures with known naming conventions
class TextureSetLoader {
    static getMapping() {
        return {
            'grass1-bl': {
                albedo: 'grass1-bl/grass1-albedo3.png',
                normal: 'grass1-bl/grass1-normal1-ogl.png',
                roughness: 'grass1-bl/grass1-rough.png',
                ao: 'grass1-bl/grass1-ao.png',
                height: 'grass1-bl/grass1-height.png'
            },
            'sand-dunes1-bl': {
                albedo: 'sand-dunes1-bl/sand-dunes1_albedo.png',
                normal: 'sand-dunes1-bl/sand-dunes1_normal-ogl.png',
                roughness: 'sand-dunes1-bl/sand-dunes1_roughness.png',
                ao: 'sand-dunes1-bl/sand-dunes1_ao.png',
                height: 'sand-dunes1-bl/sand-dunes1_height.png',
                metallic: 'sand-dunes1-bl/sand-dunes1_metallic.png'
            },
            'jagged-cliff1-bl': {
                albedo: 'jagged-cliff1-bl/jagged-cliff1-albedo.png',
                normal: 'jagged-cliff1-bl/jagged-cliff1-normal-ogl.png',
                roughness: 'jagged-cliff1-bl/jagged-cliff1-roughness.png',
                ao: 'jagged-cliff1-bl/jagged-cliff1-ao.png',
                height: 'jagged-cliff1-bl/jagged-cliff1-height.png',
                metallic: 'jagged-cliff1-bl/jagged-cliff1-metallic.png'
            },
            'limestone-cliffs-bl': {
                albedo: 'limestone-cliffs-bl/limestone-cliffs_albedo.png',
                normal: 'limestone-cliffs-bl/limestone-cliffs_normal-ogl.png',
                roughness: 'limestone-cliffs-bl/limestone-cliffs_roughness.png',
                ao: 'limestone-cliffs-bl/limestone-cliffs_ao.png',
                height: 'limestone-cliffs-bl/limestone-cliffs_height.png',
                metallic: 'limestone-cliffs-bl/limestone-cliffs_metallic.png'
            },
            'mud-with-vegetation-bl': {
                albedo: 'mud-with-vegetation-bl/mud_with_vegetation_albedo.png',
                normal: 'mud-with-vegetation-bl/mud_with_vegetation_Normal-ogl.png',
                roughness: 'mud-with-vegetation-bl/mud_with_vegetation_Roughness.png',
                ao: 'mud-with-vegetation-bl/mud_with_vegetation_ao.png',
                height: 'mud-with-vegetation-bl/mud_with_vegetation_Height.png',
                metallic: 'mud-with-vegetation-bl/mud_with_vegetation_Metallic.png'
            },
            'patchy-meadow1-bl': {
                albedo: 'patchy-meadow1-bl/patchy-meadow1_albedo.png',
                normal: 'patchy-meadow1-bl/patchy-meadow1_normal-ogl.png',
                roughness: 'patchy-meadow1-bl/patchy-meadow1_roughness.png',
                ao: 'patchy-meadow1-bl/patchy-meadow1_ao.png',
                height: 'patchy-meadow1-bl/patchy-meadow1_height.png',
                metallic: 'patchy-meadow1-bl/patchy-meadow1_metallic.png'
            },
            'leaf-fall1-bl4': {
                albedo: 'leaf-fall1-bl4/leaf-fall1-albedo.png',
                normal: 'leaf-fall1-bl4/leaf-fall3-normal-ogl.png',
                roughness: 'leaf-fall1-bl4/leaf-fall1-roughness.png',
                ao: 'leaf-fall1-bl4/leaf-fall1-ao.png',
                metallic: 'leaf-fall1-bl4/leaf-fall1-metalness.png'
            },
            'wet-stones-with-sand-bl': {
                albedo: 'wet-stones-with-sand-bl/wet-stones-with-sand1-albedo.png',
                normal: 'wet-stones-with-sand-bl/wet-stones-with-sand1-normal-ogl.png',
                roughness: 'wet-stones-with-sand-bl/wet-stones-with-sand1-roughness.png',
                ao: 'wet-stones-with-sand-bl/wet-stones-with-sand1-ao.png',
                height: 'wet-stones-with-sand-bl/wet-stones-with-sand1-height.png',
                metallic: 'wet-stones-with-sand-bl/wet-stones-with-sand1-metallic.png'
            },
            'rock-snow-ice1-2k-bl': {
                albedo: 'rock-snow-ice1-2k-bl/rock-snow-ice1-2k_Base_Color.png',
                normal: 'rock-snow-ice1-2k-bl/rock-snow-ice1-2k_Normal-ogl.png',
                roughness: 'rock-snow-ice1-2k-bl/rock-snow-ice1-2k_Roughness.png',
                ao: 'rock-snow-ice1-2k-bl/rock-snow-ice1-2k_Ambient_Occlusion.png',
                height: 'rock-snow-ice1-2k-bl/rock-snow-ice1-2k_Height.png',
                metallic: 'rock-snow-ice1-2k-bl/rock-snow-ice1-2k_Metallic.png'
            },
            'rocky-rugged-terrain-bl': {
                albedo: 'rocky-rugged-terrain-bl/rocky-rugged-terrain_albedo.png',
                normal: 'rocky-rugged-terrain-bl/rocky-rugged-terrain_normal-ogl.png',
                roughness: 'rocky-rugged-terrain-bl/rocky-rugged-terrain_roughness.png',
                ao: 'rocky-rugged-terrain-bl/rocky-rugged-terrain_ao.png',
                height: 'rocky-rugged-terrain-bl/rocky-rugged-terrain_height.png',
                metallic: 'rocky-rugged-terrain-bl/rocky-rugged-terrain_metallic.png'
            },
            'gray-bricks1-bl4': {
                albedo: 'gray-bricks1-bl4/gray-bricks1-albedo.png',
                normal: 'gray-bricks1-bl4/gray-bricks1-Normal-ogl.png',
                roughness: 'gray-bricks1-bl4/gray-bricks1-Roughness.png',
                ao: 'gray-bricks1-bl4/gray-bricks1-ao.png',
                height: 'gray-bricks1-bl4/gray-bricks1-Height.png',
                metallic: 'gray-bricks1-bl4/gray-bricks1-Metallic.png'
            },
            'sloppy-brick-wall-bl': {
                albedo: 'sloppy-brick-wall-bl/sloppy-brick-wall_albedo.png',
                normal: 'sloppy-brick-wall-bl/sloppy-brick-wall_normal-ogl.png',
                roughness: 'sloppy-brick-wall-bl/sloppy-brick-wall_roughness.png',
                ao: 'sloppy-brick-wall-bl/sloppy-brick-wall_ao.png',
                height: 'sloppy-brick-wall-bl/sloppy-brick-wall_height.png',
                metallic: 'sloppy-brick-wall-bl/sloppy-brick-wall_metallic.png'
            },
            'sloppy-mortar-bricks-bl': {
                albedo: 'sloppy-mortar-bricks-bl/sloppy-mortar-bricks_albedo.png',
                normal: 'sloppy-mortar-bricks-bl/sloppy-mortar-bricks_normal-ogl.png',
                roughness: 'sloppy-mortar-bricks-bl/sloppy-mortar-bricks_roughness.png',
                ao: 'sloppy-mortar-bricks-bl/sloppy-mortar-bricks_ao.png',
                height: 'sloppy-mortar-bricks-bl/sloppy-mortar-bricks_height.png',
                metallic: 'sloppy-mortar-bricks-bl/sloppy-mortar-bricks_metallic.png'
            },
            'grime-alley-bricks_1-bl': {
                albedo: 'grime-alley-bricks_1-bl/grime-alley-bricks_1_albedo.png',
                normal: 'grime-alley-bricks_1-bl/grime-alley-bricks_1_normal-ogl.png',
                roughness: 'grime-alley-bricks_1-bl/grime-alley-bricks_1_roughness.png',
                ao: 'grime-alley-bricks_1-bl/grime-alley-bricks_1_ao.png',
                height: 'grime-alley-bricks_1-bl/grime-alley-bricks_1_height.png',
                metallic: 'grime-alley-bricks_1-bl/grime-alley-bricks_1_metallic.png'
            },
            'brown-varied-shingle-bl': {
                albedo: 'brown-varied-shingle-bl/brown-varied-shingle_albedo.png',
                normal: 'brown-varied-shingle-bl/brown-varied-shingle_normal-ogl.png',
                roughness: 'brown-varied-shingle-bl/brown-varied-shingle_roughness.png',
                ao: 'brown-varied-shingle-bl/brown-varied-shingle_ao.png',
                height: 'brown-varied-shingle-bl/brown-varied-shingle_height.png',
                metallic: 'brown-varied-shingle-bl/brown-varied-shingle_metallic.png'
            },
            'old-cedar-shingles-bl': {
                albedo: 'old-cedar-shingles-bl/old-cedar-shingles_albedo.png',
                normal: 'old-cedar-shingles-bl/old-cedar-shingles_normal-ogl.png',
                roughness: 'old-cedar-shingles-bl/old-cedar-shingles_roughness.png',
                ao: 'old-cedar-shingles-bl/old-cedar-shingles_ao.png',
                height: 'old-cedar-shingles-bl/old-cedar-shingles_height.png',
                metallic: 'old-cedar-shingles-bl/old-cedar-shingles_metallic.png'
            },
            'wetcobble-bl': {
                albedo: 'wetcobble-bl/wetcobble_albedo.png',
                normal: 'wetcobble-bl/wetcobble_normal-ogl.png',
                roughness: 'wetcobble-bl/wetcobble_roughness.png',
                ao: 'wetcobble-bl/wetcobble_ao.png',
                height: 'wetcobble-bl/wetcobble_height.png',
                metallic: 'wetcobble-bl/wetcobble_metallic.png'
            },
            'whispy-grass-meadow-bl': {
                albedo: 'whispy-grass-meadow-bl/whispy-grass-meadow_albedo.png',
                normal: 'whispy-grass-meadow-bl/whispy-grass-meadow_normal-ogl.png',
                roughness: 'whispy-grass-meadow-bl/whispy-grass-meadow_roughness.png',
                ao: 'whispy-grass-meadow-bl/whispy-grass-meadow_ao.png',
                height: 'whispy-grass-meadow-bl/whispy-grass-meadow_height.png',
                metallic: 'whispy-grass-meadow-bl/whispy-grass-meadow_metallic.png'
            },
            'dirtwithrocks-bl': {
                albedo: 'dirtwithrocks-bl/dirtwithrocks_Base_Color.png',
                normal: 'dirtwithrocks-bl/dirtwithrocks_Normal-ogl.png',
                roughness: 'dirtwithrocks-bl/dirtwithrocks_Roughness.png',
                ao: 'dirtwithrocks-bl/dirtwithrocks_Ambient_Occlusion.png',
                height: 'dirtwithrocks-bl/dirtwithrocks_Height.png',
                metallic: 'dirtwithrocks-bl/dirtwithrocks_Metallic.png'
            },
            'desert-cliff1-bl': {
                albedo: 'desert-cliff1-bl/desert-cliff1_albedo.png',
                normal: 'desert-cliff1-bl/desert-cliff1_normal-ogl.png',
                roughness: 'desert-cliff1-bl/desert-cliff1_roughness.png',
                ao: 'desert-cliff1-bl/desert-cliff1_ao.png',
                height: 'desert-cliff1-bl/desert-cliff1_height.png',
                metallic: 'desert-cliff1-bl/desert-cliff1_metallic.png'
            },
            'ice-field-bl -ue': {
                albedo: 'ice-field-bl -ue/ice-field_albedo.png',
                normal: 'ice-field-bl -ue/ice-field_normal-ogl.png',
                roughness: 'ice-field-bl -ue/ice-field_roughness.png',
                ao: 'ice-field-bl -ue/ice-field_ao.png',
                height: 'ice-field-bl -ue/ice-field_height.png',
                metallic: 'ice-field-bl -ue/ice-field_metallic.png'
            },
            'vertical-streak-cliff1-unity': {
                albedo: 'vertical-streak-cliff1-unity/vertical-streak-cliff1_albedo.png',
                normal: 'vertical-streak-cliff1-unity/vertical-streak-cliff1_normal-ogl.png',
                roughness: 'vertical-streak-cliff1-unity/vertical-streak-cliff1_roughness.png',
                ao: 'vertical-streak-cliff1-unity/vertical-streak-cliff1_ao.png',
                height: 'vertical-streak-cliff1-unity/vertical-streak-cliff1_height.png',
                metallic: 'vertical-streak-cliff1-unity/vertical-streak-cliff1_metallic.png'
            },
            'leaf-front-back-bl': {
                albedo: 'leaf-front-back-bl/leaf-front-back_albedo.png',
                normal: 'leaf-front-back-bl/leaf-front-back_normal-ogl.png',
                roughness: 'leaf-front-back-bl/leaf-front-back_roughness.png',
                ao: 'leaf-front-back-bl/leaf-front-back_ao.png',
                height: 'leaf-front-back-bl/leaf-front-back_height.png',
                metallic: 'leaf-front-back-bl/leaf-front-back_metallic.png'
            }
        };
    }

    static loadSet(name, options = {}) {
        const mapping = TextureSetLoader.getMapping()[name];
        if (!mapping) {
            console.warn(`[TextureSetLoader] Unknown texture set: ${name}`);
            return null;
        }
        const loader = new THREE.TextureLoader();
        const basePath = options.basePath || '../textures/';
        const result = {};
        for (const [type, fileName] of Object.entries(mapping)) {
            const path = basePath + fileName;
            const tex = loader.load(path, (loadedTex) => {
                if (typeof options.onLoad === 'function') {
                    try { options.onLoad(type, loadedTex); } catch (e) { /* noop */ }
                }
            }, undefined, (err) => {
                console.warn(`[TextureSetLoader] Failed to load ${path}:`, err);
            });
            tex.wrapS = options.wrapS ?? THREE.RepeatWrapping;
            tex.wrapT = options.wrapT ?? THREE.RepeatWrapping;
            tex.repeat.set(options.repeatX ?? 1, options.repeatY ?? 1);
            if (type === 'albedo') {
                tex.colorSpace = THREE.SRGBColorSpace;
            } else {
                tex.colorSpace = THREE.NoColorSpace;
            }
            tex.generateMipmaps = options.generateMipmaps !== false;
            tex.minFilter = options.minFilter ?? THREE.LinearMipmapLinearFilter;
            tex.magFilter = options.magFilter ?? THREE.LinearFilter;
            if (options.anisotropy) {
                tex.anisotropy = options.anisotropy;
            }
            result[type] = tex;
        }
        return result;
    }

    static loadAlbedoOnly(name, options = {}) {
        const set = TextureSetLoader.loadSet(name, options);
        return set ? set.albedo : null;
    }
}

if (typeof module !== 'undefined') {
    module.exports = { TextureSetLoader };
} else {
    window.TextureSetLoader = TextureSetLoader;
}
