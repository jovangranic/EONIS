import OrdersList from "../components/OrderList";

const OrdersPage = () => {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-4 text-emerald-400">Orders</h1>
      <OrdersList />
    </div>
  );
};

export default OrdersPage;