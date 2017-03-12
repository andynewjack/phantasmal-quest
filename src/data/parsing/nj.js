// @flow
import {
    BufferAttribute,
    BufferGeometry,
    Euler,
    Matrix3,
    Matrix4,
    Object3D,
    Quaternion,
    Vector3
} from 'three';
import { ArrayBufferCursor } from '../ArrayBufferCursor';

// TODO:
// - deal with multiple NJCM chunks
// - deal with other types of chunks
// - textures
// - colors
// - bump maps
// - animation
// - deal with vertex information contained in triangle strips
export function parse_nj(cursor: ArrayBufferCursor): ?Object3D {
    while (cursor.bytes_left) {
        // NJ uses a little endian variant of the IFF format.
        // IFF files contain chunks preceded by an 8-byte header.
        // The header consists of 4 ASCII characters for the "Type ID" and a 32-bit integer specifying the chunk size.
        const iff_type_id = cursor.string_ascii(4, false, false);
        const iff_chunk_size = cursor.u32();

        if (iff_type_id === 'NJCM') {
            return parse_njcm(cursor.take(iff_chunk_size));
        } else {
            cursor.seek(iff_chunk_size);
        }
    }

    return null;
}

type Node = {
    vertices: { position: Vector3, normal: Vector3 }[],
    indices: number[],
    parent: ?Node,
    children: Node[]
};

type ChunkVertex = {
    index: number,
    position: [number, number, number],
    normal?: [number, number, number]
};

type ChunkTriangleStrip = {
    clockwise_winding: boolean,
    indices: number[]
};

function parse_njcm(cursor: ArrayBufferCursor): ?BufferGeometry {
    if (cursor.bytes_left) {
        const positions: number[] = [];
        const normals: number[] = [];
        parse_sibling_objects(cursor, new Matrix4(), positions, normals, [], []);
        return create_buffer_geometry(positions, normals);
    } else {
        return null;
    }
}

function parse_sibling_objects(
    cursor: ArrayBufferCursor,
    parent_matrix: Matrix4,
    positions: number[],
    normals: number[],
    cached_chunk_offsets: number[],
    vertices: *[]
): void {
    const eval_flags = cursor.u32();
    const no_translate = (eval_flags & 0b1) !== 0;
    const no_rotate = (eval_flags & 0b10) !== 0;
    const no_scale = (eval_flags & 0b100) !== 0;
    const hidden = (eval_flags & 0b1000) !== 0;
    const break_child_trace = (eval_flags & 0b10000) !== 0;
    const zxy_rotation_order = (eval_flags & 0b100000) !== 0;

    const model_offset = cursor.u32();
    const pos_x = cursor.f32();
    const pos_y = cursor.f32();
    const pos_z = cursor.f32();
    const rotation_x = cursor.i32() * (2 * Math.PI / 0xFFFF);
    const rotation_y = cursor.i32() * (2 * Math.PI / 0xFFFF);
    const rotation_z = cursor.i32() * (2 * Math.PI / 0xFFFF);
    const scale_x = cursor.f32();
    const scale_y = cursor.f32();
    const scale_z = cursor.f32();
    const child_offset = cursor.u32();
    const sibling_offset = cursor.u32();

    const rotation = new Euler(rotation_x, rotation_y, rotation_z, zxy_rotation_order ? 'ZXY' : 'ZYX');
    const matrix = new Matrix4()
        .compose(
        no_translate ? new Vector3() : new Vector3(pos_x, pos_y, pos_z),
        no_rotate ? new Quaternion(0, 0, 0, 1) : new Quaternion().setFromEuler(rotation),
        no_scale ? new Vector3(1, 1, 1) : new Vector3(scale_x, scale_y, scale_z)
        )
        .premultiply(parent_matrix);

    if (model_offset && !hidden) {
        cursor.seek_start(model_offset);
        parse_model(cursor, matrix, positions, normals, cached_chunk_offsets, vertices);
    }

    if (child_offset && !break_child_trace) {
        cursor.seek_start(child_offset);
        parse_sibling_objects(cursor, matrix, positions, normals, cached_chunk_offsets, vertices);
    }

    if (sibling_offset) {
        cursor.seek_start(sibling_offset);
        parse_sibling_objects(cursor, parent_matrix, positions, normals, cached_chunk_offsets, vertices);
    }
}

function create_buffer_geometry(
    positions: number[],
    normals: number[]
): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.addAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.addAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    return geometry;
}

