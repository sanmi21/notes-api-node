import express from 'express';
import prisma from '../db.js';
import {authenticateToken, verifyNoteOwnership} from '../middleware.js';
import {serializeImage} from '../utility.js';
import { upload } from '../upload.js';
import {
    deleteStoredUpload,
    getStoredUploadDownload,
    storeUpload
} from '../storage/storage.service.js';
import {isAllowedUploadType} from '../storage/storage.selector.js';
import {findOwnedUpload} from '../storage/upload-access.js';

const router = express.Router();

router.use(authenticateToken);

router.post('/:id/images', verifyNoteOwnership, upload.single('image'), async (req, res) => {
    let storedFile;
    try{
        if(!req.file){
            return res.status(400).json({error: 'No image attached'});
        }
        const requestedUploadType = req.body.uploadType;
        const uploadType = requestedUploadType || 'note-image';
        if (!isAllowedUploadType(uploadType)) {
            return res.status(400).json({error: 'Invalid upload type'});
        }
        if (!isMimeTypeAllowed(uploadType, req.file.mimetype)) {
            return res.status(400).json({error: 'Invalid file type for this upload type'});
        }
        const maxSize = uploadType === 'avatar' || uploadType === 'note-image'
            ? 5 * 1024 * 1024
            : 10 * 1024 * 1024;
        if (req.file.size > maxSize) {
            return res.status(400).json({error: `File exceeds the ${maxSize / 1024 / 1024} MB limit`});
        }
        if (!matchesFileSignature(req.file.buffer, req.file.mimetype)) {
            return res.status(400).json({error: 'File content does not match its MIME type'});
        }

        storedFile = await storeUpload(req.file, {
            uploadType: requestedUploadType,
            useDefaultProvider: !requestedUploadType,
            folder: `notes/${req.note.id}`,
            private: true
        });
        const newImage = await prisma.noteImage.create({
            data: {
                url: storedFile.url || '',
                provider: storedFile.provider,
                key: storedFile.key,
                originalName: storedFile.originalName,
                fileSize: storedFile.size,
                mimeType: storedFile.mimeType,
                resourceType: storedFile.resourceType,
                metadata: JSON.stringify(storedFile.metadata || {}),
                uploadType,
                noteId: req.note.id
            }
        });

        return res.status(201).json(serializeImage(newImage));
    }catch (error){
        if (storedFile) {
            await deleteStoredUpload(storedFile).catch((cleanupError) => {
                console.error('Failed to clean up upload after database error:', cleanupError.message);
            });
        }
        console.error("Error uploading image:", error);
        return res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Upload failed'
        });
    }
});

router.post('/', async (req, res) => {
    try {
        const {title, content, tags} = req.body;

        if (!title) {
            return res.status(400).json({error: 'Title is required'});
        }

        const tagsString = tags && Array.isArray(tags) ? JSON.stringify(tags) : '[]';

        const newNote = await prisma.note.create({
            data: {
                title, 
                content,
                tags: tagsString,
                userId : req.user.userId
            }
        });

        return res.status(201).json({
            ...newNote,
            tags: JSON.parse(newNote.tags)
        });
    } catch (error) {
        console.error("Error creating note:", error);
        return res.status(500).json({error: 'Internal server error'});
    }
});

