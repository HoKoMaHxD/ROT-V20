'use strict';
const {performance}=require('node:perf_hooks');
class SeatLatency {
  constructor(clock=()=>performance.now()){this.clock=clock;this.last=null;}
  wrap(receivedAt,options) {
    // Registration keeps its existing confirmation flow; measure seat attempts.
    if(!options?.onDispatch)return options;
    const start=Number.isFinite(receivedAt)?receivedAt:this.clock();
    const record={start};this.last=record;
    return {...options,
      onQueued:()=>{record.queued=this.clock();options.onQueued?.();},
      onDispatch:()=>{record.dispatched=this.clock();options.onDispatch();},
      onResponse:status=>{record.response=this.clock();record.status=status;options.onResponse?.(status);}};
  }
  summary() {
    const r=this.last;if(!r)return 'قياس السرعة: ينتظر أول محاولة حجز كرسي.';
    const ms=value=>Math.max(0,value).toFixed(2)+' ms';
    if(r.dispatched==null)return 'آخر حجز: ينتظر الإرسال أو أُلغي قبل الإرسال.';
    return `آخر حجز — وصول الحدث إلى بدء الإرسال: ${ms(r.dispatched-r.start)}\n`+
      `انتظار طابور الإرسال: ${r.queued==null?'—':ms(r.dispatched-r.queued)}\n`+
      `استجابة ديسكورد بعد بدء الإرسال: ${r.response==null?'لم تصل بعد':`${ms(r.response-r.dispatched)} (HTTP ${r.status})`}\n`+
      'هذه أزمنة الطلب، ولا تعني نجاح حجز المقعد.';
  }
}
module.exports={SeatLatency};
