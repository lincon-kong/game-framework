CREATE TABLE public.framework_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.framework_players (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES public.framework_accounts(id),
    realm text NOT NULL CHECK (length(trim(realm)) > 0),
    data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
    data_schema_version integer NOT NULL CHECK (data_schema_version > 0),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (account_id, realm)
);
