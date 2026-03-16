import json
import logging
from typing import Any

from aegis_runtime.soul.prompts import (
    SOUL_SYSTEM_PROMPT,
    SOUL_USER_PROMPT_TEMPLATE,
    SOUL_COMPETITIVE_PROMPT_TEMPLATE,
)
from aegis_runtime.soul.schemas import SoulArtifacts, SoulJson

logger = logging.getLogger(__name__)


class SoulGenerator:
    def __init__(self, api_key: str):
        self.api_key = api_key

    async def generate(self, run_summary: dict[str, Any]) -> SoulArtifacts:
        import anthropic

        metrics = run_summary.get("metrics", {})
        config = run_summary.get("config", {})
        orders = run_summary.get("orders", [])
        snapshots = run_summary.get("portfolioSnapshots", [])

        trades_text = json.dumps(orders[:20], indent=2, default=str)
        snapshots_text = json.dumps(snapshots[-10:], indent=2, default=str)
        config_text = json.dumps(config, indent=2, default=str)

        user_prompt = SOUL_USER_PROMPT_TEMPLATE.format(
            run_id=run_summary.get("runId", "unknown"),
            total_return=metrics.get("totalReturn", 0),
            sharpe_ratio=metrics.get("sharpeRatio", 0),
            max_drawdown=metrics.get("maxDrawdown", 0),
            win_rate=metrics.get("winRate", 0),
            total_trades=metrics.get("totalTrades", 0),
            profit_factor=metrics.get("profitFactor", 0),
            config=config_text,
            trades=trades_text,
            snapshots=snapshots_text,
        )

        client = anthropic.Anthropic(api_key=self.api_key)
        message = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=4096,
            system=SOUL_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )

        response_text = message.content[0].text
        return self._parse_response(response_text)

    async def generate_competitive(
        self, run_summary: dict[str, Any], competitive_context: dict[str, Any]
    ) -> SoulArtifacts:
        """Generate soul artifacts with competitive tournament context."""
        import anthropic

        metrics = run_summary.get("metrics", {})
        config = run_summary.get("config", {})
        orders = run_summary.get("orders", [])
        snapshots = run_summary.get("portfolioSnapshots", [])

        trades_text = json.dumps(orders[:20], indent=2, default=str)
        snapshots_text = json.dumps(snapshots[-10:], indent=2, default=str)
        config_text = json.dumps(config, indent=2, default=str)

        field_stats = competitive_context.get("fieldStats", {})
        field_stats_text = json.dumps(field_stats, indent=2, default=str)

        user_prompt = SOUL_COMPETITIVE_PROMPT_TEMPLATE.format(
            run_id=run_summary.get("runId", "unknown"),
            total_return=metrics.get("totalReturn", 0),
            sharpe_ratio=metrics.get("sharpeRatio", 0),
            max_drawdown=metrics.get("maxDrawdown", 0),
            win_rate=metrics.get("winRate", 0),
            total_trades=metrics.get("totalTrades", 0),
            profit_factor=metrics.get("profitFactor", 0),
            config=config_text,
            trades=trades_text,
            snapshots=snapshots_text,
            rank=competitive_context.get("rank", "?"),
            total_entrants=competitive_context.get("totalEntrants", "?"),
            percentile=competitive_context.get("percentile", "?"),
            relative_strengths=", ".join(competitive_context.get("relativeStrengths", [])),
            relative_weaknesses=", ".join(competitive_context.get("relativeWeaknesses", [])),
            field_stats=field_stats_text,
        )

        client = anthropic.Anthropic(api_key=self.api_key)
        message = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=4096,
            system=SOUL_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )

        response_text = message.content[0].text
        return self._parse_response(response_text)

    def _parse_response(self, text: str) -> SoulArtifacts:
        soul_md = ""
        soul_json_raw = "{}"

        if "---SOUL_MD---" in text and "---SOUL_JSON---" in text:
            parts = text.split("---SOUL_JSON---")
            soul_md = parts[0].replace("---SOUL_MD---", "").strip()
            soul_json_raw = parts[1].strip()
        else:
            soul_md = text

        try:
            soul_json = json.loads(soul_json_raw)
            # Validate
            SoulJson(**soul_json)
        except (json.JSONDecodeError, Exception) as e:
            logger.warning(f"Failed to parse soul JSON: {e}")
            soul_json = SoulJson().model_dump()

        return SoulArtifacts(soul_md=soul_md, soul_json=soul_json)
