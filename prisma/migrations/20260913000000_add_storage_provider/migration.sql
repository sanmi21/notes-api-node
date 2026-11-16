ALTER TABLE "NoteImage" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'local';
ALTER TABLE "NoteImage" ADD COLUMN "key" TEXT;
ALTER TABLE "NoteImage" ADD COLUMN "originalName" TEXT;
ALTER TABLE "NoteImage" ADD COLUMN "resourceType" TEXT;
ALTER TABLE "NoteImage" ADD COLUMN "metadata" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "NoteImage" ADD COLUMN "uploadType" TEXT NOT NULL DEFAULT 'note-image';
