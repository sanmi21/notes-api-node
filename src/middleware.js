import jwt from "jsonwebtoken";

export function authenticateToken(req, res, next){
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, payload) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = payload;
        next();
    });
}

export async function verifyNoteOwnership(req, res, next) {
  const noteId = Number(req.params.id);

  if (!Number.isInteger(noteId) || noteId <= 0) {
    return res.status(400).json({ error: 'Invalid note ID' });
  }

  const note = await prisma.note.findFirst({
    where: {
      id: noteId,
      userId: req.user.userId
    }
  });

  if (!note) {
    return res.status(404).json({ error: 'Note not found' });
  }

  req.note = note;
  next();
}