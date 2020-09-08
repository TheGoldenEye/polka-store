-- Up
CREATE TABLE if not exists "transactions" (
  "chain"               TEXT NOT NULL,
  "id"                  TEXT NOT NULL,
  "height"              INTEGER NOT NULL,
  "blockHash"           TEXT NOT NULL,
  "type"                TEXT NOT NULL,
  "subType"             TEXT,
  "event"               TEXT,
  "timestamp"           INTEGER NOT NULL,
  "specVersion"         INTEGER,
  "transactionVersion"  INTEGER,
  "authorId"            TEXT,
  "senderId"            TEXT,
  "recipientId"         TEXT,
  "amount"              BIGINT,
  "partialFee"          BIGINT,
  "feeBalances"         BIGINT,
  "feeTreasury"         BIGINT,
  "tip"                 BIGINT,
  "success"             INTEGER,
  CONSTRAINT transactions_PK PRIMARY KEY (id));

-- Down
DROP TABLE IF EXISTS "transactions";
