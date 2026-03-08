import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parents[4] / "data"  # ats/data/
MANIFEST_PATH = DATA_DIR / "manifest.json"


class DataCatalog:
    def __init__(self, data_dir: Path | None = None):
        self.data_dir = data_dir or DATA_DIR
        self.manifest_path = self.data_dir / "manifest.json"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._manifest = self._load_manifest()

    def _load_manifest(self) -> dict:
        if self.manifest_path.exists():
            return json.loads(self.manifest_path.read_text())
        return {"datasets": {}}

    def _save_manifest(self):
        self.manifest_path.write_text(json.dumps(self._manifest, indent=2))

    def _dataset_key(self, symbol: str, timeframe: str, start: str, end: str) -> str:
        return f"{symbol}/{timeframe}_{start}_{end}"

    def has_dataset(self, symbol: str, timeframe: str, start: str, end: str) -> bool:
        key = self._dataset_key(symbol, timeframe, start, end)
        return key in self._manifest["datasets"]

    def get_dataset_path(self, symbol: str, timeframe: str, start: str, end: str) -> Path:
        key = self._dataset_key(symbol, timeframe, start, end)
        rel_path = self._manifest["datasets"].get(key, {}).get("path", "")
        if not rel_path:
            raise FileNotFoundError(f"Dataset not found: {key}")
        return self.data_dir / rel_path

    def register_dataset(
        self, symbol: str, timeframe: str, start: str, end: str, path: Path
    ):
        key = self._dataset_key(symbol, timeframe, start, end)
        rel_path = str(path.relative_to(self.data_dir))
        self._manifest["datasets"][key] = {
            "path": rel_path,
            "symbol": symbol,
            "timeframe": timeframe,
            "start": start,
            "end": end,
        }
        self._save_manifest()
        logger.info(f"Registered dataset: {key}")
