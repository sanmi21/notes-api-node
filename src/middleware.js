import prisma from './db.js';
import {verifyToken} from './auth/tokens.js';

export function authenticateToken(req, res, next) {
    const authHeader = req.get('authorization');
    const match = typeof authHeader === 'string' && authHeader.match(/^Bearer ([^\s]+)$/);
    const token = match?.[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        req.user = verifyToken(token, 'access');
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid or expired access token' });
    }
}

export async function verifyNoteOwnership(req, res, next) {
    const noteId = Number(req.params.id);

    if (!Number.isInteger(noteId) || noteId <= 0) {
    return res.status(400).json({ error: 'Invalid note ID' });
    }

    const existingNote = await prisma.note.findFirst({
        where: {id: noteId, userId: req.user.userId}
    });


    if (!existingNote) {
    return res.status(404).json({ error: 'Note not found' });
    }

    req.note = existingNote;
    next();
}
