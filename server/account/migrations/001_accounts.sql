ALTER TABLE public.framework_accounts
    ADD COLUMN status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled')),
    ADD COLUMN updated_at timestamptz;

UPDATE public.framework_accounts SET updated_at = created_at;
ALTER TABLE public.framework_accounts
    ALTER COLUMN updated_at SET NOT NULL,
    ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE public.framework_external_identities (
    account_id uuid NOT NULL REFERENCES public.framework_accounts(id),
    provider text NOT NULL CHECK (length(trim(provider)) > 0),
    external_id text NOT NULL CHECK (length(trim(external_id)) > 0),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (provider, external_id)
);
