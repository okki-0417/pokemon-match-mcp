CREATE TABLE `pokemon` (
	`id` text PRIMARY KEY NOT NULL,
	`name_en` text NOT NULL,
	`name_ja` text,
	`type1` text NOT NULL,
	`type2` text,
	`hp` integer NOT NULL,
	`atk` integer NOT NULL,
	`def` integer NOT NULL,
	`spa` integer NOT NULL,
	`spd` integer NOT NULL,
	`spe` integer NOT NULL,
	`is_champions` integer DEFAULT false NOT NULL,
	`champions_tier` text,
	`weightkg` real NOT NULL,
	`gen` integer NOT NULL,
	`dex_num` integer NOT NULL,
	`base_species` text NOT NULL,
	`forme` text,
	`prevo` text,
	`evos` text DEFAULT '[]' NOT NULL,
	`other_formes` text DEFAULT '[]' NOT NULL,
	`is_mega` integer DEFAULT false NOT NULL,
	`is_primal` integer DEFAULT false NOT NULL,
	`egg_groups` text DEFAULT '[]' NOT NULL,
	`gender_ratio` text,
	`tier` text,
	`doubles_tier` text,
	`nat_dex_tier` text,
	`tags` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pokemon_abilities` (
	`pokemon_id` text NOT NULL,
	`ability_id` text NOT NULL,
	`slot` text NOT NULL,
	PRIMARY KEY(`pokemon_id`, `ability_id`),
	FOREIGN KEY (`pokemon_id`) REFERENCES `pokemon`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ability_id`) REFERENCES `abilities`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `abilities` (
	`id` text PRIMARY KEY NOT NULL,
	`name_en` text NOT NULL,
	`name_ja` text,
	`description` text,
	`flags` text DEFAULT '[]' NOT NULL,
	`desc_long` text
);
--> statement-breakpoint
CREATE TABLE `learnsets` (
	`pokemon_id` text NOT NULL,
	`move_id` text NOT NULL,
	`sources` text NOT NULL,
	PRIMARY KEY(`pokemon_id`, `move_id`),
	FOREIGN KEY (`pokemon_id`) REFERENCES `pokemon`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`move_id`) REFERENCES `moves`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `moves` (
	`id` text PRIMARY KEY NOT NULL,
	`name_en` text NOT NULL,
	`name_ja` text,
	`type` text NOT NULL,
	`category` text NOT NULL,
	`base_power` integer NOT NULL,
	`accuracy` integer,
	`pp` integer NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`target` text NOT NULL,
	`flags` text NOT NULL,
	`secondaries` text,
	`description` text,
	`crit_ratio` integer DEFAULT 1 NOT NULL,
	`multihit` text,
	`drain` text,
	`recoil` text,
	`heal` text,
	`self_switch` text,
	`volatile_status` text,
	`ignore_ability` integer DEFAULT false NOT NULL,
	`ignore_immunity` text DEFAULT false NOT NULL,
	`non_ghost_target` text,
	`desc_long` text
);
--> statement-breakpoint
CREATE TABLE `natures` (
	`id` text PRIMARY KEY NOT NULL,
	`name_en` text NOT NULL,
	`name_ja` text,
	`plus` text,
	`minus` text
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`name_en` text NOT NULL,
	`name_ja` text,
	`description` text,
	`is_champions` integer DEFAULT false NOT NULL,
	`is_berry` integer DEFAULT false NOT NULL,
	`mega_stone` text,
	`fling` text,
	`natural_gift` text,
	`item_user` text,
	`on_memory` text,
	`desc_long` text
);
--> statement-breakpoint
CREATE TABLE `usage_stats` (
	`format` text NOT NULL,
	`year_month` text NOT NULL,
	`elo_cutoff` integer NOT NULL,
	`pokemon_id` text NOT NULL,
	`usage_pct` real NOT NULL,
	`raw_count` integer NOT NULL,
	`moves` text NOT NULL,
	`items` text NOT NULL,
	`abilities` text NOT NULL,
	`teammates` text NOT NULL,
	`spreads` text NOT NULL,
	PRIMARY KEY(`format`, `year_month`, `elo_cutoff`, `pokemon_id`),
	FOREIGN KEY (`pokemon_id`) REFERENCES `pokemon`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_usage_stats_format_ym_elo_usage` ON `usage_stats` (`format`,`year_month`,`elo_cutoff`,"usage_pct" DESC);