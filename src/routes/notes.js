import express from 'express';
import prisma from '../db.js';
import {authenticateToken} from '../middleware.js';

const router = express.Router();

router.use(authenticateToken);


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
            where: { userId: req.user.userId }
        });
        

        const formattedNotes = notes.map(note => ({
            ...note,
            tags: JSON.parse(note.tags || '[]')
        }));
        
        return res.json(formattedNotes);
    } catch (error) {
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