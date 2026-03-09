-- Pure SQL file without dbt/Jinja templating

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE VIEW active_users AS
SELECT id, name, email
FROM users
WHERE status = 'active';

-- Complex query with CTEs
WITH active_users AS (
    SELECT * FROM users WHERE status = 'active'
),
recent_orders AS (
    SELECT
        o.*,
        u.name as user_name
    FROM orders o
    INNER JOIN active_users u ON u.id = o.user_id
    WHERE o.created_at > '2024-01-01'
),
order_summary AS (
    SELECT
        user_id,
        COUNT(*) as order_count,
        SUM(total) as total_spent
    FROM recent_orders
    GROUP BY user_id
)
SELECT
    u.name,
    u.email,
    COALESCE(os.order_count, 0) as order_count,
    COALESCE(os.total_spent, 0) as total_spent
FROM active_users u
LEFT JOIN order_summary os ON u.id = os.user_id
ORDER BY os.total_spent DESC NULLS LAST;
