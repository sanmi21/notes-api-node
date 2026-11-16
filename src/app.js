import 'dotenv/config';
import express from 'express';
import authRoutes from './routes/auth.js';
import noteRoutes from './routes/notes.js';
import multer from 'multer';

const app = express();

app.use(express.json({limit: '100kb'}));

app.use('/auth', authRoutes);
app.use('/notes', noteRoutes);

app.get('/', (req, res) => {
    res.send('Welcome to the Notes API')
});

app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        const message = error.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the 10 MB limit' : 'Invalid upload';
        return res.status(400).json({error: message});
    }
    if (error) {
        console.error('Unhandled request error:', error.message);
        return res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Internal server error'
        });
    }
    next();
});

export default app;
