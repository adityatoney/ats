import re
from dataclasses import dataclass, field


class StrategyValidationError(Exception):
    pass


@dataclass
class ParsedStrategy:
    objective: str = ""
    universe: str = ""
    entry_criteria: str = ""
    exit_criteria: str = ""
    risk_rules: str = ""
    sizing_doctrine: str = ""
    raw_sections: dict[str, str] = field(default_factory=dict)


REQUIRED_SECTIONS = [
    "objective",
    "universe",
    "entry criteria",
    "exit criteria",
    "risk rules",
    "sizing doctrine",
]

SECTION_MAP = {
    "objective": "objective",
    "universe": "universe",
    "entry criteria": "entry_criteria",
    "entry_criteria": "entry_criteria",
    "exit criteria": "exit_criteria",
    "exit_criteria": "exit_criteria",
    "risk rules": "risk_rules",
    "risk_rules": "risk_rules",
    "sizing doctrine": "sizing_doctrine",
    "sizing_doctrine": "sizing_doctrine",
    "sizing": "sizing_doctrine",
}


class StrategyMarkdownParser:
    @staticmethod
    def parse(markdown: str) -> ParsedStrategy:
        sections: dict[str, str] = {}
        current_section: str | None = None
        current_content: list[str] = []

        for line in markdown.split("\n"):
            header_match = re.match(r"^##\s+(.+)", line)
            if header_match:
                if current_section is not None:
                    sections[current_section] = "\n".join(current_content).strip()
                current_section = header_match.group(1).strip().lower()
                current_content = []
            else:
                current_content.append(line)

        if current_section is not None:
            sections[current_section] = "\n".join(current_content).strip()

        # Map sections to fields
        parsed = ParsedStrategy(raw_sections=sections)
        for section_name, content in sections.items():
            field_name = SECTION_MAP.get(section_name)
            if field_name:
                setattr(parsed, field_name, content)

        # Validate required sections
        missing = []
        for req in REQUIRED_SECTIONS:
            field_name = SECTION_MAP.get(req, req)
            if not getattr(parsed, field_name, ""):
                missing.append(req)

        if missing:
            raise StrategyValidationError(
                f"Missing required sections: {', '.join(missing)}"
            )

        return parsed
