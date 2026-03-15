"""RSI-based mean reversion strategy for tournament testing."""
import polars as pl


def prepare_features(df):
    """Add RSI indicator."""
    delta = df["close"].diff()
    gain = delta.clip(lower_bound=0).rolling_mean(14)
    loss = (-delta.clip(upper_bound=0)).rolling_mean(14)
    rs = gain / loss.replace(0, 1e-10)
    rsi = 100 - (100 / (1 + rs))
    return df.with_columns(rsi.alias("rsi"))


def generate_signal(state, portfolio):
    bar = state.current_bar
    rsi = bar.get("rsi")
    if rsi is None:
        return None

    symbol = state.symbol
    has_position = symbol in portfolio.positions and portfolio.positions[symbol].quantity > 0

    if rsi < 30 and not has_position:
        return {"action": "buy", "symbol": symbol, "confidence": 0.7, "reason": f"RSI oversold: {rsi:.1f}"}
    elif rsi > 70 and has_position:
        return {"action": "sell", "symbol": symbol, "confidence": 0.7, "reason": f"RSI overbought: {rsi:.1f}"}

    return None


def size_position(portfolio, signal):
    if signal["action"] == "sell":
        pos = portfolio.positions.get(signal["symbol"])
        return {"quantity": pos.quantity if pos else 0}

    equity = portfolio.equity
    allocation = equity * 0.2
    price = signal.get("price", 100)
    if price <= 0:
        return {"quantity": 0}
    qty = int(allocation / price)
    return {"quantity": max(qty, 1)}


def risk_gate(order, portfolio, market):
    return {"approved": True, "reason": ""}
