from dataclasses import dataclass


@dataclass
class FeeModel:
    per_share: float = 0.01
    percentage: float = 0.0

    max_fee_pct: float = 0.01  # Cap per-share fees at 1% of trade value

    def compute_fee(self, quantity: float, price: float) -> float:
        trade_value = abs(quantity) * price
        fee_per_share = self.per_share * abs(quantity)
        fee_percentage = self.percentage * trade_value

        # Cap per-share fee to prevent it from exceeding max_fee_pct of trade value
        # (critical for split-adjusted historical prices like AAPL at $0.09 in 1980)
        if trade_value > 0 and fee_per_share > self.max_fee_pct * trade_value:
            fee_per_share = round(self.max_fee_pct * trade_value, 8)

        return round(max(fee_per_share, fee_percentage), 8)
