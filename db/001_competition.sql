CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id text UNIQUE REFERENCES "user"(id) ON DELETE SET NULL,
  username varchar(40) NOT NULL CHECK (username ~ '^[A-Za-z0-9_]{3,40}$'),
  display_name varchar(60),
  avatar text,
  bio varchar(300),
  x_handle varchar(15),
  discord_handle varchar(32),
  joined_at timestamptz NOT NULL DEFAULT now(),
  suspended boolean NOT NULL DEFAULT false,
  removed boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX profiles_username ON profiles (lower(username));

CREATE FUNCTION anonymize_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.auth_user_id IS NOT NULL AND NEW.auth_user_id IS NULL THEN
    NEW.username := 'deleted_' || replace(OLD.id::text, '-', '');
    NEW.display_name := NULL;
    NEW.bio := NULL;
    NEW.avatar := NULL;
    NEW.x_handle := NULL;
    NEW.discord_handle := NULL;
    NEW.removed := true;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER profiles_anonymize BEFORE UPDATE OF auth_user_id ON profiles
FOR EACH ROW EXECUTE FUNCTION anonymize_profile();

CREATE TABLE rulesets (
  version integer PRIMARY KEY,
  title text NOT NULL,
  sections jsonb NOT NULL
);

CREATE TABLE seasons (
  year integer PRIMARY KEY CHECK (year BETWEEN 1900 AND 9999),
  registration_at timestamptz NOT NULL,
  locks_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  first_session date NOT NULL,
  last_session date NOT NULL,
  calendar_source text NOT NULL,
  rules_version integer NOT NULL REFERENCES rulesets(version),
  data_mode text NOT NULL CHECK (data_mode IN ('free','official')),
  final_revision integer CHECK (final_revision > 0),
  finalized_at timestamptz,
  published_date date,
  last_updated_at timestamptz,
  CHECK (registration_at < locks_at AND locks_at < ends_at),
  CHECK (first_session <= last_session),
  CHECK ((final_revision IS NULL) = (finalized_at IS NULL))
);
CREATE TABLE market_sessions (
  year integer NOT NULL REFERENCES seasons(year),
  session_date date NOT NULL,
  opens_at timestamptz NOT NULL,
  closes_at timestamptz NOT NULL,
  PRIMARY KEY (year, session_date),
  CHECK (opens_at < closes_at)
);
CREATE TABLE securities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key text NOT NULL UNIQUE,
  symbol varchar(25) NOT NULL,
  name text NOT NULL,
  exchange text NOT NULL,
  instrument text NOT NULL,
  industry text,
  market_cap numeric CHECK (market_cap >= 0),
  active boolean NOT NULL,
  provider_eligible boolean NOT NULL,
  eligibility_override boolean,
  issuer_key text,
  market_history_id bigint,
  benchmark boolean NOT NULL DEFAULT false,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX securities_active_symbol ON securities (symbol) WHERE active;
CREATE INDEX securities_symbol ON securities (symbol);
CREATE TABLE security_symbols (
  security_id uuid NOT NULL REFERENCES securities(id),
  symbol varchar(25) NOT NULL,
  valid_from date NOT NULL,
  valid_until date,
  PRIMARY KEY (security_id, valid_from),
  EXCLUDE USING gist (security_id WITH =, daterange(valid_from, valid_until, '[)') WITH &&),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);
CREATE TABLE entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_year integer NOT NULL REFERENCES seasons(year),
  profile_id uuid NOT NULL REFERENCES profiles(id),
  security_id uuid NOT NULL REFERENCES securities(id),
  pick_symbol varchar(25) NOT NULL,
  company text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disqualified_reason text,
  UNIQUE (season_year, profile_id),
  UNIQUE (season_year, id)
);
CREATE INDEX entries_season_security ON entries (season_year, security_id);
CREATE INDEX entries_profile ON entries (profile_id, season_year);

