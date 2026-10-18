"""AETHERION v0.4 offline trainer. Requires NumPy and PyTorch (CPU).
Run from repository root: python lab/generate/v4/train.py
Tiny authored Korean corpus; NOT a general-purpose LLM.
"""
import json, math, base64, random
from pathlib import Path
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

ROOT=Path(__file__).resolve().parent
pairs=[line.split('\t',1) for line in (ROOT/'corpus.tsv').read_text().splitlines() if '\t' in line]
assert len(pairs)==94
C,D,FD=96,32,64
vocab=['<unk>']+sorted(set(''.join(q+a for q,a in pairs)+'Q: A:\n!?.,0123456789 '))
stoi={ch:i for i,ch in enumerate(vocab)}
assert len(vocab)==376
entries=[]
for question,answer in pairs:
    for ix,text in enumerate((question,question+'?','혹시 '+question,question+' 알려줘')):
        prompt='Q: '+text+'\nA: '
        ids=[stoi.get(ch,0) for ch in prompt+answer+'\n']
        if len(ids)<=C+1 and ix!=1:entries.append((ids,len(prompt)))
X=torch.zeros(len(entries),C,dtype=torch.long)
Y=torch.zeros_like(X)
Mask=torch.zeros_like(X,dtype=torch.float32)
for i,(ids,prefix) in enumerate(entries):
    seq=torch.tensor(ids)
    end=min(C,len(ids)-1)
    X[i,:end]=seq[:end];Y[i,:end]=seq[1:end+1]
    Mask[i,prefix-1:end]=1

class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.E=nn.Embedding(len(vocab),D)
        self.P=nn.Parameter(torch.randn(C,D)*.01)
        self.wq=nn.Linear(D,D,bias=False);self.wk=nn.Linear(D,D,bias=False)
        self.wv=nn.Linear(D,D,bias=False);self.wo=nn.Linear(D,D,bias=False)
        self.ln1=nn.LayerNorm(D,elementwise_affine=False)
        self.ln2=nn.LayerNorm(D,elementwise_affine=False)
        self.ln3=nn.LayerNorm(D,elementwise_affine=False)
        self.fc1=nn.Linear(D,FD);self.fc2=nn.Linear(FD,D)
        self.outBias=nn.Parameter(torch.zeros(len(vocab)))
    def forward(self,tokens):
        B,T=tokens.shape
        x=self.E(tokens)+self.P[:T]
        n=self.ln1(x)
        q=self.wq(n);k=self.wk(n);v=self.wv(n)
        scores=q@k.transpose(-1,-2)/math.sqrt(D)
        mask=torch.triu(torch.ones(T,T,dtype=torch.bool,device=tokens.device),diagonal=1)
        attended=F.softmax(scores.masked_fill(mask,-1e4),dim=-1)@v
        h=x+self.wo(attended)
        z=h+self.fc2(F.relu(self.fc1(self.ln2(h))))
        return self.ln3(z)@self.E.weight.T+self.outBias

def param(model):
    return {'E':model.E.weight,'P':model.P,'wq':model.wq.weight,'wk':model.wk.weight,
      'wv':model.wv.weight,'wo':model.wo.weight,'fc1':model.fc1.weight,'fc1b':model.fc1.bias,
      'fc2':model.fc2.weight,'fc2b':model.fc2.bias,'outb':model.outBias}

def quant(model):
    weights=[];offsets={};scales={}
    for key,t in param(model).items():
        values=t.detach().flatten().numpy()
        scale=float(np.max(np.abs(values)) or 1)/127
        ints=np.clip(np.rint(values/scale),-127,127).astype('int8')
        offsets[key]=[len(weights),len(ints)];scales[key]=scale
        weights.extend(map(int,ints))
    return weights,offsets,scales

def restore(model,weights,offsets,scales):
    with torch.no_grad():
        for key,t in param(model).items():
            start,n=offsets[key]
            a=np.asarray(weights[start:start+n],dtype='float32')*scales[key]
            t.copy_(torch.tensor(a).reshape(t.shape))

def train(steps,lr,prior=None):
    random.seed(75391);np.random.seed(75391);torch.manual_seed(75391)
    model=Net()
    if prior:restore(model,*prior)
    optimizer=torch.optim.AdamW(model.parameters(),lr=lr,weight_decay=.003)
    for step in range(steps):
        idx=torch.randint(0,len(entries),(24,))
        bx,by,mask=X[idx],Y[idx],Mask[idx]
        logits=model(bx)
        entropy=F.cross_entropy(logits.reshape(-1,len(vocab)),by.reshape(-1),reduction='none').reshape_as(by)
        loss=(entropy*mask).sum()/mask.sum()
        optimizer.zero_grad(set_to_none=True);loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(),1.0);optimizer.step()
        if (step+1)%500==0:print('step',step+1,'of',steps,'loss',round(loss.item(),4),flush=True)
    return quant(model)

if __name__=='__main__':
    torch.set_num_threads(2)
    packed=None
    for steps,lr in [(2100,.004),(1600,.0017),(1000,.0008)]:
        packed=train(steps,lr,packed)
    weights,offsets,scales=packed
    data={'version':'native-generator-0.4',
      'architecture':'one-layer one-head causal Transformer Q8',
      'd_model':D,'ffn':FD,'context':C,'vocab':vocab,
      'pair_count':len(pairs),'augmented_samples':len(pairs)*4,'train_steps':4700,
      'note':'Toy model on authored Korean examples; not a general-purpose LLM.',
      'offsets':offsets,'scales':scales,
      'quantized_weights_b64':base64.b64encode(np.asarray(weights,dtype='int8').tobytes()).decode('ascii')}
    out=ROOT/'model.json'
    out.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
    print('Saved',out,'vocab',len(vocab),'weights',len(weights),'bytes',out.stat().st_size,flush=True)
