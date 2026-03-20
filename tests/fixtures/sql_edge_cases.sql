-- Edge case: CREATE VIEW with inline CTE (CREATE preamble must not be lost)
CREATE VIEW active_summary AS
WITH active AS (
    SELECT id, name FROM users WHERE status = 'active'
),
stats AS (
    SELECT user_id, COUNT(*) AS cnt FROM orders GROUP BY user_id
)
SELECT u.id, u.name, COALESCE(s.cnt, 0) AS order_count
FROM active u
LEFT JOIN stats s ON s.user_id = u.id;

-- Edge case: consecutive single-line statements must each be a separate chunk
SELECT 1;
SELECT 2;

-- Edge case: quoted identifiers (BigQuery/Snowflake style)
SELECT *
FROM "analytics"."orders"
INNER JOIN `project`.`dataset`.`users` ON "analytics"."orders".user_id = `project`.`dataset`.`users`.id;
