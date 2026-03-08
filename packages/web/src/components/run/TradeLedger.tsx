interface Props {
  orders: Array<Record<string, unknown>>;
}

export function TradeLedger({ orders }: Props) {
  if (orders.length === 0) {
    return <div className="text-gray-400">No trades yet.</div>;
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-gray-400 text-left">
            <th className="p-3">Symbol</th>
            <th className="p-3">Side</th>
            <th className="p-3">Type</th>
            <th className="p-3">Quantity</th>
            <th className="p-3">Status</th>
            <th className="p-3">Bar</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order, i) => (
            <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
              <td className="p-3 font-mono">{order.symbol as string}</td>
              <td className="p-3">
                <span
                  className={
                    (order.side as string) === 'buy' ? 'text-green-400' : 'text-red-400'
                  }
                >
                  {(order.side as string).toUpperCase()}
                </span>
              </td>
              <td className="p-3">{order.orderType as string}</td>
              <td className="p-3">{String(order.quantity)}</td>
              <td className="p-3">
                <span
                  className={`px-1.5 py-0.5 rounded text-xs ${
                    order.status === 'filled'
                      ? 'bg-green-900/50 text-green-300'
                      : order.status === 'pending'
                        ? 'bg-yellow-900/50 text-yellow-300'
                        : 'bg-gray-700 text-gray-300'
                  }`}
                >
                  {order.status as string}
                </span>
              </td>
              <td className="p-3">{String(order.barIndex)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
