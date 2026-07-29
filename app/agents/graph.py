from typing import TypedDict
from langgraph.graph import StateGraph, END
from openai import OpenAI
from app.core.config import settings
from app.core.models import SourceRef
from app.retrieval.hybrid import retriever

class State(TypedDict,total=False):
    question:str; query:str; route:str; contexts:list; answer:str; citations:list; retries:int; relevant:bool

def route(s:State):
    q=s["question"].lower()
    s["route"]="sql" if any(x in q for x in ["sql","database","table schema"]) else "knowledge"
    s["query"]=s["question"]; s["retries"]=0
    return s

def retrieve(s:State): s["contexts"]=retriever.search(s["query"]); return s

def validate(s:State):
    s["relevant"]=bool(s["contexts"]) and any(w in " ".join(x.text.lower() for x in s["contexts"]) for w in s["question"].lower().split() if len(w)>3)
    return s

def rewrite(s:State): s["query"]="Corporate knowledge question: "+s["question"]+" Include exact names, numbers, tables, charts and policy terminology."; s["retries"]+=1; return s

def generate(s:State):
    ctx="\n\n".join(f"[{i+1}] {b.text}" for i,b in enumerate(s["contexts"]))
    if settings.openai_api_key:
        client=OpenAI(api_key=settings.openai_api_key)
        r=client.chat.completions.create(model=settings.openai_chat_model,temperature=0,messages=[{"role":"system","content":"Answer only from supplied evidence. Cite claims using [1], [2]. Say when evidence is insufficient."},{"role":"user","content":f"Question: {s['question']}\nEvidence:\n{ctx}"}])
        s["answer"]=r.choices[0].message.content or ""
    else:s["answer"]="OPENAI_API_KEY is not configured. Retrieved evidence:\n\n"+ctx[:5000]
    s["citations"]=[SourceRef(source_id=b.source_id,file_name=b.metadata.get("file_name","source"),locator=b.metadata.get("locator",""),url=b.metadata.get("url")) for b in s["contexts"]]
    return s

def decide(s:State): return "generate" if s["relevant"] or s["retries"]>=settings.max_corrective_retries else "rewrite"

g=StateGraph(State); g.add_node("route",route); g.add_node("retrieve",retrieve); g.add_node("validate",validate); g.add_node("rewrite",rewrite); g.add_node("generate",generate)
g.set_entry_point("route"); g.add_edge("route","retrieve"); g.add_edge("retrieve","validate"); g.add_conditional_edges("validate",decide,{"generate":"generate","rewrite":"rewrite"}); g.add_edge("rewrite","retrieve"); g.add_edge("generate",END)
agent_graph=g.compile()