router.get('/', async (req, res) => {
    try {
        const notes = await prisma.note.findMany({
            where: {
                userId: req.user.userId
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        const formattedNotes = notes.map((note) => ({
            ...note,
            tags: JSON.parse(note.tags || '[]')
        }));

        return res.json(formattedNotes);
        }catch (error) {
        console.error("Error fetching notes:", error);
        return res.status(500).json({error: 'Internal server error'});
    }
});

router.get('/:id', verifyNoteOwnership, async (req, res) => {
    try{
        const note = req.note;
        const images = await prisma.noteImage.findMany({
            where: {noteId: note.id}
        });

        return res.status(200).json({
            ...note,
            tags: JSON.parse(note.tags || '[]'),
            images: images.map(serializeImage)
        });
    }catch(error){
        console.error("Error fetching note:", error);
        return res.status(500).json({error: 'Internal server error'});
    }
});

router.get('/:id/images', verifyNoteOwnership, async (req, res) => {
    try{
        const note = req.note;
        const images = await prisma.noteImage.findMany({
            where: {noteId: note.id}
        });

        return res.json(images.map(serializeImage));
    }catch (error){
        console.error("Error fetching images:", error);
        return res.status(500).json({error: 'Internal server error'});
    }
});

router.get('/:noteId/images/:imageId/file', async (req, res, next) => {
    try {
        const noteId = Number(req.params.noteId);
        const imageId = Number(req.params.imageId);

        if (!Number.isInteger(noteId) || noteId <= 0 ||
            !Number.isInteger(imageId) || imageId <= 0) {
            return res.status(400).json({error: 'Invalid note or image ID'});
        }

        const image = await findOwnedUpload(prisma, {imageId, noteId, userId: req.user.userId});

        if (!image) {
            return res.status(404).json({error: 'Image not found'});
        }

        const download = await getStoredUploadDownload(image);
        if (download.type === 'redirect') return res.redirect(download.url);
        return res.sendFile(download.path, (error) => error && next(error));
    } catch (error) {
        if (error.code === 'ENOENT') return res.status(404).json({error: 'File not found'});
        console.error('Error retrieving upload:', error.message);
        return res.status(error.statusCode || 500).json({error: 'Unable to retrieve file'});
    }
});

router.delete('/:noteId/images/:imageId', async (req, res) => {
    try {
        const noteId = Number(req.params.noteId);
        const imageId = Number(req.params.imageId);
        if (!Number.isInteger(noteId) || noteId <= 0 || !Number.isInteger(imageId) || imageId <= 0) {
            return res.status(400).json({error: 'Invalid note or image ID'});
        }

        const image = await findOwnedUpload(prisma, {imageId, noteId, userId: req.user.userId});
        if (!image) return res.status(404).json({error: 'Image not found'});

        await deleteStoredUpload(image);
        await prisma.noteImage.delete({where: {id: image.id}});
        return res.status(204).send();
    } catch (error) {
        console.error('Error deleting upload:', error.message);
        return res.status(error.statusCode || 500).json({error: 'Unable to delete file'});
    }
});

router.put('/:id', verifyNoteOwnership, async (req, res) => {
    try {
        const noteId = req.note.id;
        const {title, content, tags} = req.body;

        const updateData = {};
        if (title !== undefined) updateData.title = title;
        if (content !== undefined) updateData.content = content;
        if (tags !== undefined && Array.isArray(tags)){
             updateData.tags = JSON.stringify(tags);
        }

        const updatedNote = await prisma.note.update({
            where: {id: noteId},
            data: updateData
        });

        return res.json({
            ...updatedNote,
            tags: JSON.parse(updatedNote.tags || '[]')
        });
    } catch (error) {
        console.error("Error updating note:", error);
        return res.status(500).json({error: 'Internal server error'});
    }
});

router.delete('/:id', verifyNoteOwnership, async (req, res) => {
    try{
        const noteId = req.note.id;
        const images = await prisma.noteImage.findMany({where: {noteId}});
        await Promise.all(images.map((image) => deleteStoredUpload(image)));
        await prisma.note.delete({
            where: {id: noteId}
        });
        return res.status(204).send();
    }catch (error) {
        console.error("Error deleting note:", error);
        return res.status(500).json({error: 'Internal server error'});
    }
});

export default router;

function isMimeTypeAllowed(uploadType, mimeType) {
    const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    if (uploadType === 'avatar' || uploadType === 'note-image') return imageTypes.has(mimeType);
    return imageTypes.has(mimeType) || mimeType === 'application/pdf';
}

function matchesFileSignature(buffer, mimeType) {
    if (!Buffer.isBuffer(buffer)) return false;
    if (mimeType === 'image/jpeg') return buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (mimeType === 'image/gif') return ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
    if (mimeType === 'image/webp') {
        return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    }
    if (mimeType === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    return false;
}
