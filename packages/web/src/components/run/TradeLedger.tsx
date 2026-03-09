interface Props {
  orders: Array<Record<string, unknown>>;
}

function formatDate(value: unknown): string {
  if (!value) return '—';
  const d = new Date(value as string);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTime(value: unknown): string {
  if (!value) return '';
  const d = new Date(value as string);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatQty(value: unknown): string {
  const n = Number(value);
  if (isNaN(n)) return '0.00';
  return n.toFixed(2);
}

function formatPrice(value: unknown): string {
  if (value == null) return '—';
  const n = Number(value);
  if (isNaN(n)) return '—';
  return `$${n.toFixed(2)}`;
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
            <th className="p-3">Date</th>
            <th className="p-3">Time</th>
            <th className="p-3">Symbol</th>
            <th className="p-3">Side</th>
            <th className="p-3">Quantity</th>
            <th className="p-3">Price</th>
            <th className="p-3">Status</th>
            <th className="p-3">Bar</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order, i) => {
            const ts = order.filledAtSim || order.submittedAtSim;
            return (
              <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                <td className="p-3 text-gray-300">{formatDate(ts)}</td>
                <td className="p-3 text-gray-400">{formatTime(ts)}</td>
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
                <td className="p-3 font-mono">{formatQty(order.quantity)}</td>
                <td className="p-3 font-mono">{formatPrice(order.fillPrice)}</td>
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
