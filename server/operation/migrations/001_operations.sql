CREATE TABLE public.framework_operations (
    scope text NOT NULL CHECK (length(trim(scope)) > 0),
    key text NOT NULL CHECK (length(trim(key)) > 0),
    request_hash text NOT NULL,
    response jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (scope, key)
);
