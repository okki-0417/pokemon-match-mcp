CREATE TYPE "public"."move_category" AS ENUM('physical', 'special', 'status');--> statement-breakpoint
CREATE TABLE "learnsets" (
	"pokemon_id" text NOT NULL,
	"move_id" text NOT NULL,
	"sources" text[] NOT NULL,
	CONSTRAINT "learnsets_pokemon_id_move_id_pk" PRIMARY KEY("pokemon_id","move_id")
);
--> statement-breakpoint
CREATE TABLE "moves" (
	"id" text PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_ja" text,
	"type" "pokemon_type" NOT NULL,
	"category" "move_category" NOT NULL,
	"base_power" integer NOT NULL,
	"accuracy" integer,
	"pp" integer NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"description" text
);
--> statement-breakpoint
ALTER TABLE "learnsets" ADD CONSTRAINT "learnsets_pokemon_id_pokemon_id_fk" FOREIGN KEY ("pokemon_id") REFERENCES "public"."pokemon"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learnsets" ADD CONSTRAINT "learnsets_move_id_moves_id_fk" FOREIGN KEY ("move_id") REFERENCES "public"."moves"("id") ON DELETE restrict ON UPDATE no action;