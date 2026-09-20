export function findOwnedUpload(database, {imageId, noteId, userId}) {
  return database.noteImage.findFirst({
    where: {
      id: imageId,
      noteId,
      note: {userId}
    }
  });
}