CREATE FUNCTION guard_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  season_row seasons%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.season_year, NEW.profile_id, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.season_year, OLD.profile_id, OLD.created_at) THEN
    RAISE EXCEPTION 'Entry identity cannot change' USING ERRCODE = 'BT003';
  END IF;
  IF TG_OP = 'UPDATE' AND
     (NEW.security_id, NEW.pick_symbol, NEW.company, NEW.updated_at) IS NOT DISTINCT FROM
     (OLD.security_id, OLD.pick_symbol, OLD.company, OLD.updated_at) THEN
    SELECT * INTO season_row FROM seasons WHERE year = NEW.season_year FOR SHARE;
    IF season_row.final_revision IS NOT NULL THEN
      RAISE EXCEPTION 'Finalized entry' USING ERRCODE = 'BT001';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.disqualified_reason IS NOT NULL OR
     TG_OP = 'UPDATE' AND NEW.disqualified_reason IS DISTINCT FROM OLD.disqualified_reason THEN
    RAISE EXCEPTION 'Entry cannot be changed with a disqualification' USING ERRCODE = 'BT003';
  END IF;
  SELECT * INTO season_row FROM seasons
    WHERE year = CASE WHEN TG_OP = 'DELETE' THEN OLD.season_year ELSE NEW.season_year END
    FOR SHARE;
  IF NOT FOUND OR clock_timestamp() < season_row.registration_at OR
     clock_timestamp() >= season_row.locks_at OR season_row.final_revision IS NOT NULL THEN
    RAISE EXCEPTION 'Registration is closed' USING ERRCODE = 'BT001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NOT EXISTS (SELECT 1 FROM securities WHERE id=NEW.security_id
      AND active AND NOT benchmark AND coalesce(eligibility_override, provider_eligible)
      AND checked_at > clock_timestamp() - interval '7 days'
      AND symbol=NEW.pick_symbol AND name=NEW.company FOR SHARE) THEN
    RAISE EXCEPTION 'Security is ineligible' USING ERRCODE = 'BT002';
  END IF;
  IF clock_timestamp() >= season_row.locks_at THEN
    RAISE EXCEPTION 'Registration is closed' USING ERRCODE = 'BT001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_entry BEFORE INSERT OR UPDATE OR DELETE ON entries
FOR EACH ROW EXECUTE FUNCTION guard_entry();

