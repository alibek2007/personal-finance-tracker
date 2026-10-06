-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_accountId_fkey";

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_recurringTransactionId_fkey";

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_userId_fkey";

-- DropTable
DROP TABLE "Subscription";

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_recurringTransactionId_date_key" ON "Transaction"("recurringTransactionId", "date");

