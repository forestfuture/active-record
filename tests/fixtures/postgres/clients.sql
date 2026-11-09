-- Views that read the backend (the connection) each query runs on, for the PostgreSQL adapter's client tests.
CREATE VIEW backends AS SELECT pg_backend_pid() AS id;

CREATE VIEW backend_sessions AS SELECT pg_backend_pid() AS id, pg_backend_pid() AS backend_id;
