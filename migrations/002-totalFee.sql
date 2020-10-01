-- Up
ALTER TABLE transactions RENAME COLUMN partialFee TO totalFee;
UPDATE transactions SET totalFee = 
  CASE 
    WHEN (feeBalances IS NULL AND feeTreasury IS NULL) THEN NULL 
    ELSE (COALESCE(feeBalances, 0)+COALESCE(feeTreasury, 0)) 
  END;

-- Down
ALTER TABLE transactions RENAME COLUMN totalFee TO partialFee;
