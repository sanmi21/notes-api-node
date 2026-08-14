# Express Notes API (RESTful Service)

A secure, high-performance RESTful API for managing user notes, built with **Node.js**, **Express**, **Prisma ORM**, and **SQLite**. Features JWT authentication, `bcryptjs` password hashing, and custom middleware for protected routes.

## Tech Stack

-**Runtime**: Node.js (ES Modules)

- **Framework:** Express.js
- **Database & ORM:** SQLite + Prisma ORM (v5)
- **Authentication:** JSON Web Tokens (`jsonwebtoken`) + Password Hashing (`bcryptjs`)
- **API Testing:** Thunder Client

## Architecture & Project Structure

```text
notes_api/
├── prisma/
│ └── schema.prisma # Relational Database Models (User & Note)
├── src/
│ ├── routes/
│ │ ├── auth.js # Public Auth endpoints (/signup, /login)
│ │ └── notes.js # Protected Notes CRUD endpoints
│ ├── app.js # Express Application Entrypoint
│ ├── db.js # Centralized Prisma Client instance
│ └── middleware.js # JWT Authentication Verification Guard
├── .env # Environment secrets (ignored by Git)
└── package.json
