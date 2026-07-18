-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "baseBranch" TEXT,
ADD COLUMN     "diff" TEXT,
ADD COLUMN     "llmModel" TEXT,
ADD COLUMN     "llmProvider" TEXT,
ADD COLUMN     "plan" TEXT,
ADD COLUMN     "previewUrl" TEXT,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "repoOwner" TEXT,
ADD COLUMN     "repoUrl" TEXT,
ADD COLUMN     "secondaryBaseBranch" TEXT,
ADD COLUMN     "secondaryBranchName" TEXT,
ADD COLUMN     "secondaryProjectId" TEXT,
ADD COLUMN     "secondaryRepoName" TEXT,
ADD COLUMN     "secondaryRepoOwner" TEXT,
ADD COLUMN     "secondaryRepoUrl" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isPremium" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pushToken" TEXT,
ADD COLUMN     "subscriptionId" TEXT;

-- CreateTable
CREATE TABLE "TaskLog" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "pushed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL,
    "queueName" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "result" TEXT,
    "error" TEXT,
    "userId" TEXT,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectEnvironment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "repoOwner" TEXT NOT NULL,
    "repoName" TEXT NOT NULL,
    "envContent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectEnvironment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEnvironment_userId_repoOwner_repoName_key" ON "ProjectEnvironment"("userId", "repoOwner", "repoName");

-- AddForeignKey
ALTER TABLE "TaskLog" ADD CONSTRAINT "TaskLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEnvironment" ADD CONSTRAINT "ProjectEnvironment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
