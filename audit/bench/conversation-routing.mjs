// Independent, hand-written conversational probes. Never added to training.
import { classifyAsync } from '../../src/cts-core/classifier.ts'
import { writeFileSync } from 'node:fs'
const probes=[
 ['medical','My throat is swelling after taking a pill and breathing feels difficult.'],
 ['medical','I get dizzy whenever I stand up, could this be from the tablets?'],
 ['legal','My landlord kept the deposit even though I left the flat spotless.'],
 ['coding','Why does the connection pool freeze when requests spike?'],
 ['commerce','A quiet compact keyboard would suit me better. What should I get?'],
 ['sales','We want to roll this out to our whole company. What would eighty seats cost?'],
 ['education','How do green leaves turn sunlight into food?'],
 ['customer_support','The item came cracked and nobody has answered my emails.'],
 ['general','Suggest something relaxing to do this weekend.'],
]
const results=[]
for(const [expected,text] of probes){
 const frame=await classifyAsync(text)
 results.push({expected,actual:frame.domain,correct:frame.domain===expected,text})
}
const report={scope:'Nine independent hand-written paraphrase probes; diagnostic only, not a statistically representative accuracy estimate.',correct:results.filter(row=>row.correct).length,total:results.length,results}
writeFileSync('reports/conversation-routing.json',JSON.stringify(report,null,2)+'\n')
console.log(`Independent conversational routing: ${report.correct}/${report.total}; see reports/conversation-routing.json`)
