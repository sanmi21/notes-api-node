export function serializeImage(image) {
    return {
        ...image,
        metadata: parseMetadata(image.metadata),
        url: `/notes/${image.noteId}/images/${image.id}/file`
    };
}

function parseMetadata(metadata) {
    if (!metadata) return {};
    if (typeof metadata === 'object') return metadata;
    try {
        return JSON.parse(metadata);
    } catch {
        return {};
    }
}
