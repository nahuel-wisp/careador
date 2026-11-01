CREATE TABLE `absence_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`absence_id` integer NOT NULL,
	`file_name` text NOT NULL,
	`mime` text NOT NULL,
	`data` blob NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`absence_id`) REFERENCES `absences`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `absences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer,
	`kind` text NOT NULL,
	`date_from` text NOT NULL,
	`date_to` text NOT NULL,
	`note` text,
	`created_by` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `absences_dates_idx` ON `absences` (`date_from`,`date_to`);--> statement-breakpoint
CREATE TABLE `schedule_assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`schedule_id` integer NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `schedule_assignments_employee_idx` ON `schedule_assignments` (`employee_id`);--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`days` text NOT NULL,
	`late_tolerance_min` integer DEFAULT 15 NOT NULL,
	`early_tolerance_min` integer DEFAULT 15 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `sites` ADD `schedule_id` integer REFERENCES schedules(id);