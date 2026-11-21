-- CreateEnum
CREATE TYPE "MarksStatus" AS ENUM ('OPEN', 'PUBLISHING', 'PUBLISHED');

-- AlterTable
ALTER TABLE "EpochEnvelope" ADD COLUMN     "added" TEXT[],
ADD COLUMN     "confirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "groupChainId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "members" TEXT[],
ADD COLUMN     "removed" TEXT[],
ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'INVIGILATOR';

-- AlterTable
ALTER TABLE "Exam" ADD COLUMN     "marksSnapshot" JSONB,
ADD COLUMN     "marksStatus" "MarksStatus" NOT NULL DEFAULT 'OPEN';

-- AlterTable
ALTER TABLE "Mark" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "RelayJob" ADD COLUMN     "examId" TEXT,
ADD COLUMN     "ref" TEXT;

-- CreateTable
CREATE TABLE "ScriptTicket" (
    "tokenHash" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScriptTicket_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "ScriptTicket_examId_idx" ON "ScriptTicket"("examId");

-- CreateIndex
CREATE INDEX "RelayJob_ref_idx" ON "RelayJob"("ref");

-- CreateIndex
CREATE INDEX "RelayJob_status_idx" ON "RelayJob"("status");


-- existing rows got safe defaults above; new rows always set groupChainId explicitly
ALTER TABLE "EpochEnvelope" ALTER COLUMN "groupChainId" DROP DEFAULT;
-- centre groups' chain id is the centreId itself
UPDATE "EpochEnvelope" SET "groupChainId" = substring("groupKey" from 8) WHERE "groupKey" LIKE 'centre:%' AND "groupChainId" = '';
