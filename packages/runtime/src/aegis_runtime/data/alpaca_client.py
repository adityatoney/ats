import os
import logging
import time
from datetime import datetime

import polars as pl
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.requests import StockBarsRequest
from alpaca.data.timeframe import TimeFrame, TimeFrameUnit

from aegis_runtime.data.schemas import BAR_COLUMNS

logger = logging.getLogger(__name__)

TIMEFRAME_MAP = {
    "1Min": TimeFrame(1, TimeFrameUnit.Minute),
    "5Min": TimeFrame(5, TimeFrameUnit.Minute),
    "15Min": TimeFrame(15, TimeFrameUnit.Minute),
    "1Hour": TimeFrame(1, TimeFrameUnit.Hour),
    "1Day": TimeFrame(1, TimeFrameUnit.Day),
}

# Yahoo Finance timeframe mapping
YF_TIMEFRAME_MAP = {
    "1Min": "1m",
    "5Min": "5m",
    "15Min": "15m",
    "1Hour": "1h",
    "1Day": "1d",
}


def _fetch_yfinance(symbol: str, start: str, end: str, timeframe: str) -> pl.DataFrame | None:
    """Fallback data source using Yahoo Finance for longer history."""
    try:
        import yfinance as yf

        yf_interval = YF_TIMEFRAME_MAP.get(timeframe, "1d")
        ticker = yf.Ticker(symbol)
        df = ticker.history(start=start, end=end, interval=yf_interval)

        if df.empty:
            return None

        records = []
        for idx, row in df.iterrows():
            records.append({
                "timestamp": idx.to_pydatetime(),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "volume": float(row["Volume"]),
                "vwap": float((row["High"] + row["Low"] + row["Close"]) / 3),
            })

        result = pl.DataFrame(records).sort("timestamp")
        logger.info(f"Yahoo Finance: fetched {len(result)} bars for {symbol} ({start} to {end})")
        return result

    except ImportError:
        logger.warning("yfinance not installed, cannot use Yahoo Finance fallback")
        return None
    except Exception as e:
        logger.warning(f"Yahoo Finance fallback failed for {symbol}: {e}")
        return None


class AlpacaHistoricalClient:
    def __init__(self):
        api_key = os.getenv("ALPACA_API_KEY", "")
        secret_key = os.getenv("ALPACA_SECRET_KEY", "")
        self.client = StockHistoricalDataClient(api_key, secret_key)

    def fetch_bars(
        self,
        symbols: list[str],
        start: str,
        end: str,
        timeframe: str = "1Day",
    ) -> dict[str, pl.DataFrame]:
        tf = TIMEFRAME_MAP.get(timeframe)
        if not tf:
            raise ValueError(f"Unsupported timeframe: {timeframe}")

        result: dict[str, pl.DataFrame] = {}
        max_retries = 3
        requested_start = datetime.fromisoformat(start).date()

        for symbol in symbols:
            for attempt in range(max_retries):
                try:
                    request = StockBarsRequest(
                        symbol_or_symbols=symbol,
                        start=start,
                        end=end,
                        timeframe=tf,
                    )
                    bars = self.client.get_stock_bars(request)

                    records = []
                    for bar in bars[symbol]:
                        records.append({
                            "timestamp": bar.timestamp,
                            "open": float(bar.open),
                            "high": float(bar.high),
                            "low": float(bar.low),
                            "close": float(bar.close),
                            "volume": float(bar.volume),
                            "vwap": float(bar.vwap) if bar.vwap else 0.0,
                        })

                    df = pl.DataFrame(records)
                    df = df.sort("timestamp")

                    # Check if Alpaca returned data covering the full requested range
                    if len(df) > 0:
                        actual_start = df["timestamp"][0].date()
                        if actual_start > requested_start:
                            logger.warning(
                                f"Alpaca data for {symbol} starts at {actual_start}, "
                                f"requested {requested_start}. Trying Yahoo Finance fallback..."
                            )
                            yf_df = _fetch_yfinance(symbol, start, end, timeframe)
                            if yf_df is not None and len(yf_df) > len(df):
                                logger.info(
                                    f"Using Yahoo Finance data for {symbol}: "
                                    f"{len(yf_df)} bars (vs Alpaca's {len(df)})"
                                )
                                df = yf_df

                    result[symbol] = df
                    logger.info(
                        f"Fetched {len(df)} bars for {symbol} "
                        f"({df['timestamp'][0]} to {df['timestamp'][-1]})"
                        if len(df) > 0 else f"No bars for {symbol}"
                    )
                    break

                except Exception as e:
                    logger.warning(
                        f"Attempt {attempt + 1}/{max_retries} failed for {symbol}: {e}"
                    )
                    if attempt < max_retries - 1:
                        time.sleep(2 ** attempt)
                    else:
                        raise

        return result
