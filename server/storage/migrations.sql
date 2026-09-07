CREATE TABLE IF NOT EXISTS public.framework_schema_migrations (
    namespace text NOT NULL,
    version bigint NOT NULL CHECK (version > 0),
    name text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (namespace, version)
);
