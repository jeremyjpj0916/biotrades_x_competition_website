ALTER TABLE market_observations ADD COLUMN observed_through date;
ALTER TABLE security_reviews ADD COLUMN effective_date date;
CREATE UNIQUE INDEX corporate_actions_active_split ON corporate_actions (security_id, effective_date)
WHERE kind='split' AND voided_at IS NULL;
