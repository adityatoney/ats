"""Buy day 1, hold forever strategy for tournament testing."""


def prepare_features(df):
    return df


def generate_signal(state, portfolio):
    symbol = state.symbol
    has_position = symbol in portfolio.positions and portfolio.positions[symbol].quantity > 0

    # Buy on first bar only
    if state.bar_index == 0 and not has_position:
        return {"action": "buy", "symbol": symbol, "confidence": 1.0, "reason": "Buy and hold entry"}

    return None


def size_position(portfolio, signal):
    equity = portfolio.equity
    num_symbols = max(len(portfolio.positions) + 1, 1)
    allocation = equity * 0.9 / num_symbols
    price = signal.get("price", 100)
    if price <= 0:
        return {"quantity": 0}
    qty = int(allocation / price)
    return {"quantity": max(qty, 1)}


def risk_gate(order, portfolio, market):
    return {"approved": True, "reason": ""}
