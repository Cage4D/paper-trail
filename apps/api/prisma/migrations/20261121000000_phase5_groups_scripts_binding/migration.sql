-- DropIndex
DROP INDEX "EpochEnvelope_groupKey_epoch_key";

-- AlterTable
ALTER TABLE "EpochEnvelope" ADD COLUMN     "boardAddr" TEXT NOT NULL,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Exam" ADD COLUMN     "marksRoot" TEXT,
ADD COLUMN     "marksTx" TEXT;

-- AlterTable
ALTER TABLE "Mark" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "boardAddr" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Script" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bindRelayTx" TEXT,
ADD COLUMN     "bindStatementHash" TEXT,
ADD COLUMN     "bindTx" TEXT;

-- CreateTable
CREATE TABLE "BindChallenge" (
    "nonce" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BindChallenge_pkey" PRIMARY KEY ("nonce")
);

-- CreateIndex
CREATE UNIQUE INDEX "EpochEnvelope_boardAddr_groupKey_epoch_key" ON "EpochEnvelope"("boardAddr", "groupKey", "epoch");

-- CreateIndex
CREATE UNIQUE INDEX "Mark_scriptId_markerAddr_key" ON "Mark"("scriptId", "markerAddr");

-- CreateIndex
CREATE INDEX "Member_boardAddr_groupKey_active_idx" ON "Member"("boardAddr", "groupKey", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Script_examId_pseudonymHash_key" ON "Script"("examId", "pseudonymHash");

