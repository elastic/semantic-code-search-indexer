{# A basic example for a project-wide macro to cast a column uniformly #}

{% macro cents_to_dollars(column_name, scale=2) -%}
    {{ return(adapter.dispatch('cents_to_dollars')(column_name, scale)) }}
{%- endmacro %}

{% macro default__cents_to_dollars(column_name, scale) %}
    ({{ column_name }} / 100)::numeric(16, {{ scale }})
{% endmacro %}

{% macro postgres__cents_to_dollars(column_name, scale) %}
    ({{ column_name }}::numeric(16, {{ scale }}) / 100)
{% endmacro %}

{% macro bigquery__cents_to_dollars(column_name, scale) %}
    round(cast(({{ column_name }} / 100) as numeric), {{ scale }})
{% endmacro %}

{% macro snowflake__cents_to_dollars(column_name, scale) %}
    round({{ column_name }} / 100, {{ scale }})
{% endmacro %}
