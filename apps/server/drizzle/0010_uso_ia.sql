CREATE TABLE `uso_ia` (
	`id` text PRIMARY KEY NOT NULL,
	`usuario_id` text NOT NULL,
	`entrada_id` text,
	`dia` text NOT NULL,
	`modelo` text NOT NULL,
	`tokens_entrada` integer DEFAULT 0 NOT NULL,
	`tokens_cache_lectura` integer DEFAULT 0 NOT NULL,
	`tokens_cache_escritura` integer DEFAULT 0 NOT NULL,
	`tokens_salida` integer DEFAULT 0 NOT NULL,
	`costo_micro_usd` integer DEFAULT 0 NOT NULL,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `uso_ia_usuario_dia` ON `uso_ia` (`usuario_id`,`dia`);