CREATE TABLE daily_prices (
  security_id uuid NOT NULL REFERENCES securities(id),
  session_date date NOT NULL,
  symbol varchar(25) NOT NULL,
  open numeric NOT NULL CHECK (open > 0 AND open < 'Infinity'::numeric),
  close numeric NOT NULL CHECK (close > 0 AND close < 'Infinity'::numeric),
  high numeric CHECK (high > 0 AND high < 'Infinity'::numeric),
  low numeric CHECK (low > 0 AND low < 'Infinity'::numeric),
  source text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (security_id, session_date),
  CHECK (high IS NULL OR high >= greatest(open, close)),
  CHECK (low IS NULL OR low <= least(open, close))
);
CREATE TABLE corporate_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  security_id uuid NOT NULL REFERENCES securities(id),
  effective_date date NOT NULL,
  sequence integer NOT NULL DEFAULT 0,
  kind text NOT NULL CHECK (kind IN ('split','cash','stock','mixed','halt','resume','cancel','delist','distribution','spin_off','review')),
  ratio numeric CHECK (ratio > 0),
  cash numeric CHECK (cash >= 0),
  successor_id uuid REFERENCES securities(id),
  source text NOT NULL,
  notes text,
  voided_at timestamptz,
  CHECK (security_id IS DISTINCT FROM successor_id)
);
CREATE UNIQUE INDEX corporate_actions_slot ON corporate_actions (security_id, effective_date, sequence) WHERE voided_at IS NULL;
CREATE TABLE security_reviews (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  year integer NOT NULL REFERENCES seasons(year),
  security_id uuid NOT NULL REFERENCES securities(id),
  category text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution text,
  UNIQUE (year, security_id, category)
);
CREATE TABLE daily_standings (
  year integer NOT NULL,
  session_date date NOT NULL,
  entry_id uuid NOT NULL,
  start_price numeric,
  close_price numeric,
  equivalent_value numeric,
  return_pct numeric,
  daily_pct numeric,
  rank integer,
  rank_change integer,
  status text NOT NULL,
  PRIMARY KEY (year, session_date, entry_id),
  FOREIGN KEY (year, entry_id) REFERENCES entries(season_year, id),
  FOREIGN KEY (year, session_date) REFERENCES market_sessions(year, session_date) ON DELETE CASCADE
);
CREATE INDEX standings_leaderboard ON daily_standings (year, session_date, rank);
CREATE TABLE benchmark_standings (
  year integer NOT NULL,
  session_date date NOT NULL,
  security_id uuid NOT NULL REFERENCES securities(id),
  return_pct numeric,
  PRIMARY KEY (year, session_date, security_id),
  FOREIGN KEY (year, session_date) REFERENCES market_sessions(year, session_date) ON DELETE CASCADE
);
CREATE TABLE archives (
  year integer NOT NULL REFERENCES seasons(year),
  revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  reason text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (year, revision)
);
ALTER TABLE seasons ADD CONSTRAINT seasons_archive_fk FOREIGN KEY (year, final_revision) REFERENCES archives(year, revision);
CREATE TABLE trophies (
  year integer NOT NULL,
  revision integer NOT NULL,
  profile_id uuid NOT NULL REFERENCES profiles(id),
  kind text NOT NULL CHECK (kind IN ('champion','silver','bronze','elite')),
  PRIMARY KEY (year, revision, profile_id, kind),
  FOREIGN KEY (year, revision) REFERENCES archives(year, revision)
);
CREATE INDEX trophies_profile ON trophies (profile_id, year);
CREATE FUNCTION immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'This record is immutable';
END;
$$;
CREATE TRIGGER immutable_archive BEFORE UPDATE OR DELETE ON archives
FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER immutable_rules BEFORE UPDATE OR DELETE ON rulesets
FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER immutable_trophies BEFORE UPDATE OR DELETE ON trophies
FOR EACH ROW EXECUTE FUNCTION immutable_record();

CREATE TABLE sync_jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  year integer NOT NULL REFERENCES seasons(year),
  session_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  UNIQUE (year, session_date)
);
CREATE INDEX sync_jobs_available ON sync_jobs (available_at, session_date) WHERE status <> 'succeeded';
CREATE TABLE worker_health (
  name text PRIMARY KEY,
  ran_at timestamptz NOT NULL DEFAULT now(),
  last_error text
);
CREATE TABLE notifications (
  key text PRIMARY KEY,
  message text NOT NULL,
  destination text NOT NULL DEFAULT 'discord',
  recipient text,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor text NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  happened_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TABLE request_limits (
  bucket text PRIMARY KEY,
  count integer NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE provider_requests (
  name text PRIMARY KEY,
  next_at timestamptz NOT NULL
);
CREATE TABLE issuer_reference (
  cik text PRIMARY KEY,
  industry_code text,
  industry text,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE market_observations (
  security_id uuid NOT NULL REFERENCES securities(id),
  symbol text NOT NULL,
  source text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (security_id, symbol, source)
);
CREATE FUNCTION preserve_season_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.final_revision IS NOT NULL AND
     (NEW.final_revision IS NULL OR NEW.final_revision < OLD.final_revision) THEN
    RAISE EXCEPTION 'Cannot revoke or roll back an official publication';
  END IF;
  IF clock_timestamp() >= OLD.registration_at AND
     (NEW.rules_version, NEW.data_mode, NEW.registration_at) IS DISTINCT FROM (OLD.rules_version, OLD.data_mode, OLD.registration_at) THEN
    RAISE EXCEPTION 'Season rules and data mode are frozen once registration opens';
  END IF;
  IF clock_timestamp() >= OLD.locks_at AND
     (NEW.locks_at, NEW.first_session) IS DISTINCT FROM (OLD.locks_at, OLD.first_session) THEN
    RAISE EXCEPTION 'Cannot reopen a locked season';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER season_publication BEFORE UPDATE ON seasons
FOR EACH ROW EXECUTE FUNCTION preserve_season_publication();
