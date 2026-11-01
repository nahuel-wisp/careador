ALTER TABLE `app_users` ADD `phone` text;--> statement-breakpoint
ALTER TABLE `app_users` ADD `contact_email` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `position` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `phone` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `lunch` text;--> statement-breakpoint
ALTER TABLE `schedules` ADD `lunch` text;--> statement-breakpoint
ALTER TABLE `schedules` ADD `lunch_deducted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sites` ADD `address` text;--> statement-breakpoint
ALTER TABLE `sites` ADD `phone` text;--> statement-breakpoint
ALTER TABLE `sites` ADD `notes` text;