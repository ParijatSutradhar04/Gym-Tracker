-- performed_order: the order the day's exercises were actually done (null until one has a logged set).
-- is_drop: the set continues the normal set above it at a lower weight.
ALTER TABLE day_exercises ADD COLUMN IF NOT EXISTS performed_order int NULL CHECK (performed_order >= 1);
ALTER TABLE sets ADD COLUMN IF NOT EXISTS is_drop boolean NOT NULL DEFAULT false;
