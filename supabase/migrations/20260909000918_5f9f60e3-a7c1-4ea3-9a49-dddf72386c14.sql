CREATE TABLE public.exchange_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange text NOT NULL UNIQUE,
  label text NOT NULL,
  api_key_last4 text NOT NULL,
  api_secret_last4 text NOT NULL,
  api_key_cipher text NOT NULL,
  api_secret_cipher text NOT NULL,
  passphrase_cipher text,
  market_mode text NOT NULL DEFAULT 'spot',
  connection_status text NOT NULL DEFAULT 'untested',
  last_error_code text,
  last_error_message text,
  last_tested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.exchange_credentials TO anon, authenticated;
GRANT ALL ON public.exchange_credentials TO service_role;
ALTER TABLE public.exchange_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exchange_credentials_read_safe" ON public.exchange_credentials
FOR SELECT TO anon, authenticated USING (true);

CREATE TRIGGER update_exchange_credentials_updated_at
BEFORE UPDATE ON public.exchange_credentials
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();