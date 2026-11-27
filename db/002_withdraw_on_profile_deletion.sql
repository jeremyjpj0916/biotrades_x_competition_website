CREATE FUNCTION withdraw_open_entries_on_profile_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  entry_record record;
BEGIN
  IF OLD.auth_user_id IS NULL OR NEW.auth_user_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  FOR entry_record IN
    SELECT e.id FROM entries e JOIN seasons s ON s.year=e.season_year
    WHERE e.profile_id=NEW.id AND s.registration_at<=clock_timestamp() AND s.locks_at>clock_timestamp()
  LOOP
    BEGIN
      DELETE FROM entries WHERE id=entry_record.id;
    EXCEPTION WHEN SQLSTATE 'BT001' THEN
      -- The deadline won the race. Preserve and anonymize the locked entry.
      NULL;
    END;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER profiles_withdraw_open_entries AFTER UPDATE OF auth_user_id ON profiles
FOR EACH ROW EXECUTE FUNCTION withdraw_open_entries_on_profile_deletion();
