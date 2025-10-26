import { useEffect, useState } from "react";

const OrdersList = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/orders/completed", {
          credentials: "include",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Failed to load orders");
        setOrders(data.orders || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchOrders();
  }, []);

  if (loading) return <div className="text-center text-gray-300">Loading completed orders...</div>;
  if (error) return <div className="text-center text-red-400">Error: {error}</div>;
  if (!orders.length) return <div className="text-center text-gray-300">No completed orders found.</div>;

  return (
    <div className="bg-gray-800 p-6 rounded-md">
      <h2 className="text-2xl font-semibold mb-4 text-emerald-400">Completed Orders</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm text-left">
          <thead>
            <tr className="text-gray-300">
              <th className="px-4 py-2">Order ID</th>
              <th className="px-4 py-2">User</th>
              <th className="px-4 py-2">Total</th>
              <th className="px-4 py-2">Items</th>
              <th className="px-4 py-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o._id} className="border-t border-gray-700">
                <td className="px-4 py-3 text-gray-200">{o._id}</td>
                <td className="px-4 py-3 text-gray-200">{o.user?.name || o.user?.email || "—"}</td>
                <td className="px-4 py-3 text-gray-200">€{(o.totalAmount || o.total || 0).toFixed(2)}</td>
                <td className="px-4 py-3 text-gray-200">{(o.products || o.items || []).length}</td>
                <td className="px-4 py-3 text-gray-200">{new Date(o.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default OrdersList;