function parse_model(
    cursor: ArrayBufferCursor,
    matrix: Matrix4,
    positions: number[],
    normals: number[],
    cached_chunk_offsets: number[],
    vertices: { position: Vector3, normal: Vector3 }[]
): void {
    const vlist_offset = cursor.u32(); // Vertex list
    const plist_offset = cursor.u32(); // Triangle strip index list

    const normal_matrix = new Matrix3().getNormalMatrix(matrix);

    if (vlist_offset) {
        cursor.seek_start(vlist_offset);

        for (const chunk of parse_chunks(cursor, cached_chunk_offsets, true)) {
            if (chunk.chunk_type === 'VERTEX') {
                const chunk_vertices: ChunkVertex[] = (chunk.data: any);

                for (const vertex of chunk_vertices) {
                    const position = new Vector3(...vertex.position).applyMatrix4(matrix);
                    const normal = vertex.normal ? new Vector3(...vertex.normal).applyMatrix3(normal_matrix) : [0, 1, 0];
                    vertices[vertex.index] = { position, normal };
                }
            }
        }
    }

    if (plist_offset) {
        cursor.seek_start(plist_offset);

        for (const chunk of parse_chunks(cursor, cached_chunk_offsets, false)) {
            if (chunk.chunk_type === 'STRIP') {
                for (const {clockwise_winding, indices: strip_indices} of (chunk.data: any)) {
                    for (let j = 2; j < strip_indices.length; ++j) {
                        const a = vertices[strip_indices[j - 2]];
                        const b = vertices[strip_indices[j - 1]];
                        const c = vertices[strip_indices[j]];

                        if (a && b && c) {
                            if (j % 2 === (clockwise_winding ? 1 : 0)) {
                                positions.splice(positions.length, 0, a.position.x, a.position.y, a.position.z);
                                positions.splice(positions.length, 0, b.position.x, b.position.y, b.position.z);
                                positions.splice(positions.length, 0, c.position.x, c.position.y, c.position.z);
                                normals.splice(normals.length, 0, a.normal.x, a.normal.y, a.normal.z);
                                normals.splice(normals.length, 0, b.normal.x, b.normal.y, b.normal.z);
                                normals.splice(normals.length, 0, c.normal.x, c.normal.y, c.normal.z);
                            } else {
                                positions.splice(positions.length, 0, b.position.x, b.position.y, b.position.z);
                                positions.splice(positions.length, 0, a.position.x, a.position.y, a.position.z);
                                positions.splice(positions.length, 0, c.position.x, c.position.y, c.position.z);
                                normals.splice(normals.length, 0, b.normal.x, b.normal.y, b.normal.z);
                                normals.splice(normals.length, 0, a.normal.x, a.normal.y, a.normal.z);
                                normals.splice(normals.length, 0, c.normal.x, c.normal.y, c.normal.z);
                            }
                        }
                    }
                }
            }
        }
    }
}

function parse_chunks(cursor: ArrayBufferCursor, cached_chunk_offsets: number[], wide_end_chunks: boolean): *[] {
    const chunks = [];
    let loop = true;

    while (loop) {
        const chunk_type_id = cursor.u8();
        const flags = cursor.u8();
        const chunk_start_position = cursor.position;
        let chunk_type = 'UNKOWN';
        let chunk_sub_type = null;
        let data = null;
        let size = 0;

        if (chunk_type_id === 0) {
            chunk_type = 'NULL';
        } else if (1 <= chunk_type_id && chunk_type_id <= 5) {
            chunk_type = 'BITS';

            if (chunk_type_id === 4) {
                chunk_sub_type = 'CACHE_POLYGON_LIST';
                data = {
                    store_index: flags,
                    offset: cursor.position
                };
                cached_chunk_offsets[data.store_index] = data.offset;
                loop = false;
            } else if (chunk_type_id === 5) {
                chunk_sub_type = 'DRAW_POLYGON_LIST';
                data = {
                    store_index: flags
                };
                cursor.seek_start(cached_chunk_offsets[data.store_index]);
                chunks.splice(chunks.length, 0, ...parse_chunks(cursor, cached_chunk_offsets, wide_end_chunks));
            }
        } else if (8 <= chunk_type_id && chunk_type_id <= 9) {
            chunk_type = 'TINY';
            size = 2;
        } else if (17 <= chunk_type_id && chunk_type_id <= 31) {
            chunk_type = 'MATERIAL';
            size = 2 + 2 * cursor.u16();
        } else if (32 <= chunk_type_id && chunk_type_id <= 50) {
            chunk_type = 'VERTEX';
            size = 2 + 4 * cursor.u16();
            data = parse_chunk_vertex(cursor, chunk_type_id, flags);
        } else if (56 <= chunk_type_id && chunk_type_id <= 58) {
            chunk_type = 'VOLUME';
            size = 2 + 2 * cursor.u16();
        } else if (64 <= chunk_type_id && chunk_type_id <= 75) {
            chunk_type = 'STRIP';
            size = 2 + 2 * cursor.u16();
            data = parse_chunk_triangle_strip(cursor, chunk_type_id);
        } else if (chunk_type_id === 255) {
            chunk_type = 'END';
            size = wide_end_chunks ? 2 : 0;
            loop = false;
        } else {
            // Ignore unknown chunks.
            console.warn(`Unknown chunk type: ${chunk_type_id}.`);
            size = 2 + 2 * cursor.u16();
        }

        cursor.seek_start(chunk_start_position + size);

        chunks.push({
            chunk_type,
            chunk_sub_type,
            chunk_type_id,
            data
        });
    }

    return chunks;
}

