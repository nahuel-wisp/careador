CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer DEFAULT (unixepoch()) NOT NULL,
	`user_id` integer,
	`user_name` text NOT NULL,
	`action` text NOT NULL,
	`summary` text NOT NULL,
	`employee_id` integer,
	`date` text,
	`detail` text
);
--> statement-breakpoint
CREATE INDEX `audit_employee_idx` ON `audit_log` (`employee_id`,`date`);--> statement-breakpoint
CREATE INDEX `audit_at_idx` ON `audit_log` (`at`);--> statement-breakpoint
ALTER TABLE `events` ADD `voided_at` integer;--> statement-breakpoint
ALTER TABLE `events` ADD `voided_by` text;--> statement-breakpoint
ALTER TABLE `events` ADD `void_reason` text;