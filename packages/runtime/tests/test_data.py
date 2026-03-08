import tempfile
from pathlib import Path

import polars as pl

from aegis_runtime.data.data_catalog import DataCatalog


class TestDataCatalog:
    def test_register_and_check_dataset(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            catalog = DataCatalog(data_dir=Path(tmpdir))
            assert not catalog.has_dataset("AAPL", "1Day", "2022-01-01", "2023-01-01")

            # Create a dummy parquet file
            data_path = Path(tmpdir) / "AAPL" / "1Day_2022-01-01_2023-01-01.parquet"
            data_path.parent.mkdir(parents=True, exist_ok=True)
            df = pl.DataFrame({"close": [1.0, 2.0]})
            df.write_parquet(data_path)

            catalog.register_dataset("AAPL", "1Day", "2022-01-01", "2023-01-01", data_path)
            assert catalog.has_dataset("AAPL", "1Day", "2022-01-01", "2023-01-01")

    def test_get_dataset_path(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            catalog = DataCatalog(data_dir=Path(tmpdir))
            data_path = Path(tmpdir) / "AAPL" / "test.parquet"
            data_path.parent.mkdir(parents=True, exist_ok=True)
            pl.DataFrame({"close": [1.0]}).write_parquet(data_path)

            catalog.register_dataset("AAPL", "1Day", "2022-01-01", "2023-01-01", data_path)
            retrieved = catalog.get_dataset_path("AAPL", "1Day", "2022-01-01", "2023-01-01")
            assert retrieved.exists()

    def test_manifest_persistence(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            catalog = DataCatalog(data_dir=Path(tmpdir))
            data_path = Path(tmpdir) / "AAPL" / "test.parquet"
            data_path.parent.mkdir(parents=True, exist_ok=True)
            pl.DataFrame({"close": [1.0]}).write_parquet(data_path)

            catalog.register_dataset("AAPL", "1Day", "2022-01-01", "2023-01-01", data_path)

            # Load new catalog instance
            catalog2 = DataCatalog(data_dir=Path(tmpdir))
            assert catalog2.has_dataset("AAPL", "1Day", "2022-01-01", "2023-01-01")
