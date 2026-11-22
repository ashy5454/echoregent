"""Train an eight-domain lexical classifier from auditable balanced sources.

This is a new compact classifier, not a recovery of the unavailable DistilBERT
checkpoint. Data is downloaded as JSON only; no remote dataset code runs.
"""
import collections
import concurrent.futures
import hashlib
import io
import json
import pathlib
import random
import re
import time
import urllib.parse
import urllib.request
import zipfile
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split

ROOT = pathlib.Path(__file__).resolve().parents[2]
DATA = ROOT / 'data' / 'compact_classifier'
OUT = ROOT / 'ml' / 'cts_classifier'
DOMAINS = ['coding', 'commerce', 'customer_support', 'education', 'general', 'legal', 'medical', 'sales']
SOURCES = [
 ('coding','code-search-net/code_search_net','python',30000),
 ('customer_support','bitext/Bitext-customer-support-llm-chatbot-training-dataset','default',26872),
 ('medical','qiaojin/PubMedQA','pqa_artificial',211269),
 ('education','rajpurkar/squad','plain_text',87599),
 ('commerce','embedding-data/Amazon-QA','default',100000),
]

def read_url(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=90) as response:
                return response.read()
        except Exception:
            if attempt == 3: raise
            time.sleep(2 * (attempt + 1))

def page(source, offset):
    domain, dataset, config, _ = source
    params = urllib.parse.urlencode(dict(dataset=dataset, config=config, split='train', offset=offset, length=100))
    rows = json.loads(read_url('https://datasets-server.huggingface.co/rows?' + params))['rows']
    examples = []
    for wrapped in rows:
        row=wrapped['row']
        if domain=='coding': text=str(row['func_documentation_string'])+' '+str(row['func_code_string'])[:260]
        elif domain=='customer_support': text=row['instruction']
        elif domain=='medical': text=row['question']
        elif domain=='education': text=row['question']+' '+row['context'][:130]
        elif domain=='commerce': text=row['query']+' '+(' '.join(row.get('pos',[])))[:130]
        if isinstance(text,str) and len(text.strip())>12:
            examples.append({'text':text[:512].strip(),'label':domain,'source':dataset,'source_row':wrapped['row_idx']})
    return examples

def load_sources():
    DATA.mkdir(parents=True,exist_ok=True)
    cached=DATA/'corpus.jsonl'
    if cached.exists():
        return [json.loads(line) for line in cached.read_text(encoding='utf8').splitlines()]
    tasks=[]
    rng=random.Random(7219)
    for source in SOURCES:
        offsets=rng.sample(range(0,source[3]-100,100),26)
        tasks.extend((source,offset) for offset in offsets)
    examples=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        futures=[pool.submit(page,source,offset) for source,offset in tasks]
        for future in concurrent.futures.as_completed(futures): examples.extend(future.result())
    print('Public viewer sources loaded',collections.Counter(row['label'] for row in examples),flush=True)
    legal_url='https://raw.githubusercontent.com/TheAtticusProject/cuad/main/data.zip'
    archive=zipfile.ZipFile(io.BytesIO(read_url(legal_url)))
    name=next(name for name in archive.namelist() if name.endswith('train_separate_questions.json'))
    legal=json.loads(archive.read(name))
    for item in legal['data']:
        for paragraph in item['paragraphs']:
            for question in paragraph['qas']:
                text=question['question']+' '+paragraph['context'][:180]
                examples.append({'text':text[:512],'label':'legal','source':legal_url,'source_row':question['id']})
    for index in range(1,18):
        url=f'https://raw.githubusercontent.com/budzianowski/multiwoz/master/data/MultiWOZ_2.2/train/dialogues_{index:03d}.json'
        dialogues=json.loads(read_url(url))
        for dialogue in dialogues:
            for turn in dialogue['turns']:
                if turn['speaker']=='USER' and len(turn['utterance'])>12:
                    examples.append({'text':turn['utterance'][:512],'label':'general','source':url,'source_row':dialogue['dialogue_id']+':'+turn['turn_id']})
        if sum(row['label']=='general' for row in examples)>4000: break
    import sys
    sys.path.insert(0,str(ROOT))
    from pipeline.data.synthetic_gen import generate_synthetic_sales
    for index,row in enumerate(generate_synthetic_sales(target=2600)):
        examples.append({'text':row['text'][:512],'label':'sales','source':'pipeline/data/synthetic_gen.py','source_row':index})
    unique={}
    for row in examples:
        key=re.sub(r'\s+',' ',row['text'].lower()).strip()
        unique.setdefault(key,row)
    balanced=[]
    for domain in DOMAINS:
        rows=[row for row in unique.values() if row['label']==domain]
        rng.shuffle(rows)
        if len(rows)<1000: raise RuntimeError(f'{domain}: only {len(rows)} unique examples')
        balanced.extend(rows[:1000])
    cached.write_text(''.join(json.dumps(row)+'\n' for row in balanced),encoding='utf8')
    return balanced

