ALTER TABLE "strategy_versions" ALTER COLUMN "strategy_md" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD COLUMN "source_kind" text;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD COLUMN "strategy_pine" text;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD COLUMN "strategy_ir_json" jsonb;--> statement-breakpoint
UPDATE "strategy_versions"
SET "source_kind" = CASE
  WHEN "strategy_py" IS NOT NULL THEN 'legacy_python'
  ELSE 'markdown_yaml'
END;--> statement-breakpoint
ALTER TABLE "strategy_versions" ALTER COLUMN "source_kind" SET NOT NULL;
