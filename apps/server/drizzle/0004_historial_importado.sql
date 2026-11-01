PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` integer,
	`source` text DEFAULT 'device' NOT NULL,
	`device_event_id` text NOT NULL,
	`time` integer NOT NULL,
	`kind` text NOT NULL,
	`verify_mode` text NOT NULL,
	`person_code` text,
	`employee_id` integer,
	`person_name` text,
	`door_no` integer,
	`raw` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_events`("id", "device_id", "device_event_id", "time", "kind", "verify_mode", "person_code", "employee_id", "door_no", "raw", "created_at") SELECT "id", "device_id", "device_event_id", "time", "kind", "verify_mode", "person_code", "employee_id", "door_no", "raw", "created_at" FROM `events`;--> statement-breakpoint
DROP TABLE `events`;--> statement-breakpoint
ALTER TABLE `__new_events` RENAME TO `events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `events_device_event_uq` ON `events` (`device_id`,`device_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_import_uq` ON `events` (`device_event_id`) WHERE source = 'import';--> statement-breakpoint
CREATE INDEX `events_employee_time_idx` ON `events` (`employee_id`,`time`);--> statement-breakpoint
CREATE INDEX `events_time_idx` ON `events` (`time`);