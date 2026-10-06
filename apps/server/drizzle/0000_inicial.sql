CREATE TABLE `bitacora` (
	`id` text PRIMARY KEY NOT NULL,
	`usuario_id` text NOT NULL,
	`entrada_id` text,
	`tabla` text NOT NULL,
	`registro_id` text NOT NULL,
	`accion` text NOT NULL,
	`antes` text,
	`despues` text,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deshecho_en` text,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bitacora_usuario` ON `bitacora` (`usuario_id`,`creado_en`);--> statement-breakpoint
CREATE TABLE `categorias` (
	`id` text PRIMARY KEY NOT NULL,
	`usuario_id` text NOT NULL,
	`nombre` text NOT NULL,
	`padre_id` text,
	`tipo` text NOT NULL,
	`naturaleza` text,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `categorias_usuario` ON `categorias` (`usuario_id`);--> statement-breakpoint
CREATE TABLE `comercios` (
	`id` text PRIMARY KEY NOT NULL,
	`usuario_id` text NOT NULL,
	`nombre` text NOT NULL,
	`nombre_normalizado` text NOT NULL,
	`categoria_id` text,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `comercios_usuario_nombre` ON `comercios` (`usuario_id`,`nombre_normalizado`);--> statement-breakpoint
CREATE TABLE `compras_msi` (
	`id` text PRIMARY KEY NOT NULL,
	`usuario_id` text NOT NULL,
	`descripcion` text NOT NULL,
	`total_centavos` integer NOT NULL,
	`meses` integer NOT NULL,
	`mensualidad_centavos` integer NOT NULL,
	`primer_cargo` text NOT NULL,
	`cuenta_id` text,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`eliminado_en` text,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cuentas` (
	`id` text PRIMARY KEY NOT NULL,
	`usuario_id` text NOT NULL,
	`nombre` text NOT NULL,
	`tipo` text DEFAULT 'otra' NOT NULL,
	`institucion` text,
	`alias` text DEFAULT '[]' NOT NULL,
	`dia_corte` integer,
	`dia_pago` integer,
	`archivada` integer DEFAULT false NOT NULL,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `dispositivos` (
	`id` text PRIMARY KEY NOT NULL,
	`usuario_id` text NOT NULL,
	`nombre` text NOT NULL,
	`token_hash` text NOT NULL,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`ultimo_uso` text,
	`revocado_en` text,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dispositivos_token_hash` ON `dispositivos` (`token_hash`);--> statement-breakpoint
CREATE TABLE `entradas` (
	`id` text PRIMARY KEY NOT NULL,
	`usuario_id` text NOT NULL,
	`client_id` text NOT NULL,
	`conversacion_id` text NOT NULL,
	`texto` text NOT NULL,
	`lat` real,
	`lon` real,
	`lugar` text,
	`capturado_en` text NOT NULL,
	`estado` text DEFAULT 'procesando' NOT NULL,
	`respuesta` text,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entradas_usuario_client` ON `entradas` (`usuario_id`,`client_id`);--> statement-breakpoint
CREATE TABLE `memorias` (
	`id` text PRIMARY KEY NOT NULL,
	`usuario_id` text NOT NULL,
	`texto` text NOT NULL,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `mensajes` (
	`id` text PRIMARY KEY NOT NULL,
	`usuario_id` text NOT NULL,
	`conversacion_id` text NOT NULL,
	`contenido` text NOT NULL,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mensajes_conversacion` ON `mensajes` (`usuario_id`,`conversacion_id`);--> statement-breakpoint
CREATE TABLE `metas` (
	`id` text PRIMARY KEY NOT NULL,
	`usuario_id` text NOT NULL,
	`nombre` text NOT NULL,
	`objetivo_centavos` integer NOT NULL,
	`ahorrado_centavos` integer DEFAULT 0 NOT NULL,
	`fecha_limite` text,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `movimientos` (
	`id` text PRIMARY KEY NOT NULL,
	`usuario_id` text NOT NULL,
	`tipo` text NOT NULL,
	`monto_centavos` integer NOT NULL,
	`moneda` text DEFAULT 'MXN' NOT NULL,
	`categoria_id` text,
	`comercio_id` text,
	`cuenta_id` text,
	`cuenta_destino_id` text,
	`descripcion` text,
	`fecha` text NOT NULL,
	`ocurrido_en` text NOT NULL,
	`lat` real,
	`lon` real,
	`lugar` text,
	`origen` text DEFAULT 'voz' NOT NULL,
	`texto_original` text,
	`entrada_id` text,
	`recurrente_id` text,
	`msi_id` text,
	`revisar` integer DEFAULT false NOT NULL,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actualizado_en` text,
	`eliminado_en` text,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `movimientos_usuario_fecha` ON `movimientos` (`usuario_id`,`fecha`);--> statement-breakpoint
CREATE INDEX `movimientos_entrada` ON `movimientos` (`entrada_id`);--> statement-breakpoint
CREATE TABLE `prestamos_personales` (
	`id` text PRIMARY KEY NOT NULL,
	`usuario_id` text NOT NULL,
	`persona` text NOT NULL,
	`direccion` text NOT NULL,
	`monto_centavos` integer NOT NULL,
	`descripcion` text,
	`saldado_en` text,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `presupuestos` (
	`id` text PRIMARY KEY NOT NULL,
	`usuario_id` text NOT NULL,
	`categoria_id` text NOT NULL,
	`limite_centavos` integer NOT NULL,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recurrentes` (
	`id` text PRIMARY KEY NOT NULL,
	`usuario_id` text NOT NULL,
	`nombre` text NOT NULL,
	`tipo` text NOT NULL,
	`monto_centavos` integer NOT NULL,
	`moneda` text DEFAULT 'MXN' NOT NULL,
	`frecuencia` text NOT NULL,
	`dia` integer NOT NULL,
	`mes` integer,
	`categoria_id` text,
	`cuenta_id` text,
	`avisar_dias_antes` integer DEFAULT 1 NOT NULL,
	`activo` integer DEFAULT true NOT NULL,
	`entrada_id` text,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`eliminado_en` text,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `usuarios` (
	`id` text PRIMARY KEY NOT NULL,
	`nombre` text NOT NULL,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
