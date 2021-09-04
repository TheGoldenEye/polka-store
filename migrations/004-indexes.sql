-- Up
CREATE INDEX IF NOT EXISTS idx_transactions_height ON transactions (height);
CREATE INDEX IF NOT EXISTS idx_transactions_authorId_height ON transactions (authorId, height);
CREATE INDEX IF NOT EXISTS idx_transactions_senderId_height ON transactions (senderId, height);
CREATE INDEX IF NOT EXISTS idx_transactions_recipientId_height ON transactions (recipientId, height);
CREATE INDEX IF NOT EXISTS idx_transactions_event_addData_height ON transactions (event, addData, height);

-- Down
DROP INDEX IF EXISTS idx_transactions_height;
DROP INDEX IF EXISTS idx_transactions_authorId_height;
DROP INDEX IF EXISTS idx_transactions_senderId_height;
DROP INDEX IF EXISTS idx_transactions_recipientId_height;
DROP INDEX IF EXISTS idx_transactions_event_addData_height;
