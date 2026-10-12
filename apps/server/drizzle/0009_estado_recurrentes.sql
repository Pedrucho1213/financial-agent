ALTER TABLE `recurrentes` ADD `estado` text DEFAULT 'activa' NOT NULL;--> statement-breakpoint
ALTER TABLE `recurrentes` ADD `estado_en` text;--> statement-breakpoint
UPDATE `recurrentes` SET `estado` = 'pausada' WHERE `activo` = 0;