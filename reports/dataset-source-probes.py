import json, urllib.request, concurrent.futures
sources = [
 ('coding','code-search-net/code_search_net','python'),
 ('customer_support','bitext/Bitext-customer-support-llm-chatbot-training-dataset','default'),
 ('legal','theatticusproject/cuad-qa','default'),
 ('medical','qiaojin/PubMedQA','pqa_artificial'),
 ('education','rajpurkar/squad','plain_text'),
 ('commerce','embedding-data/Amazon-QA','default'),
 ('general','pfb30/multi_woz_v22','v2.2'),
]
def probe(source):
 domain,dataset,config=source
 query=urllib.parse.urlencode(dict(dataset=dataset,config=config,split='train',offset=0,length=2))
 try:
  with urllib.request.urlopen('https://datasets-server.huggingface.co/rows?'+query,timeout=60) as response: data=json.load(response)
  return dict(domain=domain,dataset=dataset,config=config,fields=[f['name'] for f in data.get('features',[])],rows=data.get('rows'))
 except Exception as error:return dict(domain=domain,error=str(error),dataset=dataset,config=config)
with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:
 for result in pool.map(probe,sources):print(json.dumps(result)[:2000],flush=True)
