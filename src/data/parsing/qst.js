// @flow
import { ArrayBufferCursor } from '../ArrayBufferCursor';

type QstContainedFile = {
    name: string;
    name_2: ?string; // Unsure what this is
    quest_no: ?number;
    expected_size: ?number;
    data: ArrayBufferCursor;
    chunk_nos: Set<number>;
};

type ParseQstResult = {
    version: string;
    files: QstContainedFile[];
};

/**
 * Low level parsing function for .qst files.
 * Can only read the Blue Burst format.
 */
export function parse_qst(cursor: ArrayBufferCursor): ?ParseQstResult {
    // A .qst file contains two 88-byte headers that describe the embedded .dat and .bin files.
    let version = 'PC';

    // Detect version.
    const version_a = cursor.u8();
    cursor.seek(1);
    const version_b = cursor.u8();

    if (version_a === 0x44) {
        version = 'Dreamcast/GameCube';
    } else if (version_a === 0x58) {
        if (version_b === 0x44) {
            version = 'Blue Burst';
        }
    } else if (version_a === 0xA6) {
        version = 'Dreamcast download';
    }

    if (version === 'Blue Burst') {
        // Read headers and contained files.
        cursor.seek_start(0);

        const headers = parse_headers(cursor);

        const files = parse_files(
            cursor, new Map(headers.map(h => [h.file_name, h.size])));

        for (const file of files) {
            const header = headers.find(h => h.file_name === file.name);

            if (header) {
                file.quest_no = header.quest_no;
                file.name_2 = header.file_name_2;
            }
        }

        return {
            version,
            files
        };
    } else {
        return null;
    }
}

type SimpleQstContainedFile = {
    name: string;
    name_2?: ?string;
    quest_no?: ?number;
    data: ArrayBufferCursor;
};

type WriteQstParams = {
    version?: ?string;
    files: SimpleQstContainedFile[];
};

/**
 * Always writes in Blue Burst format.
 */
export function write_qst(params: WriteQstParams): ArrayBufferCursor {
    const files = params.files;
    const total_size = files
        .map(f => 88 + Math.ceil(f.data.size / 1024) * 1056)
        .reduce((a, b) => a + b);
    const cursor = new ArrayBufferCursor(total_size, true);

    write_file_headers(cursor, files);
    write_file_chunks(cursor, files);

    if (cursor.size !== total_size) {
        throw new Error(`Expected a final file size of ${total_size}, but got ${cursor.size}.`);
    }

    return cursor.seek_start(0);
}

/**
 * TODO: Read all headers instead of just the first 2.
 */
function parse_headers(cursor: ArrayBufferCursor): any[] {
    const files = [];

    for (let i = 0; i < 2; ++i) {
        cursor.seek(4);
        const quest_no = cursor.u16();
        cursor.seek(38);
        const file_name = cursor.string_ascii(16, true, true);
        const size = cursor.u32();
        // Not sure what this is:
        const file_name_2 = cursor.string_ascii(24, true, true);

        files.push({
            quest_no,
            file_name,
            file_name_2,
            size
        });
    }

    return files;
}

