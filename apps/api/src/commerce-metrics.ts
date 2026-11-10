/** @file 電商成效計算；無訪問或花費時不猜測轉換率與 ROAS，退款不計入淨成交。 */
export function commerceMetrics({orders,spendCents,visits}:{/** 已登錄訂單。 */orders:Array<{status:string;totalCents:number}>;/** 實際花費。 */spendCents:number;/** 訪問量。 */visits:number}) {
  const paid=orders.filter(order=>order.status==='paid');
  const revenueCents=paid.reduce((sum,order)=>sum+order.totalCents,0);
  return {paidOrders:paid.length,revenueCents,pendingOrders:orders.filter(order=>order.status==='pending').length,refundOrders:orders.filter(order=>order.status==='refunded').length,averageCents:paid.length?Math.round(revenueCents/paid.length):null,conversion:visits&&paid.length<=visits?paid.length/visits:null,roas:spendCents?revenueCents/spendCents:null};
}
