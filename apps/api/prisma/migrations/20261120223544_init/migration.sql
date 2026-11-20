-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('PENDING', 'CREATED', 'FAILED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('INVIGILATOR', 'MARKER');

-- CreateEnum
CREATE TYPE "RelayStatus" AS ENUM ('QUEUED', 'SUBMITTED', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "roleAddress" TEXT NOT NULL,
    "evmAddress" TEXT NOT NULL,
    "qorexAddress" TEXT,
    "sealCard" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthChallenge" (
    "nonce" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("nonce")
);

-- CreateTable
CREATE TABLE "Exam" (
    "id" TEXT NOT NULL,
    "onchainId" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "boardAddr" TEXT NOT NULL,
    "examiners" TEXT[],
    "startTime" TIMESTAMP(3) NOT NULL,
    "masterCommitment" TEXT NOT NULL,
    "committeeBlob" BYTEA NOT NULL,
    "committeeHash" TEXT NOT NULL,
    "createTx" TEXT,
    "status" "ExamStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Centre" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "onchainId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "commitment" TEXT NOT NULL,
    "cipherBlob" BYTEA NOT NULL,
    "cipherHash" TEXT NOT NULL,
    "setTx" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "currentEpoch" INTEGER NOT NULL DEFAULT 0,
    "released" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Centre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "address" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "addedEpoch" INTEGER NOT NULL,
    "removedEpoch" INTEGER,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpochEnvelope" (
    "id" TEXT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL,
    "envelope" BYTEA NOT NULL,
    "membersHash" TEXT NOT NULL,
    "txHash" TEXT,

    CONSTRAINT "EpochEnvelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardState" (
    "boardAddr" TEXT NOT NULL,
    "sealedState" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardState_pkey" PRIMARY KEY ("boardAddr")
);

-- CreateTable
CREATE TABLE "ShareBlob" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "examinerAddr" TEXT NOT NULL,
    "examinerIndex" INTEGER NOT NULL,
    "sealedToExaminer" BYTEA NOT NULL,
    "releasedBlob" BYTEA,
    "releasedEpoch" INTEGER,
    "releaseTx" TEXT,

    CONSTRAINT "ShareBlob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Script" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "pseudonymHash" TEXT NOT NULL,
    "blob" BYTEA NOT NULL,
    "scriptHash" TEXT NOT NULL,
    "markerEpoch" INTEGER NOT NULL,
    "txHash" TEXT,

    CONSTRAINT "Script_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mark" (
    "id" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "markerAddr" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "sealedFeedback" BYTEA,

    CONSTRAINT "Mark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityMap" (
    "examId" TEXT NOT NULL,
    "blob" BYTEA NOT NULL,

    CONSTRAINT "IdentityMap_pkey" PRIMARY KEY ("examId")
);

-- CreateTable
CREATE TABLE "ChainEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "examId" TEXT,
    "centreId" TEXT,
    "data" JSONB NOT NULL,
    "txHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerCursor" (
    "id" TEXT NOT NULL,
    "lastBlock" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelayJob" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "signer" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "RelayStatus" NOT NULL,
    "txHash" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RelayJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_roleAddress_key" ON "User"("roleAddress");

-- CreateIndex
CREATE UNIQUE INDEX "User_evmAddress_key" ON "User"("evmAddress");

-- CreateIndex
CREATE UNIQUE INDEX "User_qorexAddress_key" ON "User"("qorexAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Exam_onchainId_key" ON "Exam"("onchainId");

-- CreateIndex
CREATE UNIQUE INDEX "Centre_examId_onchainId_key" ON "Centre"("examId", "onchainId");

-- CreateIndex
CREATE UNIQUE INDEX "EpochEnvelope_groupKey_epoch_key" ON "EpochEnvelope"("groupKey", "epoch");

-- CreateIndex
CREATE UNIQUE INDEX "ShareBlob_examId_centreId_examinerAddr_key" ON "ShareBlob"("examId", "centreId", "examinerAddr");

-- CreateIndex
CREATE INDEX "ChainEvent_examId_idx" ON "ChainEvent"("examId");

-- CreateIndex
CREATE UNIQUE INDEX "ChainEvent_txHash_logIndex_key" ON "ChainEvent"("txHash", "logIndex");

-- AddForeignKey
ALTER TABLE "Centre" ADD CONSTRAINT "Centre_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
