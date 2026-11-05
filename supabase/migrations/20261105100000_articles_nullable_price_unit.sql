-- Articles: price_excl_vat and unit become nullable ("not specified").
--
-- Mirrored Fortnox articles may have no price and/or no unit. Previously the
-- columns were NOT NULL with defaults (0 / 'st'), which silently invented a
-- price and unit. Existing rows keep their stored values; only the NOT NULL
-- constraints and the hidden defaults are removed. Idempotent: DROP NOT NULL /
-- DROP DEFAULT are no-ops when already applied.
ALTER TABLE public.articles ALTER COLUMN unit DROP NOT NULL;
ALTER TABLE public.articles ALTER COLUMN unit DROP DEFAULT;
ALTER TABLE public.articles ALTER COLUMN price_excl_vat DROP NOT NULL;
ALTER TABLE public.articles ALTER COLUMN price_excl_vat DROP DEFAULT;

NOTIFY pgrst, 'reload schema';