function parse_chunk_vertex(cursor: ArrayBufferCursor, chunk_type_id: number, flags: number): ChunkVertex[] {
    // There are apparently 4 different sets of vertices, ignore all but set 0.
    if ((flags & 0b11) !== 0) {
        return [];
    }

    const index = cursor.u16();
    const vertex_count = cursor.u16();

    const vertices: ChunkVertex[] = [];

    for (let i = 0; i < vertex_count; ++i) {
        const vertex: ChunkVertex = {
            index: index + i,
            position: [
                cursor.f32(), // x
                cursor.f32(), // y
                cursor.f32(), // z
            ]
        };

        if (chunk_type_id === 32) {
            cursor.seek(4); // Always 1.0
        } else if (chunk_type_id === 33) {
            cursor.seek(4); // Always 1.0
            vertex.normal = [
                cursor.f32(), // x
                cursor.f32(), // y
                cursor.f32(), // z
            ];
            cursor.seek(4); // Always 0.0
        } else if (35 <= chunk_type_id && chunk_type_id <= 40) {
            if (chunk_type_id === 37) {
                // Ninja flags
                vertex.index = index + cursor.u16();
                cursor.seek(2);
            } else {
                // Skip user flags and material information.
                cursor.seek(4);
            }
        } else if (41 <= chunk_type_id && chunk_type_id <= 47) {
            vertex.normal = [
                cursor.f32(), // x
                cursor.f32(), // y
                cursor.f32(), // z
            ];

            if (chunk_type_id >= 42) {
                if (chunk_type_id === 44) {
                    // Ninja flags
                    vertex.index = index + cursor.u16();
                    cursor.seek(2);
                } else {
                    // Skip user flags and material information.
                    cursor.seek(4);
                }
            }
        } else if (chunk_type_id >= 48) {
            // Skip 32-bit vertex normal in format: reserved(2)|x(10)|y(10)|z(10)
            cursor.seek(4);

            if (chunk_type_id >= 49) {
                // Skip user flags and material information.
                cursor.seek(4);
            }
        }

        vertices.push(vertex);
    }

    return vertices;
}

function parse_chunk_triangle_strip(cursor: ArrayBufferCursor, chunk_type_id: number): ChunkTriangleStrip[] {
    const user_offset_and_strip_count = cursor.u16();
    const user_flags_size = user_offset_and_strip_count >>> 14;
    const strip_count = user_offset_and_strip_count & 0x3FFF;
    let options;

    switch (chunk_type_id) {
        case 64: options = [false, false, false, false]; break;
        case 65: options = [true, false, false, false]; break;
        case 66: options = [true, false, false, false]; break;
        case 67: options = [false, false, true, false]; break;
        case 68: options = [true, false, true, false]; break;
        case 69: options = [true, false, true, false]; break;
        case 70: options = [false, true, false, false]; break;
        case 71: options = [true, true, false, false]; break;
        case 72: options = [true, true, false, false]; break;
        case 73: options = [false, false, false, false]; break;
        case 74: options = [true, false, false, true]; break;
        case 75: options = [true, false, false, true]; break;
        default: throw new Error(`Unexpected chunk type ID: ${chunk_type_id}.`);
    }

    const [
        parse_texture_coords,
        parse_color,
        parse_normal,
        parse_texture_coords_hires
    ] = options;

    const strips = [];

    for (let i = 0; i < strip_count; ++i) {
        const winding_flag_and_index_count = cursor.i16();
        const clockwise_winding = winding_flag_and_index_count < 1;
        const index_count = Math.abs(winding_flag_and_index_count);

        const indices = [];

        for (let j = 0; j < index_count; ++j) {
            indices.push(cursor.u16());

            if (parse_texture_coords) {
                cursor.seek(4);
            }

            if (parse_color) {
                cursor.seek(4);
            }

            if (parse_normal) {
                cursor.seek(6);
            }

            if (parse_texture_coords_hires) {
                cursor.seek(8);
            }

            if (j >= 2) {
                cursor.seek(2 * user_flags_size);
            }
        }

        strips.push({ clockwise_winding, indices });
    }

    return strips;
}
