// @flow
import { groupBy } from 'lodash';
import { ArrayBufferCursor } from '../ArrayBufferCursor';

const OBJECT_SIZE = 68;
const NPC_SIZE = 72;

export function parse_dat(cursor: ArrayBufferCursor) {
    const objs = [];
    const npcs = [];
    const unknowns = [];

    while (cursor.bytes_left) {
        const entity_type = cursor.u32();
        const total_size = cursor.u32();
        const area_id = cursor.u32();
        const entities_size = cursor.u32();

        if (entity_type === 0) {
            break;
        } else {
            if (entities_size !== total_size - 16) {
                throw Error(`Malformed DAT file. Expected an entities size of ${total_size - 16}, got ${entities_size}.`);
            }

            if (entity_type === 1) { // Objects
                const object_count = Math.floor(entities_size / OBJECT_SIZE);
                const start_position = cursor.position;

                for (let i = 0; i < object_count; ++i) {
                    const type_id = cursor.u16();
                    const unknown1 = cursor.u8_array(10);
                    const section_id = cursor.u16();
                    const unknown2 = cursor.u8_array(2);
                    const x = cursor.f32();
                    const y = cursor.f32();
                    const z = cursor.f32();
                    const unknown3 = cursor.u8_array(40);

                    objs.push({
                        type_id,
                        unknown1,
                        section_id,
                        unknown2,
                        position: { x, y, z },
                        unknown3,
                        area_id
                    });
                }

                const bytes_read = cursor.position - start_position;

                if (bytes_read !== entities_size) {
                    console.warn(`Read ${bytes_read} bytes instead of expected ${entities_size} for entity type ${entity_type} (Object).`);
                    cursor.seek(entities_size - bytes_read);
                }
            } else if (entity_type === 2) { // NPCs
                const npc_count = Math.floor(entities_size / NPC_SIZE);
                const start_position = cursor.position;

                for (let i = 0; i < npc_count; ++i) {
                    const type_id = cursor.u16();
                    const unknown1 = cursor.u8_array(10);
                    const section_id = cursor.u16();
                    const unknown2 = cursor.u8_array(6);
                    const x = cursor.f32();
                    const y = cursor.f32();
                    const z = cursor.f32();
                    const unknown3 = cursor.u8_array(16);
                    const flags = cursor.u32();
                    const unknown4 = cursor.u8_array(12);
                    const skin = cursor.u32();
                    const unknown5 = cursor.u8_array(4);

                    npcs.push({
                        type_id,
                        unknown1,
                        section_id,
                        unknown2,
                        position: { x, y, z },
                        unknown3,
                        flags,
                        unknown4,
                        skin,
                        unknown5,
                        area_id
                    });
                }

                const bytes_read = cursor.position - start_position;

                if (bytes_read !== entities_size) {
                    console.warn(`Read ${bytes_read} bytes instead of expected ${entities_size} for entity type ${entity_type} (NPC).`);
                    cursor.seek(entities_size - bytes_read);
                }
            } else {
                // There are also waves (type 3) and unknown entity types 4 and 5.
                unknowns.push({
                    entity_type,
                    total_size,
                    area_id,
                    entities_size,
                    data: cursor.u8_array(entities_size)
                });
            }
        }
    }

    return { objs, npcs, unknowns };
}

export function write_dat({objs, npcs, unknowns}): ArrayBufferCursor {
    const cursor = new ArrayBufferCursor(
        objs.length * OBJECT_SIZE + npcs.length * NPC_SIZE + unknowns * 1000, true);

    const grouped_objs = groupBy(objs, obj => obj.area_id);
    const obj_area_ids = Object.keys(grouped_objs)
        .map(key => parseInt(key, 10))
        .sort((a, b) => a - b);

    for (const area_id of obj_area_ids) {
        const objs = grouped_objs[area_id];
        const entities_size = objs.length * OBJECT_SIZE;
        cursor.write_u32(1); // Entity type
        cursor.write_u32(entities_size + 16);
        cursor.write_u32(area_id);
        cursor.write_u32(entities_size);

        for (const obj of objs) {
            cursor.write_u16(obj.type_id);
            cursor.write_u8_array(obj.unknown1);
            cursor.write_u16(obj.section_id);
            cursor.write_u8_array(obj.unknown2);
            cursor.write_f32(obj.position.x);
            cursor.write_f32(obj.position.y);
            cursor.write_f32(obj.position.z);
            cursor.write_u8_array(obj.unknown3);
        }
    }

    const grouped_npcs = groupBy(npcs, npc => npc.area_id);
    const npc_area_ids = Object.keys(grouped_npcs)
        .map(key => parseInt(key, 10))
        .sort((a, b) => a - b);

    for (const area_id of npc_area_ids) {
        const npcs = grouped_npcs[area_id];
        const entities_size = npcs.length * NPC_SIZE;
        cursor.write_u32(2); // Entity type
        cursor.write_u32(entities_size + 16);
        cursor.write_u32(area_id);
        cursor.write_u32(entities_size);

        for (const npc of npcs) {
            cursor.write_u16(npc.type_id);
            cursor.write_u8_array(npc.unknown1);
            cursor.write_u16(npc.section_id);
            cursor.write_u8_array(npc.unknown2);
            cursor.write_f32(npc.position.x);
            cursor.write_f32(npc.position.y);
            cursor.write_f32(npc.position.z);
            cursor.write_u8_array(npc.unknown3);
            cursor.write_u32(npc.flags);
            cursor.write_u8_array(npc.unknown4);
            cursor.write_u32(npc.skin);
            cursor.write_u8_array(npc.unknown5);
        }
    }

    for (const unknown of unknowns) {
        cursor.write_u32(unknown.entity_type);
        cursor.write_u32(unknown.total_size);
        cursor.write_u32(unknown.area_id);
        cursor.write_u32(unknown.entities_size);
        cursor.write_u8_array(unknown.data);
    }

    // Final header.
    cursor.write_u32(0);
    cursor.write_u32(0);
    cursor.write_u32(0);
    cursor.write_u32(0);

    cursor.seek_start(0);

    return cursor;
}