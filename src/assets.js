// @flow

export function get_area_render_data(
    area_id: number,
    area_version: number
): Promise<ArrayBuffer> {
    return get_area_asset(area_id, area_version, 'render');
}

export function get_area_collision_data(
    area_id: number,
    area_version: number
): Promise<ArrayBuffer> {
    return get_area_asset(area_id, area_version, 'collision');
}

/**
 * Cache for the binary data.
 */
const buffer_cache: Map<string, Promise<ArrayBuffer>> = new Map();

function get_asset(url: string): Promise<ArrayBuffer> {
    const promise = buffer_cache.get(url);

    if (promise) {
        return promise;
    } else {
        const promise = fetch(url).then(r => r.arrayBuffer());
        buffer_cache.set(url, promise);
        return promise;
    }
}

function area_version_to_base_url(area_id: number, area_variant: number): string {
    const base_names = [
        ['city00_00', 1],
        ['forest01', 1],
        ['forest02', 1],
        ['cave01_', 6],
        ['cave02_', 5],
        ['cave03_', 6],
        ['machine01_', 6],
        ['machine02_', 6],
        ['ancient01_', 5],
        ['ancient02_', 5],
        ['ancient03_', 5],
        ['boss01', 1],
        ['boss02', 1],
        ['boss03', 1],
        ['darkfalz00', 1]
    ];

    if (0 <= area_id && area_id < base_names.length) {
        const [base_name, variants] = base_names[area_id];

        if (0 <= area_variant && area_variant < variants) {
            const base_url: string = ((process.env.PUBLIC_URL): any);
            let variant: string;

            if (variants === 1) {
                variant = '';
            } else {
                variant = String(area_variant);
                while (variant.length < 2) variant = '0' + variant;
            }

            return `${base_url}/maps/map_${base_name}${variant}`;
        } else {
            throw new Error(`Unknown variant ${area_variant} of area ${area_id}.`);
        }
    } else {
        throw new Error(`Unknown area ${area_id}.`);
    }
}

type AreaAssetType = 'render' | 'collision';

function get_area_asset(
    area_id: number,
    area_variant: number,
    type: AreaAssetType
): Promise<ArrayBuffer> {
    try {
        const base_url = area_version_to_base_url(area_id, area_variant);
        const suffix = type === 'render' ? 'n.rel' : 'c.rel';
        return get_asset(base_url + suffix);
    } catch (e) {
        return Promise.reject(e);
    }
}
