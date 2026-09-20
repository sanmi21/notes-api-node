# Express Notes API (RESTful Service)

A secure, high-performance RESTful API for managing user notes, built with **Node.js**, **Express**, **Prisma ORM**, and **SQLite**. Features JWT authentication, `bcryptjs` password hashing, and custom middleware for protected routes.

## Authentication testing

The Scale 1 authentication release includes signup, password login, protected access, password reset, and authenticator-app MFA. Read the [Scale 1 implementation guide](./docs/auth/scale-one-implementation.md) to understand the code, then follow the [Scale 1 testing guide](./docs/auth/scale-one-testing.md) to test the complete flow with Thunder Client.

## Tech Stack

-**Runtime**: Node.js (ES Modules)

- **Framework:** Express.js
- **Database & ORM:** SQLite + Prisma ORM (v5)
- **Authentication:** JSON Web Tokens (`jsonwebtoken`) + Password Hashing (`bcryptjs`)
- **API Testing:** Thunder Client

## Architecture & Project Structure

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
