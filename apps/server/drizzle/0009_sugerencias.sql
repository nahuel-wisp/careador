CREATE TABLE `feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer DEFAULT (unixepoch()) NOT NULL,
	`user_id` integer,
	`user_name` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`page` text,
	`status` text DEFAULT 'nuevo' NOT NULL,
	`reply` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `feedback_status_idx` ON `feedback` (`status`,`at`);