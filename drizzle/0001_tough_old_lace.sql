CREATE TYPE "public"."ability_slot" AS ENUM('primary', 'secondary', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."pokemon_type" AS ENUM('normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy');--> statement-breakpoint
CREATE TABLE "pokemon" (
	"id" text PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_ja" text,
	"type1" "pokemon_type" NOT NULL,
	"type2" "pokemon_type",
	"hp" integer NOT NULL,
	"atk" integer NOT NULL,
	"def" integer NOT NULL,
	"spa" integer NOT NULL,
	"spd" integer NOT NULL,
	"spe" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pokemon_abilities" (
	"pokemon_id" text NOT NULL,
	"ability_id" text NOT NULL,
	"slot" "ability_slot" NOT NULL,
	CONSTRAINT "pokemon_abilities_pokemon_id_ability_id_pk" PRIMARY KEY("pokemon_id","ability_id")
);
--> statement-breakpoint
CREATE TABLE "abilities" (
	"id" text PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_ja" text,
	"description" text
);
--> statement-breakpoint
ALTER TABLE "pokemon_abilities" ADD CONSTRAINT "pokemon_abilities_pokemon_id_pokemon_id_fk" FOREIGN KEY ("pokemon_id") REFERENCES "public"."pokemon"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pokemon_abilities" ADD CONSTRAINT "pokemon_abilities_ability_id_abilities_id_fk" FOREIGN KEY ("ability_id") REFERENCES "public"."abilities"("id") ON DELETE restrict ON UPDATE no action;