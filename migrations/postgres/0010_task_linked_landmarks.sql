-- City-unique buildings are work, not ambient decoration. Older releases
-- published a finished LANDMARK world feature when the first district grew;
-- remove those legacy copies so the same asset can reappear only through a
-- task and follow its five construction stages.
DELETE FROM world_features_v6 WHERE kind = 'LANDMARK';
