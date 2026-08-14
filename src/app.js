import express from 'express';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import noteRoutes from './routes/notes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

app.use('/auth', authRoutes);
app.use('/notes', noteRoutes);

app.get('/', (req, res) => {
    res.send('Welcome to the Notes API')
});

app.listen(PORT, ()=> {
    console.log(`🚀 Express Server running on http://localhost:${PORT}`);
})