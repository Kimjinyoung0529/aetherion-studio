"""AETHERION Native Generator v0.2 — toy causal Transformer weight builder.
PyTorch is used for offline TRAINING ONLY; browser inference is handwritten WGSL.
Deterministic tiny Korean conversational corpus. Not Noema or general LLM.
"""
import json,base64,math,random
from pathlib import Path
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
torch.set_num_threads(3)
random.seed(3409);torch.manual_seed(3409)
pairs=[
("안녕","안녕하세요. 저는 에테리온 실험 모델입니다."),
("안녕하세요","반갑습니다. 오늘은 무엇을 만들까요?"),
("너 누구야","저는 브라우저에서 실행하는 작은 생성형 모델입니다."),
("무엇을 할 수 있어","짧은 문장을 한 글자씩 생성하는 실험입니다."),
("WebGPU가 뭐야","WebGPU는 브라우저에서 그래픽 장치를 사용하는 기술입니다."),
("GPU란","GPU는 많은 계산을 병렬로 수행하는 장치입니다."),
("왜 느려","작은 모델도 기기와 브라우저에 따라 속도가 다릅니다."),
("최적화 해줘","메모리를 줄이고 계산을 묶으면 더 빠르게 만들 수 있습니다."),
("어떤 모델이야","작은 인과적 어텐션 모델로 문장을 생성합니다."),
("Noema와 같아","아니요. 저는 별도의 소형 실험 모델입니다."),
("대화할 수 있어","아주 짧은 실험용 대화만 할 수 있습니다."),
("인공지능이 뭐야","인공지능은 데이터에서 패턴을 학습해 계산합니다."),
("에이전트가 뭐야","에이전트는 목표를 단계별로 처리하는 프로그램입니다."),
("학습이 뭐야","학습은 정답과 예측의 차이를 줄이는 과정입니다."),
("모델이란","모델은 학습한 숫자 가중치의 집합입니다."),
("반가워","저도 반가워요. 즐거운 실험을 시작해요."),
("회사 소개해줘","에테리온은 우리가 만든 가상 AI 기술 브랜드입니다."),
("코딩 도와줘","코드를 작게 나누어 테스트하면 안정적으로 개발할 수 있습니다."),
("보안은 어때","이 실험의 추론은 브라우저 안에서 이루어집니다."),
("GPU 테스트","연산 결과와 시간을 보고 장치가 작동하는지 확인합니다."),
("무슨 언어 써","한국어로 짧은 문장을 생성하는 실험입니다."),
("고마워","도움이 되었다니 기쁩니다."),
("잘 가","다음에 만나요."),
("오늘 할 일","오늘은 코드 작성과 작은 테스트를 진행해요."),
]
corpus="".join(("Q: "+q+"\nA: "+a+"\n\n")*3 for q,a in pairs)*2
vocab=["<unk>"]+sorted(set(corpus+"?!.0123456789"))
V=len(vocab);D=16;Fdim=32;C=48
stoi={c:i for i,c in enumerate(vocab)}
encoded=torch.tensor([stoi.get(ch,0) for ch in corpus],dtype=torch.long)
class Model(nn.Module):
 def __init__(self):
  super().__init__()
  self.E=nn.Embedding(V,D)
  self.P=nn.Parameter(torch.randn(C,D)*.01)
  self.wq=nn.Linear(D,D,bias=False);self.wk=nn.Linear(D,D,bias=False)
  self.wv=nn.Linear(D,D,bias=False);self.wo=nn.Linear(D,D,bias=False)
  self.ln1=nn.LayerNorm(D,elementwise_affine=False)
  self.ln2=nn.LayerNorm(D,elementwise_affine=False)
  self.ln3=nn.LayerNorm(D,elementwise_affine=False)
  self.fc1=nn.Linear(D,Fdim);self.fc2=nn.Linear(Fdim,D)
  self.outBias=nn.Parameter(torch.zeros(V))
 def forward(self,tokens):
  batch,T=tokens.shape
  x=self.E(tokens)+self.P[:T]
  n=self.ln1(x)
  q=self.wq(n);k=self.wk(n);v=self.wv(n)
  scores=q@k.transpose(-1,-2)/math.sqrt(D)
  mask=torch.triu(torch.ones(T,T,dtype=torch.bool),diagonal=1)
  weights=F.softmax(scores.masked_fill(mask,-1e4),dim=-1)
  h=x+self.wo(weights@v)
  z=h+self.fc2(F.relu(self.fc1(self.ln2(h))))
  return self.ln3(z)@self.E.weight.T+self.outBias
m=Model();opt=torch.optim.AdamW(m.parameters(),lr=.006,weight_decay=.004)
for step in range(3500):
 positions=torch.randint(0,len(encoded)-C-1,(35,))
 xs=encoded[positions[:,None]+torch.arange(C+1)]
 loss=F.cross_entropy(m(xs[:,:-1]).reshape(-1,V),xs[:,1:].reshape(-1))
 opt.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_(m.parameters(),1.0);opt.step()
 if step%500==499:print("step",step+1,"loss",round(loss.item(),4),flush=True)
params={"E":m.E.weight,"P":m.P,"wq":m.wq.weight,"wk":m.wk.weight,
"wv":m.wv.weight,"wo":m.wo.weight,"fc1":m.fc1.weight,"fc1b":m.fc1.bias,
"fc2":m.fc2.weight,"fc2b":m.fc2.bias,"outb":m.outBias}
weights=[];offsets={};scales={}
for name,t in params.items():
 values=t.detach().flatten().numpy()
 scale=float(np.max(np.abs(values)) or 1)/127
 ints=np.clip(np.rint(values/scale),-127,127).astype("int8")
 offsets[name]=[len(weights),len(ints)];scales[name]=scale
 weights.extend(int(x) for x in ints)
out={"version":"native-generator-0.2","architecture":"one-layer single-head causal Transformer",
"d_model":D,"ffn":Fdim,"context":C,"vocab":vocab,"pair_count":len(pairs),
"train_steps":3500,"note":"Limited toy text generation; NOT Noema, not production LLM.",
"offsets":offsets,"scales":scales,
"quantized_weights_b64":base64.b64encode(np.array(weights,dtype="int8").tobytes()).decode()}
Path("lab/generator-model.json").write_text(json.dumps(out,ensure_ascii=False,separators=(",",":"))+"\n")
print("Generated",len(weights),"weights",len(vocab),"tokens",flush=True)
