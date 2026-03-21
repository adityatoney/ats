import logging
from pathlib import Path

import polars as pl

from aegis_runtime.data.alpaca_client import AlpacaHistoricalClient
from aegis_runtime.data.data_catalog import DataCatalog

logger = logging.getLogger(__name__)


class DataNotFoundError(Exception):
    pass


class DataLoader:
    def __init__(self, data_dir: Path | None = None):
        self.catalog = DataCatalog(data_dir=data_dir)

    def load(
        self,
        symbols: list[str],
        start: str,
        end: str,
        timeframe: str = "1Day",
    ) -> dict[str, pl.DataFrame]:
        result: dict[str, pl.DataFrame] = {}
        missing_symbols = []

        for symbol in symbols:
            if self.catalog.has_dataset(symbol, timeframe, start, end):
                path = self.catalog.get_dataset_path(symbol, timeframe, start, end)
                df = pl.read_parquet(path)
                result[symbol] = df
                logger.info(f"Loaded {symbol} from cache: {len(df)} bars")
            else:
                missing_symbols.append(symbol)

        if missing_symbols:
            logger.info(f"Fetching data for: {missing_symbols}")
            client = AlpacaHistoricalClient()
            fetched = client.fetch_bars(missing_symbols, start, end, timeframe)

            for symbol, df in fetched.items():
                # Save to parquet
                symbol_dir = self.catalog.data_dir / symbol
                symbol_dir.mkdir(parents=True, exist_ok=True)
                filename = f"{timeframe}_{start}_{end}.parquet"
                path = symbol_dir / filename
                df.write_parquet(path)

                # Register in catalog
                self.catalog.register_dataset(symbol, timeframe, start, end, path)
                result[symbol] = df

        return result

    def load_from_parquet(self, path: Path) -> pl.DataFrame:
        if not path.exists():
            raise DataNotFoundError(f"Parquet file not found: {path}")
        return pl.read_parquet(path)

    def load_merged(
        self,
        symbols: list[str],
        start: str,
        end: str,
        timeframe: str = "1Day",
    ) -> pl.DataFrame:
        data = self.load(symbols, start, end, timeframe)
        frames = []
        for symbol, df in data.items():
            df = df.with_columns(pl.lit(symbol).alias("symbol"))
            frames.append(df)
        if not frames:
            raise DataNotFoundError("No data loaded")
        return pl.concat(frames).sort("timestamp")
