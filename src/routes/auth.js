import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../db.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'SUPER_SECRET_KEY_NOTES_API_2026';

// ----------------------------------
// 1. POST /auth/signup
// ----------------------------------
router.post('/signup', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash the password with bcrypt (salting done automatically)
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user in SQLite via Prisma
    const newUser = await prisma.user.create({
      data: {
        email,
        password: hashedPassword
      }
    });

    // Return response omitting password
    return res.status(201).json({
      id: newUser.id,
      email: newUser.email
    });

  } catch (error) {
    console.error("Signup error:", error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ----------------------------------
// 2. POST /auth/login
// ----------------------------------
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password match using bcrypt
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT access token
    const token = jwt.sign(
      { userId: user.id },
      JWT_SECRET,
      { expiresIn: '30m' }
    );

    return res.json({
      access_token: token,
      token_type: 'bearer'
    });

  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;