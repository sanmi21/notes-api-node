import express from 'express';
import path from 'path';
import prisma from '../db.js';
import {authenticateToken, verifyNoteOwnership} from '../middleware.js';
import { upload } from '../upload.js';

const router = express.Router();

router.use(authenticateToken);

const uploadDir = path.join(process.cwd(), 'uploads');

function serializeImage(image) {
    return {
        ...image,
        url: `/notes/${image.noteId}/images/${image.id}/file`
    };
}

router.post('/:id/images', verifyNoteOwnership, upload.single('image'), async (req, res) => {
    try{
        const noteId = parseInt(req.params.id);

        if (!req.file){
            return res.status(400).json({error : 'No image file provided'});
        }

        const existingNote = await prisma.note.findFirst({
            where: {id: noteId, userId: req.user.userId}
        });

        if (!existingNote){
            return res.status(404).json({error: 'Note not found or unauthorized'});
        }

        const imageUrl = `/uploads/${req.file.filename}`;
        const newImage = await prisma.noteImage.create({
            data: {
                url: imageUrl,
                fileSize: req.file.size,
                mimeType: req.file.mimetype,
                noteId: existingNote.id
            }
        });

        return res.status(201).json(serializeImage(newImage));
    }catch (error){
        console.error("Error uploading image:", error);
        return res.status(500).json({error: 'Internal server error'});
    }
});

router.get('/:id/images', async (req, res) => {
    try{
        const noteId = parseInt(req.params.id);
        
        const existingNote = await prisma.note.findFirst({
            where: {id: noteId, userId: req.user.userId},
            include: {images: true}
        });

        if (!existingNote){
            return res.status(404).json({error:' Note not found or unauthorized'});
        }

        return res.json(existingNote.images.map(serializeImage));
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

        const image = await prisma.noteImage.findFirst({
            where: {
                id: imageId,
                noteId,
                note: {
                    userId: req.user.userId
                }
            }
        });

        if (!image) {
            return res.status(404).json({error: 'Image not found'});
        }

        const filename = path.basename(image.url);
        return res.sendFile(path.join(uploadDir, filename), (error) => {
            if (error) {
                next(error);
            }
        });
    } catch (error) {
        next(error);
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
        include: {
            images: true 
        },
        orderBy: {
            createdAt: 'desc' 
        }
        });

        const formattedNotes = notes.map((note) => ({
        ...note,
        tags: JSON.parse(note.tags || '[]'),
        images: note.images.map(serializeImage)
        }));

        return res.json(formattedNotes);
        }catch (error) {
        console.error("Error fetching notes:", error);
        return res.status(500).json({error: 'Internal server error'});
    }
});


router.put('/:id', async (req, res) => {
    try {
        const noteId = parseInt(req.params.id);
        const {title, content, tags} = req.body;
        
        const existingNote = await prisma.note.findFirst({
            where: {
                id: noteId,
                userId: req.user.userId
            }
        });

        if (!existingNote) {
            return res.status(404).json({error: 'Note not found'});
        
        }

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

router.delete('/:id', async (req, res) => {
    try{
        const noteId = parseInt(req.params.id);

        const existingNote = await prisma.note.findFirst({
            where: {
                id: noteId,
                userId: req.user.userId
            
            }
        });

        if (!existingNote) { 
            return res.status(404).json({error: 'Note not found or undauthorized'});
        
        }

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
