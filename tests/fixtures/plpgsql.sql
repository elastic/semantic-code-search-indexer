-- PLpgSQL fixture for parser tests
CREATE TYPE status_enum AS ENUM ('active', 'inactive');

CREATE TABLE accounts (
  account_id SERIAL PRIMARY KEY,
  owner_name TEXT NOT NULL,
  status status_enum NOT NULL DEFAULT 'active',
  balance NUMERIC(12, 2) NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION calculate_bonus(base_amount NUMERIC, multiplier NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN base_amount * multiplier;
END;
$$;

CREATE VIEW active_accounts AS
SELECT account_id, owner_name, balance
FROM accounts
WHERE status = 'active';

SELECT calculate_bonus(100, 1.25);
