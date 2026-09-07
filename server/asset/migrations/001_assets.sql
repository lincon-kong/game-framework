CREATE TABLE public.framework_asset_quantities (
    player_id uuid NOT NULL REFERENCES public.framework_players(id),
    asset_id text NOT NULL CHECK (length(trim(asset_id)) > 0),
    kind text NOT NULL CHECK (kind IN ('balance', 'stack')),
    quantity bigint NOT NULL CHECK (quantity >= 0),
    PRIMARY KEY (player_id, asset_id)
);

CREATE TABLE public.framework_asset_instances (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id uuid NOT NULL REFERENCES public.framework_players(id),
    asset_id text NOT NULL CHECK (length(trim(asset_id)) > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ON public.framework_asset_instances (player_id, asset_id);

CREATE TABLE public.framework_asset_ledger (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    player_id uuid NOT NULL REFERENCES public.framework_players(id),
    asset_id text NOT NULL CHECK (length(trim(asset_id)) > 0),
    kind text NOT NULL CHECK (kind IN ('balance', 'stack', 'instance')),
    instance_id uuid,
    change text NOT NULL CHECK (change IN ('add', 'remove', 'create')),
    before_quantity bigint,
    delta bigint,
    after_quantity bigint,
    source text NOT NULL CHECK (length(trim(source)) > 0),
    reference text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (
        (kind IN ('balance', 'stack') AND instance_id IS NULL
         AND before_quantity IS NOT NULL AND delta IS NOT NULL AND after_quantity IS NOT NULL
         AND before_quantity >= 0 AND after_quantity >= 0
         AND before_quantity::numeric + delta::numeric = after_quantity::numeric
         AND ((change = 'add' AND delta > 0) OR (change = 'remove' AND delta < 0)))
        OR (kind = 'instance' AND instance_id IS NOT NULL
            AND before_quantity IS NULL AND delta IS NULL AND after_quantity IS NULL
            AND change IN ('create', 'remove'))
    )
);
CREATE INDEX ON public.framework_asset_ledger (player_id, id);
