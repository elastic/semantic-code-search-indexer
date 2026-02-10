-- models/staging/stg_orders.sql
{{ config(materialized='view') }}

with

source as (

    select * from {{ source('ecom', 'raw_orders') }}

),

cleaned as (

    select
        ----------  ids
        id as order_id,
        store_id as location_id,
        customer as customer_id,

        ---------- numerics
        subtotal as subtotal_cents,
        tax_paid as tax_paid_cents,
        order_total as order_total_cents,
        {{ cents_to_dollars('subtotal') }} as subtotal,
        {{ cents_to_dollars('tax_paid') }} as tax_paid,
        {{ cents_to_dollars('order_total') }} as order_total,

        ---------- timestamps
        {{ dbt.date_trunc('day','ordered_at') }} as ordered_at

    from source
    where id is not null

),

final as (

    select
        *,
        {{ ref('dim_customers') }}.customer_name
    from cleaned
    left join {{ ref('dim_customers') }} using (customer_id)

)

select * from final