function parse_files(cursor: ArrayBufferCursor, expected_sizes: Map<string, number>): QstContainedFile[] {
    // Files are interleaved in 1056 byte chunks.
    // Each chunk has a 24 byte header, 1024 byte data segment and an 8 byte trailer.
    const files = new Map();

    while (cursor.bytes_left) {
        const start_position = cursor.position;

        // Read meta data.
        const chunk_no = cursor.seek(4).u8();
        const file_name = cursor.seek(3).string_ascii(16, true, true);

        let file = files.get(file_name);

        if (!file) {
            const expected_size = expected_sizes.get(file_name) || null;
            files.set(file_name, file = {
                name: file_name,
                name_2: null,
                quest_no: null,
                expected_size,
                data: new ArrayBufferCursor(expected_size || (10 * 1024), true),
                chunk_nos: new Set()
            });
        }

        if (file.chunk_nos.has(chunk_no)) {
            console.warn(`File chunk number ${chunk_no} of file ${file_name} was already encountered, overwriting previous chunk.`);
        } else {
            file.chunk_nos.add(chunk_no);
        }

        // Read file data.
        let size = cursor.seek(1024).u32();
        cursor.seek(-1028);

        if (size > 1024) {
            console.warn(`Data segment size of ${size} is larger than expected maximum size, reading just 1024 bytes.`);
            size = 1024;
        }

        const data = cursor.take(size);
        const chunk_position = chunk_no * 1024;
        file.data.size = Math.max(chunk_position + size, file.data.size);
        file.data.seek_start(chunk_position).write_cursor(data);

        // Skip the padding and the trailer.
        cursor.seek(1032 - data.size);

        if (cursor.position !== start_position + 1056) {
            throw new Error(`Read ${cursor.position - start_position} file chunk message bytes instead of expected 1056.`);
        }
    }

    for (const file of files.values()) {
        // Clean up file properties.
        file.data.seek_start(0);
        file.chunk_nos = new Set(Array.from(file.chunk_nos.values()).sort((a, b) => a - b));

        // Check whether the expected size was correct.
        if (file.expected_size != null && file.data.size !== file.expected_size) {
            console.warn(`File ${file.name} has an actual size of ${file.data.size} instead of the expected size ${file.expected_size}.`);
        }

        // Detect missing file chunks.
        const actual_size = Math.max(file.data.size, file.expected_size || 0);

        for (let chunk_no = 0; chunk_no < Math.ceil(actual_size / 1024); ++chunk_no) {
            if (!file.chunk_nos.has(chunk_no)) {
                console.warn(`File ${file.name} is missing chunk ${chunk_no}.`);
            }
        }
    }

    return Array.from(files.values());
}

function write_file_headers(cursor: ArrayBufferCursor, files: SimpleQstContainedFile[]): void {
    for (const file of files) {
        cursor.write_u16(88); // Header size.
        cursor.write_u16(0x44); // Magic number.
        cursor.write_u16(file.quest_no || 0);

        for (let i = 0; i < 38; ++i) {
            cursor.write_u8(0);
        }

        cursor.write_string_ascii(file.name, 16);
        cursor.write_u32(file.data.size);

        let file_name_2: string;

        if (file.name_2 == null) {
            // Not sure this makes sense.
            const dot_pos = file.name.lastIndexOf('.');
            file_name_2 = dot_pos === -1
                ? file.name + '_j'
                : file.name.slice(0, dot_pos) + '_j' + file.name.slice(dot_pos);
        } else {
            file_name_2 = file.name_2;
        }

        cursor.write_string_ascii(file_name_2, 24);
    }
}

function write_file_chunks(cursor: ArrayBufferCursor, files: SimpleQstContainedFile[]): void {
    // Files are interleaved in 1056 byte chunks.
    // Each chunk has a 24 byte header, 1024 byte data segment and an 8 byte trailer.
    files = files.slice();
    const chunk_nos = new Array(files.length).fill(0);

    while (files.length) {
        let i = 0;

        while (i < files.length) {
            if (!write_file_chunk(cursor, files[i].data, chunk_nos[i]++, files[i].name)) {
                // Remove if there are no more chunks to write.
                files.splice(i, 1);
                chunk_nos.splice(i, 1);
            } else {
                ++i;
            }
        }
    }
}

/**
 * @returns true if there are bytes left to write in data, false otherwise.
 */
function write_file_chunk(
    cursor: ArrayBufferCursor,
    data: ArrayBufferCursor,
    chunk_no: number,
    name: string
): boolean {
    cursor.write_u8_array([28, 4, 19, 0]);
    cursor.write_u8(chunk_no);
    cursor.write_u8_array([0, 0, 0]);
    cursor.write_string_ascii(name, 16);

    const size = Math.min(1024, data.bytes_left);
    cursor.write_cursor(data.take(size));

    // Padding.
    for (let i = size; i < 1024; ++i) {
        cursor.write_u8(0);
    }

    cursor.write_u32(size);
    cursor.write_u32(0);

    return !!data.bytes_left;
}
