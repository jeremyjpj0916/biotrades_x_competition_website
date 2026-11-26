CREATE OR REPLACE FUNCTION preserve_season_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.final_revision IS NOT NULL AND
     (NEW.final_revision IS NULL OR NEW.final_revision < OLD.final_revision) THEN
    RAISE EXCEPTION 'Cannot revoke or roll back an official publication';
  END IF;
  IF clock_timestamp() >= OLD.registration_at AND
     (NEW.rules_version, NEW.data_mode, NEW.registration_at) IS DISTINCT FROM (OLD.rules_version, OLD.data_mode, OLD.registration_at) THEN
    RAISE EXCEPTION 'Season rules and data mode are frozen once registration opens';
  END IF;
  IF clock_timestamp() >= OLD.locks_at THEN
    IF NEW.locks_at IS DISTINCT FROM OLD.locks_at THEN
      RAISE EXCEPTION 'Cannot reopen a locked season';
    END IF;
    IF NEW.first_session IS DISTINCT FROM OLD.first_session AND
       (OLD.published_date IS NOT NULL OR NEW.first_session <= OLD.first_session OR
        EXISTS(SELECT 1 FROM market_sessions m WHERE m.year=OLD.year AND m.session_date=OLD.first_session)) THEN
      RAISE EXCEPTION 'Opening session can only be corrected for a verified closure before scoring';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
