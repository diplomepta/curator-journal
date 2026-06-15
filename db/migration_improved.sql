USE curator_journal;

ALTER TABLE events ADD COLUMN event_place VARCHAR(150) NOT NULL DEFAULT 'не указано' AFTER event_type;
ALTER TABLE events ADD COLUMN organizer VARCHAR(150) NOT NULL DEFAULT 'не указано' AFTER event_place;
ALTER TABLE events ADD COLUMN target_audience VARCHAR(150) NOT NULL DEFAULT 'не указано' AFTER organizer;
ALTER TABLE events MODIFY description TEXT NOT NULL;

UPDATE events
SET event_place = 'не указано',
    organizer = COALESCE((SELECT full_name FROM users WHERE users.id = events.created_by), 'не указано'),
    target_audience = 'студенты группы'
WHERE event_place = 'не указано';
