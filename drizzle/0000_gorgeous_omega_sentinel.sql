CREATE TABLE `cloud_state_chunks` (
	`owner_id` text NOT NULL,
	`state_key` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`encoding` text NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `state_key`, `chunk_index`)
);
