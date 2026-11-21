-- AlterTable
ALTER TABLE "Mark" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Demo" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "centres" JSONB NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "boardState" BYTEA,
    "scripts" JSONB,
    "steps" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Demo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Demo_examId_key" ON "Demo"("examId");

