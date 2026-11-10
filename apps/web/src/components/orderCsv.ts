/** @file 解析訂單 CSV，支援引號、逗號與換行；名稱對應必須唯一，金額轉為整數分。 */
export function parseOrderCsv({text,products,campaigns}:{/** 原始 CSV。 */text:string;/** 已建商品。 */products:Array<{id:string;name:string}>;/** 已建活動。 */campaigns:Array<{id:string;name:string}>}){
  const rows:string[][]=[];let row:string[]=[];let cell='';let quoted=false;let closed=false;
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(quoted){if(char==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=char;continue;}
    if(char==='"'){if(cell||closed)throw Error('CSV 引號格式錯誤');quoted=true;}
    else if(char===','||char==='\n'){row.push(cell);cell='';closed=false;if(char==='\n'){rows.push(row);row=[];}}
    else if(char==='\r'&&text[i+1]==='\n')continue;
    else {if(closed)throw Error('CSV 引號後有無效字元');cell+=char;}
  }
  if(quoted)throw Error('CSV 引號未結束');row.push(cell);rows.push(row);
  const nonempty=rows.filter(values=>values.some(value=>value.trim()));const header=nonempty.shift()?.map(value=>value.trim());
  const columns=['number','product','campaign','quantity','total','status','date'];
  if(!header||header.join(',')!==columns.join(','))throw Error('CSV 欄位須依序為 number,product,campaign,quantity,total,status,date');
  if(!nonempty.length||nonempty.length>500)throw Error('每次請匯入 1–500 筆訂單');
  function findId(items:Array<{id:string;name:string}>,name:string){const matches=items.filter(item=>item.name===name);if(matches.length!==1)throw Error(`名稱不存在或不唯一：${name}`);return matches[0].id;}
  return nonempty.map((values,index)=>{
    if(values.length!==7)throw Error(`第 ${index+2} 列欄位數不符`);
    const [number,product,campaign,quantity,total,status,date]=values.map(value=>value.trim());
    if(!/^\d+(\.\d{1,2})?$/.test(total)||!/^\d+$/.test(quantity)||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error(`第 ${index+2} 列金額、數量或日期格式錯誤`);
    const [whole,fraction='']=total.split('.');const totalCents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
    const time=new Date(date+'T12:00:00+08:00');if(!Number.isFinite(time.getTime())||new Date(time.getTime()+8*3600_000).toISOString().slice(0,10)!==date)throw Error(`第 ${index+2} 列日期無效`);
    return {number,productId:findId(products,product),campaignId:campaign?findId(campaigns,campaign):null,quantity:Number(quantity),totalCents,status,orderedAt:time.toISOString()};
  });
}