def main():
    started=time.perf_counter()
    corpus=load_sources()
    # Product calibration bridges research/docstring sources to user messages.
    # These generated examples are included in training only; the public
    # holdout metrics below continue to use untouched source examples.
    topics={
      'coding':['TypeScript compiler error','React component rendering','Express API endpoint timeout','Python traceback exception','PostgreSQL database query','JavaScript async await promise','Docker container build','Git merge conflict','unit test assertion failure','REST API authentication','npm dependency installation','Rust borrow checker','C++ segmentation fault','SQL database migration','webhook retry handler','CSS flexbox styling','Kubernetes deployment logs','Java null pointer exception','CORS request error','code refactoring function'],
      'customer_support':['cancel an order','refund for a damaged delivery','reset account password','customer service ticket','track a package','missing order confirmation','billing invoice charged twice','return a broken product','update shipping address','contact customer support','recover locked account','replacement for damaged item','subscription cancellation','delivery was delayed','payment was declined','incorrect invoice','account login problem','escalate a support complaint','warranty replacement request','refund status'],
      'medical':['blood pressure and lisinopril','dry cough from medication','ibuprofen drug interaction','shortness of breath symptom','diabetes insulin treatment','patient heart disease','allergy medication dosage','fever and chest pain','doctor appointment symptoms','asthma inhaler side effects','blood test results','headache treatment','pregnancy health concerns','antibiotic prescription','knee pain diagnosis','high cholesterol statin','dizziness after taking medicine','clinical trial patients','hospital surgical procedure','mental health therapy'],
      'legal':['employment contract termination','liability obligations in an agreement','non disclosure confidentiality clause','landlord tenant lease dispute','contract indemnification provision','copyright infringement lawsuit','patent licensing rights','arbitration agreement','governing law jurisdiction','legal notice from attorney','employment severance agreement','court injunction','breach of contract remedies','non compete restrictions','privacy law compliance','business incorporation documents','legal counsel review','consumer protection statute','intellectual property ownership','commercial contract renewal'],
      'commerce':['wireless keyboard compatibility','laptop battery specifications','compare smartphone prices','product material and dimensions','choose running shoes','purchase camera lens','headphone sound quality','USB cable compatibility','buy kitchen appliance','shopping for a monitor','discount coupon purchase','product warranty specifications','screen resolution comparison','recommend a desk chair','best tablet for drawing','store stock availability','purchase a travel backpack','charging adapter compatibility','compare electric bicycles','online product reviews'],
      'education':['photosynthesis biology homework','explain calculus derivative','history of ancient Rome lesson','school science assignment','teach algebra equations','study for an exam','learn Spanish grammar','explain Newton laws','practice math fractions','geography class rivers','understand chemical reactions','university literature essay','student learning exercises','biology plants oxygen','physics force and motion','tutor quadratic equations','explain the water cycle','study guide astronomy','learning about World War history','vocabulary lesson'],
      'sales':['enterprise plan annual quote','discount for eighty seats','sales proposal for procurement','negotiate contract pricing','demo for potential buyer','enterprise purchasing budget','compare subscription plans','volume pricing offer','annual billing discount','commercial sales opportunity','sales pipeline follow up','buyer objections price','quarterly procurement deadline','business ROI presentation','request a pricing proposal','renew enterprise subscription','premium plan negotiation','lead qualification meeting','procurement decision timeline','business software quote'],
      'general':['plan a restaurant visit','find a hotel near the train station','book a taxi ride','travel itinerary in Cambridge','recommend a movie','weekend trip planning','write a birthday greeting','find local attractions','schedule dinner with friends','weather for a picnic','hotel reservation for two people','directions to a museum','train departure schedule','restaurant booking tonight','choose a holiday destination','plan a community event','daily routine advice','write a friendly email','suggest a relaxing hobby','organize a family gathering'],
    }
    forms=['I need help with {}.','Can you explain {}?','I have a question about {}.','What should I do about {}?','Please help me understand {}.','I am working on {} and need advice.','How can I handle {}?','We are discussing {}. What are the next steps?','Could you provide details about {}?','I want to know more about {}.','I am having trouble with {}.','Please give me guidance on {}.']
    calibration=[{'text':form.format(topic),'label':domain,'source':'product-topic-calibration','source_row':f'{domain}/{topic}/{index}'} for domain,items in topics.items() for topic in items for index,form in enumerate(forms)]
    texts=[row['text'] for row in corpus]
    labels=[row['label'] for row in corpus]
    train_indices,test_indices=train_test_split(np.arange(len(corpus)),test_size=0.2,stratify=labels,random_state=7219)
    # A word bigram model with sublinear TF is cheap to reproduce in JS.
    vectorizer=TfidfVectorizer(lowercase=True,token_pattern=r'(?u)\b\w\w+\b',ngram_range=(1,2),
        max_features=35000,sublinear_tf=True,min_df=2)
    train_texts=[texts[index] for index in train_indices]+[row['text'] for row in calibration]
    train_labels=[labels[index] for index in train_indices]+[row['label'] for row in calibration]
    train=vectorizer.fit_transform(train_texts)
    classifier=LogisticRegression(C=4,max_iter=400,solver='lbfgs',class_weight='balanced')
    classifier.fit(train,train_labels)
    test=vectorizer.transform([texts[index] for index in test_indices])
    predictions=classifier.predict(test)
    metrics=classification_report([labels[index] for index in test_indices],predictions,output_dict=True,zero_division=0)
    print(json.dumps(metrics,indent=2),flush=True)
    OUT.mkdir(parents=True,exist_ok=True)
    weights=dict(format='cts-tfidf-logistic-v1',domains=classifier.classes_.tolist(),
        vocabulary=vectorizer.vocabulary_,idf=vectorizer.idf_.tolist(),
        coefficients=classifier.coef_.astype(np.float32).tolist(),intercept=classifier.intercept_.tolist(),
        ngram_range=[1,2],sublinear_tf=True,max_chars=512)
    # numpy vocabulary indices require conversion to JSON integers.
    weights['vocabulary']={key:int(value) for key,value in weights['vocabulary'].items()}
    weight_bytes=json.dumps(weights,separators=(',',':')).encode()
    (OUT/'compact_weights.json').write_bytes(weight_bytes)
    (OUT/'label_map.json').write_text(json.dumps({str(i):label for i,label in enumerate(classifier.classes_)},indent=2))
    report=dict(model='cts_classifier',architecture='TF-IDF unigram/bigram + balanced logistic regression',
        original_checkpoint_recovered=False,train_count=len(train_indices),product_calibration_count=len(calibration),test_count=len(test_indices),
        class_distribution=dict(collections.Counter(labels)),metrics=metrics,
        sources=dict(collections.Counter(row['source'] for row in corpus)),
        split='seeded stratified 80/20, deduplicated text; same-source holdout, not independent real traffic',
        limitations=['No private training data used. Sales examples are synthetic. Quality gates need independent product probes; source or template overlap can inflate holdout results.'],
        weight_sha256=hashlib.sha256(weight_bytes).hexdigest(),duration_seconds=time.perf_counter()-started)
    (ROOT/'reports/compact_classifier_training.json').write_text(json.dumps(report,indent=2))
    (DATA/'heldout.jsonl').write_text(''.join(json.dumps(corpus[i])+'\n' for i in test_indices),encoding='utf8')
    print('Saved compact classifier',OUT,flush=True)

if __name__=='__main__':main()
