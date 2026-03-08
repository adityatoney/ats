from dataclasses import dataclass


@dataclass
class FeeModel:
    per_share: float = 0.01
    percentage: float = 0.0

    def compute_fee(self, quantity: int, price: float) -> float:
        fee_per_share = self.per_share * abs(quantity)
        fee_percentage = self.percentage * abs(quantity) * price
        return round(max(fee_per_share, fee_percentage), 8)
