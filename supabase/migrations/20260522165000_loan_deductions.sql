ALTER TABLE loans ADD COLUMN IF NOT EXISTS deduct_obligations boolean DEFAULT false;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS deducted_shares_amount numeric DEFAULT 0;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS deducted_fines_amount numeric DEFAULT 0;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS deducted_interest_amount numeric DEFAULT 0;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS deducted_capital_amount numeric DEFAULT 0;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS deductions_detail jsonb DEFAULT '[]'::jsonb;
