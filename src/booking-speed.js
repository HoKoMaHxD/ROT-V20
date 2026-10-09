'use strict';
const MAX_BOOKING_DELAY_MS=10000;
function bookingDelay(account) {
  const value=account?.seatDelayMs;
  return Number.isInteger(value)&&value>=0&&value<=MAX_BOOKING_DELAY_MS?value:0;
}
function parseBookingDelay(input) {
  const raw=String(input).trim().replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776));
  if(!/^\d{1,5}$/.test(raw)||Number(raw)>MAX_BOOKING_DELAY_MS)
    throw new Error('أدخل رقماً صحيحاً من 0 إلى 10000 مللي ثانية. 0 يحافظ على سرعة الحجز الحالية.');
  return Number(raw);
}
function saveBookingDelay({ownerId,input,store,session}) {
  const seatDelayMs=parseBookingDelay(input),account=store.data[ownerId];
  if(!account?.token)throw new Error('اربط حسابك أولاً ثم اضبط سرعة الحجز.');
  store.put(ownerId,{...account,seatDelayMs});
  if(session?.chairs)session.chairs.seatDelayMs=seatDelayMs;
  return seatDelayMs;
}
module.exports={bookingDelay,parseBookingDelay,saveBookingDelay};
