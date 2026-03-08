from pydantic import BaseModel


class SoulJson(BaseModel):
    beliefs: list[str] = []
    anti_patterns: list[str] = []
    regime_preferences: list[str] = []
    timing_lessons: list[str] = []
    confidence_boundaries: dict = {}
    playbooks: list[str] = []
    scar_tissue: list[str] = []
    forbidden_moves: list[str] = []


class SoulArtifacts(BaseModel):
    soul_md: str
    soul_json: dict
